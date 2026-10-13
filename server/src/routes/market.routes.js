import { Router } from "express";
import {
  getBacktest,
  getIndicators,
  getPrices,
  postBacktest,
  postPositionSize,
  postSignal,
} from "../controllers/market.controller.js";

const router = Router();

router.get("/prices", getPrices);
router.get("/indicators", getIndicators);
router.get("/backtest", getBacktest);
router.post("/backtest", postBacktest);
router.post("/signal", postSignal);
router.post("/position-size", postPositionSize);

export default router;
