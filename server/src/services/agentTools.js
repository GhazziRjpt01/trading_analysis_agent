import { ASSET_TYPES, fetchAnalysis, postAnalysis } from "./analysis.service.js";
import { HttpError } from "../errors.js";

export const TIMEFRAMES = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

// Enough history for EMA 50 and MACD. The model only receives the latest values.
const TOOL_LIMIT = "300";
const RECENT_BARS = 8;

const PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    asset_type: {
      type: "string",
      enum: ["crypto", "forex", "metals"],
      description: "Market class.",
    },
    symbol: {
      type: "string",
      description: "Pair or metal, for example BTC/USDT, EURUSD, XAUUSD, Gold, or Silver.",
    },
    timeframe: {
      type: "string",
      enum: ["1m", "5m", "15m", "30m", "1h", "4h", "1d"],
    },
  },
  required: ["asset_type", "symbol", "timeframe"],
};

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_price_data",
      description:
        "Fetch OHLCV candles from the analysis service. Use this for every price or volume number.",
      strict: true,
      parameters: PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "compute_indicators",
      description:
        "Compute RSI, MACD, EMA 20/50, Bollinger Bands, and ATR from the analysis service. OBV, MFI, and VWAP appear only when volume is real. Use this for every indicator number.",
      strict: true,
      parameters: PARAMETERS,
    },
  },
  {
    type: "function",
    function: {
      name: "get_trade_signal",
      description:
        "Fetch the rule-based trade signal from the analysis service. Entry, stop, and take-profit prices are already computed. Explain them as returned. If direction is no_trade, say there is no trade and do not invent prices.",
      strict: true,
      parameters: PARAMETERS,
    },
  },
];

export async function executeTool(name, rawArguments, fetchImpl = fetchAnalysis, postImpl = postAnalysis) {
  let args;
  try {
    args = JSON.parse(rawArguments);
  } catch {
    return { ok: false, detail: "Tool arguments were not valid JSON." };
  }

  const parsed = parseToolArgs(args);
  if (!parsed.ok) {
    return parsed;
  }

  const query = {
    asset_type: parsed.asset_type,
    symbol: parsed.symbol,
    timeframe: parsed.timeframe,
    limit: TOOL_LIMIT,
  };

  try {
    if (name === "get_price_data") {
      const result = await fetchImpl("/prices", query);
      return compactPrices(result.status, result.body);
    }
    if (name === "compute_indicators") {
      const result = await fetchImpl("/indicators", query);
      return compactIndicators(result.status, result.body);
    }
    if (name === "get_trade_signal") {
      const result = await postImpl("/signal", {
        asset_type: parsed.asset_type,
        symbol: parsed.symbol,
        timeframe: parsed.timeframe,
      });
      return compactSignal(result.status, result.body);
    }
  } catch (err) {
    const detail = err instanceof HttpError ? err.message : "Analysis service is unavailable.";
    return { ok: false, detail };
  }

  return { ok: false, detail: "Unknown tool." };
}

export function parseToolArgs(args) {
  const assetType = typeof args?.asset_type === "string" ? args.asset_type.trim().toLowerCase() : "";
  const symbol = typeof args?.symbol === "string" ? args.symbol.trim() : "";
  const timeframe = typeof args?.timeframe === "string" ? args.timeframe.trim() : "";
  if (!ASSET_TYPES.has(assetType)) {
    return { ok: false, detail: "asset_type must be crypto, forex, or metals." };
  }
  if (!symbol || symbol.length > 32) {
    return { ok: false, detail: "symbol is required." };
  }
  if (!TIMEFRAMES.has(timeframe)) {
    return { ok: false, detail: "timeframe must be 1m, 5m, 15m, 30m, 1h, 4h, or 1d." };
  }
  return { ok: true, asset_type: assetType, symbol, timeframe };
}

export function compactPrices(status, body) {
  if (status !== 200 || !body || !Array.isArray(body.bars)) {
    return { ok: false, detail: body?.detail || "Price data is unavailable." };
  }
  const recent = body.bars.slice(-RECENT_BARS).map(compactBar);
  return {
    ok: true,
    asset_type: body.asset_type,
    symbol: body.symbol,
    timeframe: body.timeframe,
    disclaimer: body.disclaimer,
    bar_count: body.count,
    latest: recent.at(-1) ?? null,
    recent_bars: recent,
  };
}

export function compactIndicators(status, body) {
  if (status !== 200 || !body?.latest) {
    return { ok: false, detail: body?.detail || "Indicators are unavailable." };
  }
  const points = Array.isArray(body.points) ? body.points : [];
  return {
    ok: true,
    asset_type: body.asset_type,
    symbol: body.symbol,
    timeframe: body.timeframe,
    disclaimer: body.disclaimer,
    note: body.note ?? null,
    warning: body.warning ?? null,
    latest: body.latest,
    previous: points.length > 1 ? points.at(-2) : null,
  };
}

export function compactSignal(status, body) {
  if (status !== 200 || !body?.direction) {
    return { ok: false, detail: body?.detail || "Signal is unavailable." };
  }
  const noTrade = body.direction === "no_trade";
  return {
    ok: true,
    instruction: noTrade
      ? "The signal is no_trade. Say there is no trade. Do not invent an entry, stop, or target."
      : "Explain only these price levels. Do not change or replace them.",
    asset_type: body.asset_type,
    symbol: body.symbol,
    timeframe: body.timeframe,
    direction: body.direction,
    confidence: body.confidence,
    entry_zone: body.entry_zone ?? null,
    stop_loss: body.stop_loss ?? null,
    take_profit_1: body.take_profit_1 ?? null,
    take_profit_2: body.take_profit_2 ?? null,
    risk_reward: body.risk_reward ?? null,
    invalidation: body.invalidation ?? [],
    votes: body.votes ?? [],
    backtest: body.backtest ?? null,
    disclaimer: body.disclaimer,
  };
}

function compactBar(bar) {
  return {
    timestamp: bar.timestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? null,
  };
}
