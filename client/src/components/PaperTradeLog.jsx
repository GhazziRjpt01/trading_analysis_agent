import { DISCLAIMER, RISK_DISCLAIMER } from "../constants.js";
import { formatQuote } from "./SignalCard.jsx";

const STATUS_LABEL = {
  open: "Still open",
  hit_tp: "Hit TP",
  hit_sl: "Hit SL",
};

export default function PaperTradeLog({ trades, loading, error, accessToken, onStatus, onDelete, onRetry }) {
  return (
    <section className="paper-log" aria-label="Paper trading log">
      <div className="signal-head">
        <h2>Paper trading log</h2>
        <p>Saved signals stay on your account. Mark whether price reached the target or the stop.</p>
      </div>
      <p className="risk-banner">{RISK_DISCLAIMER}</p>
      <p className="disclaimer-inline">{DISCLAIMER}</p>

      {!accessToken && <p className="note">Sign in to keep a paper trading log.</p>}
      {accessToken && loading && <p className="note">Loading paper trades…</p>}
      {accessToken && error && (
        <div role="alert">
          <p className="account-message">{error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
      {accessToken && !loading && !error && trades.length === 0 && (
        <p className="note">No paper trades yet. Save a buy or sell signal from the card beside the chart.</p>
      )}

      {accessToken && trades.length > 0 && (
        <ul className="paper-log-list">
          {trades.map((trade) => (
            <li key={trade.id}>
              <div>
                <strong>
                  {trade.direction === "buy" ? "Buy" : "Sell"} {trade.symbol}
                </strong>
                <span>
                  {trade.timeframe} · {STATUS_LABEL[trade.status] || trade.status}
                </span>
              </div>
              <p>
                Entry {formatQuote(trade.entry_low)} – {formatQuote(trade.entry_high)} · SL {formatQuote(trade.stop_loss)} · TP1{" "}
                {formatQuote(trade.take_profit_1)} · TP2 {formatQuote(trade.take_profit_2)}
              </p>
              <div className="paper-log-actions">
                <button type="button" aria-pressed={trade.status === "hit_tp"} onClick={() => onStatus(trade.id, "hit_tp")}>
                  Hit TP
                </button>
                <button type="button" aria-pressed={trade.status === "hit_sl"} onClick={() => onStatus(trade.id, "hit_sl")}>
                  Hit SL
                </button>
                <button type="button" aria-pressed={trade.status === "open"} onClick={() => onStatus(trade.id, "open")}>
                  Still open
                </button>
                <button type="button" className="ghost" onClick={() => onDelete(trade.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
