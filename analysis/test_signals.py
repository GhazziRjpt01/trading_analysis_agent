"""Signal votes, ATR levels, and position size. No network."""

import unittest
from datetime import datetime, timedelta, timezone

from providers.base import new_bar
from signals import backtest_signal_rules, decide, parse_position_request, position_size, run_signal
from errors import InvalidRequestError


def _point(**overrides):
    point = {
        "ema_20": 110.0,
        "ema_50": 100.0,
        "rsi_14": 58.0,
        "macd": {"histogram": 1.5},
        "bollinger": {"middle": 100.0, "upper": 120.0, "lower": 80.0},
        "atr_14": 2.0,
    }
    point.update(overrides)
    return point


class DecideTest(unittest.TestCase):
    def test_four_buy_votes_are_a_high_confidence_buy(self):
        result = decide(_point(), 105.0)
        self.assertEqual(result["direction"], "buy")
        self.assertEqual(result["confidence"], "high")
        self.assertEqual(result["entry_zone"], {"low": 104.5, "high": 105.0})
        self.assertEqual(result["stop_loss"], 101.5)
        self.assertEqual(result["take_profit_1"], 109.0)
        self.assertEqual(result["take_profit_2"], 112.0)
        self.assertAlmostEqual(result["risk_reward"], 4 / 3.5, places=4)
        self.assertLess(result["stop_loss"], result["entry_zone"]["low"])

    def test_one_opposing_vote_is_no_trade_with_null_levels(self):
        result = decide(_point(rsi_14=40.0), 105.0)
        self.assertEqual(result["direction"], "no_trade")
        self.assertEqual(result["confidence"], "low")
        self.assertIsNone(result["entry_zone"])
        self.assertIsNone(result["stop_loss"])
        self.assertIsNone(result["take_profit_1"])
        self.assertIsNone(result["take_profit_2"])
        self.assertIsNone(result["risk_reward"])
        self.assertTrue(any("conflict" in line for line in result["invalidation"]))

    def test_three_agreeing_votes_are_medium_confidence(self):
        result = decide(_point(rsi_14=50.0), 105.0)
        self.assertEqual(result["direction"], "buy")
        self.assertEqual(result["confidence"], "medium")

    def test_missing_atr_cannot_place_a_stop(self):
        result = decide(_point(atr_14=None), 105.0)
        self.assertEqual(result["direction"], "no_trade")
        self.assertTrue(any("ATR" in line for line in result["invalidation"]))

    def test_sell_stop_sits_above_the_entry_zone(self):
        result = decide(
            _point(
                ema_20=90.0,
                ema_50=100.0,
                rsi_14=42.0,
                macd={"histogram": -1.0},
                bollinger={"middle": 110.0, "upper": 130.0, "lower": 90.0},
            ),
            100.0,
        )
        self.assertEqual(result["direction"], "sell")
        self.assertGreater(result["stop_loss"], result["entry_zone"]["high"])
        self.assertLess(result["take_profit_1"], result["entry_zone"]["low"])


class PositionSizeTest(unittest.TestCase):
    def test_crypto_size_is_base_units(self):
        result = position_size("crypto", 10_000, 1, 100, 96)
        self.assertEqual(result["unit"], "units")
        self.assertEqual(result["risk_amount"], 100)
        self.assertAlmostEqual(result["position_size"], 25.0)
        self.assertIsNone(result["lots"])

    def test_forex_size_is_lots(self):
        result = position_size("forex", 10_000, 1, 1.1, 1.09)
        self.assertEqual(result["unit"], "lots")
        self.assertAlmostEqual(result["units"], 10_000)
        self.assertAlmostEqual(result["lots"], 0.1)
        self.assertEqual(result["position_size"], 0.1)

    def test_metals_size_is_units(self):
        result = position_size("metals", 5_000, 2, 2400, 2380)
        self.assertEqual(result["unit"], "units")
        self.assertAlmostEqual(result["position_size"], 5.0)

    def test_equal_entry_and_stop_is_rejected(self):
        with self.assertRaises(InvalidRequestError):
            parse_position_request(
                {
                    "asset_type": "crypto",
                    "account_balance": 1000,
                    "risk_percent": 1,
                    "entry": 10,
                    "stop_loss": 10,
                }
            )


class BacktestRulesTest(unittest.TestCase):
    def test_long_target_before_the_stop_counts_as_a_win(self):
        bars = []
        points = []
        for index, close in enumerate([100.0, 100.0, 110.0]):
            stamp = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=index)
            bars.append(new_bar(stamp, close, close + (8 if index == 2 else 0.5), close - 0.5, close, None))
            points.append(_point(atr_14=2.0))
        bars[1] = new_bar(bars[1].timestamp, 100, 100.5, 99.5, 100, None)
        stats = backtest_signal_rules(bars, points, asset_type="crypto", symbol="BTC/USDT")
        self.assertEqual(stats["trade_count"], 1)
        self.assertEqual(stats["win_rate_pct"], 100.0)
        self.assertGreaterEqual(stats["max_drawdown_pct"], 0)

    def test_stop_wins_when_the_same_bar_touches_both(self):
        bars = []
        points = []
        for index in range(2):
            stamp = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=index)
            low = 90 if index == 1 else 99
            high = 120 if index == 1 else 101
            bars.append(new_bar(stamp, 100, high, low, 100, None))
            points.append(_point())
        stats = backtest_signal_rules(bars, points, asset_type="forex", symbol="EURUSD")
        self.assertEqual(stats["trade_count"], 1)
        self.assertEqual(stats["win_rate_pct"], 0.0)

    def test_flat_history_is_no_trade(self):
        bars = []
        for index in range(60):
            stamp = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=index)
            bars.append(new_bar(stamp, 10, 11, 9, 10, None))
        result = run_signal(bars, asset_type="crypto", symbol="BTC/USDT", timeframe="1h")
        self.assertEqual(result["direction"], "no_trade")
        self.assertIsNone(result["stop_loss"])
        self.assertIn("trade_count", result["backtest"])
        self.assertIn("Past performance", result["performance_note"])


if __name__ == "__main__":
    unittest.main()
