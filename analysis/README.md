# Analysis service

Research-only market data for crypto, forex, and metals. This service reads public candles and computes indicators. It does not place orders.

**Research only, not financial advice.**

## What it serves

| Path | Role |
| --- | --- |
| `GET /health` | Process is up. |
| `GET /prices` | OHLCV candles. |
| `GET /indicators` | RSI(14), MACD(12, 26, 9), EMA(20), EMA(50), Bollinger Bands(20, 2), ATR(14). |
| `GET /backtest` | Paper EMA 20/50 crossover. Same candles as `/prices`. No orders. |
| `POST /backtest` | Paper EMA crossover or RSI mean reversion over `period` bars, with asset-class costs. |
| `POST /signal` | Rule-based buy, sell, or no_trade. Entry, stop, and targets are computed here. |
| `POST /position-size` | Position size from balance, risk percent, entry, and stop. |

Crypto (`asset_type=crypto`) uses public ccxt candles. Binance is first; if that call fails, Bybit is tried. Forex (`asset_type=forex`) uses Yahoo Finance tickers such as `EURUSD=X`. Metals (`asset_type=metals`) uses Yahoo Finance futures: Gold is `GC=F` and Silver is `SI=F`. The API accepts `Gold`, `Silver`, `XAUUSD`, `XAGUSD`, `XAU/USD`, `XAG/USD`, `GC=F`, and `SI=F`, and returns `XAUUSD` or `XAGUSD`.

All three return the same bar shape: `timestamp` (UTC), `open`, `high`, `low`, `close`, and `volume`. Forex volume is `null` because that feed has no real traded volume. Metals futures keep contract volume. OBV, MFI(14), and VWAP are computed only when every bar has a volume; otherwise they are omitted and the payload includes a note.

`Twelve Data` is reserved for forex (`FOREX_SOURCE=twelvedata`, pairs such as `EUR/USD`) and metals (`METALS_SOURCE=twelvedata`, `XAU/USD` and `XAG/USD`). The key is `TWELVE_DATA_API_KEY`. Neither adapter is called until its fetch method is implemented.

Identical candle requests are cached in memory. `CACHE_TTL_SECONDS` defaults to 60 so refreshes do not hammer public rate limits.

## Setup

Python 3.12. From this directory:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

`.env` is gitignored. The example file has placeholders only. Public Binance, Bybit, and Yahoo candles do not need API keys.

## Run

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Interactive docs: http://127.0.0.1:8000/docs

## Examples

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/health"

Invoke-RestMethod "http://127.0.0.1:8000/prices?asset_type=crypto&symbol=BTC/USDT&timeframe=1h&limit=500"

Invoke-RestMethod "http://127.0.0.1:8000/indicators?asset_type=forex&symbol=EURUSD&timeframe=1h&limit=500"

Invoke-RestMethod "http://127.0.0.1:8000/prices?asset_type=metals&symbol=Gold&timeframe=1h&limit=300"

Invoke-RestMethod "http://127.0.0.1:8000/indicators?asset_type=metals&symbol=Silver&timeframe=1d&limit=300"

Invoke-RestMethod "http://127.0.0.1:8000/backtest?asset_type=crypto&symbol=BTC/USDT&timeframe=1h&limit=300"
```

`symbol` also accepts `EUR/USD` and `EURUSD=X`. Timeframes: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`. `limit` is 1–1000.

`GET /backtest` uses those same query parameters. The run starts at 10,000 paper equity, takes one long or short at a time, and fills the next bar's open after an EMA cross on the close. Research friction is 10 bps per fill for crypto, 1 bp for forex, and 5 bps for metals. A still-open position is marked closed on the last bar. The response includes `disclaimer`.

`POST /backtest` accepts `asset_type`, `symbol`, `timeframe`, `period` (50–1000 bars), and `strategy` (`ema_crossover` or `rsi_mean_reversion`). Crypto costs are a percentage fee and slippage. Forex cost is a spread in pips. Metals use a price-point spread plus slippage, because broker pip sizes differ. The response includes total return, win rate, max drawdown, Sharpe ratio, trade count, and the equity curve, plus `Past performance does not predict future results.`

An unknown pair returns `400` with a `detail` message. If both crypto venues fail for a network or rate-limit reason, the response is `502`.

Each data response includes `disclaimer`: `Research only, not financial advice.`
