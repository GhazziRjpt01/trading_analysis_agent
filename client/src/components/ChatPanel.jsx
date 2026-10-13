import { useEffect, useRef, useState } from "react";
import { streamChat } from "../api.js";
import { DISCLAIMER } from "../constants.js";

const CONTEXT = {
  crypto: "Crypto trades 24/7 with high volatility.",
  forex: "Forex has sessions and spreads.",
  metals:
    "Metals trade near 24/5, react to USD and interest rate news, and silver is more volatile than gold.",
};

export default function ChatPanel({ assetType, symbol, timeframe }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [toolNote, setToolNote] = useState("");
  const [error, setError] = useState("");
  const logRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const node = logRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, toolNote, error]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || streaming) {
      return;
    }

    const history = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setError("");
    setToolNote("");
    setStreaming(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat({
        assetType,
        symbol,
        timeframe,
        messages: history,
        signal: controller.signal,
        onDelta(chunk) {
          if (controller.signal.aborted) {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            if (!last || last.role !== "assistant") {
              return current;
            }
            next[next.length - 1] = { ...last, content: last.content + chunk };
            return next;
          });
        },
        onTool(event) {
          setToolNote(toolLabel(event.name, event.status));
        },
      });
    } catch (err) {
      if (err.name === "AbortError") {
        return;
      }
      setMessages((current) => {
        const last = current.at(-1);
        if (last?.role === "assistant" && !last.content) {
          return current.slice(0, -1);
        }
        return current;
      });
      setError(err.message || "The research assistant is unavailable.");
    } finally {
      if (abortRef.current === controller) {
        setStreaming(false);
        setToolNote("");
      }
    }
  }

  return (
    <section className="chat" aria-label="Research chat">
      <div className="chat-head">
        <h2>Research chat</h2>
        <p>
          {symbol} · {timeframe}
        </p>
        <p>{CONTEXT[assetType]}</p>
        <p className="disclaimer-inline">{DISCLAIMER}</p>
      </div>

      <div className="chat-log" ref={logRef} role="log" aria-live="polite">
        {messages.length === 0 && (
          <p className="chat-empty">
            Ask about this chart. The answer uses indicator numbers from the analysis service.
          </p>
        )}
        {messages.map((message, index) => (
          <p key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
            {message.content || (streaming && index === messages.length - 1 ? "…" : "")}
          </p>
        ))}
      </div>

      {toolNote && <p className="chat-tool">{toolNote}</p>}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}

      <form className="chat-form" onSubmit={send}>
        <label className="visually-hidden" htmlFor="chat-draft">
          Message
        </label>
        <textarea
          id="chat-draft"
          rows={2}
          value={draft}
          placeholder={`Ask about ${symbol}`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={streaming || !draft.trim()}>
          {streaming ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}

function toolLabel(name, status) {
  const label =
    name === "get_price_data" ? "candles" : name === "compute_indicators" ? "indicators" : "market data";
  return status === "running" ? `Reading ${label}…` : `Read ${label}.`;
}
