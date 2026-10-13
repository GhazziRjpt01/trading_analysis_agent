import { asyncHandler } from "../middleware/asyncHandler.js";
import { HttpError } from "../errors.js";
import { parseChatRequest, requireOpenAI, streamAgentChat } from "../services/agentChat.js";

export const postAgentChat = asyncHandler(async (req, res) => {
  const input = parseChatRequest(req.body);
  requireOpenAI();

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      abort.abort();
    }
  });

  const write = (event) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    await streamAgentChat({ ...input, write, signal: abort.signal });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error(`agent chat failed: ${err.status || err.name || "error"}`);
      write({ type: "error", detail: chatErrorDetail(err) });
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

function chatErrorDetail(err) {
  if (err instanceof HttpError) {
    return err.message;
  }
  if (err.status === 401) {
    return "OPENAI_API_KEY was rejected.";
  }
  return "The research assistant is unavailable.";
}
