import { useEffect, useState } from "react";
import {
  deletePaperRun,
  deletePaperTrade,
  fetchBacktest,
  fetchMarket,
  fetchPaperRuns,
  fetchPaperTrades,
  fetchSignal,
  pairsFor,
  savePaperRun,
  savePaperTrade,
  updatePaperTrade,
} from "./api.js";
import { DISCLAIMER, RISK_DISCLAIMER } from "./constants.js";
import AccountBar from "./components/AccountBar.jsx";
import BacktestPage from "./components/BacktestPage.jsx";
import BacktestPanel from "./components/BacktestPanel.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import Controls from "./components/Controls.jsx";
import LedgerPanel from "./components/LedgerPanel.jsx";
import LibraryPanel from "./components/LibraryPanel.jsx";
import MarketChart from "./components/MarketChart.jsx";
import PaperTradeLog from "./components/PaperTradeLog.jsx";
import SignalCard from "./components/SignalCard.jsx";
import { supabase } from "./supabase.js";
import "./styles.css";

export default function App() {
  const [assetType, setAssetType] = useState("crypto");
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [backtest, setBacktest] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(true);
  const [backtestError, setBacktestError] = useState("");
  const [requestId, setRequestId] = useState(0);
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [session, setSession] = useState(null);
  const [page, setPage] = useState("chart");
  const [signal, setSignal] = useState(null);
  const [signalLoading, setSignalLoading] = useState(true);
  const [signalError, setSignalError] = useState("");
  const [tradeLog, setTradeLog] = useState([]);
  const [tradeLogLoading, setTradeLogLoading] = useState(false);
  const [tradeLogError, setTradeLogError] = useState("");
  const [tradeLogVersion, setTradeLogVersion] = useState(0);
  const [savingTrade, setSavingTrade] = useState(false);
  const [tradeSaveError, setTradeSaveError] = useState("");

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }
    let ignore = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!ignore) {
        setSession(data.session);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      ignore = true;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    setBacktest(null);
    setBacktestError("");
    setBacktestLoading(true);
    setSignal(null);
    setSignalError("");
    setSignalLoading(true);
    setTradeSaveError("");

    const query = { assetType, symbol, timeframe, signal: controller.signal };

    fetchMarket(query)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }
        setData(null);
        setError(err.message || "Could not load market data.");
        setLoading(false);
      });

    fetchBacktest(query)
      .then((result) => {
        setBacktest(result);
        setBacktestLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }
        setBacktest(null);
        setBacktestError(err.message || "Could not run the backtest.");
        setBacktestLoading(false);
      });

    fetchSignal(query)
      .then((result) => {
        setSignal(result);
        setSignalLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }
        setSignal(null);
        setSignalError(err.message || "Could not compute the signal.");
        setSignalLoading(false);
      });

    return () => controller.abort();
  }, [assetType, symbol, timeframe, requestId]);

  useEffect(() => {
    setSaveError("");
    setSaveNotice("");
  }, [assetType, symbol, timeframe]);

  useEffect(() => {
    const controller = new AbortController();
    setLedgerLoading(true);
    setLedgerError("");
    fetchPaperRuns(controller.signal)
      .then((result) => {
        setLedger(result.runs ?? []);
        setLedgerLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }
        setLedgerError(err.message || "Could not load the paper ledger.");
        setLedgerLoading(false);
      });
    return () => controller.abort();
  }, [ledgerVersion]);

  useEffect(() => {
    const accessToken = session?.access_token || "";
    if (!accessToken) {
      setTradeLog([]);
      setTradeLogLoading(false);
      setTradeLogError("");
      return undefined;
    }
    const controller = new AbortController();
    setTradeLogLoading(true);
    setTradeLogError("");
    fetchPaperTrades(accessToken, controller.signal)
      .then((result) => {
        setTradeLog(result.items ?? []);
        setTradeLogLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          return;
        }
        setTradeLogError(err.message || "Could not load paper trades.");
        setTradeLogLoading(false);
      });
    return () => controller.abort();
  }, [session, tradeLogVersion]);

  async function saveCurrentRun() {
    setSaving(true);
    setSaveError("");
    setSaveNotice("");
    try {
      await savePaperRun({ assetType, symbol, timeframe });
      setSaveNotice("Saved to the paper ledger.");
      setLedgerVersion((value) => value + 1);
    } catch (err) {
      setSaveError(err.message || "Could not save the paper run.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCurrentSignal() {
    const accessToken = session?.access_token || "";
    if (!accessToken) {
      setTradeSaveError("Sign in to save a paper trade.");
      return;
    }
    setSavingTrade(true);
    setTradeSaveError("");
    try {
      await savePaperTrade({ accessToken, assetType, symbol, timeframe });
      setTradeLogVersion((value) => value + 1);
    } catch (err) {
      setTradeSaveError(err.message || "Could not save the paper trade.");
    } finally {
      setSavingTrade(false);
    }
  }

  async function markTrade(id, status) {
    const accessToken = session?.access_token || "";
    setTradeLogError("");
    try {
      await updatePaperTrade({ accessToken, id, status });
      setTradeLogVersion((value) => value + 1);
    } catch (err) {
      setTradeLogError(err.message || "Could not update the paper trade.");
    }
  }

  async function removeTrade(id) {
    const accessToken = session?.access_token || "";
    setTradeLogError("");
    try {
      await deletePaperTrade(accessToken, id);
      setTradeLogVersion((value) => value + 1);
    } catch (err) {
      setTradeLogError(err.message || "Could not remove the paper trade.");
    }
  }

  async function removeRun(id) {
    setLedgerError("");
    try {
      await deletePaperRun(id);
      setLedgerVersion((value) => value + 1);
    } catch (err) {
      setLedgerError(err.message || "Could not remove the paper run.");
    }
  }

  function changeAssetType(next) {
    setAssetType(next);
    setSymbol(pairsFor(next)[0].value);
  }

  const latest = data?.indicators?.latest;
  const lastBar = data?.prices?.bars?.at(-1);

  return (
    <div className="app">
      <div className="content">
      <header className="top">
        <div>
          <h1>Trading Analysis</h1>
          <p>Crypto, forex, and metals candles, a paper ledger, and a research chat beside the chart.</p>
        </div>
        <AccountBar session={session} onSession={setSession} />
      </header>

      <p className="risk-banner">{RISK_DISCLAIMER}</p>

      <nav className="pages" aria-label="Pages">
        <button type="button" aria-pressed={page === "chart"} onClick={() => setPage("chart")}>
          Chart
        </button>
        <button type="button" aria-pressed={page === "backtest"} onClick={() => setPage("backtest")}>
          Backtest
        </button>
      </nav>

      {page === "backtest" ? (
        <BacktestPage assetType={assetType} symbol={symbol} timeframe={timeframe} />
      ) : (
        <>
      <Controls
        assetType={assetType}
        symbol={symbol}
        timeframe={timeframe}
        onAssetType={changeAssetType}
        onSymbol={setSymbol}
        onTimeframe={setTimeframe}
      />

      <LibraryPanel
        accessToken={session?.access_token || ""}
        assetType={assetType}
        symbol={symbol}
        timeframe={timeframe}
        onPick={(item) => {
          setAssetType(item.asset_type);
          setSymbol(item.symbol);
        }}
      />

      {data && (
        <div className="summary" aria-live="polite">
          <span className="stat">
            <em>Close</em>
            {formatPrice(lastBar?.close)}
          </span>
          <span className="stat">
            <em>EMA 20</em>
            {formatPrice(latest?.ema_20)}
          </span>
          <span className="stat">
            <em>EMA 50</em>
            {formatPrice(latest?.ema_50)}
          </span>
          <span className="stat">
            <em>RSI</em>
            {formatNumber(latest?.rsi_14, 1)}
          </span>
          <span className="stat">
            <em>MACD</em>
            {formatAdaptive(latest?.macd?.histogram)}
          </span>
          {latest?.mfi_14 != null && (
            <span className="stat">
              <em>MFI</em>
              {formatNumber(latest.mfi_14, 1)}
            </span>
          )}
          {latest?.vwap != null && (
            <span className="stat">
              <em>VWAP</em>
              {formatPrice(latest.vwap)}
            </span>
          )}
          {latest?.obv != null && (
            <span className="stat">
              <em>OBV</em>
              {formatCompact(latest.obv)}
            </span>
          )}
        </div>
      )}

      {data?.indicators?.note && <p className="note">{data.indicators.note}</p>}

      <div className="desk">
      <section className="stage" aria-busy={loading}>
        <div className="legend">
          <span>
            <i className="swatch ema20" />
            EMA 20
          </span>
          <span>
            <i className="swatch ema50" />
            EMA 50
          </span>
        </div>
        <span className="pane-label rsi">RSI 14</span>
        <span className="pane-label macd">MACD</span>
        <MarketChart
          bars={data?.prices?.bars ?? []}
          points={data?.indicators?.points ?? []}
          timeframe={timeframe}
          levels={chartLevels(signal)}
        />
        {loading && (
          <div className="overlay">
            <p>Loading market data…</p>
          </div>
        )}
        {!loading && error && (
          <div className="overlay" role="alert">
            <div>
              <p>{error}</p>
              <button type="button" onClick={() => setRequestId((value) => value + 1)}>
                Retry
              </button>
            </div>
          </div>
        )}
      </section>
      <div className="signal-column">
        <SignalCard
          signal={signal}
          loading={signalLoading}
          error={signalError}
          onRetry={() => setRequestId((value) => value + 1)}
          assetType={assetType}
          accessToken={session?.access_token || ""}
          onSave={saveCurrentSignal}
          saving={savingTrade}
          saveError={tradeSaveError}
        />
      </div>
      <ChatPanel assetType={assetType} symbol={symbol} timeframe={timeframe} />
      </div>

      <PaperTradeLog
        trades={tradeLog}
        loading={tradeLogLoading}
        error={tradeLogError}
        accessToken={session?.access_token || ""}
        onStatus={markTrade}
        onDelete={removeTrade}
        onRetry={() => setTradeLogVersion((value) => value + 1)}
      />

      <BacktestPanel
        result={backtest}
        loading={backtestLoading}
        error={backtestError}
        onRetry={() => setRequestId((value) => value + 1)}
        onSave={saveCurrentRun}
        saving={saving}
        saveError={saveError}
        saveNotice={saveNotice}
      />

      <LedgerPanel
        runs={ledger}
        loading={ledgerLoading}
        error={ledgerError}
        onRetry={() => setLedgerVersion((value) => value + 1)}
        onDelete={removeRun}
        current={{ assetType, symbol, timeframe }}
      />
        </>
      )}
      </div>

      <footer className="footer">
        <p>{RISK_DISCLAIMER}</p>
        <p>{DISCLAIMER}</p>
      </footer>
    </div>
  );
}

function chartLevels(signal) {
  if (!signal || signal.direction === "no_trade" || !signal.entry_zone) {
    return null;
  }
  return {
    direction: signal.direction,
    entryLow: signal.entry_zone.low,
    entryHigh: signal.entry_zone.high,
    stopLoss: signal.stop_loss,
    takeProfit1: signal.take_profit_1,
    takeProfit2: signal.take_profit_2,
  };
}

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 5 : 6;
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatNumber(value, digits) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCompact(value) {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function formatAdaptive(value) {
  if (value == null || Number.isNaN(Number(value))) {
    return "—";
  }
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 6;
  return formatNumber(value, digits);
}
