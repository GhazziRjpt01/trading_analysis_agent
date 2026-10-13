import { Router } from "express";
import {
  deletePaperRun,
  getPaperRun,
  listPaperRuns,
  savePaperRun,
} from "../controllers/paper.controller.js";

const router = Router();

router.get("/", listPaperRuns);
router.post("/", savePaperRun);
router.get("/:id", getPaperRun);
router.delete("/:id", deletePaperRun);

export default router;
