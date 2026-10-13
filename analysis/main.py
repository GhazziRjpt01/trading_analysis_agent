"""HTTP API for candles, indicators, and paper backtests. No order routes."""

import logging
from datetime import datetime, timezone
from typing import Literal

AssetType = Literal["crypto", "forex", "metals"]

from fastapi import Body, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from backtest import run_ema_cross_backtest
from config import settings
from errors import AnalysisError
from indicators import compute_indicators
from providers.base import MAX_LIMIT, OHLCVBar
from providers.factory import load_ohlcv
from signals import (
    SIGNAL_LOOKBACK,
    parse_position_request,
    parse_signal_request,
    position_size,
    run_signal,
)
from strategy_backtest import PERFORMANCE_NOTE, parse_backtest_request, run_strategy_backtest

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

DISCLAIMER = "Research only, not financial advice."

app = FastAPI(
    title="trading_analysis_agent analysis",
    summary="Market data, indicators, and paper backtests for crypto, forex, and metals.",
    description=(
        "Research service. It reads public candles, computes indicators, and "
        "simulates an EMA crossover. It does not place orders. "
        "Research only, not financial advice."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class BarModel(BaseModel):
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None


class PriceResponse(BaseModel):
    asset_type: str
    symbol: str
    timeframe: str
    disclaimer: str
    count: int
    bars: list[BarModel]


class MacdModel(BaseModel):
    macd: float | None = None
    signal: float | None = None
    histogram: float | None = None


class BollingerModel(BaseModel):
    middle: float | None = None
    upper: float | None = None
    lower: float | None = None


class IndicatorPoint(BaseModel):
    timestamp: str
    rsi_14: float | None = None
    macd: MacdModel
    ema_20: float | None = None
    ema_50: float | None = None
    bollinger: BollingerModel
    atr_14: float | None = None
    # Present only when every bar has real volume. Otherwise null.
    obv: float | None = None
    mfi_14: float | None = None
    vwap: float | None = None


class TradeModel(BaseModel):
    side: Literal["long", "short"]
    entry_time: str
    exit_time: str
    entry_price: float
    exit_price: float
    return_pct: float
    pnl: float
    reason: Literal["signal", "end_of_data"]


class EquityPointModel(BaseModel):
    timestamp: str
    equity: float


class BacktestResponse(BaseModel):
    asset_type: str
    symbol: str
    timeframe: str
    disclaimer: str
    strategy: str
    strategy_label: str
    description: str
    starting_equity: float
    ending_equity: float
    return_pct: float
    trade_count: int
    win_count: int
    loss_count: int
    win_rate_pct: float | None = None
    max_drawdown_pct: float
    fee_bps: float
    fill: str
    sizing: str
    warning: str | None = None
    trades: list[TradeModel]
    equity: list[EquityPointModel]


class IndicatorResponse(BaseModel):
    asset_type: str
    symbol: str
    timeframe: str
    disclaimer: str
    note: str | None = None
    warning: str | None = None
    latest: IndicatorPoint
    points: list[IndicatorPoint] = Field(description="Same indicators on each returned candle.")


@app.exception_handler(AnalysisError)
async def handle_analysis_error(_, exc: AnalysisError):
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/prices", response_model=PriceResponse)
def prices(
    asset_type: AssetType = Query(description="crypto, forex, or metals"),
    symbol: str = Query(description="BTC/USDT, EURUSD, or Gold"),
    timeframe: str = Query(default="1h", description="1m, 5m, 15m, 30m, 1h, 4h, or 1d"),
    limit: int = Query(default=500, ge=1, le=MAX_LIMIT),
):
    normalized, bars = load_ohlcv(asset_type, symbol, timeframe, limit)
    return PriceResponse(
        asset_type=asset_type,
        symbol=normalized,
        timeframe=timeframe,
        disclaimer=DISCLAIMER,
        count=len(bars),
        bars=[_bar_model(bar) for bar in bars],
    )


@app.get("/indicators", response_model=IndicatorResponse)
def indicators(
    asset_type: AssetType = Query(description="crypto, forex, or metals"),
    symbol: str = Query(description="BTC/USDT, EURUSD, or Gold"),
    timeframe: str = Query(default="1h", description="1m, 5m, 15m, 30m, 1h, 4h, or 1d"),
    limit: int = Query(default=500, ge=1, le=MAX_LIMIT),
):
    normalized, bars = load_ohlcv(asset_type, symbol, timeframe, limit)
    computed = compute_indicators(bars, asset_type=asset_type)
    return IndicatorResponse(
        asset_type=asset_type,
        symbol=normalized,
        timeframe=timeframe,
        disclaimer=DISCLAIMER,
        note=computed.get("note"),
        warning=computed.get("warning"),
        latest=_indicator_point(computed["latest"]),
        points=[_indicator_point(point) for point in computed["points"]],
    )


@app.get("/backtest", response_model=BacktestResponse)
def backtest(
    asset_type: AssetType = Query(description="crypto, forex, or metals"),
    symbol: str = Query(description="BTC/USDT, EURUSD, or Gold"),
    timeframe: str = Query(default="1h", description="1m, 5m, 15m, 30m, 1h, 4h, or 1d"),
    limit: int = Query(default=500, ge=1, le=MAX_LIMIT),
):
    normalized, bars = load_ohlcv(asset_type, symbol, timeframe, limit)
    result = run_ema_cross_backtest(bars, asset_type=asset_type)
    return BacktestResponse(
        asset_type=asset_type,
        symbol=normalized,
        timeframe=timeframe,
        disclaimer=DISCLAIMER,
        strategy=result["strategy"],
        strategy_label=result["strategy_label"],
        description=result["description"],
        starting_equity=result["starting_equity"],
        ending_equity=result["ending_equity"],
        return_pct=result["return_pct"],
        trade_count=result["trade_count"],
        win_count=result["win_count"],
        loss_count=result["loss_count"],
        win_rate_pct=result["win_rate_pct"],
        max_drawdown_pct=result["max_drawdown_pct"],
        fee_bps=result["fee_bps"],
        fill=result["fill"],
        sizing=result["sizing"],
        warning=result["warning"],
        trades=[_trade_model(trade) for trade in result["trades"]],
        equity=[_equity_point(point) for point in result["equity"]],
    )


@app.post("/backtest")
def post_backtest(payload: dict = Body(...)):
    asset_type, symbol, timeframe, period, strategy = parse_backtest_request(payload)
    normalized, bars = load_ohlcv(asset_type, symbol, timeframe, period)
    result = run_strategy_backtest(
        bars,
        asset_type=asset_type,
        symbol=normalized,
        timeframe=timeframe,
        strategy=strategy,
    )
    return {
        "asset_type": asset_type,
        "symbol": normalized,
        "timeframe": timeframe,
        "period": period,
        "disclaimer": DISCLAIMER,
        **result,
        "performance_note": PERFORMANCE_NOTE,
    }


@app.post("/signal")
def post_signal(payload: dict = Body(...)):
    asset_type, symbol, timeframe = parse_signal_request(payload)
    normalized, bars = load_ohlcv(asset_type, symbol, timeframe, SIGNAL_LOOKBACK)
    result = run_signal(bars, asset_type=asset_type, symbol=normalized, timeframe=timeframe)
    return {
        "asset_type": asset_type,
        "symbol": normalized,
        "timeframe": timeframe,
        "disclaimer": DISCLAIMER,
        **result,
    }


@app.post("/position-size")
def post_position_size(payload: dict = Body(...)):
    asset_type, balance, risk_percent, entry, stop_loss = parse_position_request(payload)
    return {
        "disclaimer": DISCLAIMER,
        **position_size(asset_type, balance, risk_percent, entry, stop_loss),
    }


def _bar_model(bar: OHLCVBar) -> BarModel:
    # Eight decimals keeps FX and crypto quotes stable without binary float tails.
    return BarModel(
        timestamp=_iso(bar.timestamp),
        open=_round(bar.open),
        high=_round(bar.high),
        low=_round(bar.low),
        close=_round(bar.close),
        volume=None if bar.volume is None else _round(bar.volume),
    )


def _round(value: float) -> float:
    return round(float(value), 8)


def _indicator_point(point: dict) -> IndicatorPoint:
    return IndicatorPoint(
        timestamp=_iso(point["timestamp"]),
        rsi_14=point["rsi_14"],
        macd=MacdModel(**point["macd"]),
        ema_20=point["ema_20"],
        ema_50=point["ema_50"],
        bollinger=BollingerModel(**point["bollinger"]),
        atr_14=point["atr_14"],
        obv=point.get("obv"),
        mfi_14=point.get("mfi_14"),
        vwap=point.get("vwap"),
    )


def _trade_model(trade: dict) -> TradeModel:
    return TradeModel(
        side=trade["side"],
        entry_time=_iso(trade["entry_time"]),
        exit_time=_iso(trade["exit_time"]),
        entry_price=trade["entry_price"],
        exit_price=trade["exit_price"],
        return_pct=trade["return_pct"],
        pnl=trade["pnl"],
        reason=trade["reason"],
    )


def _equity_point(point: dict) -> EquityPointModel:
    return EquityPointModel(timestamp=_iso(point["timestamp"]), equity=point["equity"])


def _iso(timestamp: datetime) -> str:
    return timestamp.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
