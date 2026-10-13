import cors from "cors";
import express from "express";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import apiRoutes from "./routes/index.js";

const app = express();

app.disable("x-powered-by");

// The Vite dashboard. Reads, paper-run saves, and the research chat.
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  }),
);

app.use(express.json());
app.use("/api", apiLimiter);
app.use("/api", apiRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
