"""Paper-fill rules for the EMA crossover backtest. No network."""

import unittest
from datetime import datetime, timedelta, timezone

import numpy as np

from backtest import crossover_signals, run_ema_cross_backtest, simulate_signals
from providers.base import new_bar


def bar(index: int, open_: float, close: float):
    high = max(open_, close)
    low = min(open_, close)
    stamp = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=index)
    return new_bar(stamp, open_, high, low, close, None)


class CrossoverSignalsTest(unittest.TestCase):
    def test_up_cross_then_down_cross(self):
        fast = np.array([1.0, 1.0, 3.0, 3.0, 1.0])
        slow = np.array([2.0, 2.0, 2.0, 2.0, 2.0])
        self.assertEqual(crossover_signals(fast, slow), [(2, "long"), (4, "short")])

    def test_nan_warmup_is_skipped(self):
        fast = np.array([np.nan, 1.0, 3.0])
        slow = np.array([np.nan, 2.0, 2.0])
        self.assertEqual(crossover_signals(fast, slow), [(2, "long")])


class SimulateSignalsTest(unittest.TestCase):
    def test_long_fills_on_the_next_open(self):
        bars = [
            bar(0, 100, 100),
            bar(1, 100, 250),
            bar(2, 110, 110),
            bar(3, 110, 121),
        ]
        result = simulate_signals(bars, [(1, "long")], fee_rate=0.001, starting_equity=10_000)
        self.assertEqual(len(result["trades"]), 1)
        trade = result["trades"][0]
        self.assertEqual(trade["entry_price"], 110)
        self.assertEqual(trade["exit_price"], 121)
        self.assertEqual(trade["reason"], "end_of_data")
        self.assertAlmostEqual(trade["pnl"], 980.0, places=6)
        self.assertAlmostEqual(result["ending_equity"], 10980.0, places=6)

    def test_short_profit_uses_the_price_decline(self):
        bars = [
            bar(0, 50, 50),
            bar(1, 50, 50),
            bar(2, 100, 100),
            bar(3, 80, 80),
        ]
        result = simulate_signals(bars, [(1, "short")], fee_rate=0.001, starting_equity=10_000)
        trade = result["trades"][0]
        self.assertEqual(trade["side"], "short")
        self.assertEqual(trade["entry_price"], 100)
        self.assertAlmostEqual(trade["pnl"], 1980.0, places=6)
        self.assertAlmostEqual(result["ending_equity"], 11980.0, places=6)

    def test_signal_on_the_last_bar_is_not_filled(self):
        bars = [bar(index, 100, 100) for index in range(4)]
        result = simulate_signals(bars, [(3, "long")], fee_rate=0.001, starting_equity=10_000)
        self.assertEqual(result["trades"], [])
        self.assertEqual(result["ending_equity"], 10_000)

    def test_same_side_signal_does_not_stack(self):
        bars = [bar(index, 100, 101) for index in range(5)]
        result = simulate_signals(
            bars,
            [(1, "long"), (2, "long")],
            fee_rate=0.0,
            starting_equity=10_000,
        )
        self.assertEqual(len(result["trades"]), 1)
        self.assertEqual(result["trades"][0]["entry_price"], bars[2].open)

    def test_reversal_closes_then_opens_at_the_same_open(self):
        bars = [
            bar(0, 100, 100),
            bar(1, 100, 100),
            bar(2, 120, 120),
            bar(3, 120, 120),
            bar(4, 80, 70),
        ]
        result = simulate_signals(
            bars,
            [(1, "long"), (3, "short")],
            fee_rate=0.001,
            starting_equity=10_000,
        )
        self.assertEqual([trade["side"] for trade in result["trades"]], ["long", "short"])
        self.assertEqual(result["trades"][0]["exit_price"], 80)
        self.assertEqual(result["trades"][0]["reason"], "signal")
        self.assertEqual(result["trades"][1]["entry_price"], 80)
        self.assertEqual(result["trades"][1]["exit_price"], 70)
        self.assertAlmostEqual(result["ending_equity"], 7464.20666666, places=4)

    def test_drawdown_includes_the_open_loss(self):
        bars = [
            bar(0, 100, 100),
            bar(1, 100, 100),
            bar(2, 100, 50),
        ]
        result = simulate_signals(bars, [(1, "long")], fee_rate=0.001, starting_equity=10_000)
        self.assertAlmostEqual(result["ending_equity"], 4980.0, places=6)
        self.assertAlmostEqual(result["max_drawdown_pct"], 50.2, places=4)


class EmaCrossBacktestTest(unittest.TestCase):
    def test_short_history_returns_a_warning_and_flat_equity(self):
        bars = [bar(index, 100, 100) for index in range(10)]
        result = run_ema_cross_backtest(bars, asset_type="crypto")
        self.assertEqual(result["trade_count"], 0)
        self.assertEqual(result["ending_equity"], 10_000)
        self.assertIn("Not enough bars", result["warning"])

    def test_trend_reversal_trades_long_then_short(self):
        bars = []
        index = 0
        for _ in range(60):
            bars.append(bar(index, 100, 100))
            index += 1
        for _ in range(40):
            bars.append(bar(index, 130, 130))
            index += 1
        for _ in range(40):
            bars.append(bar(index, 70, 70))
            index += 1

        crypto = run_ema_cross_backtest(bars, asset_type="crypto")
        forex = run_ema_cross_backtest(bars, asset_type="forex")

        metals = run_ema_cross_backtest(bars[:10], asset_type="metals")
        self.assertEqual(crypto["fee_bps"], 10.0)
        self.assertEqual(forex["fee_bps"], 1.0)
        self.assertEqual(metals["fee_bps"], 5.0)
        self.assertEqual(metals["trade_count"], 0)
        self.assertGreaterEqual(crypto["trade_count"], 2)
        self.assertEqual(crypto["trades"][0]["side"], "long")
        self.assertEqual(crypto["trades"][1]["side"], "short")
        self.assertLess(crypto["ending_equity"], forex["ending_equity"])
        self.assertIsNone(crypto["warning"])

        opens = {item.timestamp: item.open for item in bars}
        for trade in crypto["trades"]:
            if trade["reason"] == "signal":
                self.assertEqual(trade["entry_price"], opens[trade["entry_time"]])
                self.assertEqual(trade["exit_price"], opens[trade["exit_time"]])


if __name__ == "__main__":
    unittest.main()
