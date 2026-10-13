"""Runtime settings. Secrets come from the environment, never from source."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# analysis/.env is gitignored. Missing file is fine: public data has defaults.
load_dotenv(Path(__file__).resolve().parent / ".env")


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}.") from exc
    if value < 1:
        raise RuntimeError(f"{name} must be >= 1.")
    return value


def _csv_env(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    cache_ttl_seconds: int
    cors_origins: list[str]
    crypto_exchange: str
    crypto_fallback_exchange: str
    forex_source: str
    metals_source: str
    # Empty unless a Twelve Data adapter is configured. Never hardcoded.
    twelve_data_api_key: str


def load_settings() -> Settings:
    return Settings(
        cache_ttl_seconds=_int_env("CACHE_TTL_SECONDS", 60),
        cors_origins=_csv_env(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ),
        crypto_exchange=os.getenv("CRYPTO_EXCHANGE", "binance").strip().lower(),
        crypto_fallback_exchange=os.getenv(
            "CRYPTO_FALLBACK_EXCHANGE", "bybit"
        ).strip().lower(),
        forex_source=os.getenv("FOREX_SOURCE", "yfinance").strip().lower(),
        metals_source=os.getenv("METALS_SOURCE", "yfinance").strip().lower(),
        twelve_data_api_key=os.getenv("TWELVE_DATA_API_KEY", "").strip(),
    )


settings = load_settings()
