"""Strategy backtest for POST /backtest.

Signals are read on the bar close and filled on the next bar's open.
Costs are research assumptions, not a broker schedule. Crypto pays a
percentage fee and slippage. Forex pays a spread in pips. Metals pay a
price-point spread plus a small percentage slippage, because a metal
pip is not the same size at every broker.
"""

import math
from datetime import datetime, timezone

import numpy as np

from backtest import STARTING_EQUITY, _close, _marked, _measured, crossover_signals
from errors import InvalidRequestError
from indicators import _rsi, ema
from providers.base import MAX_LIMIT, OHLCVBar, TIMEFRAMES

STRATEGIES = ("ema_crossover", "rsi_mean_reversion")
PERFORMANCE_NOTE = "Past performance does not predict future results."

_RSI_PERIOD = 14
_RSI_OVERSOLD = 30.0
_RSI_OVERBOUGHT = 70.0
_RSI_EXIT = 50.0
_EMA_FAST = 20
_EMA_SLOW = 50

# Bars per session-day before the 365 or 252 multiplier. Used only to annualize Sharpe.
_BARS_PER_DAY = {"1m": 24 * 60, "5m": 24 * 12, "15m": 24 * 4, "30m": 48, "1h": 24, "4h": 6, "1d": 1}

_FOREX_SPREAD_PIPS = 1.5
_CRYPTO_FEE_RATE = 0.001  # 10 bps each side
_CRYPTO_SLIPPAGE_RATE = 0.0005  # 5 bps each side
_METAL_SLIPPAGE_RATE = 0.0002  # 2 bps each side
_GOLD_SPREAD = 0.40
_SILVER_SPREAD = 0.03


class CostModel:
    def __init__(self, *, fee_rate: float, slippage_rate: float, spread_price: float, detail: str):
        self.fee_rate = fee_rate
        self.slippage_rate = slippage_rate
        self.spread_price = spread_price
        self.detail = detail


def parse_backtest_request(payload: dict) -> tuple[str, str, str, int, str]:
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
    period = payload.get("period")
    if isinstance(period, bool) or not isinstance(period, int) or period < 50 or period > MAX_LIMIT:
        raise InvalidRequestError(f"period must be an integer from 50 to {MAX_LIMIT}.")
    strategy = str(payload.get("strategy", "")).strip()
    if strategy not in STRATEGIES:
        raise InvalidRequestError("strategy must be ema_crossover or rsi_mean_reversion.")
    return asset_type, symbol, timeframe, period, strategy


def run_strategy_backtest(
    bars: list[OHLCVBar],
    *,
    asset_type: str,
    symbol: str,
    timeframe: str,
    strategy: str,
) -> dict:
    cost = cost_for(asset_type, symbol)
    label, description, minimum, signals = _strategy(bars, strategy)
    if len(bars) < minimum:
        measured = _measured(STARTING_EQUITY, STARTING_EQUITY, [], [])
        warning = (
            f"Not enough bars for this backtest. Need at least {minimum} "
            "so a signal can fill on the next open."
        )
    else:
        measured = simulate_costed(bars, signals, cost)
        warning = None
    measured["sharpe_ratio"] = sharpe_ratio(measured["equity"], timeframe, asset_type)
    return _present(
        measured,
        strategy=strategy,
        strategy_label=label,
        description=description,
        costs=cost.detail,
        warning=warning,
    )


def cost_for(asset_type: str, symbol: str) -> CostModel:
    if asset_type == "crypto":
        return CostModel(
            fee_rate=_CRYPTO_FEE_RATE,
            slippage_rate=_CRYPTO_SLIPPAGE_RATE,
            spread_price=0.0,
            detail="Crypto: 10 bps fee and 5 bps slippage on each fill.",
        )
    if asset_type == "forex":
        pip = forex_pip_size(symbol)
        spread = _FOREX_SPREAD_PIPS * pip
        return CostModel(
            fee_rate=0.0,
            slippage_rate=0.0,
            spread_price=spread,
            detail=(
                f"Forex: {_FOREX_SPREAD_PIPS} pip spread. "
                f"One pip is {pip} for this pair. "
                "Half of the spread is applied on each fill."
            ),
        )
    spread, name = metal_spread(symbol)
    return CostModel(
        fee_rate=0.0,
        slippage_rate=_METAL_SLIPPAGE_RATE,
        spread_price=spread,
        detail=(
            f"{name}: {spread} price-point spread plus 2 bps slippage on each fill. "
            "Broker pip sizes for metals differ, so this cost is in price points, not pips."
        ),
    )


def forex_pip_size(symbol: str) -> float:
    compact = symbol.upper().replace("/", "").replace("=X", "")
    # A JPY quote uses 0.01. Other majors use 0.0001.
    if compact.endswith("JPY"):
        return 0.01
    return 0.0001


def metal_spread(symbol: str) -> tuple[float, str]:
    compact = symbol.upper().replace("/", "").replace("=F", "")
    if "XAG" in compact or "SILVER" in compact or compact.startswith("SI"):
        return _SILVER_SPREAD, "Silver"
    return _GOLD_SPREAD, "Gold"


def apply_cost(mid: float, side: str, action: str, cost: CostModel) -> float:
    """Move the fill against the position. Long entry and short exit pay up."""
    pays_up = (side == "long" and action == "entry") or (side == "short" and action == "exit")
    rate = cost.slippage_rate
    slipped = mid * (1.0 + rate) if pays_up else mid * (1.0 - rate)
    half_spread = cost.spread_price / 2.0
    price = slipped + half_spread if pays_up else slipped - half_spread
    return max(price, 1e-12)


def rsi_mean_reversion_signals(rsi: np.ndarray) -> list[tuple[int, str]]:
    """Buy a cross below 30, sell a cross above 70, and flatten through 50."""
    signals: list[tuple[int, str]] = []
    position: str | None = None
    for index in range(1, len(rsi)):
        previous = float(rsi[index - 1])
        current = float(rsi[index])
        if not math.isfinite(previous) or not math.isfinite(current):
            continue
        target = position
        if position == "long" and previous <= _RSI_EXIT < current:
            target = None
        elif position == "short" and previous >= _RSI_EXIT > current:
            target = None
        elif position is None and previous >= _RSI_OVERSOLD > current:
            target = "long"
        elif position is None and previous <= _RSI_OVERBOUGHT < current:
            target = "short"
        if target == position:
            continue
        signals.append((index, "flat" if target is None else target))
        position = target
    return signals


def simulate_costed(
    bars: list[OHLCVBar],
    signals: list[tuple[int, str]],
    cost: CostModel,
    starting_equity: float = STARTING_EQUITY,
) -> dict:
    signal_at = {index: side for index, side in signals}
    equity = starting_equity
    position: dict | None = None
    trades: list[dict] = []
    curve: list[dict] = []

    for index, bar in enumerate(bars):
        command = signal_at.get(index - 1)
        if command is not None and equity > 0:
            if position is not None and (command == "flat" or command != position["side"]):
                exit_price = apply_cost(bar.open, position["side"], "exit", cost)
                equity = _close(position, exit_price, bar.timestamp, "signal", cost.fee_rate, trades)
                position = None
            if command in ("long", "short") and position is None and equity > 0:
                position = {
                    "side": command,
                    "entry_price": apply_cost(bar.open, command, "entry", cost),
                    "entry_time": bar.timestamp,
                    "entry_equity": equity,
                }

        if position is None:
            marked = equity
        else:
            marked = _mark_exit(position, bar.close, cost)
        curve.append({"timestamp": bar.timestamp, "equity": marked})

    if position is not None:
        last = bars[-1]
        equity = _close(
            position,
            apply_cost(last.close, position["side"], "exit", cost),
            last.timestamp,
            "end_of_data",
            cost.fee_rate,
            trades,
        )
        curve[-1]["equity"] = equity

    return _measured(starting_equity, equity, trades, curve)


def sharpe_ratio(curve: list[dict], timeframe: str, asset_type: str) -> float | None:
    """Annualized Sharpe from bar equity changes. The risk-free rate is zero."""
    equities = [float(point["equity"]) for point in curve]
    returns = []
    for previous, current in zip(equities, equities[1:]):
        if previous <= 0:
            continue
        returns.append((current - previous) / previous)
    if len(returns) < 2:
        return None
    mean = sum(returns) / len(returns)
    variance = sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)
    if variance <= 0:
        return None
    periods = _BARS_PER_DAY[timeframe] * (365 if asset_type == "crypto" else 252)
    return mean / math.sqrt(variance) * math.sqrt(periods)


def _strategy(bars: list[OHLCVBar], strategy: str) -> tuple[str, str, int, list]:
    close = np.array([bar.close for bar in bars], dtype=float)
    if strategy == "ema_crossover":
        signals = crossover_signals(ema(close, _EMA_FAST), ema(close, _EMA_SLOW))
        return (
            "EMA 20/50 crossover",
            "Long when EMA 20 crosses above EMA 50. Short on the opposite cross. "
            "The fill is the next bar's open.",
            _EMA_SLOW + 2,
            signals,
        )
    signals = rsi_mean_reversion_signals(_rsi(close, _RSI_PERIOD))
    return (
        "RSI mean reversion",
        "Long when RSI(14) crosses below 30, short when it crosses above 70, "
        "and flat when it crosses 50. The fill is the next bar's open.",
        _RSI_PERIOD + 2,
        signals,
    )


def _mark_exit(position: dict, price: float, cost: CostModel) -> float:
    return _marked(position, apply_cost(price, position["side"], "exit", cost), cost.fee_rate)


def _present(raw: dict, *, strategy: str, strategy_label: str, description: str, costs: str, warning: str | None) -> dict:
    sharpe = raw.get("sharpe_ratio")
    return {
        "strategy": strategy,
        "strategy_label": strategy_label,
        "description": description,
        "starting_equity": _round_money(raw["starting_equity"]),
        "ending_equity": _round_money(raw["ending_equity"]),
        "total_return_pct": _round_pct(raw["return_pct"]),
        "win_rate_pct": None if raw["win_rate_pct"] is None else _round_pct(raw["win_rate_pct"]),
        "max_drawdown_pct": _round_pct(raw["max_drawdown_pct"]),
        "sharpe_ratio": None if sharpe is None else round(float(sharpe), 4),
        "trade_count": raw["trade_count"],
        "costs": costs,
        "warning": warning,
        "performance_note": PERFORMANCE_NOTE,
        "equity": [
            {"timestamp": _iso(point["timestamp"]), "equity": _round_money(point["equity"])}
            for point in raw["equity"]
        ],
    }


def _round_money(value: float) -> float:
    return round(float(value), 2)


def _round_pct(value: float) -> float:
    return round(float(value), 4)


def _iso(timestamp: datetime) -> str:
    return timestamp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
