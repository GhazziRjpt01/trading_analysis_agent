import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../errors.js";
import {
  ANALYSIS_COLUMNS,
  DISCLAIMER,
  WATCHLIST_COLUMNS,
  buildWatchlistInsert,
  parseAssetType,
  parseRowId,
  parseSymbol,
  prepareAnalysis,
} from "../services/library.js";
import { mapSupabaseError, requireUser, supabaseAdmin } from "../services/supabaseAdmin.js";

export const listWatchlist = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { data, error } = await supabaseAdmin()
    .from("watchlists")
    .select(WATCHLIST_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) {
    throw mapSupabaseError(error);
  }
  res.json({ disclaimer: DISCLAIMER, items: data });
});

export const addWatchlist = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const row = buildWatchlistInsert(user.id, {
    assetType: parseAssetType(req.body?.asset_type),
    symbol: parseSymbol(req.body?.symbol),
  });
  const { data, error } = await supabaseAdmin()
    .from("watchlists")
    .insert(row)
    .select(WATCHLIST_COLUMNS)
    .single();
  if (error) {
    throw mapSupabaseError(error);
  }
  res.status(201).json({ disclaimer: DISCLAIMER, item: data });
});

export const removeWatchlist = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseRowId(req.params.id);
  const { data, error } = await supabaseAdmin()
    .from("watchlists")
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

export const listAnalyses = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const { data, error } = await supabaseAdmin()
    .from("saved_analyses")
    .select(ANALYSIS_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) {
    throw mapSupabaseError(error);
  }
  res.json({ disclaimer: DISCLAIMER, items: data });
});

export const saveAnalysis = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const prepared = await prepareAnalysis(user.id, req.body);
  if (prepared.errorStatus) {
    res.status(prepared.errorStatus).json(prepared.errorBody);
    return;
  }
  const { data, error } = await supabaseAdmin()
    .from("saved_analyses")
    .insert(prepared.row)
    .select(ANALYSIS_COLUMNS)
    .single();
  if (error) {
    throw mapSupabaseError(error);
  }
  res.status(201).json({ disclaimer: DISCLAIMER, item: data });
});

export const removeAnalysis = asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const id = parseRowId(req.params.id);
  const { data, error } = await supabaseAdmin()
    .from("saved_analyses")
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
