"""Shared OHLCV contract. Indicators and the API depend on this, not on a vendor."""

import math
from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from datetime import datetime, timezone

from errors import InvalidRequestError, UnsupportedTimeframeError

# One set for crypto, forex, and metals. Providers map these onto vendor intervals.
TIMEFRAMES: tuple[str, ...] = ("1m", "5m", "15m", "30m", "1h", "4h", "1d")

# Binance public klines cap a single request at 1000. Stay inside that.
MAX_LIMIT = 1000


@dataclass(frozen=True)
class OHLCVBar:
    """One candle. `volume` is null when the source has no real traded volume."""

    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float | None


class MarketDataProvider(ABC):
    """Vendor adapter. `get_ohlcv` is the only method callers need."""

    @abstractmethod
    def get_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        """Return up to `limit` bars, oldest first, timestamps in UTC."""

    def normalize_symbol(self, symbol: str) -> str:
        return symbol.strip().upper()


def validate_ohlcv_request(timeframe: str, limit: int) -> None:
    if timeframe not in TIMEFRAMES:
        raise UnsupportedTimeframeError(timeframe, TIMEFRAMES)
    # bool is a subclass of int; reject it so True is not treated as limit=1.
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_LIMIT:
        raise InvalidRequestError(f"limit must be an integer from 1 to {MAX_LIMIT}.")


def new_bar(
    timestamp: datetime,
    open_: float,
    high: float,
    low: float,
    close: float,
    volume: float | None,
) -> OHLCVBar:
    """Build a UTC bar. Naive timestamps are treated as UTC, matching exchange clocks."""
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    else:
        timestamp = timestamp.astimezone(timezone.utc)
    cleaned_volume = None if volume is None else float(volume)
    return OHLCVBar(
        timestamp=timestamp.replace(microsecond=0),
        open=float(open_),
        high=float(high),
        low=float(low),
        close=float(close),
        volume=cleaned_volume,
    )


def clean_bars(bars: list[OHLCVBar], limit: int) -> list[OHLCVBar]:
    """Drop unusable candles and keep the most recent `limit`, oldest first.

    Indicators assume ascending time. A newest-first vendor payload would
    silently invert RSI and EMA, so the sort lives here for every provider.
    """
    kept: list[OHLCVBar] = []
    for bar in bars:
        prices = (bar.open, bar.high, bar.low, bar.close)
        if any(not math.isfinite(price) or price <= 0 for price in prices):
            continue
        if bar.high < bar.low:
            continue
        if bar.volume is not None and (not math.isfinite(bar.volume) or bar.volume < 0):
            bar = replace(bar, volume=None)
        kept.append(bar)

    ordered = sorted(kept, key=lambda bar: bar.timestamp)
    unique: dict[datetime, OHLCVBar] = {}
    for bar in ordered:
        unique[bar.timestamp] = bar
    trimmed = list(unique.values())
    if len(trimmed) > limit:
        trimmed = trimmed[-limit:]
    return trimmed
