import { useEffect, useState } from "react";
import { fetchPaperRun } from "../api.js";
import { DISCLAIMER } from "../constants.js";

export default function LedgerPanel({
  runs,
  loading,
  error,
  onRetry,
  onDelete,
  current,
}) {
  const [openId, setOpenId] = useState(null);

  return (
    <section className="ledger" aria-busy={loading} aria-label="Paper ledger">
      <h2>Paper ledger</h2>
      <p className="backtest-copy">Saved on this machine. No live orders.</p>
      <p className="disclaimer-inline">{DISCLAIMER}</p>

      {loading && <p className="backtest-status">Loading paper ledger…</p>}

      {!loading && error && (
        <div className="backtest-status" role="alert">
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && runs.length === 0 && (
        <p className="backtest-status">No saved paper runs yet. Save the current backtest to keep it here.</p>
      )}

      {!loading && !error && runs.length > 0 && (
        <ul className="ledger-list">
          {runs.map((run) => (
            <li
              key={run.id}
              className={isCurrent(run, current) ? "ledger-row current" : "ledger-row"}
            >
              <div>
                <strong>
                  {run.symbol} · {run.timeframe}
                </strong>
                <span className="trade-price">
                  {run.asset_type} · {formatWhen(run.saved_at)}
                </span>
              </div>
              <div className="ledger-metrics">
                <span className={tone(run.return_pct)}>{formatSignedPercent(run.return_pct)}</span>
                <span>{formatMoney(run.ending_equity)}</span>
                <span>{run.trade_count} trades</span>
              </div>
              <div className="ledger-actions">
                {run.trade_count > 0 && (
                  <button type="button" className="ghost" onClick={() => setOpenId(openId === run.id ? null : run.id)}>
                    {openId === run.id ? "Hide trades" : "Trades"}
                  </button>
                )}
                <button type="button" className="ghost" onClick={() => onDelete(run.id)}>
                  Remove
                </button>
              </div>
              {openId === run.id && <RunTrades id={run.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RunTrades({ id }) {
  const [trades, setTrades] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setTrades(null);
    setError("");
    fetchPaperRun(id, controller.signal)
      .then((run) => setTrades(run.trades ?? []))
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }
        setError(err.message || "Could not load trades.");
      });
    return () => controller.abort();
  }, [id]);

  if (error) {
    return (
      <p className="backtest-status" role="alert">
        {error}
      </p>
    );
  }
  if (!trades) {
    return <p className="backtest-status">Loading trades…</p>;
  }

  const rows = [...trades].reverse();
  return (
    <div className="trade-scroll ledger-trades">
      <table className="trades">
        <caption>Saved paper trades, newest first.</caption>
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

function isCurrent(run, current) {
  return (
    run.asset_type === current.assetType &&
    run.symbol === current.symbol &&
    run.timeframe === current.timeframe
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
