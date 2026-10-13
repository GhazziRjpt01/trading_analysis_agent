import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpError } from "../errors.js";
import { bearerToken, requireUser } from "./supabaseAdmin.js";
import { buildAnalysisInsert, buildWatchlistInsert, prepareAnalysis } from "./library.js";

test("bearer token is the credential after Bearer", () => {
  assert.equal(bearerToken("Bearer abc.def"), "abc.def");
  assert.equal(bearerToken("bearer abc"), "abc");
  assert.equal(bearerToken("Token abc"), "");
  assert.equal(bearerToken(""), "");
});

test("missing token is rejected before any database call", async () => {
  await assert.rejects(
    () => requireUser({ get: () => "" }, async () => {
      throw new Error("should not verify");
    }),
    (err) => err instanceof HttpError && err.status === 401,
  );
});

test("inserts use the verified user id, not a body user id", () => {
  const watch = buildWatchlistInsert("user-a", { assetType: "crypto", symbol: "BTC/USDT" });
  assert.equal(watch.user_id, "user-a");
  assert.equal(watch.user_id === "user-b", false);

  const analysis = buildAnalysisInsert("user-a", {
    assetType: "metals",
    symbol: "XAUUSD",
    timeframe: "1h",
    note: null,
    snapshot: { latest_bar: { close: 1 } },
  });
  assert.equal(analysis.user_id, "user-a");
  assert.equal(analysis.disclaimer, "Research only, not financial advice.");
  assert.equal(Object.hasOwn(analysis, "requested_user_id"), false);
});

test("saved analysis stores tool numbers and the verified user", async () => {
  const prepared = await prepareAnalysis(
    "user-a",
    { asset_type: "forex", symbol: "EURUSD", timeframe: "1h", user_id: "user-b", note: "  session  " },
    async (pathname) => {
      if (pathname === "/prices") {
        return {
          status: 200,
          body: {
            symbol: "EURUSD",
            bars: [{ timestamp: "2026-10-12T10:00:00Z", open: 1, high: 2, low: 0.5, close: 1.1, volume: null }],
          },
        };
      }
      return {
        status: 200,
        body: {
          symbol: "EURUSD",
          latest: { rsi_14: 48.2 },
          points: [{ rsi_14: 48.2 }],
          note: "Volume-based indicators are omitted.",
        },
      };
    },
  );

  assert.equal(prepared.row.user_id, "user-a");
  assert.equal(prepared.row.note, "session");
  assert.equal(prepared.row.snapshot.latest_bar.close, 1.1);
  assert.equal(prepared.row.snapshot.latest_bar.volume, null);
  assert.equal(prepared.row.snapshot.indicators.rsi_14, 48.2);
});

test("a rejected symbol is not saved", async () => {
  const prepared = await prepareAnalysis(
    "user-a",
    { asset_type: "crypto", symbol: "NOPE", timeframe: "1h" },
    async () => ({ status: 400, body: { detail: "Unknown symbol." } }),
  );
  assert.equal(prepared.errorStatus, 400);
  assert.equal(prepared.row, undefined);
});
