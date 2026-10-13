import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../errors.js";
import { ASSET_TYPES, fetchAnalysis } from "../services/analysis.service.js";
import { paperLedger } from "../services/paperLedger.js";

const DISCLAIMER = "Research only, not financial advice.";
const SIDES = new Set(["long", "short"]);
const REASONS = new Set(["signal", "end_of_data"]);

export const listPaperRuns = asyncHandler(async (_req, res) => {
  const runs = await paperLedger.list();
  res.json({
    disclaimer: DISCLAIMER,
    runs: [...runs].reverse().map(summarize),
  });
});

export const getPaperRun = asyncHandler(async (req, res) => {
  const run = await paperLedger.get(req.params.id);
  if (!run) {
    throw new HttpError(404, "Paper run not found.");
  }
  res.json(run);
});

export const savePaperRun = asyncHandler(async (req, res) => {
  const assetType = firstString(req.query.asset_type).toLowerCase();
  const symbol = firstString(req.query.symbol);
  const timeframe = firstString(req.query.timeframe);
  if (!ASSET_TYPES.has(assetType)) {
    throw new HttpError(400, "asset_type must be crypto, forex, or metals.");
  }
  if (!symbol) {
    throw new HttpError(400, "symbol is required.");
  }
  if (!timeframe) {
    throw new HttpError(400, "timeframe is required.");
  }
  const limit = parseLimit(req.query.limit);

  const result = await fetchAnalysis("/backtest", {
    asset_type: assetType,
    symbol,
    timeframe,
    limit: String(limit),
  });
  if (result.status !== 200) {
    res.status(result.status).json(result.body);
    return;
  }

  const run = await paperLedger.save(toStoredRun(result.body, limit));
  res.status(201).json(run);
});

export const deletePaperRun = asyncHandler(async (req, res) => {
  const removed = await paperLedger.remove(req.params.id);
  if (!removed) {
    throw new HttpError(404, "Paper run not found.");
  }
  res.status(204).end();
});

function summarize(run) {
  return {
    id: run.id,
    saved_at: run.saved_at,
    asset_type: run.asset_type,
    symbol: run.symbol,
    timeframe: run.timeframe,
    strategy_label: run.strategy_label,
    ending_equity: run.ending_equity,
    return_pct: run.return_pct,
    trade_count: run.trade_count,
    max_drawdown_pct: run.max_drawdown_pct,
    fee_bps: run.fee_bps,
    warning: run.warning,
  };
}

function toStoredRun(body, limit) {
  if (!body || typeof body !== "object" || !ASSET_TYPES.has(body.asset_type)) {
    throw new HttpError(502, "Analysis service returned an unexpected backtest.");
  }

  const trades = Array.isArray(body.trades) ? body.trades.map(toTrade) : null;
  const tradeCount = requireInteger(body, "trade_count");
  if (!trades || trades.length !== tradeCount) {
    throw new HttpError(502, "Analysis service returned an unexpected backtest.");
  }

  return {
    asset_type: body.asset_type,
    symbol: requireText(body, "symbol"),
    timeframe: requireText(body, "timeframe"),
    limit,
    disclaimer: DISCLAIMER,
    strategy: requireText(body, "strategy"),
    strategy_label: requireText(body, "strategy_label"),
    description: requireText(body, "description"),
    starting_equity: requireNumber(body, "starting_equity"),
    ending_equity: requireNumber(body, "ending_equity"),
    return_pct: requireNumber(body, "return_pct"),
    trade_count: tradeCount,
    win_count: requireInteger(body, "win_count"),
    loss_count: requireInteger(body, "loss_count"),
    win_rate_pct: body.win_rate_pct == null ? null : requireNumber(body, "win_rate_pct"),
    max_drawdown_pct: requireNumber(body, "max_drawdown_pct"),
    fee_bps: requireNumber(body, "fee_bps"),
    fill: requireText(body, "fill"),
    sizing: requireText(body, "sizing"),
    warning: body.warning == null ? null : requireText(body, "warning"),
    trades,
  };
}

function toTrade(trade) {
  if (!trade || !SIDES.has(trade.side) || !REASONS.has(trade.reason)) {
    throw new HttpError(502, "Analysis service returned an unexpected backtest.");
  }
  return {
    side: trade.side,
    entry_time: requireText(trade, "entry_time"),
    exit_time: requireText(trade, "exit_time"),
    entry_price: requireNumber(trade, "entry_price"),
    exit_price: requireNumber(trade, "exit_price"),
    return_pct: requireNumber(trade, "return_pct"),
    pnl: requireNumber(trade, "pnl"),
    reason: trade.reason,
  };
}

function requireText(source, key) {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(502, "Analysis service returned an unexpected backtest.");
  }
  return value;
}

function requireNumber(source, key) {
  const value = source[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(502, "Analysis service returned an unexpected backtest.");
  }
  return value;
}

function requireInteger(source, key) {
  const value = requireNumber(source, key);
  if (!Number.isInteger(value)) {
    throw new HttpError(502, "Analysis service returned an unexpected backtest.");
  }
  return value;
}

function parseLimit(raw) {
  const text = firstString(raw);
  if (!text) {
    return 300;
  }
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new HttpError(400, "limit must be an integer from 1 to 1000.");
  }
  return value;
}

function firstString(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  if (typeof picked !== "string") {
    return "";
  }
  return picked.trim();
}
