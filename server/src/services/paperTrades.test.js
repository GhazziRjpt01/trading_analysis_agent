import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPaperTradeInsert, parseTradeStatus } from "./paperTrades.js";

const signal = {
  asset_type: "crypto",
  symbol: "BTC/USDT",
  timeframe: "1h",
  direction: "buy",
  confidence: "high",
  entry_zone: { low: 100, high: 101 },
  stop_loss: 97,
  take_profit_1: 105,
  take_profit_2: 110,
  risk_reward: 1.1429,
  votes: [{ name: "EMA 20/50", vote: "buy" }],
  invalidation: ["A close below the stop loss."],
};

test("a paper trade stores the analysis prices and starts open", () => {
  const row = buildPaperTradeInsert("user-1", {
    ...signal,
    stop_loss_from_client: 1,
  });
  assert.equal(row.user_id, "user-1");
  assert.equal(row.stop_loss, 97);
  assert.equal(row.entry_low, 100);
  assert.equal(row.entry_high, 101);
  assert.equal(row.status, "open");
  assert.equal(row.stop_loss_from_client, undefined);
  assert.match(row.disclaimer, /Not financial advice/);
});

test("no_trade cannot be saved", () => {
  assert.throws(
    () => buildPaperTradeInsert("user-1", { ...signal, direction: "no_trade", entry_zone: null, stop_loss: null }),
    /no_trade/,
  );
});

test("status is open, hit_tp, or hit_sl", () => {
  assert.equal(parseTradeStatus("hit_tp"), "hit_tp");
  assert.equal(parseTradeStatus("hit_sl"), "hit_sl");
  assert.throws(() => parseTradeStatus("closed"), /status/);
});
