import { Router } from "express";
import {
  addWatchlist,
  listAnalyses,
  listWatchlist,
  removeAnalysis,
  removeWatchlist,
  saveAnalysis,
} from "../controllers/library.controller.js";
import {
  listPaperTrades,
  removePaperTrade,
  savePaperTrade,
  updatePaperTrade,
} from "../controllers/paperTrades.controller.js";

const router = Router();

router.get("/watchlist", listWatchlist);
router.post("/watchlist", addWatchlist);
router.delete("/watchlist/:id", removeWatchlist);
router.get("/analyses", listAnalyses);
router.post("/analyses", saveAnalysis);
router.delete("/analyses/:id", removeAnalysis);
router.get("/paper-trades", listPaperTrades);
router.post("/paper-trades", savePaperTrade);
router.patch("/paper-trades/:id", updatePaperTrade);
router.delete("/paper-trades/:id", removePaperTrade);

export default router;
