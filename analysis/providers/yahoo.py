"""Shared Yahoo Finance candle download for forex and metals.

Forex callers drop volume: the FX ticker's volume is not traded volume.
Metals futures (GC=F, SI=F) keep volume, because that column is contract volume.
"""

import logging
import math
from datetime import datetime, timedelta, timezone

import pandas as pd

from errors import InvalidSymbolError, MarketDataError
from providers.base import OHLCVBar, clean_bars, new_bar

logger = logging.getLogger(__name__)

# Yahoo's intraday history is capped. Stay inside the window it actually serves.
_MAX_LOOKBACK = {
    "1m": timedelta(days=7),
    "5m": timedelta(days=59),
    "15m": timedelta(days=59),
    "30m": timedelta(days=59),
    "1h": timedelta(days=729),
    "4h": timedelta(days=729),
    "1d": timedelta(days=365 * 15),
}

_BAR_MINUTES = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "1h": 60,
    "4h": 240,
    "1d": 60 * 24,
}

_YF_INTERVAL = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1h",
    "4h": "1h",  # resampled to 4h after the download
    "1d": "1d",
}

_LABEL = {"forex": "Forex", "metals": "Metals"}


def download_yahoo_bars(
    ticker_symbol: str,
    symbol: str,
    asset_type: str,
    timeframe: str,
    limit: int,
    *,
    include_volume: bool,
) -> list[OHLCVBar]:
    """Return cleaned bars, oldest first. `include_volume` false stores null volume."""
    frame = _download(ticker_symbol, symbol, asset_type, timeframe, limit, include_volume)
    if timeframe == "4h":
        frame = _resample_4h(frame)
    bars = clean_bars(_frame_to_bars(frame, include_volume=include_volume), limit)
    if not bars:
        raise InvalidSymbolError(symbol, asset_type, unknown_market=True)
    return bars


def _download(
    ticker_symbol: str,
    symbol: str,
    asset_type: str,
    timeframe: str,
    limit: int,
    include_volume: bool,
) -> pd.DataFrame:
    end = datetime.now(timezone.utc) + timedelta(minutes=1)
    max_lookback = _MAX_LOOKBACK[timeframe]
    # 2x calendar time covers the weekend close, and 4h resampling
    # which needs four 1h bars per returned candle.
    span = min(max_lookback, timedelta(minutes=_BAR_MINUTES[timeframe] * limit * 2))
    frame = _history(
        ticker_symbol,
        symbol,
        asset_type,
        _YF_INTERVAL[timeframe],
        end - span,
        end,
        include_volume,
    )
    if _short(frame, limit, timeframe) and span < max_lookback - timedelta(hours=1):
        wider = _history(
            ticker_symbol,
            symbol,
            asset_type,
            _YF_INTERVAL[timeframe],
            end - max_lookback,
            end,
            include_volume,
        )
        if not wider.empty:
            frame = wider
    if frame.empty:
        raise InvalidSymbolError(symbol, asset_type, unknown_market=True)
    return frame


def _short(frame: pd.DataFrame, limit: int, timeframe: str) -> bool:
    if frame.empty:
        return True
    if timeframe == "4h":
        return len(frame) < limit * 4
    return len(frame) < limit


def _history(
    ticker_symbol: str,
    symbol: str,
    asset_type: str,
    interval: str,
    start: datetime,
    end: datetime,
    include_volume: bool,
) -> pd.DataFrame:
    import yfinance as yf

    label = _LABEL.get(asset_type, asset_type)
    ticker = yf.Ticker(ticker_symbol)
    try:
        try:
            frame = ticker.history(
                start=start,
                end=end,
                interval=interval,
                auto_adjust=False,
                actions=False,
                timeout=20,
            )
        except TypeError:
            # Older yfinance builds do not accept every keyword above.
            frame = ticker.history(start=start, end=end, interval=interval)
    except Exception as exc:
        if _missing_symbol(exc):
            raise InvalidSymbolError(symbol, asset_type, unknown_market=True) from exc
        logger.warning("yfinance failed for %s: %s", ticker_symbol, exc.__class__.__name__)
        raise MarketDataError(f"{label} data is temporarily unavailable for {symbol}.") from exc

    if frame is None or frame.empty:
        return pd.DataFrame()
    return _prepare_frame(frame, include_volume=include_volume, label=label)


def _missing_symbol(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(token in text for token in ("not found", "no data found", "delisted", "invalid ticker"))


def _prepare_frame(frame: pd.DataFrame, *, include_volume: bool, label: str) -> pd.DataFrame:
    if isinstance(frame.columns, pd.MultiIndex):
        frame = frame.copy()
        frame.columns = frame.columns.get_level_values(0)
    frame = frame.rename(columns=lambda name: str(name).title())
    needed = ["Open", "High", "Low", "Close"]
    if any(name not in frame.columns for name in needed):
        raise MarketDataError(f"{label} data did not include OHLC prices.")
    columns = list(needed)
    # Missing volume stays off the frame so callers store null instead of zero.
    if include_volume and "Volume" in frame.columns:
        columns.append("Volume")
    prepared = frame.loc[:, columns].copy()
    prepared.index = pd.to_datetime(prepared.index, utc=True)
    prepared = prepared.dropna(subset=needed).sort_index()
    return prepared


def _resample_4h(frame: pd.DataFrame) -> pd.DataFrame:
    """Yahoo has no 4h interval. Fold UTC 1h bars into 4h candles."""
    agg = {"Open": "first", "High": "max", "Low": "min", "Close": "last"}
    if "Volume" in frame.columns:
        agg["Volume"] = "sum"
    ohlc = frame.resample("4h", label="left", closed="left").agg(agg)
    return ohlc.dropna(subset=["Open", "High", "Low", "Close"])


def _frame_to_bars(frame: pd.DataFrame, *, include_volume: bool) -> list[OHLCVBar]:
    bars: list[OHLCVBar] = []
    for timestamp, row in frame.iterrows():
        bars.append(
            new_bar(
                timestamp=timestamp.to_pydatetime(),
                open_=row["Open"],
                high=row["High"],
                low=row["Low"],
                close=row["Close"],
                volume=_volume(row) if include_volume else None,
            )
        )
    return bars


def _volume(row: pd.Series) -> float | None:
    if "Volume" not in row.index:
        return None
    raw = row["Volume"]
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return None
    value = float(raw)
    if not math.isfinite(value) or value < 0:
        return None
    return value
