"""Metals OHLCV.

YFinance is the default source. Gold and silver are the COMEX futures
GC=F and SI=F. Those contracts publish volume, so it is kept.

Twelve Data is reserved. Its spot symbols are XAU/USD and XAG/USD, and the
key is TWELVE_DATA_API_KEY. Selecting METALS_SOURCE=twelvedata fails clearly
until that fetch method is filled in.
"""

import logging
from abc import ABC, abstractmethod

from config import settings
from errors import InvalidSymbolError, MarketDataError
from providers.base import OHLCVBar, MarketDataProvider, validate_ohlcv_request
from providers.yahoo import download_yahoo_bars

# Canonical form is XAUUSD / XAGUSD so a later Twelve Data adapter can map
# them to XAU/USD and XAG/USD without a second symbol list.
_CANONICAL = {
    "GOLD": "XAUUSD",
    "XAU": "XAUUSD",
    "XAUUSD": "XAUUSD",
    "XAU/USD": "XAUUSD",
    "GC=F": "XAUUSD",
    "SILVER": "XAGUSD",
    "XAG": "XAGUSD",
    "XAGUSD": "XAGUSD",
    "XAG/USD": "XAGUSD",
    "SI=F": "XAGUSD",
}

_YAHOO_TICKER = {"XAUUSD": "GC=F", "XAGUSD": "SI=F"}
_TWELVE_DATA_PAIR = {"XAUUSD": "XAU/USD", "XAGUSD": "XAG/USD"}


def normalize_metals_symbol(symbol: str) -> str:
    """Gold, XAU/USD, XAUUSD, and GC=F all become XAUUSD. Silver becomes XAGUSD."""
    cleaned = symbol.strip().upper().replace(" ", "")
    canonical = _CANONICAL.get(cleaned)
    if canonical is None:
        raise InvalidSymbolError(symbol.strip() or symbol, "metals")
    return canonical


class MetalsSource(ABC):
    """One metals vendor. Return the shared OHLCV bars."""

    @abstractmethod
    def fetch(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        """`symbol` is canonical, XAUUSD or XAGUSD."""


class YFinanceMetalsSource(MetalsSource):
    def fetch(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        # GC=F and SI=F volume is futures volume, so it stays on the bar.
        return download_yahoo_bars(
            _YAHOO_TICKER[symbol],
            symbol,
            "metals",
            timeframe,
            limit,
            include_volume=True,
        )


class TwelveDataMetalsSource(MetalsSource):
    """Placeholder. Implement `fetch` here when the HTTP client is added.

    Do not hardcode the key. `config.settings.twelve_data_api_key` already
    reads TWELVE_DATA_API_KEY from the environment.
    """

    def __init__(self, api_key: str):
        if not api_key or api_key == "your_twelve_data_api_key":
            raise MarketDataError(
                "TWELVE_DATA_API_KEY is not set. Add it to analysis/.env, "
                "or set METALS_SOURCE=yfinance."
            )
        self._api_key = api_key

    def fetch(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        vendor_symbol = _TWELVE_DATA_PAIR[symbol]
        raise MarketDataError(
            f"Twelve Data is not implemented yet (would request {vendor_symbol}). "
            "Set METALS_SOURCE=yfinance."
        )


class MetalsProvider(MarketDataProvider):
    def __init__(self, source: MetalsSource | None = None):
        self._source = source if source is not None else build_metals_source()
        # yfinance logs a long error string for unknown tickers. The API
        # already returns InvalidSymbolError for that case.
        logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    def normalize_symbol(self, symbol: str) -> str:
        return normalize_metals_symbol(symbol)

    def get_ohlcv(self, symbol: str, timeframe: str, limit: int) -> list[OHLCVBar]:
        symbol = self.normalize_symbol(symbol)
        validate_ohlcv_request(timeframe, limit)
        return self._source.fetch(symbol, timeframe, limit)


def build_metals_source() -> MetalsSource:
    name = settings.metals_source
    if name == "yfinance":
        return YFinanceMetalsSource()
    if name == "twelvedata":
        return TwelveDataMetalsSource(settings.twelve_data_api_key)
    raise MarketDataError(
        f"Unknown METALS_SOURCE '{name}'. Use yfinance, or add a MetalsSource "
        "and select it here."
    )
