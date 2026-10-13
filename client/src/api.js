import { PAIRS } from "./constants.js";

// Vite only exposes variables prefixed with VITE_. The fallback is the local Express port.
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

// 300 bars covers EMA 50 and MACD warmup without a 500-point payload.
const LIMIT = 300;

export async function fetchMarket({ assetType, symbol, timeframe, signal }) {
  const params = new URLSearchParams({
    asset_type: assetType,
    symbol,
    timeframe,
    limit: String(LIMIT),
  });

  const [prices, indicators] = await Promise.all([
    getJson(`/api/prices?${params}`, signal),
    getJson(`/api/indicators?${params}`, signal),
  ]);

  return { prices, indicators };
}

export function fetchBacktest({ assetType, symbol, timeframe, signal }) {
  const params = new URLSearchParams({
    asset_type: assetType,
    symbol,
    timeframe,
    limit: String(LIMIT),
  });
  return getJson(`/api/backtest?${params}`, signal);
}

export function fetchPaperRuns(signal) {
  return getJson("/api/paper-runs", signal);
}

export function fetchPaperRun(id, signal) {
  return getJson(`/api/paper-runs/${encodeURIComponent(id)}`, signal);
}

export function savePaperRun({ assetType, symbol, timeframe }) {
  const params = new URLSearchParams({
    asset_type: assetType,
    symbol,
    timeframe,
    limit: String(LIMIT),
  });
  return sendJson("POST", `/api/paper-runs?${params}`);
}

export function deletePaperRun(id) {
  return sendJson("DELETE", `/api/paper-runs/${encodeURIComponent(id)}`);
}

export function runStrategyBacktest(body) {
  return sendJson("POST", "/api/backtest", undefined, { body });
}

export function fetchSignal({ assetType, symbol, timeframe, signal }) {
  return sendJson("POST", "/api/signal", signal, {
    body: { asset_type: assetType, symbol, timeframe },
  });
}

export function calculatePositionSize(body) {
  return sendJson("POST", "/api/position-size", undefined, { body });
}

export function fetchPaperTrades(accessToken, signal) {
  return sendJson("GET", "/api/paper-trades", signal, { headers: authHeader(accessToken) });
}

export function savePaperTrade({ accessToken, assetType, symbol, timeframe }) {
  return sendJson("POST", "/api/paper-trades", undefined, {
    headers: authHeader(accessToken),
    body: { asset_type: assetType, symbol, timeframe },
  });
}

export function updatePaperTrade({ accessToken, id, status }) {
  return sendJson("PATCH", `/api/paper-trades/${encodeURIComponent(id)}`, undefined, {
    headers: authHeader(accessToken),
    body: { status },
  });
}

export function deletePaperTrade(accessToken, id) {
  return sendJson("DELETE", `/api/paper-trades/${encodeURIComponent(id)}`, undefined, {
    headers: authHeader(accessToken),
  });
}

export function fetchWatchlist(accessToken, signal) {
  return sendJson("GET", "/api/watchlist", signal, { headers: authHeader(accessToken) });
}

export function addWatchlist({ accessToken, assetType, symbol }) {
  return sendJson("POST", "/api/watchlist", undefined, {
    headers: authHeader(accessToken),
    body: { asset_type: assetType, symbol },
  });
}

export function removeWatchlist(accessToken, id) {
  return sendJson("DELETE", `/api/watchlist/${encodeURIComponent(id)}`, undefined, {
    headers: authHeader(accessToken),
  });
}

export function fetchAnalyses(accessToken, signal) {
  return sendJson("GET", "/api/analyses", signal, { headers: authHeader(accessToken) });
}

export function saveAnalysis({ accessToken, assetType, symbol, timeframe, note }) {
  return sendJson("POST", "/api/analyses", undefined, {
    headers: authHeader(accessToken),
    body: { asset_type: assetType, symbol, timeframe, note },
  });
}

export function deleteAnalysis(accessToken, id) {
  return sendJson("DELETE", `/api/analyses/${encodeURIComponent(id)}`, undefined, {
    headers: authHeader(accessToken),
  });
}

export async function streamChat({ assetType, symbol, timeframe, messages, onDelta, onTool, signal }) {
  let response;
  try {
    response = await fetch(`${API_URL}/api/agent/chat`, {
      method: "POST",
      signal,
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        asset_type: assetType,
        symbol,
        timeframe,
        messages,
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw err;
    }
    throw new Error("Cannot reach the API. Start the Express server and check VITE_API_URL.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${response.status}).`);
  }
  if (!response.body) {
    throw new Error("The research assistant returned an empty stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((row) => row.startsWith("data:"));
      if (!line) {
        continue;
      }
      const event = JSON.parse(line.slice(5).trim());
      if (event.type === "delta" && event.text) {
        onDelta(event.text);
      } else if (event.type === "tool") {
        onTool(event);
      } else if (event.type === "error") {
        throw new Error(event.detail || "The research assistant is unavailable.");
      }
    }
  }
}

export function pairsFor(assetType) {
  return PAIRS[assetType] ?? PAIRS.crypto;
}

function authHeader(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

function getJson(path, signal) {
  return sendJson("GET", path, signal);
}

async function sendJson(method, path, signal, options = {}) {
  const headers = { Accept: "application/json", ...options.headers };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw err;
    }
    throw new Error("Cannot reach the API. Start the Express server and check VITE_API_URL.");
  }

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || `Request failed (${response.status}).`);
  }
  return body;
}
