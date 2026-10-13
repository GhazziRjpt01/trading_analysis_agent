"""Pick a provider from asset_type and reuse recent candles for a short TTL."""

from threading import Lock

from cache import TTLCache
from config import settings
from errors import InvalidRequestError
from providers.base import OHLCVBar, MarketDataProvider, validate_ohlcv_request
from providers.crypto import CryptoProvider
from providers.forex import ForexProvider
from providers.metals import MetalsProvider

_cache = TTLCache(settings.cache_ttl_seconds)
_providers: dict[str, MarketDataProvider] = {}
_provider_lock = Lock()


def get_provider(asset_type: str) -> MarketDataProvider:
    """Return the crypto, forex, or metals provider. Callers do not import vendors."""
    key = asset_type.strip().lower()
    with _provider_lock:
        provider = _providers.get(key)
        if provider is None:
            if key == "crypto":
                provider = CryptoProvider()
            elif key == "forex":
                provider = ForexProvider()
            elif key == "metals":
                provider = MetalsProvider()
            else:
                raise InvalidRequestError("asset_type must be crypto, forex, or metals.")
            _providers[key] = provider
        return provider


def load_ohlcv(asset_type: str, symbol: str, timeframe: str, limit: int) -> tuple[str, list[OHLCVBar]]:
    """Normalize, serve a cache hit when possible, otherwise call the provider.

    The cache key is the normalized symbol, so BTC/usdt and BTC/USDT share
    one Binance request inside the TTL.
    """
    validate_ohlcv_request(timeframe, limit)
    provider = get_provider(asset_type)
    normalized = provider.normalize_symbol(symbol)
    cache_key = (asset_type.strip().lower(), normalized, timeframe, limit)
    cached = _cache.get(cache_key)
    if cached is not None:
        return normalized, cached
    bars = provider.get_ohlcv(normalized, timeframe, limit)
    _cache.set(cache_key, bars)
    return normalized, bars
