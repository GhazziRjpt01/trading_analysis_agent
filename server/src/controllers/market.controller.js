import { asyncHandler } from "../middleware/asyncHandler.js";
import { fetchAnalysis, postAnalysis } from "../services/analysis.service.js";

function proxy(pathname) {
  return asyncHandler(async (req, res) => {
    const result = await fetchAnalysis(pathname, req.query);
    // Keep the Python status and body, including its disclaimer and 400s.
    res.status(result.status).json(result.body);
  });
}

export const getPrices = proxy("/prices");
export const getIndicators = proxy("/indicators");
export const getBacktest = proxy("/backtest");

export const postBacktest = asyncHandler(async (req, res) => {
  const result = await postAnalysis("/backtest", req.body);
  res.status(result.status).json(result.body);
});

export const postSignal = asyncHandler(async (req, res) => {
  const result = await postAnalysis("/signal", req.body);
  res.status(result.status).json(result.body);
});

export const postPositionSize = asyncHandler(async (req, res) => {
  const result = await postAnalysis("/position-size", req.body);
  res.status(result.status).json(result.body);
});
