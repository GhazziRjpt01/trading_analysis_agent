import { config } from "../config.js";
import { HttpError } from "../errors.js";

// Python checks symbol, timeframe, and limit. Express checks the asset class
// so a new class is rejected here before it is forwarded.
export const ASSET_TYPES = new Set(["crypto", "forex", "metals"]);
const FORWARDED_PARAMS = ["asset_type", "symbol", "timeframe", "limit"];

// The first Yahoo fetch can take around 10 seconds. Leave room past that.
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * GET a path on the analysis service and return its status and JSON body.
 * This process only proxies reads. It does not place orders.
 */
export async function fetchAnalysis(pathname, query) {
  const assetType = firstString(query?.asset_type).toLowerCase();
  if (assetType && !ASSET_TYPES.has(assetType)) {
    throw new HttpError(400, "asset_type must be crypto, forex, or metals.");
  }
  const url = buildUrl(pathname, query);

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    console.error(`analysis ${pathname} failed: ${err.name}`);
    throw new HttpError(
      502,
      timedOut ? "Analysis service timed out." : "Analysis service is unavailable.",
    );
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(502, "Analysis service returned a non-JSON response.");
  }

  return { status: response.status, body };
}

/**
 * POST a JSON body to the analysis service. Used for paper backtests.
 * This process does not place orders.
 */
export async function postAnalysis(pathname, body) {
  const assetType = firstString(body?.asset_type).toLowerCase();
  if (!ASSET_TYPES.has(assetType)) {
    throw new HttpError(400, "asset_type must be crypto, forex, or metals.");
  }
  const url = new URL(config.analysisUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, asset_type: assetType }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err.name === "TimeoutError" || err.name === "AbortError";
    console.error(`analysis ${pathname} failed: ${err.name}`);
    throw new HttpError(
      502,
      timedOut ? "Analysis service timed out." : "Analysis service is unavailable.",
    );
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(502, "Analysis service returned a non-JSON response.");
  }
  return { status: response.status, body: parsed };
}

function buildUrl(pathname, query) {
  const url = new URL(config.analysisUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";

  for (const key of FORWARDED_PARAMS) {
    const value = firstString(query?.[key]);
    if (!value) {
      continue;
    }
    url.searchParams.set(key, key === "asset_type" ? value.toLowerCase() : value);
  }

  return url;
}

function firstString(value) {
  const picked = Array.isArray(value) ? value[0] : value;
  if (typeof picked !== "string") {
    return "";
  }
  return picked.trim();
}
