"""Indicator math on synthetic bars. No network."""

import unittest
from datetime import datetime, timedelta, timezone

import numpy as np

from indicators import compute_indicators, ema
from providers.base import new_bar


def bars(closes, volume=None):
    series = []
    for index, close in enumerate(closes):
        stamp = datetime(2024, 1, 1, tzinfo=timezone.utc) + timedelta(hours=index)
        series.append(new_bar(stamp, close, close + 1, close - 1, close, volume))
    return series


class EmaTest(unittest.TestCase):
    def test_ema_is_seeded_with_the_sma(self):
        values = np.array([1.0, 2.0, 3.0, 6.0])
        result = ema(values, 3)
        self.assertTrue(np.isnan(result[0]))
        self.assertTrue(np.isnan(result[1]))
        self.assertAlmostEqual(result[2], 2.0)
        self.assertAlmostEqual(result[3], 4.0)

    def test_short_series_stays_nan(self):
        result = ema(np.array([1.0, 2.0]), 5)
        self.assertTrue(np.isnan(result).all())


class RsiAndBandsTest(unittest.TestCase):
    def test_flat_prices_are_rsi_50(self):
        payload = compute_indicators(bars([10.0] * 20), asset_type="forex")
        self.assertEqual(payload["latest"]["rsi_14"], 50.0)
        self.assertIsNone(payload["points"][13]["rsi_14"])

    def test_rising_prices_are_rsi_100(self):
        payload = compute_indicators(bars(list(range(1, 20))), asset_type="crypto")
        self.assertEqual(payload["latest"]["rsi_14"], 100.0)

    def test_flat_bollinger_bands_collapse_to_the_sma(self):
        payload = compute_indicators(bars([10.0] * 20), asset_type="crypto")
        bands = payload["latest"]["bollinger"]
        self.assertEqual(bands["middle"], 10.0)
        self.assertEqual(bands["upper"], 10.0)
        self.assertEqual(bands["lower"], 10.0)

    def test_constant_range_atr_matches_the_bar_range(self):
        payload = compute_indicators(bars([10.0] * 20), asset_type="metals")
        self.assertEqual(payload["latest"]["atr_14"], 2.0)


class VolumeIndicatorTest(unittest.TestCase):
    def test_null_volume_omits_obv_mfi_and_vwap(self):
        payload = compute_indicators(bars([1.0, 2.0, 3.0], volume=None), asset_type="crypto")
        self.assertIn("no real volume", payload["note"])
        self.assertNotIn("obv", payload["latest"])
        self.assertNotIn("mfi_14", payload["latest"])
        self.assertNotIn("vwap", payload["latest"])

    def test_real_volume_builds_obv_in_the_price_direction(self):
        payload = compute_indicators(bars([1.0, 2.0, 1.0], volume=10), asset_type="crypto")
        self.assertNotIn("note", payload)
        self.assertEqual([point["obv"] for point in payload["points"]], [10.0, 20.0, 10.0])
        self.assertEqual(payload["latest"]["vwap"], round((1 + 2 + 1) / 3, 8))

    def test_one_missing_volume_drops_the_whole_volume_set(self):
        series = bars([1.0, 2.0], volume=5)
        broken = series + bars([3.0], volume=None)
        payload = compute_indicators(broken, asset_type="metals")
        self.assertNotIn("obv", payload["latest"])


class ComputeIndicatorsTest(unittest.TestCase):
    def test_short_history_warns_about_ema_50(self):
        payload = compute_indicators(bars([100.0] * 10), asset_type="forex")
        self.assertIn("EMA 50", payload["warning"])
        self.assertIsNone(payload["latest"]["ema_50"])

    def test_macd_histogram_is_the_line_minus_the_signal(self):
        payload = compute_indicators(bars([float(index) for index in range(1, 61)]), asset_type="crypto")
        macd = payload["latest"]["macd"]
        self.assertIsNotNone(macd["signal"])
        self.assertAlmostEqual(macd["histogram"], macd["macd"] - macd["signal"], places=6)


if __name__ == "__main__":
    unittest.main()
