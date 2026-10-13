"""Short-lived memory cache for identical OHLCV requests.

Dashboard refreshes would otherwise hit Binance or Yahoo on every poll.
The TTL stays short so a research view does not serve stale candles for long.
"""

import time
from threading import Lock


class TTLCache:
    def __init__(self, ttl_seconds: int):
        self._ttl_seconds = ttl_seconds
        self._values: dict[tuple, tuple[float, list]] = {}
        self._lock = Lock()

    def get(self, key: tuple) -> list | None:
        now = time.monotonic()
        with self._lock:
            item = self._values.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= now:
                del self._values[key]
                return None
            # Copy so a caller cannot append onto the cached list.
            return list(value)

    def set(self, key: tuple, value: list) -> None:
        now = time.monotonic()
        with self._lock:
            expired = [item for item, (expires_at, _) in self._values.items() if expires_at <= now]
            for item in expired:
                del self._values[item]
            self._values[key] = (now + self._ttl_seconds, list(value))
