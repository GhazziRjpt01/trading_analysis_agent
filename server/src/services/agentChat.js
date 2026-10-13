import OpenAI from "openai";
import { config, openaiConfigured } from "../config.js";
import { HttpError } from "../errors.js";
import { ASSET_TYPES } from "./analysis.service.js";
import { systemPrompt } from "./agentPrompt.js";
import { TIMEFRAMES, TOOLS, executeTool } from "./agentTools.js";

const MAX_MESSAGES = 20;
const MAX_CONTENT = 4_000;
// Price, indicators, and the signal tool, then the answer.
const MAX_TOOL_ROUNDS = 4;

export function requireOpenAI() {
  if (!openaiConfigured()) {
    throw new HttpError(503, "OPENAI_API_KEY is not configured.");
  }
}

export function parseChatRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const assetType = typeof body.asset_type === "string" ? body.asset_type.trim().toLowerCase() : "";
  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  const timeframe = typeof body.timeframe === "string" ? body.timeframe.trim() : "";
  if (!ASSET_TYPES.has(assetType)) {
    throw new HttpError(400, "asset_type must be crypto, forex, or metals.");
  }
  if (!symbol || symbol.length > 32) {
    throw new HttpError(400, "symbol is required.");
  }
  if (!TIMEFRAMES.has(timeframe)) {
    throw new HttpError(400, "timeframe must be 1m, 5m, 15m, 30m, 1h, 4h, or 1d.");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new HttpError(400, "messages must include at least one user message.");
  }
  if (body.messages.length > MAX_MESSAGES) {
    throw new HttpError(400, "messages is limited to 20.");
  }

  const messages = body.messages.map(parseMessage);
  if (messages.at(-1).role !== "user") {
    throw new HttpError(400, "The last message must be from the user.");
  }
  return { assetType, symbol, timeframe, messages };
}

/**
 * Stream an assistant reply. Tool rounds call the analysis service, then
 * the following round streams the text that cites those numbers.
 */
export async function streamAgentChat({
  assetType,
  symbol,
  timeframe,
  messages,
  write,
  signal,
  client,
  fetchImpl,
  postImpl,
}) {
  const openai = client ?? createClient();
  const conversation = [
    { role: "system", content: systemPrompt({ assetType, symbol, timeframe }) },
    ...messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const stream = await openai.chat.completions.create(
      {
        model: config.openaiModel,
        temperature: 0.2,
        max_tokens: 800,
        messages: conversation,
        tools: TOOLS,
        stream: true,
      },
      { signal },
    );

    const turn = await readTurn(stream, write);
    if (turn.toolCalls.length === 0) {
      write({ type: "done" });
      return;
    }

    conversation.push({
      role: "assistant",
      content: turn.content || null,
      tool_calls: turn.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of turn.toolCalls) {
      write({ type: "tool", name: call.name, status: "running" });
      const result = await executeTool(call.name, call.arguments, fetchImpl, postImpl);
      write({ type: "tool", name: call.name, status: "done" });
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  write({ type: "error", detail: "The assistant stopped after too many tool calls." });
}

function createClient() {
  requireOpenAI();
  return new OpenAI({ apiKey: config.openaiApiKey });
}

async function readTurn(stream, write) {
  let content = "";
  const toolCalls = new Map();

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }
    if (delta.content) {
      content += delta.content;
      write({ type: "delta", text: delta.content });
    }
    if (delta.tool_calls) {
      for (const call of delta.tool_calls) {
        const current = toolCalls.get(call.index) ?? { id: "", name: "", arguments: "" };
        if (call.id) {
          current.id = call.id;
        }
        if (call.function?.name) {
          current.name += call.function.name;
        }
        if (call.function?.arguments) {
          current.arguments += call.function.arguments;
        }
        toolCalls.set(call.index, current);
      }
    }
  }

  return { content, toolCalls: [...toolCalls.values()].filter((call) => call.id && call.name) };
}

function parseMessage(message, index) {
  const role = message?.role;
  const content = message?.content;
  if (role !== "user" && role !== "assistant") {
    throw new HttpError(400, "messages may only use the user and assistant roles.");
  }
  if (typeof content !== "string" || !content.trim()) {
    throw new HttpError(400, `messages[${index}] needs text content.`);
  }
  if (content.length > MAX_CONTENT) {
    throw new HttpError(400, `messages[${index}] is too long.`);
  }
  return { role, content: content.trim() };
}
