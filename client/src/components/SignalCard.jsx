import { useEffect, useState } from "react";
import { calculatePositionSize } from "../api.js";
import { DISCLAIMER, PAST_PERFORMANCE, RISK_DISCLAIMER } from "../constants.js";

export default function SignalCard({
  signal,
  loading,
  error,
  onRetry,
  assetType,
  accessToken,
  onSave,
  saving,
  saveError,
}) {
  return (
    <section className="signal-card" aria-label="Signal">
      <div className="signal-head">
        <h2>Signal</h2>
        {signal?.direction && <Direction direction={signal.direction} confidence={signal.confidence} />}
      </div>
      <p className="risk-banner">{RISK_DISCLAIMER}</p>
      <p className="disclaimer-inline">{DISCLAIMER}</p>

      {loading && <p className="note">Computing the signal…</p>}
      {!loading && error && (
        <div role="alert">
          <p className="account-message">{error}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {!loading && !error && signal && (
        <>
          {signal.direction === "no_trade" ? (
            <p className="signal-flat">No trade. The indicators do not agree.</p>
          ) : (
            <dl className="signal-levels">
              <div>
                <dt>Entry zone</dt>
                <dd>
                  {formatQuote(signal.entry_zone?.low)} – {formatQuote(signal.entry_zone?.high)}
                </dd>
              </div>
              <div>
                <dt>Stop loss</dt>
                <dd>{formatQuote(signal.stop_loss)}</dd>
              </div>
              <div>
                <dt>Take profit 1</dt>
                <dd>{formatQuote(signal.take_profit_1)}</dd>
              </div>
              <div>
                <dt>Take profit 2</dt>
                <dd>{formatQuote(signal.take_profit_2)}</dd>
              </div>
              <div>
                <dt>Risk / reward</dt>
                <dd>{formatQuote(signal.risk_reward, 2)}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd className="signal-confidence">{signal.confidence}</dd>
              </div>
            </dl>
          )}

          <ul className="signal-votes">
            {(signal.votes ?? []).map((vote) => (
              <li key={vote.name}>
                <span>{vote.name}</span>
                <em className={vote.vote}>{vote.vote}</em>
              </li>
            ))}
          </ul>

          {signal.invalidation?.length > 0 && (
            <div>
              <h3>Invalidation</h3>
              <ul className="signal-notes">
                {signal.invalidation.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="signal-stats">
            <h3>Same rules on this history</h3>
            <p>
              Win rate {formatStat(signal.backtest?.win_rate_pct, "%")} · Max drawdown{" "}
              {formatStat(signal.backtest?.max_drawdown_pct, "%")} · Trades {signal.backtest?.trade_count ?? "—"}
            </p>
            {signal.backtest?.warning && <p className="note">{signal.backtest.warning}</p>}
            <p className="disclaimer-inline">{signal.performance_note || PAST_PERFORMANCE}</p>
          </div>

          <button type="button" onClick={onSave} disabled={saving || signal.direction === "no_trade" || !accessToken}>
            {saving ? "Saving…" : "Save paper trade"}
          </button>
          {!accessToken && <p className="note">Sign in to save this signal as a paper trade.</p>}
          {signal.direction === "no_trade" && <p className="note">A no-trade signal is not saved.</p>}
          {saveError && (
            <p className="account-message" role="alert">
              {saveError}
            </p>
          )}
        </>
      )}

      <PositionForm assetType={assetType} signal={signal} />
    </section>
  );
}

function PositionForm({ assetType, signal }) {
  const [balance, setBalance] = useState("10000");
  const [riskPercent, setRiskPercent] = useState("1");
  const [entry, setEntry] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!signal || signal.direction === "no_trade" || !signal.entry_zone) {
      return;
    }
    const planned = signal.direction === "buy" ? signal.entry_zone.high : signal.entry_zone.low;
    setEntry(String(planned));
    setStopLoss(signal.stop_loss == null ? "" : String(signal.stop_loss));
    setResult(null);
  }, [signal]);

  async function onSubmit(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    setResult(null);
    try {
      const sized = await calculatePositionSize({
        asset_type: assetType,
        account_balance: Number(balance),
        risk_percent: Number(riskPercent),
        entry: Number(entry),
        stop_loss: Number(stopLoss),
      });
      setResult(sized);
    } catch (err) {
      setError(err.message || "Could not size the position.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="size-form" onSubmit={onSubmit}>
      <h3>Position size</h3>
      <label>
        Account balance
        <input value={balance} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" required />
      </label>
      <label>
        Risk %
        <input value={riskPercent} onChange={(event) => setRiskPercent(event.target.value)} inputMode="decimal" required />
      </label>
      <label>
        Entry
        <input value={entry} onChange={(event) => setEntry(event.target.value)} inputMode="decimal" required />
      </label>
      <label>
        Stop loss
        <input value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} inputMode="decimal" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Calculating…" : "Calculate"}
      </button>
      {error && (
        <p className="account-message" role="alert">
          {error}
        </p>
      )}
      {result && (
        <p className="size-result">
          {result.position_size} {result.unit}
          {result.unit === "lots" ? ` (${result.units} units)` : ""}
          <span>{result.assumption}</span>
        </p>
      )}
    </form>
  );
}

function Direction({ direction, confidence }) {
  const label = direction === "no_trade" ? "No trade" : direction === "buy" ? "Buy" : "Sell";
  return (
    <p className={`signal-direction ${direction}`}>
      {label}
      {direction !== "no_trade" && confidence ? <span>{confidence}</span> : null}
    </p>
  );
}

function formatStat(value, suffix) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${Number(value).toFixed(2)}${suffix}`;
}

export function formatQuote(value, digits) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  const abs = Math.abs(value);
  const places = digits ?? (abs >= 1000 ? 2 : abs >= 1 ? 5 : 6);
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}
