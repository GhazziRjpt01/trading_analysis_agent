import { useEffect, useState } from "react";
import { addWatchlist, deleteAnalysis, fetchAnalyses, fetchWatchlist, removeWatchlist, saveAnalysis } from "../api.js";
import { DISCLAIMER } from "../constants.js";

export default function LibraryPanel({ accessToken, assetType, symbol, timeframe, onPick }) {
  const [watchlist, setWatchlist] = useState([]);
  const [analyses, setAnalyses] = useState([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accessToken) {
      setWatchlist([]);
      setAnalyses([]);
      setError("");
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([fetchWatchlist(accessToken, controller.signal), fetchAnalyses(accessToken, controller.signal)])
      .then(([watch, saved]) => {
        setWatchlist(watch.items ?? []);
        setAnalyses(saved.items ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }
        setError(err.message || "Could not load saved research.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [accessToken]);

  async function addCurrent() {
    await run("watch", async () => {
      await addWatchlist({ accessToken, assetType, symbol });
      const watch = await fetchWatchlist(accessToken);
      setWatchlist(watch.items ?? []);
    });
  }

  async function saveCurrent() {
    await run("analysis", async () => {
      await saveAnalysis({ accessToken, assetType, symbol, timeframe, note });
      setNote("");
      const saved = await fetchAnalyses(accessToken);
      setAnalyses(saved.items ?? []);
    });
  }

  async function removeItem(kind, id) {
    await run(id, async () => {
      if (kind === "watch") {
        await removeWatchlist(accessToken, id);
        setWatchlist((items) => items.filter((item) => item.id !== id));
      } else {
        await deleteAnalysis(accessToken, id);
        setAnalyses((items) => items.filter((item) => item.id !== id));
      }
    });
  }

  async function run(key, action) {
    setBusy(key);
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err.message || "Could not update saved research.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="library" aria-label="Saved research">
      <div className="library-intro">
        <h2>Saved research</h2>
        <p className="disclaimer-inline">{DISCLAIMER}</p>
      </div>

      {!accessToken && <p className="library-empty">Sign in to save a watchlist and analyses.</p>}
      {loading && <p className="library-empty">Loading saved research…</p>}
      {error && (
        <p className="account-message" role="alert">
          {error}
        </p>
      )}

      {accessToken && !loading && (
        <>
          <article className="library-card">
            <h3>Watchlist</h3>
            <button type="button" onClick={addCurrent} disabled={busy === "watch"}>
              {busy === "watch" ? "Adding…" : `Add ${symbol}`}
            </button>
            {watchlist.length === 0 ? (
              <p className="library-empty">No symbols saved yet.</p>
            ) : (
              <ul className="library-list">
                {watchlist.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="ghost" onClick={() => onPick(item)}>
                      {item.symbol}
                      <span>{item.asset_type}</span>
                    </button>
                    <button type="button" className="ghost" onClick={() => removeItem("watch", item.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="library-card">
            <h3>Analyses</h3>
            <div className="library-save">
              <input
                value={note}
                maxLength={500}
                placeholder="Optional note"
                aria-label="Analysis note"
                onChange={(event) => setNote(event.target.value)}
              />
              <button type="button" onClick={saveCurrent} disabled={busy === "analysis"}>
                {busy === "analysis" ? "Saving…" : "Save analysis"}
              </button>
            </div>
            {analyses.length === 0 ? (
              <p className="library-empty">No saved analyses yet.</p>
            ) : (
              <ul className="library-list">
                {analyses.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>
                        {item.symbol} · {item.timeframe}
                      </strong>
                      <span>
                        Close {formatClose(item.snapshot?.latest_bar?.close)} · RSI{" "}
                        {formatRsi(item.snapshot?.indicators?.rsi_14)}
                      </span>
                      {item.note && <span>{item.note}</span>}
                    </div>
                    <button type="button" className="ghost" onClick={() => removeItem("analysis", item.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </>
      )}
    </section>
  );
}

function formatClose(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 5 });
}

function formatRsi(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}
