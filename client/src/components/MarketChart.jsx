import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
} from "lightweight-charts";

const UP = "#26a69a";
const DOWN = "#ef5350";

/**
 * One chart, three panes. A shared time scale keeps the candle, RSI, and MACD
 * crosshairs aligned. EMA lines sit on the candle pane.
 */
export default function MarketChart({ bars, points, timeframe, levels = null }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const priceLinesRef = useRef([]);

  useEffect(() => {
    const container = containerRef.current;
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#161b22" },
        textColor: "#8b97a8",
        fontFamily: "IBM Plex Sans, Segoe UI, sans-serif",
        panes: {
          separatorColor: "#2a3140",
          separatorHoverColor: "rgba(61, 139, 253, 0.35)",
        },
      },
      grid: {
        vertLines: { color: "#222838" },
        horzLines: { color: "#222838" },
      },
      rightPriceScale: { borderColor: "#2a3140" },
      timeScale: {
        borderColor: "#2a3140",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#5b8def", labelBackgroundColor: "#3d8bfd" },
        horzLine: { color: "#5b8def", labelBackgroundColor: "#3d8bfd" },
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    const ema20 = chart.addSeries(LineSeries, lineOptions("#f5c542"));
    const ema50 = chart.addSeries(LineSeries, lineOptions("#c084fc"));

    const rsi = chart.addSeries(
      LineSeries,
      {
        ...lineOptions("#3d8bfd"),
        // Keep 30/70 on screen even when RSI is stuck in the middle of the range.
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
        priceFormat: { type: "price", precision: 1, minMove: 0.1 },
      },
      1,
    );
    rsi.createPriceLine({
      price: 70,
      color: DOWN,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "70",
    });
    rsi.createPriceLine({
      price: 30,
      color: UP,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: "30",
    });

    const histogram = chart.addSeries(
      HistogramSeries,
      { priceLineVisible: false, lastValueVisible: false },
      2,
    );
    const macd = chart.addSeries(LineSeries, lineOptions("#3d8bfd"), 2);
    const signal = chart.addSeries(LineSeries, lineOptions("#ff9800"), 2);

    const panes = chart.panes();
    panes[0].setStretchFactor(3);
    panes[1].setStretchFactor(1);
    panes[2].setStretchFactor(1.15);

    chartRef.current = chart;
    seriesRef.current = { candles, ema20, ema50, rsi, histogram, macd, signal };

    return () => {
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) {
      return;
    }

    const candleData = uniqueSorted(
      bars.map((bar) => ({
        time: toUnix(bar.timestamp),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
    );
    const quote = quoteFormat(candleData.at(-1)?.close ?? 1);
    series.candles.applyOptions({ priceFormat: quote });
    series.ema20.applyOptions({ priceFormat: quote });
    series.ema50.applyOptions({ priceFormat: quote });
    series.candles.setData(candleData);
    series.ema20.setData(linePoints(points, (point) => point.ema_20));
    series.ema50.setData(linePoints(points, (point) => point.ema_50));
    series.rsi.setData(linePoints(points, (point) => point.rsi_14));

    const macdPoints = linePoints(points, (point) => point.macd?.macd);
    const macdScale = macdFormat(macdPoints.at(-1)?.value ?? 0);
    series.histogram.applyOptions({ priceFormat: macdScale });
    series.macd.applyOptions({ priceFormat: macdScale });
    series.signal.applyOptions({ priceFormat: macdScale });
    series.histogram.setData(
      uniqueSorted(
        points
          .map((point) => {
            const value = point.macd?.histogram;
            if (!Number.isFinite(value)) {
              return null;
            }
            return {
              time: toUnix(point.timestamp),
              value,
              color: value >= 0 ? "rgba(38, 166, 154, 0.7)" : "rgba(239, 83, 80, 0.7)",
            };
          })
          .filter(Boolean),
      ),
    );
    series.macd.setData(macdPoints);
    series.signal.setData(linePoints(points, (point) => point.macd?.signal));

    chart.applyOptions({
      timeScale: { timeVisible: timeframe !== "1d", secondsVisible: false },
    });
    if (candleData.length > 0) {
      chart.timeScale().fitContent();
    }

    for (const line of priceLinesRef.current) {
      series.candles.removePriceLine(line);
    }
    priceLinesRef.current = tradePriceLines(series.candles, levels);
  }, [bars, points, timeframe, levels]);

  return <div className="chart" ref={containerRef} />;
}

function tradePriceLines(candles, levels) {
  if (!levels || levels.direction === "no_trade") {
    return [];
  }
  const specs = [
    { price: levels.entryLow, color: "#8b97a8", title: "Entry", style: LineStyle.Dashed },
    { price: levels.entryHigh, color: "#8b97a8", title: "Entry", style: LineStyle.Dashed },
    { price: levels.stopLoss, color: DOWN, title: "SL", style: LineStyle.Solid },
    { price: levels.takeProfit1, color: UP, title: "TP1", style: LineStyle.Solid },
    { price: levels.takeProfit2, color: "#7dcea0", title: "TP2", style: LineStyle.Dotted },
  ];
  return specs
    .filter((spec) => Number.isFinite(spec.price))
    .map((spec) =>
      candles.createPriceLine({
        price: spec.price,
        color: spec.color,
        lineWidth: 1,
        lineStyle: spec.style,
        title: spec.title,
        axisLabelVisible: true,
      }),
    );
}

function lineOptions(color) {
  return {
    color,
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  };
}

function linePoints(points, pick) {
  return uniqueSorted(
    points
      .map((point) => {
        const value = pick(point);
        // Warmup bars are null. The chart rejects those values.
        if (!Number.isFinite(value)) {
          return null;
        }
        return { time: toUnix(point.timestamp), value };
      })
      .filter(Boolean),
  );
}

function uniqueSorted(rows) {
  const valid = rows.filter((row) => Number.isFinite(row.time));
  valid.sort((a, b) => a.time - b.time);
  const unique = [];
  for (const row of valid) {
    if (unique.length > 0 && unique[unique.length - 1].time === row.time) {
      unique[unique.length - 1] = row;
      continue;
    }
    unique.push(row);
  }
  return unique;
}

// Date strings are daily bars in this library. Intraday candles need unix seconds.
function toUnix(timestamp) {
  return Math.floor(Date.parse(timestamp) / 1000);
}

function quoteFormat(close) {
  if (close >= 1000) {
    return { type: "price", precision: 2, minMove: 0.01 };
  }
  if (close >= 1) {
    return { type: "price", precision: 5, minMove: 0.00001 };
  }
  return { type: "price", precision: 8, minMove: 0.00000001 };
}

function macdFormat(value) {
  const abs = Math.abs(value);
  if (abs >= 1) {
    return { type: "price", precision: 2, minMove: 0.01 };
  }
  if (abs >= 0.01) {
    return { type: "price", precision: 5, minMove: 0.00001 };
  }
  return { type: "price", precision: 6, minMove: 0.000001 };
}
