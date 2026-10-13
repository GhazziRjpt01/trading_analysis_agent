"""Errors the API turns into JSON responses. No stack traces leave the process."""


class AnalysisError(Exception):
    """Expected failure: bad input or an upstream data source."""

    status_code = 400


class InvalidSymbolError(AnalysisError):
    """The symbol is not a pair this asset class can request."""

    def __init__(self, symbol: str, asset_type: str, *, unknown_market: bool = False):
        self.symbol = symbol
        self.asset_type = asset_type
        if unknown_market:
            message = f"No {asset_type} market found for '{symbol}'."
        elif asset_type == "crypto":
            message = f"Invalid crypto symbol '{symbol}'. Use BASE/QUOTE, for example BTC/USDT."
        elif asset_type == "metals":
            message = (
                f"Invalid metals symbol '{symbol}'. "
                "Use Gold, Silver, XAUUSD, or XAGUSD."
            )
        else:
            message = f"Invalid forex symbol '{symbol}'. Use a six-letter pair such as EURUSD or GBPJPY."
        super().__init__(message)


class UnsupportedTimeframeError(AnalysisError):
    def __init__(self, timeframe: str, supported: tuple[str, ...]):
        joined = ", ".join(supported)
        super().__init__(f"Unsupported timeframe '{timeframe}'. Use one of: {joined}.")


class InvalidRequestError(AnalysisError):
    """limit, asset type, or another parameter is outside the supported range."""


class MarketDataError(AnalysisError):
    """The upstream source failed after the provider tried its fallback."""

    status_code = 502
