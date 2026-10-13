import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../errors.js";
import { postAnalysis } from "../services/analysis.service.js";
import { parseAssetType, parseRowId, parseSymbol, parseTimeframe } from "../services/library.js";
import {
  DISCLAIMER,
  PAPER_TRADE_COLUMNS,
  RESEARCH_DISCLAIMER,
  buildPaperTradeInsert,
  parseTradeStatus,
} from "../services/paperTrades.js";
import { mapSupabaseError, requireUser, supabaseAdmin } from "../services/supabaseAdmin.js";

export const listPaperTrades = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { data, error } = await supabaseAdmin()
    .from("paper_trades")
    .select(PAPER_TRADE_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    throw mapSupabaseError(error);
  }
  res.json({ disclaimer: DISCLAIMER, research_disclaimer: RESEARCH_DISCLAIMER, items: data });
});

export const savePaperTrade = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const result = await postAnalysis("/signal", {
    asset_type: parseAssetType(req.body?.asset_type),
    symbol: parseSymbol(req.body?.symbol),
    timeframe: parseTimeframe(req.body?.timeframe),
  });
  if (result.status !== 200) {
    res.status(result.status).json(result.body);
    return;
  }
  const row = buildPaperTradeInsert(user.id, result.body);
  const { data, error } = await supabaseAdmin()
    .from("paper_trades")
    .insert(row)
    .select(PAPER_TRADE_COLUMNS)
    .single();
  if (error) {
    throw mapSupabaseError(error);
  }
  res.status(201).json({ disclaimer: DISCLAIMER, research_disclaimer: RESEARCH_DISCLAIMER, item: data });
});

export const updatePaperTrade = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseRowId(req.params.id);
  const status = parseTradeStatus(req.body?.status);
  const { data, error } = await supabaseAdmin()
    .from("paper_trades")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id)
    .select(PAPER_TRADE_COLUMNS);
  if (error) {
    throw mapSupabaseError(error);
  }
  if (!data?.length) {
    throw new HttpError(404, "Not found.");
  }
  res.json({ disclaimer: DISCLAIMER, research_disclaimer: RESEARCH_DISCLAIMER, item: data[0] });
});

export const removePaperTrade = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseRowId(req.params.id);
  const { data, error } = await supabaseAdmin()
    .from("paper_trades")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    throw mapSupabaseError(error);
  }
  if (!data?.length) {
    throw new HttpError(404, "Not found.");
  }
  res.status(204).end();
});
