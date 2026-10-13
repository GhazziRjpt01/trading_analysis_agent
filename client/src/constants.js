export const PAIRS = {
  crypto: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"].map(pair),
  forex: ["EURUSD", "GBPJPY", "GBPUSD", "USDJPY", "AUDUSD"].map(pair),
  metals: [
    { value: "XAUUSD", label: "Gold" },
    { value: "XAGUSD", label: "Silver" },
  ],
};

function pair(symbol) {
  return { value: symbol, label: symbol };
}

export const TIMEFRAMES = [
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1H" },
  { value: "4h", label: "4H" },
  { value: "1d", label: "1D" },
];

export const DISCLAIMER = "Research only, not financial advice.";

export const RISK_DISCLAIMER =
  "Educational and research tool only. Not financial advice. Trading involves risk of loss.";

export const PAST_PERFORMANCE = "Past performance does not predict future results.";
