"""Paper backtest for an EMA 20/50 crossover.

The signal uses the same EMA as the chart. A cross is read on the bar close
and filled at the next bar's open, so the fill cannot use the bar that
produced the signal. One position at a time, sized to current equity.
This is a paper simulation. It does not place orders.
"""

import math
from datetime import datetime

import numpy as np

from indicators import ema
from providers.base import OHLCVBar

_EMA_FAST = 20
_EMA_SLOW = 50
STARTING_EQUITY = 10_000.0

# A cross can first appear once EMA 50 exists on two bars, and it still
# needs one later bar to fill. Fewer bars is an empty run, not an error.
_MIN_BARS = _EMA_SLOW + 2

# Per-fill research friction, not a broker schedule. Forex is smaller
# because the Yahoo series has no spread of its own. Metals sits between
# the two: futures volume is real, and the friction is still not a commission.
_FEE_BPS = {"crypto": 10.0, "forex": 1.0, "metals": 5.0}

STRATEGY = "ema_cross"
STRATEGY_LABEL = "EMA 20/50 crossover"
FILL = "next_bar_open"
SIZING = "100% of equity, one position at a time"
DESCRIPTION = (
    "Signal when EMA 20 crosses EMA 50 on the bar close. "
    "The paper fill is the next bar's open. "
    "One position at a time, long or short, using the full paper equity. "
    "No live orders."
)


def run_ema_cross_backtest(bars: list[OHLCVBar], *, asset_type: str) -> dict:
    fee_bps = _FEE_BPS[asset_type]
    if len(bars) < _MIN_BARS:
        return _present(
            _flat(STARTING_EQUITY),
            fee_bps=fee_bps,
            warning=(
                "Not enough bars for an EMA 20/50 backtest. "
                f"Need at least {_MIN_BARS} bars so a cross can fill on the next open."
            ),
        )

    close = np.array([bar.close for bar in bars], dtype=float)
    signals = crossover_signals(ema(close, _EMA_FAST), ema(close, _EMA_SLOW))
    simulated = simulate_signals(
        bars,
        signals,
        fee_rate=fee_bps / 10_000.0,
        starting_equity=STARTING_EQUITY,
    )
    return _present(simulated, fee_bps=fee_bps, warning=None)


def crossover_signals(fast: np.ndarray, slow: np.ndarray) -> list[tuple[int, str]]:
    """Bar indexes where the fast EMA crosses the slow EMA on that close."""
    signals: list[tuple[int, str]] = []
    for index in range(1, len(fast)):
        previous_fast = float(fast[index - 1])
        previous_slow = float(slow[index - 1])
        current_fast = float(fast[index])
        current_slow = float(slow[index])
        if not _finite(previous_fast, previous_slow, current_fast, current_slow):
            continue
        if previous_fast <= previous_slow and current_fast > current_slow:
            signals.append((index, "long"))
        elif previous_fast >= previous_slow and current_fast < current_slow:
            signals.append((index, "short"))
    return signals


def simulate_signals(
    bars: list[OHLCVBar],
    signals: list[tuple[int, str]],
    *,
    fee_rate: float,
    starting_equity: float,
) -> dict:
    """Fill each close-signal on the next bar's open. Mark the book each close.

    An open position at the end of the series is closed on the last close so
    the summary has a finished trade. Both the entry and the exit fee are
    reserved in the mark, so the curve matches that close.
    """
    signal_at = {index: side for index, side in signals}
    equity = starting_equity
    position: dict | None = None
    trades: list[dict] = []
    curve: list[dict] = []

    for index, bar in enumerate(bars):
        side = signal_at.get(index - 1)
        if side is not None and equity > 0:
            if position is not None and position["side"] != side:
                equity = _close(position, bar.open, bar.timestamp, "signal", fee_rate, trades)
                position = None
            if position is None and equity > 0:
                position = {
                    "side": side,
                    "entry_price": bar.open,
                    "entry_time": bar.timestamp,
                    "entry_equity": equity,
                }

        marked = equity if position is None else _marked(position, bar.close, fee_rate)
        curve.append({"timestamp": bar.timestamp, "equity": marked})

    if position is not None:
        last = bars[-1]
        equity = _close(position, last.close, last.timestamp, "end_of_data", fee_rate, trades)
        curve[-1]["equity"] = equity

    return _measured(starting_equity, equity, trades, curve)


def _flat(starting_equity: float) -> dict:
    return _measured(starting_equity, starting_equity, [], [])


def _measured(
    starting_equity: float,
    ending_equity: float,
    trades: list[dict],
    curve: list[dict],
) -> dict:
    wins = sum(1 for trade in trades if trade["pnl"] > 0)
    peak = starting_equity
    max_drawdown = 0.0
    for point in curve:
        value = point["equity"]
        if value > peak:
            peak = value
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - value) / peak)

    ending = curve[-1]["equity"] if curve else ending_equity
    trade_count = len(trades)
    return {
        "starting_equity": starting_equity,
        "ending_equity": ending,
        "return_pct": 0.0 if starting_equity == 0 else (ending - starting_equity) / starting_equity * 100.0,
        "trade_count": trade_count,
        "win_count": wins,
        "loss_count": trade_count - wins,
        "win_rate_pct": None if trade_count == 0 else wins / trade_count * 100.0,
        "max_drawdown_pct": max_drawdown * 100.0,
        "trades": trades,
        "equity": curve,
    }


def _close(
    position: dict,
    exit_price: float,
    exit_time: datetime,
    reason: str,
    fee_rate: float,
    trades: list[dict],
) -> float:
    ending = _marked(position, exit_price, fee_rate)
    entry_equity = position["entry_equity"]
    pnl = ending - entry_equity
    trades.append(
        {
            "side": position["side"],
            "entry_time": position["entry_time"],
            "exit_time": exit_time,
            "entry_price": position["entry_price"],
            "exit_price": exit_price,
            "return_pct": 0.0 if entry_equity == 0 else pnl / entry_equity * 100.0,
            "pnl": pnl,
            "reason": reason,
        }
    )
    return ending


def _marked(position: dict, price: float, fee_rate: float) -> float:
    sign = 1.0 if position["side"] == "long" else -1.0
    gross = sign * (price - position["entry_price"]) / position["entry_price"]
    net = gross - (2.0 * fee_rate)
    return max(0.0, position["entry_equity"] * (1.0 + net))


def _present(raw: dict, *, fee_bps: float, warning: str | None) -> dict:
    return {
        "strategy": STRATEGY,
        "strategy_label": STRATEGY_LABEL,
        "description": DESCRIPTION,
        "starting_equity": _money(raw["starting_equity"]),
        "ending_equity": _money(raw["ending_equity"]),
        "return_pct": _pct(raw["return_pct"]),
        "trade_count": raw["trade_count"],
        "win_count": raw["win_count"],
        "loss_count": raw["loss_count"],
        "win_rate_pct": None if raw["win_rate_pct"] is None else _pct(raw["win_rate_pct"]),
        "max_drawdown_pct": _pct(raw["max_drawdown_pct"]),
        "fee_bps": fee_bps,
        "fill": FILL,
        "sizing": SIZING,
        "warning": warning,
        "trades": [_present_trade(trade) for trade in raw["trades"]],
        "equity": [
            {"timestamp": point["timestamp"], "equity": _money(point["equity"])}
            for point in raw["equity"]
        ],
    }


def _present_trade(trade: dict) -> dict:
    return {
        **trade,
        "entry_price": _price(trade["entry_price"]),
        "exit_price": _price(trade["exit_price"]),
        "return_pct": _pct(trade["return_pct"]),
        "pnl": _money(trade["pnl"]),
    }


def _finite(*values: float) -> bool:
    return all(math.isfinite(value) for value in values)


def _price(value: float) -> float:
    return round(float(value), 8)


def _money(value: float) -> float:
    return round(float(value), 2)


def _pct(value: float) -> float:
    return round(float(value), 4)
