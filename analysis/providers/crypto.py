"""Crypto OHLCV from public ccxt endpoints.

Binance is tried first. If that market is missing or the call fails, the
fallback exchange (Bybit by default) is used. No API key is sent, and this
module never calls order, cancel, or withdrawal methods.
"""

import logging
import re
from datetime import datetime, timezone
from threading import Lock

import ccxt

from config import settings
from errors import InvalidSymbolError, MarketDataError
from providers.base import (
    OHLCVBar,
    MarketDataProvider,
    clean_bars,
    new_bar,
    validate_ohlcv_request,
)

logger = logging.getLogger(__name__)

# BASE/QUOTE. Spaces are stripped before this runs.
_PAIR = re.compile(r"^[A-Z0-9]{2,15}/[A-Z0-9]{2,15}$")


def normalize_crypto_symbol(symbol: str) -> str:
    cleaned = symbol.strip().upper().replace(" ", "")
    if len(cleaned) > 32 or not _PAIR.fullmatch(cleaned):
        raise InvalidSymbolError(symbol.strip() or symbol, "crypto")
    return cleaned


class CryptoProvider(MarketDataProvider):
    def __init__(
        self,
        exchange_id: str | None = None,
        fallback_id: str | None = None,
    ):
        primary_id = (exchange_id or settings.crypto_exchange).strip().lower()
        secondary_id = (fallback_id or settings.crypto_fallback_exchange).strip().lower()
        self._exchanges = [_build_exchange(primary_id)]
        # Same id twice would just double a failure. One attempt is enough.
        if secondary_id != primary_id:
            self._exchanges.append(_build_exchange(secondary_id))
        self._locks = {exchange.id: Lock() for exchange in self._exchanges}

    def normalize_symbol(self, symbol: str) -> str:
        return normalize_crypto_symbol(symbol)

    def get_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        symbol = self.normalize_symbol(symbol)
        validate_ohlcv_request(timeframe, limit)

        saw_outage = False
        for exchange in self._exchanges:
            try:
                rows = self._fetch(exchange, symbol, timeframe, limit)
            except ccxt.BadSymbol:
                logger.info("%s has no market %s", exchange.id, symbol)
                continue
            except ccxt.BaseError as exc:
                # Network, rate limit, or an exchange-side error. Try the next venue
                # before telling the caller the data is unavailable.
                saw_outage = True
                logger.warning(
                    "%s OHLCV failed for %s (%s). Trying the next exchange.",
                    exchange.id,
                    symbol,
                    exc.__class__.__name__,
                )
                continue
            if not rows:
                continue
            bars = _rows_to_bars(rows, limit)
            if bars:
                if exchange is not self._exchanges[0]:
                    logger.warning("Served %s %s from fallback exchange %s", symbol, timeframe, exchange.id)
                return bars

        if saw_outage:
            raise MarketDataError(f"Market data is temporarily unavailable for {symbol}.")
        raise InvalidSymbolError(symbol, "crypto", unknown_market=True)

    def _fetch(self, exchange, symbol: str, timeframe: str, limit: int) -> list:
        # ccxt clients are not thread-safe. The lock also spaces bursts
        # together with enableRateLimit on the exchange itself.
        with self._locks[exchange.id]:
            return exchange.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)


def _build_exchange(exchange_id: str):
    if exchange_id not in ccxt.exchanges:
        raise MarketDataError(
            f"Unknown ccxt exchange '{exchange_id}'. "
            "Set CRYPTO_EXCHANGE in analysis/.env to a public id such as binance."
        )
    # Credentials are intentionally omitted. Public candle endpoints do not need them.
    exchange = getattr(ccxt, exchange_id)(
        {
            "enableRateLimit": True,
            "timeout": 15000,
            "options": {"defaultType": "spot"},
        }
    )
    if exchange.has.get("fetchOHLCV") is False:
        raise MarketDataError(f"{exchange_id} does not provide OHLCV candles.")
    return exchange


def _rows_to_bars(rows: list, limit: int) -> list[OHLCVBar]:
    bars: list[OHLCVBar] = []
    for row in rows:
        # ccxt shape: [timestamp_ms, open, high, low, close, volume]
        timestamp_ms, open_, high, low, close, volume = row[:6]
        bars.append(
            new_bar(
                timestamp=_ms_to_utc(timestamp_ms),
                open_=open_,
                high=high,
                low=low,
                close=close,
                volume=None if volume is None else float(volume),
            )
        )
    return clean_bars(bars, limit)


def _ms_to_utc(timestamp_ms: int) -> datetime:
    return datetime.fromtimestamp(timestamp_ms / 1000, tz=timezone.utc)
