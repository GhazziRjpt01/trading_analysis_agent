"""Metals symbols and volume-indicator gating. No network."""

import unittest
from datetime import datetime, timedelta, timezone

from backtest import run_ema_cross_backtest
from errors import InvalidSymbolError
from indicators import compute_indicators
from providers.base import new_bar
from providers.metals import normalize_metals_symbol


def bar(index, close, volume):
    stamp = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=index)
    return new_bar(stamp, close, close + 1, close - 0.5, close, volume)


class MetalsSymbolTest(unittest.TestCase):
    def test_aliases_collapse_to_the_canonical_pair(self):
        self.assertEqual(normalize_metals_symbol("Gold"), "XAUUSD")
        self.assertEqual(normalize_metals_symbol("gc=f"), "XAUUSD")
        self.assertEqual(normalize_metals_symbol("XAU/USD"), "XAUUSD")
        self.assertEqual(normalize_metals_symbol("Silver"), "XAGUSD")
        self.assertEqual(normalize_metals_symbol("SI=F"), "XAGUSD")
        self.assertEqual(normalize_metals_symbol("XAG/USD"), "XAGUSD")

    def test_unknown_symbol_is_rejected(self):
        with self.assertRaises(InvalidSymbolError):
            normalize_metals_symbol("EURUSD")

    def test_paper_backtest_accepts_metals(self):
        bars = [bar(index, 100, 10) for index in range(10)]
        result = run_ema_cross_backtest(bars, asset_type="metals")
        self.assertEqual(result["fee_bps"], 5.0)
        self.assertEqual(result["trade_count"], 0)


class VolumeIndicatorTest(unittest.TestCase):
    def test_null_volume_omits_obv_mfi_and_vwap(self):
        bars = [bar(index, 100 + index, None) for index in range(60)]
        result = compute_indicators(bars, asset_type="forex")
        self.assertNotIn("obv", result["latest"])
        self.assertIn("no real volume", result["note"])
        self.assertIsNotNone(result["latest"]["rsi_14"])

    def test_real_volume_computes_obv_and_vwap(self):
        bars = [
            bar(0, 10, 100),
            bar(1, 12, 50),
            bar(2, 11, 25),
        ]
        result = compute_indicators(bars, asset_type="metals")
        points = result["points"]
        self.assertIsNone(result.get("note"))
        self.assertEqual(points[0]["obv"], 100)
        self.assertEqual(points[1]["obv"], 150)
        self.assertEqual(points[2]["obv"], 125)
        # Typical price is (high+low+close)/3. Bar 0: high 11, low 9.5, close 10.
        self.assertAlmostEqual(points[0]["vwap"], (11 + 9.5 + 10) / 3, places=6)
        self.assertIsNone(points[0]["mfi_14"])


if __name__ == "__main__":
    unittest.main()
