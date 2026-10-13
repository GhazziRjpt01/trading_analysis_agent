import { TIMEFRAMES } from "../constants.js";
import { pairsFor } from "../api.js";

export default function Controls({ assetType, symbol, timeframe, onAssetType, onSymbol, onTimeframe }) {
  const pairs = pairsFor(assetType);

  return (
    <div className="controls">
      <div className="field">
        <span>Asset</span>
        <div className="toggle" role="group" aria-label="Asset type">
          <button type="button" aria-pressed={assetType === "crypto"} onClick={() => onAssetType("crypto")}>
            Crypto
          </button>
          <button type="button" aria-pressed={assetType === "forex"} onClick={() => onAssetType("forex")}>
            Forex
          </button>
          <button type="button" aria-pressed={assetType === "metals"} onClick={() => onAssetType("metals")}>
            Metals
          </button>
        </div>
      </div>

      <label className="field">
        <span>Symbol</span>
        <select value={symbol} onChange={(event) => onSymbol(event.target.value)} aria-label="Symbol">
          {pairs.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Timeframe</span>
        <select value={timeframe} onChange={(event) => onTimeframe(event.target.value)} aria-label="Timeframe">
          {TIMEFRAMES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
