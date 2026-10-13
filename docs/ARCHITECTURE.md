# Architecture

`trading_analysis_agent` is a research tool for three asset classes: crypto (for example `BTC/USDT`, `ETH/USDT`), forex (for example `EURUSD`, `GBPJPY`), and metals (Gold `XAUUSD`, Silver `XAGUSD`). It analyzes market data, runs indicators and backtests, and can paper-trade. It does not place real orders.

## Services

| Path | Stack | Responsibility |
| --- | --- | --- |
| `client/` | React + Vite | Dashboard. Displays analysis, indicators, backtests, and paper trades. |
| `server/` | Node + Express | HTTP API and AI agent orchestration (OpenAI). |
| `analysis/` | Python FastAPI | Market data, technical indicators, and backtesting. |
| Supabase | PostgreSQL + Auth | Users, watchlists, saved analyses, and agent conversations. |

## How a request moves

1. The dashboard calls the Express API.
2. Express runs the agent (OpenAI) and asks the analysis service for data, indicators, a backtest, or a paper-trade simulation.
3. FastAPI loads bars through a market-data provider, computes the result, and returns it. Express returns that response to the client. A saved paper run is written to a local ledger until Supabase is wired.
4. The UI shows the result with the disclaimer: **Research only, not financial advice.**

## Research chat

`POST /api/agent/chat` streams an OpenAI reply as server-sent events. The model may call `get_price_data` and `compute_indicators`. Both tools take `asset_type` (`crypto`, `forex`, or `metals`), `symbol`, and `timeframe`, and Express forwards them to the analysis service. The prompt tells the model to use only those numbers, cite the indicator values, never guarantee outcomes, include the research disclaimer, and mention how crypto, forex, and metals trade. The dashboard shows the stream in a panel beside the chart. `OPENAI_API_KEY` and optional `OPENAI_MODEL` stay in `server/.env`.

## Market data providers

Each vendor (crypto exchange, forex feed, metals feed, or a later source) is a provider behind one interface. Callers never depend on a vendor's raw payload.

`asset_type` is `crypto`, `forex`, or `metals`. Crypto uses public exchange candles. Forex uses Yahoo Finance (`EURUSD=X`) and leaves volume null. Metals use Yahoo Finance futures, gold `GC=F` and silver `SI=F`, and keep that contract volume. Twelve Data is reserved for both forex (`EUR/USD`) and metals (`XAU/USD`, `XAG/USD`) and is not called yet.

OBV, MFI, and VWAP are computed only when every bar has a real volume. Forex omits them. Crypto and metals include them.

Every provider normalizes bars to the same OHLCV shape:

| Field | Meaning |
| --- | --- |
| `timestamp` | Bar open time, UTC |
| `open`, `high`, `low`, `close` | Prices |
| `volume` | Base-asset volume, or null when the source has none |

Indicators, backtests, paper trading, and the agent all consume this format.

## Backtest

`GET /backtest` on the analysis service runs a paper EMA 20/50 crossover on those bars. Express proxies it at `GET /api/backtest`. The dashboard shows return, drawdown, and the paper trades under the chart.

`POST /backtest` runs either that EMA crossover or an RSI mean reversion over `period` bars. Express proxies it at `POST /api/backtest`. Crypto pays a percentage fee and slippage, forex pays a spread in pips, and metals pay a price-point spread plus slippage because broker pip sizes differ. The Backtest page shows the equity curve and a metrics table, with the note that past performance does not predict future results.

A cross is read on the bar close and filled at the next bar's open. One position at a time, long or short. Nothing is sent to an exchange.

The dashboard can save that run with `POST /api/paper-runs`. Express re-runs the paper backtest and appends it to `server/data/paper-ledger.json` on this machine (gitignored, newest 40 runs). `GET /api/paper-runs` lists them and `DELETE /api/paper-runs/:id` removes one.

## Supabase

The SQL in `server/supabase/schema.sql` creates `watchlists`, `saved_analyses`, and `agent_conversations`. Each row has `user_id`. Row Level Security lets an authenticated user read and write only their own rows. The anon role has no grants.

Express reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `server/.env`. That secret stays on the server. The dashboard signs in with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then sends `Authorization: Bearer <access token>` on the library routes. Express verifies the token and ignores any user id in the body.

`GET` and `POST /api/watchlist`, `DELETE /api/watchlist/:id`, `GET` and `POST /api/analyses`, and `DELETE /api/analyses/:id` are scoped to that user. Saving an analysis re-reads candles and indicators from the analysis service. `agent_conversations` is in the schema for later chat history. The local paper ledger is unchanged.

## Boundaries

- Analysis and paper trading only. No live order routing.
- Secrets stay in per-service `.env` files. Each service ships a `.env.example` with variable names and placeholders only.
