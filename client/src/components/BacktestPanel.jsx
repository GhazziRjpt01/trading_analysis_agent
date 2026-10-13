import { DISCLAIMER, PAST_PERFORMANCE } from "../constants.js";

export default function BacktestPanel({
  result,
  loading,
  error,
  onRetry,
  onSave,
  saving,
  saveError,
  saveNotice,
}) {
  return (
    <section className="backtest" aria-busy={loading} aria-label="Paper backtest">
      <div className="backtest-head">
        <div>
          <h2>{result?.strategy_label ?? "EMA 20/50 crossover"}</h2>
          <p className="backtest-copy">
            {result?.description ?? "Paper simulation. No live orders."}
          </p>
        </div>
        {result?.equity?.length > 1 && <EquityLine points={result.equity} />}
      </div>
      <p className="disclaimer-inline">{DISCLAIMER}</p>
      <p className="disclaimer-inline">{PAST_PERFORMANCE}</p>

      {loading && <p className="backtest-status">Running paper backtest…</p>}

      {!loading && error && (
        <div className="backtest-status" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {!loading && result && (
        <>
          {result.warning && <p className="backtest-status">{result.warning}</p>}
          <div className="summary backtest-stats">
            <Stat label="Return" value={formatSignedPercent(result.return_pct)} tone={tone(result.return_pct)} />
            <Stat label="Ending" value={formatMoney(result.ending_equity)} />
            <Stat label="Trades" value={String(result.trade_count)} />
            <Stat label="Win rate" value={result.win_rate_pct == null ? "—" : formatPercent(result.win_rate_pct)} />
            <Stat label="Max DD" value={formatPercent(result.max_drawdown_pct)} tone="neg" />
            <Stat label="Fee" value={`${trimNumber(result.fee_bps)} bps`} />
          </div>
          {result.trade_count === 0 && !result.warning && (
            <p className="backtest-status">No EMA cross in this window. Paper equity stays at the start.</p>
          )}
          <div className="backtest-actions">
            <button type="button" onClick={onSave} disabled={saving}>
              {saving ? "Saving…" : "Save paper run"}
            </button>
            {saveNotice && <p className="backtest-status">{saveNotice}</p>}
            {saveError && (
              <p className="backtest-status" role="alert">
                {saveError}
              </p>
            )}
          </div>
          {result.trades.length > 0 && <TradeTable trades={result.trades} />}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }) {
  return (
    <span className={tone ? `stat ${tone}` : "stat"}>
      <em>{label}</em>
      {value}
    </span>
  );
}

function TradeTable({ trades }) {
  const rows = [...trades].reverse();
  return (
    <div className="trade-scroll">
      <table className="trades">
        <caption>Paper trades, newest first. The last row may be closed at the final bar.</caption>
        <thead>
          <tr>
            <th>Side</th>
            <th>Entry</th>
            <th>Exit</th>
            <th>Return</th>
            <th>PnL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((trade) => (
            <tr key={`${trade.entry_time}-${trade.exit_time}-${trade.side}`}>
              <td>{trade.side}</td>
              <td>
                {formatWhen(trade.entry_time)}
                <span className="trade-price">{formatPrice(trade.entry_price)}</span>
              </td>
              <td>
                {formatWhen(trade.exit_time)}
                <span className="trade-price">{formatPrice(trade.exit_price)}</span>
                {trade.reason === "end_of_data" && <span className="trade-tag">last bar</span>}
              </td>
              <td className={tone(trade.return_pct)}>{formatSignedPercent(trade.return_pct)}</td>
              <td className={tone(trade.pnl)}>{formatSignedMoney(trade.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EquityLine({ points }) {
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 220;
  const height = 48;
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  const path = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const up = values[values.length - 1] >= values[0];

  return (
    <svg className="equity" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Paper equity curve">
      <path d={path} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="2" />
    </svg>
  );
}

function tone(value) {
  if (value > 0) {
    return "pos";
  }
  if (value < 0) {
    return "neg";
  }
  return "";
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedMoney(value) {
  const prefix = value > 0 ? "+" : "";
  return prefix + formatMoney(value);
}

function formatPercent(value) {
  return `${Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatSignedPercent(value) {
  const prefix = value > 0 ? "+" : "";
  return prefix + formatPercent(value);
}

function formatPrice(value) {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 5 : 6;
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function trimNumber(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
