"""Rule-based signal and position size. Prices are computed here, not by a model.

A bar votes with trend (EMA 20/50), momentum (RSI and MACD), and volatility
(Bollinger position). ATR sizes the stop and targets; it does not vote.
Any opposing vote is a conflict, and a conflict is no_trade.
"""

import math

from backtest import STARTING_EQUITY
from errors import InvalidRequestError
from indicators import compute_indicators
from providers.base import TIMEFRAMES
from strategy_backtest import apply_cost, cost_for

PERFORMANCE_NOTE = "Past performance does not predict future results."
SIGNAL_LOOKBACK = 300

# Pullback zone and ATR multiples. Risk/reward uses the worse edge of the
# zone, so a fill at the far side of the zone is the one the ratio assumes.
_ZONE_ATR = 0.25
_STOP_ATR = 1.5
_TP1_ATR = 2.0
_TP2_ATR = 3.5

# Three agreeing votes and no opposition is the minimum trade. Four is high.
_MEDIUM_VOTES = 3
_HIGH_VOTES = 4

_FOREX_LOT_UNITS = 100_000

RULES = (
    "EMA 20 above EMA 50 votes buy, and the reverse votes sell. "
    "RSI above 50 votes buy unless RSI is at least 70, which votes sell. "
    "RSI below 50 votes sell unless RSI is at most 30, which votes buy. "
    "A positive MACD histogram votes buy. "
    "A close above the Bollinger middle votes buy unless the close is above the upper band, which votes sell. "
    "The reverse applies below the middle and the lower band. "
    "ATR sets the stop and targets and does not vote. "
    "One opposing vote, or fewer than three agreeing votes, is no_trade."
)


def parse_signal_request(payload: dict) -> tuple[str, str, str]:
    asset_type, symbol, timeframe = _market_fields(payload)
    return asset_type, symbol, timeframe


def parse_position_request(payload: dict) -> tuple[str, float, float, float, float]:
    if not isinstance(payload, dict):
        raise InvalidRequestError("Request body must be a JSON object.")
    asset_type = str(payload.get("asset_type", "")).strip().lower()
    if asset_type not in ("crypto", "forex", "metals"):
        raise InvalidRequestError("asset_type must be crypto, forex, or metals.")
    balance = _positive_number(payload.get("account_balance"), "account_balance")
    risk_percent = _positive_number(payload.get("risk_percent"), "risk_percent")
    if risk_percent > 100:
        raise InvalidRequestError("risk_percent must be from 0 to 100.")
    entry = _positive_number(payload.get("entry"), "entry")
    stop_loss = _positive_number(payload.get("stop_loss"), "stop_loss")
    if entry == stop_loss:
        raise InvalidRequestError("entry and stop_loss must differ.")
    return asset_type, balance, risk_percent, entry, stop_loss


def run_signal(bars, *, asset_type: str, symbol: str, timeframe: str) -> dict:
    if not bars:
        raise InvalidRequestError("No candles were returned for this symbol.")
    computed = compute_indicators(bars, asset_type=asset_type)
    points = computed["points"]
    decision = decide(points[-1], bars[-1].close)
    stats = backtest_signal_rules(bars, points, asset_type=asset_type, symbol=symbol)
    return {
        "timeframe": timeframe,
        "rules": RULES,
        "direction": decision["direction"],
        "confidence": decision["confidence"],
        "votes": decision["votes"],
        "entry_zone": decision["entry_zone"],
        "stop_loss": decision["stop_loss"],
        "take_profit_1": decision["take_profit_1"],
        "take_profit_2": decision["take_profit_2"],
        "risk_reward": decision["risk_reward"],
        "invalidation": decision["invalidation"],
        "atr": decision["atr"],
        "backtest": stats,
        "performance_note": PERFORMANCE_NOTE,
    }


def decide(point: dict, close: float) -> dict:
    """One bar. Levels are null when the direction is no_trade."""
    votes = _votes(point, close)
    buy = [vote["name"] for vote in votes if vote["vote"] == "buy"]
    sell = [vote["name"] for vote in votes if vote["vote"] == "sell"]
    atr = _finite(point.get("atr_14"))
    direction = "no_trade"
    confidence = "low"
    if atr is not None and buy and not sell and len(buy) >= _MEDIUM_VOTES:
        direction = "buy"
        confidence = "high" if len(buy) >= _HIGH_VOTES else "medium"
    elif atr is not None and sell and not buy and len(sell) >= _MEDIUM_VOTES:
        direction = "sell"
        confidence = "high" if len(sell) >= _HIGH_VOTES else "medium"

    levels = _levels(close, atr, direction) if direction != "no_trade" else _empty_levels()
    return {
        "direction": direction,
        "confidence": confidence,
        "votes": votes,
        "invalidation": _invalidation(direction, buy, sell, atr),
        "atr": None if atr is None else _price(atr),
        **levels,
    }


def position_size(asset_type: str, balance: float, risk_percent: float, entry: float, stop_loss: float) -> dict:
    """Units assume the account is denominated in the quote currency.

    Forex lots are those units divided by 100,000. That is a research
    convention, not a broker contract size.
    """
    risk_amount = balance * (risk_percent / 100.0)
    stop_distance = abs(entry - stop_loss)
    units = risk_amount / stop_distance
    if asset_type == "forex":
        size = units / _FOREX_LOT_UNITS
        unit = "lots"
        lots = _round(size, 4)
    else:
        size = units
        unit = "units"
        lots = None
    return {
        "asset_type": asset_type,
        "account_balance": _round(balance, 2),
        "risk_percent": _round(risk_percent, 4),
        "risk_amount": _round(risk_amount, 2),
        "entry": _price(entry),
        "stop_loss": _price(stop_loss),
        "stop_distance": _price(stop_distance),
        "position_size": _price(size) if unit == "units" else lots,
        "unit": unit,
        "units": _price(units),
        "lots": lots,
        "assumption": (
            "Size assumes the account currency is the quote currency. "
            "Forex lots use 100,000 base units per lot. "
            "Crypto and metals are quoted in base units."
        ),
    }


def backtest_signal_rules(bars, points, *, asset_type: str, symbol: str) -> dict:
    """Same decide() rules. Fill is the next open. A bar that touches both barriers counts as the stop."""
    if len(points) != len(bars):
        return _stats(None, 0.0, 0, "Indicator points do not match the candles.")
    # EMA 50 is undefined before bar 50, so those bars abstain. A shorter
    # window can still score bars whose points are already complete.
    warning = None
    if len(bars) < 52:
        warning = "Not enough bars to score this rule set. EMA 50 needs at least 50 bars."

    cost = cost_for(asset_type, symbol)
    equity = STARTING_EQUITY
    position = None
    trades: list[dict] = []
    peak = equity
    max_drawdown = 0.0

    for index, bar in enumerate(bars):
        if position is None and index > 0:
            decision = decide(points[index - 1], bars[index - 1].close)
            if decision["direction"] in ("buy", "sell") and decision["stop_loss"] is not None:
                side = "long" if decision["direction"] == "buy" else "short"
                position = {
                    "side": side,
                    "entry_price": apply_cost(bar.open, side, "entry", cost),
                    "stop": decision["stop_loss"],
                    "tp": decision["take_profit_1"],
                    "entry_equity": equity,
                }

        if position is not None:
            barrier = _barrier(position, bar)
            if barrier is not None:
                equity = _close_at(position, apply_cost(barrier, position["side"], "exit", cost), cost.fee_rate, trades)
                position = None

        marked = equity if position is None else _marked(position, bar.close, cost)
        if marked > peak:
            peak = marked
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - marked) / peak)

    if position is not None:
        last = bars[-1]
        equity = _close_at(
            position,
            apply_cost(last.close, position["side"], "exit", cost),
            cost.fee_rate,
            trades,
        )
        if equity > peak:
            peak = equity
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - equity) / peak)

    wins = sum(1 for trade in trades if trade["pnl"] > 0)
    win_rate = None if not trades else wins / len(trades) * 100.0
    return _stats(win_rate, max_drawdown * 100.0, len(trades), warning)


def _votes(point: dict, close: float) -> list[dict]:
    ema_fast = _finite(point.get("ema_20"))
    ema_slow = _finite(point.get("ema_50"))
    rsi = _finite(point.get("rsi_14"))
    macd = point.get("macd") if isinstance(point.get("macd"), dict) else {}
    histogram = _finite(macd.get("histogram"))
    bands = point.get("bollinger") if isinstance(point.get("bollinger"), dict) else {}
    middle = _finite(bands.get("middle"))
    upper = _finite(bands.get("upper"))
    lower = _finite(bands.get("lower"))

    trend = "abstain"
    if ema_fast is not None and ema_slow is not None:
        if ema_fast > ema_slow:
            trend = "buy"
        elif ema_fast < ema_slow:
            trend = "sell"

    momentum_rsi = "abstain"
    if rsi is not None:
        if rsi >= 70:
            momentum_rsi = "sell"
        elif rsi <= 30:
            momentum_rsi = "buy"
        elif rsi > 50:
            momentum_rsi = "buy"
        elif rsi < 50:
            momentum_rsi = "sell"

    momentum_macd = "abstain"
    if histogram is not None:
        if histogram > 0:
            momentum_macd = "buy"
        elif histogram < 0:
            momentum_macd = "sell"

    volatility = "abstain"
    if middle is not None and upper is not None and lower is not None and math.isfinite(close):
        if close > upper:
            volatility = "sell"
        elif close < lower:
            volatility = "buy"
        elif close > middle:
            volatility = "buy"
        elif close < middle:
            volatility = "sell"

    return [
        {"name": "EMA 20/50", "vote": trend},
        {"name": "RSI", "vote": momentum_rsi},
        {"name": "MACD", "vote": momentum_macd},
        {"name": "Bollinger", "vote": volatility},
    ]


def _levels(close: float, atr: float, direction: str) -> dict:
    zone = _ZONE_ATR * atr
    if direction == "buy":
        entry_low = close - zone
        entry_high = close
        stop = entry_low - _STOP_ATR * atr
        anchor = entry_high
        take_profit_1 = anchor + _TP1_ATR * atr
        take_profit_2 = anchor + _TP2_ATR * atr
    else:
        entry_low = close
        entry_high = close + zone
        stop = entry_high + _STOP_ATR * atr
        anchor = entry_low
        take_profit_1 = anchor - _TP1_ATR * atr
        take_profit_2 = anchor - _TP2_ATR * atr
    risk = abs(anchor - stop)
    reward = abs(take_profit_1 - anchor)
    ratio = None if risk == 0 else reward / risk
    return {
        "entry_zone": {"low": _price(entry_low), "high": _price(entry_high)},
        "stop_loss": _price(stop),
        "take_profit_1": _price(take_profit_1),
        "take_profit_2": _price(take_profit_2),
        "risk_reward": None if ratio is None else round(ratio, 4),
    }


def _empty_levels() -> dict:
    return {
        "entry_zone": None,
        "stop_loss": None,
        "take_profit_1": None,
        "take_profit_2": None,
        "risk_reward": None,
    }


def _invalidation(direction: str, buy: list[str], sell: list[str], atr: float | None) -> list[str]:
    if direction == "buy":
        return [
            "A close below the stop loss.",
            "EMA 20 crossing below EMA 50.",
            "MACD histogram turning negative.",
        ]
    if direction == "sell":
        return [
            "A close above the stop loss.",
            "EMA 20 crossing above EMA 50.",
            "MACD histogram turning positive.",
        ]
    reasons = []
    if atr is None:
        reasons.append("ATR is unavailable, so the stop cannot be placed.")
    if buy and sell:
        reasons.append(f"Buy votes ({', '.join(buy)}) conflict with sell votes ({', '.join(sell)}).")
    elif len(buy) < _MEDIUM_VOTES and len(sell) < _MEDIUM_VOTES:
        reasons.append("Fewer than three indicators agree.")
    if not reasons:
        reasons.append("The indicators do not agree on a direction.")
    return reasons


def _barrier(position: dict, bar) -> float | None:
    # Stop wins when one candle reaches both prices. The path inside the bar is unknown.
    if position["side"] == "long":
        if bar.low <= position["stop"]:
            return position["stop"]
        if bar.high >= position["tp"]:
            return position["tp"]
        return None
    if bar.high >= position["stop"]:
        return position["stop"]
    if bar.low <= position["tp"]:
        return position["tp"]
    return None


def _close_at(position: dict, exit_price: float, fee_rate: float, trades: list[dict]) -> float:
    ending = _pnl_equity(position["entry_equity"], position["side"], position["entry_price"], exit_price, fee_rate)
    trades.append({"pnl": ending - position["entry_equity"]})
    return ending


def _marked(position: dict, close: float, cost) -> float:
    priced = apply_cost(close, position["side"], "exit", cost)
    return _pnl_equity(position["entry_equity"], position["side"], position["entry_price"], priced, cost.fee_rate)


def _pnl_equity(entry_equity: float, side: str, entry: float, exit_price: float, fee_rate: float) -> float:
    if entry <= 0:
        return entry_equity
    sign = 1.0 if side == "long" else -1.0
    gross = sign * (exit_price - entry) / entry
    return max(0.0, entry_equity * (1.0 + gross - (2.0 * fee_rate)))


def _stats(win_rate: float | None, max_drawdown: float, trade_count: int, warning: str | None) -> dict:
    return {
        "win_rate_pct": None if win_rate is None else round(win_rate, 4),
        "max_drawdown_pct": round(max_drawdown, 4),
        "trade_count": trade_count,
        "warning": warning,
    }


def _market_fields(payload: dict) -> tuple[str, str, str]:
    if not isinstance(payload, dict):
        raise InvalidRequestError("Request body must be a JSON object.")
    asset_type = str(payload.get("asset_type", "")).strip().lower()
    if asset_type not in ("crypto", "forex", "metals"):
        raise InvalidRequestError("asset_type must be crypto, forex, or metals.")
    symbol = str(payload.get("symbol", "")).strip()
    if not symbol or len(symbol) > 32:
        raise InvalidRequestError("symbol is required.")
    timeframe = str(payload.get("timeframe", "")).strip()
    if timeframe not in TIMEFRAMES:
        joined = ", ".join(TIMEFRAMES)
        raise InvalidRequestError(f"Unsupported timeframe '{timeframe}'. Use one of: {joined}.")
    return asset_type, symbol, timeframe


def _positive_number(value, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise InvalidRequestError(f"{name} must be a number greater than 0.")
    return float(value)


def _finite(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return number


def _price(value: float) -> float:
    return round(float(value), 8)


def _round(value: float, digits: int) -> float:
    return round(float(value), digits)
