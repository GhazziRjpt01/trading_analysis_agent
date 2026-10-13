import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import app from "../app.js";

const DISCLAIMER = "Research only, not financial advice.";

let server;

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function request(method, path, { body, raw } = {}) {
  const { port } = server.address();
  const payload = raw ?? (body === undefined ? null : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = text;
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          } else {
            parsed = {};
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function stubFetch(t, impl) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  t.after(() => {
    globalThis.fetch = original;
  });
}

function jsonResult(status, body) {
  return {
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("GET /api/health reports the API process", async () => {
  const response = await request("GET", "/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok", service: "server" });
});

test("GET /api/prices rejects an unknown asset class before calling analysis", async (t) => {
  stubFetch(t, async () => {
    throw new Error("analysis should not be called");
  });
  const response = await request("GET", "/api/prices?asset_type=stock&symbol=AAPL");
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /asset_type/);
});

test("GET /api/prices forwards the candle query and the analysis body", async (t) => {
  stubFetch(t, async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/prices");
    assert.equal(options.method, "GET");
    assert.equal(parsed.searchParams.get("asset_type"), "crypto");
    assert.equal(parsed.searchParams.get("symbol"), "BTC/USDT");
    assert.equal(parsed.searchParams.get("timeframe"), "1h");
    assert.equal(parsed.searchParams.get("limit"), "100");
    assert.equal(parsed.searchParams.get("extra"), null);
    return jsonResult(200, { symbol: "BTC/USDT", disclaimer: DISCLAIMER, count: 1 });
  });

  const response = await request(
    "GET",
    "/api/prices?asset_type=CRYPTO&symbol=BTC%2FUSDT&timeframe=1h&limit=100&extra=ignore",
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.symbol, "BTC/USDT");
  assert.equal(response.body.disclaimer, DISCLAIMER);
});

test("GET /api/indicators returns the analysis payload", async (t) => {
  stubFetch(t, async (url) => {
    assert.equal(new URL(url).pathname, "/indicators");
    return jsonResult(200, { disclaimer: DISCLAIMER, latest: { rsi_14: 50 } });
  });
  const response = await request("GET", "/api/indicators?asset_type=forex&symbol=EURUSD&timeframe=4h");
  assert.equal(response.status, 200);
  assert.equal(response.body.latest.rsi_14, 50);
});

test("GET /api/backtest keeps an analysis 400", async (t) => {
  stubFetch(t, async (url) => {
    assert.equal(new URL(url).pathname, "/backtest");
    return jsonResult(400, { detail: "Unknown symbol." });
  });
  const response = await request("GET", "/api/backtest?asset_type=metals&symbol=NOPE&timeframe=1d");
  assert.equal(response.status, 400);
  assert.equal(response.body.detail, "Unknown symbol.");
});

test("POST /api/backtest forwards the strategy body", async (t) => {
  stubFetch(t, async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/backtest");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    const sent = JSON.parse(options.body);
    assert.equal(sent.asset_type, "crypto");
    assert.equal(sent.strategy, "rsi_mean_reversion");
    assert.equal(sent.period, 120);
    return jsonResult(200, {
      disclaimer: DISCLAIMER,
      trade_count: 2,
      total_return_pct: 1.5,
      performance_note: "Past performance does not predict future results.",
    });
  });

  const response = await request("POST", "/api/backtest", {
    body: {
      asset_type: "Crypto",
      symbol: "ETH/USDT",
      timeframe: "1h",
      period: 120,
      strategy: "rsi_mean_reversion",
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.trade_count, 2);
  assert.match(response.body.performance_note, /Past performance/);
});

test("POST /api/signal forwards the market and keeps the analysis levels", async (t) => {
  stubFetch(t, async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/signal");
    assert.equal(options.method, "POST");
    const sent = JSON.parse(options.body);
    assert.equal(sent.asset_type, "metals");
    assert.equal(sent.symbol, "XAUUSD");
    return jsonResult(200, {
      direction: "sell",
      stop_loss: 2408.5,
      take_profit_1: 2380,
      entry_zone: { low: 2400, high: 2402 },
      disclaimer: DISCLAIMER,
    });
  });
  const response = await request("POST", "/api/signal", {
    body: { asset_type: "Metals", symbol: "XAUUSD", timeframe: "1h" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.stop_loss, 2408.5);
  assert.equal(response.body.direction, "sell");
});

test("POST /api/position-size forwards the sizing inputs", async (t) => {
  stubFetch(t, async (url, options) => {
    assert.equal(new URL(url).pathname, "/position-size");
    const sent = JSON.parse(options.body);
    assert.equal(sent.asset_type, "forex");
    assert.equal(sent.risk_percent, 1);
    return jsonResult(200, { position_size: 0.1, unit: "lots", disclaimer: DISCLAIMER });
  });
  const response = await request("POST", "/api/position-size", {
    body: { asset_type: "forex", account_balance: 10000, risk_percent: 1, entry: 1.1, stop_loss: 1.09 },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.unit, "lots");
  assert.equal(response.body.position_size, 0.1);
});

test("POST /api/backtest rejects a missing asset class", async (t) => {
  stubFetch(t, async () => {
    throw new Error("analysis should not be called");
  });
  const response = await request("POST", "/api/backtest", { body: { symbol: "EURUSD" } });
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /asset_type/);
});

test("a down analysis service is a 502", async (t) => {
  stubFetch(t, async () => {
    throw new TypeError("fetch failed");
  });
  const response = await request("GET", "/api/prices?asset_type=crypto&symbol=BTC/USDT");
  assert.equal(response.status, 502);
  assert.equal(response.body.detail, "Analysis service is unavailable.");
});

test("a non-JSON analysis response is a 502", async (t) => {
  stubFetch(t, async () => ({
    status: 200,
    async text() {
      return "<html>down</html>";
    },
  }));
  const response = await request("POST", "/api/backtest", {
    body: { asset_type: "forex", symbol: "EURUSD", timeframe: "1h", period: 80, strategy: "ema_crossover" },
  });
  assert.equal(response.status, 502);
  assert.match(response.body.detail, /non-JSON/);
});

test("an unknown API path is 404", async () => {
  const response = await request("GET", "/api/orders");
  assert.equal(response.status, 404);
  assert.equal(response.body.detail, "Not found.");
});

test("a broken JSON body is 400", async () => {
  const response = await request("POST", "/api/backtest", { raw: "{" });
  assert.equal(response.status, 400);
  assert.equal(response.body.detail, "Request body must be JSON.");
});

test("GET /api/paper-runs returns the disclaimer and a list", async () => {
  const response = await request("GET", "/api/paper-runs");
  assert.equal(response.status, 200);
  assert.equal(response.body.disclaimer, DISCLAIMER);
  assert.ok(Array.isArray(response.body.runs));
});

test("GET /api/watchlist without a token is 401", async () => {
  const response = await request("GET", "/api/watchlist");
  assert.equal(response.status, 401);
});

test("POST /api/agent/chat rejects an empty message list", async () => {
  const response = await request("POST", "/api/agent/chat", {
    body: { asset_type: "crypto", symbol: "BTC/USDT", timeframe: "1h", messages: [] },
  });
  assert.equal(response.status, 400);
  assert.match(response.body.detail, /messages/);
});
