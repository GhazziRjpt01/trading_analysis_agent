import { useState } from "react";
import { pairsFor, runStrategyBacktest } from "../api.js";
import { DISCLAIMER, PAST_PERFORMANCE, TIMEFRAMES } from "../constants.js";

const STRATEGIES = [
  { value: "ema_crossover", label: "EMA crossover" },
  { value: "rsi_mean_reversion", label: "RSI mean reversion" },
];

export default function BacktestPage({ assetType: initialAsset, symbol: initialSymbol, timeframe: initialTimeframe }) {
  const [assetType, setAssetType] = useState(initialAsset);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [period, setPeriod] = useState(300);
  const [strategy, setStrategy] = useState("ema_crossover");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pairs = pairsFor(assetType);

  async function run(event) {
    event.preventDefault();
    const bars = Number(period);
    if (!Number.isInteger(bars) || bars < 50 || bars > 1000) {
      setError("Period must be a whole number from 50 to 1000.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const body = await runStrategyBacktest({
        asset_type: assetType,
        symbol,
        timeframe,
        period: bars,
        strategy,
      });
      setResult(body);
    } catch (err) {
      setResult(null);
      setError(err.message || "Could not run the backtest.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="backtest-page" aria-label="Backtest">
      <div className="backtest-page-head">
        <h2>Backtest</h2>
        <p>Paper simulation. No live orders.</p>
        <p className="disclaimer-inline">{PAST_PERFORMANCE}</p>
        <p className="disclaimer-inline">{DISCLAIMER}</p>
      </div>

      <form className="controls backtest-form" onSubmit={run}>
        <div className="field">
          <span>Asset</span>
          <div className="toggle" role="group" aria-label="Backtest asset type">
            {["crypto", "forex", "metals"].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={assetType === value}
                onClick={() => {
                  setAssetType(value);
                  setSymbol(pairsFor(value)[0].value);
                }}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Symbol</span>
          <select value={symbol} aria-label="Backtest symbol" onChange={(event) => setSymbol(event.target.value)}>
            {pairs.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Timeframe</span>
          <select value={timeframe} aria-label="Backtest timeframe" onChange={(event) => setTimeframe(event.target.value)}>
            {TIMEFRAMES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Period</span>
          <input
            type="number"
            min={50}
            max={1000}
            step={1}
            value={period}
            aria-label="Backtest period in bars"
            onChange={(event) => setPeriod(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Strategy</span>
          <select value={strategy} aria-label="Backtest strategy" onChange={(event) => setStrategy(event.target.value)}>
            {STRATEGIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Running…" : "Run backtest"}
        </button>
      </form>

      {error && (
        <p className="account-message" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="backtest-result">
          <div className="backtest-result-head">
            <div>
              <h3>
                {result.strategy_label} · {result.symbol} · {result.timeframe}
              </h3>
              <p>{result.description}</p>
              <p>{result.costs}</p>
              {result.warning && <p>{result.warning}</p>}
            </div>
            {result.equity?.length > 1 && <EquityChart points={result.equity} />}
          </div>
          <table className="metrics">
            <caption>Paper backtest metrics. Past performance does not predict future results.</caption>
            <tbody>
              <Metric label="Total return" value={formatSignedPercent(result.total_return_pct)} tone={tone(result.total_return_pct)} />
              <Metric label="Win rate" value={result.win_rate_pct == null ? "—" : formatPercent(result.win_rate_pct)} />
              <Metric label="Max drawdown" value={formatPercent(result.max_drawdown_pct)} tone="neg" />
              <Metric label="Sharpe ratio" value={result.sharpe_ratio == null ? "—" : formatNumber(result.sharpe_ratio)} />
              <Metric label="Trades" value={String(result.trade_count)} />
            </tbody>
          </table>
          <p className="disclaimer-inline">{result.performance_note || PAST_PERFORMANCE}</p>
          <p className="disclaimer-inline">{result.disclaimer || DISCLAIMER}</p>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone: toneName }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className={toneName || ""}>{value}</td>
    </tr>
  );
}

function EquityChart({ points }) {
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 640;
  const height = 220;
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 16) - 8;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const up = values[values.length - 1] >= values[0];

  return (
    <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Equity curve">
      <path d={path} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2" />
    </svg>
  );
}

function tone(value) {
  if (value > 0) return "pos";
  if (value < 0) return "neg";
  return "";
}

function formatPercent(value) {
  return `${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatSignedPercent(value) {
  const prefix = value > 0 ? "+" : "";
  return prefix + formatPercent(value);
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
