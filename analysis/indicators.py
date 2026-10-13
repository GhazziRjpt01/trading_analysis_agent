"""Price indicators shared by crypto, forex, and metals.

RSI(14), MACD(12, 26, 9), EMA(20), EMA(50), Bollinger(20, 2), and ATR(14)
always run. OBV, MFI(14), and VWAP run only when every bar has a real
volume. A null volume is left null; it is never treated as zero.
"""

import math

import numpy as np

from providers.base import OHLCVBar

_RSI_PERIOD = 14
_MACD_FAST = 12
_MACD_SLOW = 26
_MACD_SIGNAL = 9
_EMA_FAST = 20
_EMA_SLOW = 50
_BB_PERIOD = 20
_BB_STD = 2.0
_ATR_PERIOD = 14
_MFI_PERIOD = 14

# JSON stays stable. Eight places covers FX pips and typical crypto quotes.
_DECIMALS = 8


def compute_indicators(bars: list[OHLCVBar], *, asset_type: str) -> dict:
    # Volume indicators follow the bars, not the asset class. `asset_type`
    # stays in the signature so every caller passes the class the same way.
    _ = asset_type
    close = np.array([bar.close for bar in bars], dtype=float)
    high = np.array([bar.high for bar in bars], dtype=float)
    low = np.array([bar.low for bar in bars], dtype=float)
    volume = _real_volume(bars)

    ema_20 = _ema(close, _EMA_FAST)
    ema_50 = _ema(close, _EMA_SLOW)
    macd_line = _ema(close, _MACD_FAST) - _ema(close, _MACD_SLOW)
    signal = _ema_from_first_finite(macd_line, _MACD_SIGNAL)
    histogram = macd_line - signal
    middle, upper, lower = _bollinger(close, _BB_PERIOD, _BB_STD)
    rsi = _rsi(close, _RSI_PERIOD)
    atr = _atr(high, low, close, _ATR_PERIOD)
    obv = mfi = vwap = None
    if volume is not None:
        obv = _obv(close, volume)
        mfi = _mfi(high, low, close, volume, _MFI_PERIOD)
        vwap = _vwap(high, low, close, volume)

    points = []
    for index, bar in enumerate(bars):
        point = {
            "timestamp": bar.timestamp,
            "rsi_14": _num(rsi[index]),
            "macd": {
                "macd": _num(macd_line[index]),
                "signal": _num(signal[index]),
                "histogram": _num(histogram[index]),
            },
            "ema_20": _num(ema_20[index]),
            "ema_50": _num(ema_50[index]),
            "bollinger": {
                "middle": _num(middle[index]),
                "upper": _num(upper[index]),
                "lower": _num(lower[index]),
            },
            "atr_14": _num(atr[index]),
        }
        if volume is not None:
            point["obv"] = _num(obv[index])
            point["mfi_14"] = _num(mfi[index])
            point["vwap"] = _num(vwap[index])
        points.append(point)

    payload: dict = {"latest": points[-1], "points": points}
    if len(bars) < _EMA_SLOW:
        payload["warning"] = (
            "Not enough bars to compute every indicator. EMA 50 needs at least 50 bars."
        )
    if volume is None:
        payload["note"] = (
            "Volume-based indicators are omitted because this source has no real volume."
        )
    return payload


def ema(values: np.ndarray, period: int) -> np.ndarray:
    """Chart EMA. Backtests call this so they stay on the same series as the pane."""
    return _ema(values, period)


def _ema(values: np.ndarray, period: int) -> np.ndarray:
    """Recursive EMA seeded with an SMA.

    alpha = 2 / (period + 1). The seed avoids a fake EMA on the first prints,
    which is the usual charting definition.
    """
    out = np.full(values.shape, np.nan)
    if len(values) < period:
        return out
    alpha = 2.0 / (period + 1)
    out[period - 1] = np.mean(values[:period])
    for index in range(period, len(values)):
        out[index] = alpha * values[index] + (1.0 - alpha) * out[index - 1]
    return out


def _ema_from_first_finite(values: np.ndarray, period: int) -> np.ndarray:
    """EMA for MACD's signal line, which starts with a stretch of NaN."""
    out = np.full(values.shape, np.nan)
    finite = np.flatnonzero(~np.isnan(values))
    if len(finite) < period:
        return out
    start = int(finite[0])
    seed_at = start + period - 1
    window = values[start : seed_at + 1]
    if len(window) < period or np.isnan(window).any():
        return out
    alpha = 2.0 / (period + 1)
    out[seed_at] = np.mean(window)
    for index in range(seed_at + 1, len(values)):
        if np.isnan(values[index]):
            break
        out[index] = alpha * values[index] + (1.0 - alpha) * out[index - 1]
    return out


def _rsi(close: np.ndarray, period: int) -> np.ndarray:
    """Wilder RSI. A flat window is 50, not 100: there were no gains or losses."""
    out = np.full(close.shape, np.nan)
    if len(close) <= period:
        return out
    delta = np.diff(close)
    gain = np.clip(delta, 0, None)
    loss = np.clip(-delta, 0, None)
    avg_gain = float(np.mean(gain[:period]))
    avg_loss = float(np.mean(loss[:period]))
    out[period] = _rsi_value(avg_gain, avg_loss)
    for index in range(period, len(delta)):
        avg_gain = (avg_gain * (period - 1) + float(gain[index])) / period
        avg_loss = (avg_loss * (period - 1) + float(loss[index])) / period
        out[index + 1] = _rsi_value(avg_gain, avg_loss)
    return out


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _bollinger(close: np.ndarray, period: int, num_std: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Middle is an SMA. Bands use population std (ddof=0), matching common charts."""
    middle = np.full(close.shape, np.nan)
    upper = np.full(close.shape, np.nan)
    lower = np.full(close.shape, np.nan)
    if len(close) < period:
        return middle, upper, lower
    for index in range(period - 1, len(close)):
        window = close[index - period + 1 : index + 1]
        mid = float(np.mean(window))
        spread = float(np.std(window, ddof=0))
        middle[index] = mid
        upper[index] = mid + num_std * spread
        lower[index] = mid - num_std * spread
    return middle, upper, lower


def _atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int) -> np.ndarray:
    """Wilder ATR. The first true range has no previous close, so it is high-low."""
    out = np.full(close.shape, np.nan)
    if len(close) < period:
        return out
    previous_close = np.roll(close, 1)
    previous_close[0] = close[0]
    true_range = np.maximum(
        high - low,
        np.maximum(np.abs(high - previous_close), np.abs(low - previous_close)),
    )
    true_range[0] = high[0] - low[0]
    out[period - 1] = float(np.mean(true_range[:period]))
    for index in range(period, len(close)):
        out[index] = (out[index - 1] * (period - 1) + float(true_range[index])) / period
    return out


def _real_volume(bars: list[OHLCVBar]) -> np.ndarray | None:
    """A volume series only when every bar has one. One null means the feed has none."""
    if not bars:
        return None
    values: list[float] = []
    for bar in bars:
        if bar.volume is None or not math.isfinite(bar.volume) or bar.volume < 0:
            return None
        values.append(float(bar.volume))
    return np.array(values, dtype=float)


def _obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    out = np.full(close.shape, np.nan)
    if len(close) == 0:
        return out
    out[0] = float(volume[0])
    for index in range(1, len(close)):
        if close[index] > close[index - 1]:
            out[index] = out[index - 1] + float(volume[index])
        elif close[index] < close[index - 1]:
            out[index] = out[index - 1] - float(volume[index])
        else:
            out[index] = out[index - 1]
    return out


def _mfi(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    volume: np.ndarray,
    period: int,
) -> np.ndarray:
    """Money Flow Index. A window with no up or down flow is 50, matching flat RSI."""
    out = np.full(close.shape, np.nan)
    if len(close) <= period:
        return out
    typical = (high + low + close) / 3.0
    raw = typical * volume
    positive = np.zeros(len(close))
    negative = np.zeros(len(close))
    for index in range(1, len(close)):
        if typical[index] > typical[index - 1]:
            positive[index] = raw[index]
        elif typical[index] < typical[index - 1]:
            negative[index] = raw[index]
    positive_sum = float(np.sum(positive[1 : period + 1]))
    negative_sum = float(np.sum(negative[1 : period + 1]))
    out[period] = _mfi_value(positive_sum, negative_sum)
    for index in range(period + 1, len(close)):
        positive_sum += float(positive[index] - positive[index - period])
        negative_sum += float(negative[index] - negative[index - period])
        out[index] = _mfi_value(positive_sum, negative_sum)
    return out


def _mfi_value(positive_sum: float, negative_sum: float) -> float:
    if negative_sum == 0:
        return 100.0 if positive_sum > 0 else 50.0
    ratio = positive_sum / negative_sum
    return 100.0 - (100.0 / (1.0 + ratio))


def _vwap(high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """Cumulative VWAP over the returned window. There is no session reset."""
    out = np.full(close.shape, np.nan)
    typical = (high + low + close) / 3.0
    cumulative_pv = 0.0
    cumulative_volume = 0.0
    for index in range(len(close)):
        cumulative_pv += float(typical[index] * volume[index])
        cumulative_volume += float(volume[index])
        if cumulative_volume > 0:
            out[index] = cumulative_pv / cumulative_volume
    return out


def _num(value: float) -> float | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return round(number, _DECIMALS)
