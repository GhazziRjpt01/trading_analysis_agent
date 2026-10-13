"""Cost and signal rules for POST /backtest. No network."""

import unittest
from datetime import datetime, timedelta, timezone

import numpy as np

from providers.base import new_bar
from strategy_backtest import (
    apply_cost,
    cost_for,
    forex_pip_size,
    parse_backtest_request,
    rsi_mean_reversion_signals,
    run_strategy_backtest,
    sharpe_ratio,
)


def bar(index, open_, close):
    stamp = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=index)
    return new_bar(stamp, open_, max(open_, close), min(open_, close), close, None)


class CostTest(unittest.TestCase):
    def test_crypto_fee_and_slippage_worsen_the_long_entry(self):
        cost = cost_for("crypto", "BTC/USDT")
        self.assertAlmostEqual(cost.fee_rate, 0.001)
        self.assertAlmostEqual(cost.slippage_rate, 0.0005)
        self.assertGreater(apply_cost(100, "long", "entry", cost), 100)

    def test_forex_jpy_pip_is_larger_than_a_major(self):
        self.assertEqual(forex_pip_size("EURUSD"), 0.0001)
        self.assertEqual(forex_pip_size("GBPJPY"), 0.01)
        eur = cost_for("forex", "EURUSD")
        jpy = cost_for("forex", "GBPJPY")
        self.assertAlmostEqual(eur.spread_price, 1.5 * 0.0001)
        self.assertAlmostEqual(jpy.spread_price, 1.5 * 0.01)
        self.assertGreater(apply_cost(1.1, "long", "entry", eur), 1.1)

    def test_metals_use_price_points_not_pips(self):
        gold = cost_for("metals", "XAUUSD")
        silver = cost_for("metals", "Silver")
        self.assertAlmostEqual(gold.spread_price, 0.40)
        self.assertAlmostEqual(silver.spread_price, 0.03)
        self.assertIn("price points", gold.detail)
        self.assertGreater(apply_cost(2000, "long", "entry", gold), 2000)


class SignalTest(unittest.TestCase):
    def test_rsi_buys_oversold_and_flattens_at_50(self):
        rsi = np.array([np.nan, 40, 28, 35, 55], dtype=float)
        self.assertEqual(rsi_mean_reversion_signals(rsi), [(2, "long"), (4, "flat")])

    def test_parse_rejects_an_unknown_strategy(self):
        with self.assertRaises(Exception) as caught:
            parse_backtest_request(
                {
                    "asset_type": "crypto",
                    "symbol": "BTC/USDT",
                    "timeframe": "1h",
                    "period": 300,
                    "strategy": "breakout",
                }
            )
        self.assertIn("strategy", str(caught.exception))


class RunTest(unittest.TestCase):
    def test_flat_prices_lose_the_crypto_round_trip_cost(self):
        bars = [bar(index, 100, 100) for index in range(4)]
        # Force a long that opens on bar 2 and closes at the end.
        from strategy_backtest import simulate_costed

        result = simulate_costed(bars, [(1, "long")], cost_for("crypto", "BTC/USDT"))
        self.assertEqual(result["trade_count"], 1)
        self.assertLess(result["ending_equity"], 10_000)

    def test_sharpe_is_absent_when_equity_does_not_move(self):
        curve = [{"equity": 10_000}, {"equity": 10_000}, {"equity": 10_000}]
        self.assertIsNone(sharpe_ratio(curve, "1h", "crypto"))

    def test_sharpe_is_a_number_when_equity_varies(self):
        curve = [{"equity": 100}, {"equity": 110}, {"equity": 105}, {"equity": 120}]
        value = sharpe_ratio(curve, "1d", "forex")
        self.assertIsNotNone(value)
        self.assertTrue(math_isfinite(value))

    def test_run_reports_the_performance_note(self):
        bars = [bar(index, 100 + index, 101 + index) for index in range(60)]
        result = run_strategy_backtest(
            bars,
            asset_type="crypto",
            symbol="BTC/USDT",
            timeframe="1h",
            strategy="ema_crossover",
        )
        self.assertEqual(result["performance_note"], "Past performance does not predict future results.")
        self.assertIn("total_return_pct", result)
        self.assertIn("sharpe_ratio", result)
        self.assertIn("equity", result)


def math_isfinite(value):
    return value == value and value not in (float("inf"), float("-inf"))


if __name__ == "__main__":
    unittest.main()
