import { HttpError } from "../errors.js";

export function notFound(_req, res) {
  res.status(404).json({ detail: "Not found." });
}

export function errorHandler(err, _req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const parsedStatus = Number(err.status || err.statusCode);
  const status = err instanceof HttpError
    ? err.status
    : parsedStatus >= 400 && parsedStatus < 500
      ? parsedStatus
      : 500;
  if (status >= 500) {
    // Log the cause here. The response stays generic so internals are not returned.
    console.error(err);
  }

  const detail = status >= 500 && !(err instanceof HttpError)
    ? "Internal server error."
    : err.type === "entity.parse.failed"
      ? "Request body must be JSON."
      : err.message || "Request failed.";

  res.status(status).json({ detail });
}
