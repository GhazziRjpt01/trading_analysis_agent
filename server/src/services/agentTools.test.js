import assert from "node:assert/strict";
import { test } from "node:test";
import { compactIndicators, compactPrices, compactSignal, executeTool } from "./agentTools.js";

test("price tool calls the analysis service and keeps a null forex volume", async () => {
  const calls = [];
  const fetchImpl = async (pathname, query) => {
    calls.push({ pathname, query });
    return {
      status: 200,
      body: {
        asset_type: "forex",
        symbol: "EURUSD",
        timeframe: "1h",
        disclaimer: "Research only, not financial advice.",
        count: 2,
        bars: [
          { timestamp: "2026-10-12T10:00:00Z", open: 1.1, high: 1.2, low: 1.0, close: 1.15, volume: null },
          { timestamp: "2026-10-12T11:00:00Z", open: 1.15, high: 1.16, low: 1.14, close: 1.155, volume: null },
        ],
      },
    };
  };

  const result = await executeTool(
    "get_price_data",
    JSON.stringify({ asset_type: "Forex", symbol: "EURUSD", timeframe: "1h" }),
    fetchImpl,
  );

  assert.equal(calls[0].pathname, "/prices");
  assert.equal(calls[0].query.asset_type, "forex");
  assert.equal(calls[0].query.limit, "300");
  assert.equal(result.ok, true);
  assert.equal(result.latest.close, 1.155);
  assert.equal(result.latest.volume, null);
});

test("indicator tool returns the latest values and drops the full series", async () => {
  const fetchImpl = async () => ({
    status: 200,
    body: {
      asset_type: "crypto",
      symbol: "BTC/USDT",
      timeframe: "1h",
      disclaimer: "Research only, not financial advice.",
      latest: { rsi_14: 61.2, ema_20: 100 },
      points: [{ rsi_14: 60 }, { rsi_14: 61.2 }],
    },
  });

  const result = await executeTool(
    "compute_indicators",
    JSON.stringify({ asset_type: "crypto", symbol: "BTC/USDT", timeframe: "1h" }),
    fetchImpl,
  );

  assert.equal(result.latest.rsi_14, 61.2);
  assert.equal(result.previous.rsi_14, 60);
  assert.equal(result.points, undefined);
});

test("a failed analysis response stays an error for the model", async () => {
  const fetchImpl = async () => ({ status: 400, body: { detail: "Unknown symbol." } });
  const result = await executeTool(
    "get_price_data",
    JSON.stringify({ asset_type: "metals", symbol: "Gold", timeframe: "1d" }),
    fetchImpl,
  );
  assert.deepEqual(result, { ok: false, detail: "Unknown symbol." });
});

test("rejects an asset class the tools do not support", async () => {
  const result = await executeTool(
    "get_price_data",
    JSON.stringify({ asset_type: "stock", symbol: "AAPL", timeframe: "1h" }),
    async () => {
      throw new Error("should not fetch");
    },
  );
  assert.equal(result.ok, false);
});

test("compact helpers omit a non-200 body", () => {
  assert.equal(compactPrices(502, { detail: "down" }).ok, false);
  assert.equal(compactIndicators(200, {}).ok, false);
  assert.equal(compactSignal(400, { detail: "bad" }).ok, false);
});

test("signal tool returns the analysis prices unchanged", async () => {
  const posts = [];
  const postImpl = async (pathname, body) => {
    posts.push({ pathname, body });
    return {
      status: 200,
      body: {
        asset_type: "crypto",
        symbol: "BTC/USDT",
        timeframe: "1h",
        direction: "buy",
        confidence: "high",
        entry_zone: { low: 100.5, high: 101 },
        stop_loss: 98.25,
        take_profit_1: 106,
        take_profit_2: 112,
        risk_reward: 1.1429,
        invalidation: ["A close below the stop loss."],
        disclaimer: "Research only, not financial advice.",
      },
    };
  };

  const result = await executeTool(
    "get_trade_signal",
    JSON.stringify({ asset_type: "crypto", symbol: "BTC/USDT", timeframe: "1h" }),
    async () => {
      throw new Error("signal uses POST");
    },
    postImpl,
  );

  assert.equal(posts[0].pathname, "/signal");
  assert.equal(result.stop_loss, 98.25);
  assert.equal(result.take_profit_1, 106);
  assert.equal(result.entry_zone.low, 100.5);
  assert.match(result.instruction, /Do not change/);
});

test("a no_trade signal tells the model not to invent prices", async () => {
  const result = await executeTool(
    "get_trade_signal",
    JSON.stringify({ asset_type: "forex", symbol: "EURUSD", timeframe: "4h" }),
    async () => {
      throw new Error("signal uses POST");
    },
    async () => ({
      status: 200,
      body: {
        direction: "no_trade",
        entry_zone: null,
        stop_loss: null,
        take_profit_1: null,
        take_profit_2: null,
        confidence: "low",
      },
    }),
  );

  assert.equal(result.direction, "no_trade");
  assert.equal(result.stop_loss, null);
  assert.match(result.instruction, /Do not invent/);
});
