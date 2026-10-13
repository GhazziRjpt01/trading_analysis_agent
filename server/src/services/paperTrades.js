import { HttpError } from "../errors.js";

const DISCLAIMER = "Educational and research tool only. Not financial advice. Trading involves risk of loss.";
const RESEARCH_DISCLAIMER = "Research only, not financial advice.";
const STATUSES = new Set(["open", "hit_tp", "hit_sl"]);
const DIRECTIONS = new Set(["buy", "sell"]);

export const PAPER_TRADE_COLUMNS =
  "id, asset_type, symbol, timeframe, direction, entry_low, entry_high, stop_loss, take_profit_1, take_profit_2, risk_reward, confidence, status, disclaimer, created_at, updated_at";

export { DISCLAIMER, RESEARCH_DISCLAIMER };

export function parseTradeStatus(value) {
  const status = typeof value === "string" ? value.trim() : "";
  if (!STATUSES.has(status)) {
    throw new HttpError(400, "status must be open, hit_tp, or hit_sl.");
  }
  return status;
}

/**
 * Levels come from the analysis signal. A client-supplied price is ignored.
 * no_trade has no entry or stop, so it cannot be logged.
 */
export function buildPaperTradeInsert(userId, signal) {
  if (!signal || typeof signal !== "object") {
    throw new HttpError(502, "Analysis service returned an unexpected signal.");
  }
  if (!DIRECTIONS.has(signal.direction)) {
    throw new HttpError(400, "A no_trade signal cannot be saved as a paper trade.");
  }
  const zone = signal.entry_zone;
  return {
    user_id: userId,
    asset_type: signal.asset_type,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    direction: signal.direction,
    entry_low: requirePrice(zone, "low"),
    entry_high: requirePrice(zone, "high"),
    stop_loss: requirePrice(signal, "stop_loss"),
    take_profit_1: requirePrice(signal, "take_profit_1"),
    take_profit_2: requirePrice(signal, "take_profit_2"),
    risk_reward: requirePrice(signal, "risk_reward"),
    confidence: signal.confidence,
    status: "open",
    snapshot: {
      votes: signal.votes ?? [],
      invalidation: signal.invalidation ?? [],
      backtest: signal.backtest ?? null,
      atr: signal.atr ?? null,
    },
    disclaimer: DISCLAIMER,
  };
}

function requirePrice(source, key) {
  const value = source?.[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(502, "Analysis service returned an unexpected signal.");
  }
  return value;
}
