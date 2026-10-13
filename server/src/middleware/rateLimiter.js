import rateLimit from "express-rate-limit";

// One local dashboard polls prices and indicators. 60/minute is enough for that
// and stops a tight loop from hammering the public market-data providers.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { detail: "Too many requests. Try again in a minute." },
});
