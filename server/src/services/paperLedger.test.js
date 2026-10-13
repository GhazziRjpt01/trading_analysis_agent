import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createPaperLedger } from "./paperLedger.js";

test("saves, lists, reads, and removes a paper run", async () => {
  const ledger = createPaperLedger(await tempFile());
  assert.deepEqual(await ledger.list(), []);

  const saved = await ledger.save({ symbol: "BTC/USDT", trade_count: 1 });
  assert.match(saved.id, /^[0-9a-f-]{36}$/);
  assert.match(saved.saved_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(saved.symbol, "BTC/USDT");

  assert.equal((await ledger.list()).length, 1);
  assert.equal((await ledger.get(saved.id)).symbol, "BTC/USDT");
  assert.equal(await ledger.get("missing"), null);

  assert.equal(await ledger.remove(saved.id), true);
  assert.equal(await ledger.remove(saved.id), false);
  assert.deepEqual(await ledger.list(), []);
});

test("keeps the newest runs when the ledger is full", async () => {
  const ledger = createPaperLedger(await tempFile(), { maxRuns: 2 });
  await ledger.save({ symbol: "OLD" });
  await ledger.save({ symbol: "MID" });
  await ledger.save({ symbol: "NEW" });

  const symbols = (await ledger.list()).map((run) => run.symbol);
  assert.deepEqual(symbols, ["MID", "NEW"]);
});

test("parallel saves both persist", async () => {
  const ledger = createPaperLedger(await tempFile());
  await Promise.all([ledger.save({ symbol: "A" }), ledger.save({ symbol: "B" })]);
  const symbols = (await ledger.list()).map((run) => run.symbol).sort();
  assert.deepEqual(symbols, ["A", "B"]);
});

test("refuses a corrupt ledger instead of wiping it", async () => {
  const filePath = await tempFile();
  await writeFile(filePath, "{", "utf8");
  const ledger = createPaperLedger(filePath);
  await assert.rejects(() => ledger.list(), /not valid JSON/);
});

async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), "paper-ledger-"));
  return path.join(dir, "paper-ledger.json");
}
