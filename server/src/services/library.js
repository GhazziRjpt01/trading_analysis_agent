import { ASSET_TYPES, fetchAnalysis } from "./analysis.service.js";
import { HttpError } from "../errors.js";
import { TIMEFRAMES, compactIndicators } from "./agentTools.js";

const DISCLAIMER = "Research only, not financial advice.";
const ANALYSIS_COLUMNS = "id, asset_type, symbol, timeframe, note, snapshot, disclaimer, created_at";
const WATCHLIST_COLUMNS = "id, asset_type, symbol, created_at";

export function parseSymbol(value) {
  const symbol = typeof value === "string" ? value.trim() : "";
  if (!symbol || symbol.length > 32) {
    throw new HttpError(400, "symbol is required.");
  }
  return symbol;
}

export function parseAssetType(value) {
  const assetType = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!ASSET_TYPES.has(assetType)) {
    throw new HttpError(400, "asset_type must be crypto, forex, or metals.");
  }
  return assetType;
}

export function parseTimeframe(value) {
  const timeframe = typeof value === "string" ? value.trim() : "";
  if (!TIMEFRAMES.has(timeframe)) {
    throw new HttpError(400, "timeframe must be 1m, 5m, 15m, 30m, 1h, 4h, or 1d.");
  }
  return timeframe;
}

export function parseNote(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new HttpError(400, "note must be text.");
  }
  const note = value.trim();
  if (!note) {
    return null;
  }
  if (note.length > 500) {
    throw new HttpError(400, "note must be 500 characters or fewer.");
  }
  return note;
}

export function parseRowId(value) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new HttpError(404, "Not found.");
  }
  return value;
}

export function buildWatchlistInsert(userId, { assetType, symbol }) {
  return {
    user_id: userId,
    asset_type: assetType,
    symbol,
  };
}

export function buildAnalysisInsert(userId, { assetType, symbol, timeframe, note, snapshot }) {
  return {
    user_id: userId,
    asset_type: assetType,
    symbol,
    timeframe,
    note,
    snapshot,
    disclaimer: DISCLAIMER,
  };
}

export async function prepareAnalysis(userId, body, fetchImpl = fetchAnalysis) {
  const assetType = parseAssetType(body?.asset_type);
  const symbol = parseSymbol(body?.symbol);
  const timeframe = parseTimeframe(body?.timeframe);
  const note = parseNote(body?.note);
  const query = { asset_type: assetType, symbol, timeframe, limit: "300" };

  const [prices, indicators] = await Promise.all([
    fetchImpl("/prices", query),
    fetchImpl("/indicators", query),
  ]);
  if (prices.status !== 200) {
    return { errorStatus: prices.status, errorBody: prices.body };
  }
  if (indicators.status !== 200) {
    return { errorStatus: indicators.status, errorBody: indicators.body };
  }

  const bars = Array.isArray(prices.body?.bars) ? prices.body.bars : [];
  const latestBar = bars.at(-1);
  const compact = compactIndicators(indicators.status, indicators.body);
  if (!latestBar || !compact.ok) {
    throw new HttpError(502, "Analysis service returned an unexpected response.");
  }

  const row = buildAnalysisInsert(userId, {
    assetType,
    symbol: indicators.body.symbol || prices.body.symbol || symbol,
    timeframe,
    note,
    snapshot: {
      latest_bar: {
        timestamp: latestBar.timestamp,
        open: latestBar.open,
        high: latestBar.high,
        low: latestBar.low,
        close: latestBar.close,
        volume: latestBar.volume ?? null,
      },
      indicators: compact.latest,
      indicator_note: compact.note,
      indicator_warning: compact.warning,
    },
  });
  return { row };
}

export { ANALYSIS_COLUMNS, DISCLAIMER, WATCHLIST_COLUMNS };
