import { Router } from "express";
import agentRoutes from "./agent.routes.js";
import healthRoutes from "./health.routes.js";
import libraryRoutes from "./library.routes.js";
import marketRoutes from "./market.routes.js";
import paperRoutes from "./paper.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/agent", agentRoutes);
router.use("/", libraryRoutes);
router.use("/paper-runs", paperRoutes);
router.use("/", marketRoutes);

export default router;
