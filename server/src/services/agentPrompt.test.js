import assert from "node:assert/strict";
import { test } from "node:test";
import { systemPrompt } from "./agentPrompt.js";

test("system prompt keeps the research rules and asset context", () => {
  const prompt = systemPrompt({ assetType: "metals", symbol: "XAUUSD", timeframe: "1h" });

  assert.match(prompt, /Only use numbers returned by the tools/);
  assert.match(prompt, /Do not invent or change the direction, entry zone, stop loss, take-profit prices/);
  assert.match(prompt, /If get_trade_signal returns direction no_trade, say there is no trade/);
  assert.match(prompt, /Cite the indicator values you use/);
  assert.match(prompt, /Never guarantee outcomes/);
  assert.match(prompt, /Research only, not financial advice/);
  assert.match(prompt, /Crypto trades 24\/7 with high volatility/);
  assert.match(prompt, /Forex has sessions and spreads/);
  assert.match(prompt, /Metals trade near 24\/5, react to USD and interest rate news, and silver is more volatile than gold/);
  assert.match(prompt, /XAUUSD \(metals\) on the 1h chart/);
});
