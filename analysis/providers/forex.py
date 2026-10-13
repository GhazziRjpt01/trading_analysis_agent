"""Forex OHLCV.

YFinance is the default source. Symbols are normalized to a six-letter pair
(EURUSD) and sent to Yahoo as EURUSD=X.

Twelve Data is a second ForexSource. It is not wired to HTTP yet: selecting
FOREX_SOURCE=twelvedata fails clearly until that fetch method is filled in.
Its pairs are BASE/QUOTE (EUR/USD), and the key is TWELVE_DATA_API_KEY.
"""

import logging
from abc import ABC, abstractmethod

from config import settings
from errors import InvalidSymbolError, MarketDataError
from providers.base import OHLCVBar, MarketDataProvider, validate_ohlcv_request
from providers.yahoo import download_yahoo_bars


def normalize_forex_symbol(symbol: str) -> str:
    """EURUSD, EUR/USD, and EURUSD=X all become EURUSD."""
    cleaned = symbol.strip().upper().replace(" ", "")
    if cleaned.endswith("=X"):
        cleaned = cleaned[:-2]
    cleaned = cleaned.replace("/", "").replace("-", "")
    if len(cleaned) > 12 or not cleaned.isalpha() or len(cleaned) != 6:
        raise InvalidSymbolError(symbol.strip() or symbol, "forex")
    return cleaned


class ForexSource(ABC):
    """One forex vendor. Return the shared OHLCV bars, volume left null."""

    @abstractmethod
    def fetch(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        """`symbol` is canonical, for example EURUSD."""


class YFinanceSource(ForexSource):
    def fetch(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        # Yahoo FX tickers are the pair plus =X. That volume is not traded
        # volume, so the bars store null instead of a guessed number.
        return download_yahoo_bars(
            f"{symbol}=X",
            symbol,
            "forex",
            timeframe,
            limit,
            include_volume=False,
        )


class TwelveDataSource(ForexSource):
    """Placeholder. Implement `fetch` here when the HTTP client is added.

    Do not hardcode the key. `config.settings.twelve_data_api_key` already
    reads TWELVE_DATA_API_KEY from the environment.
    """

    def __init__(self, api_key: str):
        if not api_key or api_key == "your_twelve_data_api_key":
            raise MarketDataError(
                "TWELVE_DATA_API_KEY is not set. Add it to analysis/.env, "
                "or set FOREX_SOURCE=yfinance."
            )
        self._api_key = api_key

    def fetch(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        vendor_symbol = f"{symbol[:3]}/{symbol[3:]}"
        raise MarketDataError(
            f"Twelve Data is not implemented yet (would request {vendor_symbol}). "
            "Set FOREX_SOURCE=yfinance."
        )


class ForexProvider(MarketDataProvider):
    def __init__(self, source: ForexSource | None = None):
        self._source = source if source is not None else build_forex_source()
        # yfinance logs a long error string for unknown tickers. The API
        # already returns InvalidSymbolError for that case.
        logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    def normalize_symbol(self, symbol: str) -> str:
        return normalize_forex_symbol(symbol)

    def get_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        symbol = self.normalize_symbol(symbol)
        validate_ohlcv_request(timeframe, limit)
        return self._source.fetch(symbol, timeframe, limit)


def build_forex_source() -> ForexSource:
    name = settings.forex_source
    if name == "yfinance":
        return YFinanceSource()
    if name == "twelvedata":
        return TwelveDataSource(settings.twelve_data_api_key)
    raise MarketDataError(
        f"Unknown FOREX_SOURCE '{name}'. Use yfinance, or add a ForexSource "
        "and select it here."
    )
