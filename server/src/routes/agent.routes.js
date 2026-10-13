import { Router } from "express";
import { postAgentChat } from "../controllers/agent.controller.js";

const router = Router();

router.post("/chat", postAgentChat);

export default router;
