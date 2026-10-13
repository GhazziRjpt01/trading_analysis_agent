import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_PATH = path.join(serverRoot, "data", "paper-ledger.json");

// A local stand-in until Supabase is the system of record. Enough history
// for research on one machine, small enough to rewrite safely.
const DEFAULT_MAX_RUNS = 40;

export function createPaperLedger(filePath = DEFAULT_PATH, { maxRuns = DEFAULT_MAX_RUNS } = {}) {
  let queue = Promise.resolve();

  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    filePath,
    list() {
      return enqueue(() => readRuns(filePath));
    },
    get(id) {
      return enqueue(async () => {
        const runs = await readRuns(filePath);
        return runs.find((run) => run.id === id) ?? null;
      });
    },
    save(fields) {
      return enqueue(async () => {
        const runs = await readRuns(filePath);
        const run = { id: randomUUID(), saved_at: utcNow(), ...fields };
        const kept = [...runs, run].slice(-maxRuns);
        await writeRuns(filePath, kept);
        return run;
      });
    },
    remove(id) {
      return enqueue(async () => {
        const runs = await readRuns(filePath);
        const next = runs.filter((run) => run.id !== id);
        if (next.length === runs.length) {
          return false;
        }
        await writeRuns(filePath, next);
        return true;
      });
    },
  };
}

export const paperLedger = createPaperLedger();

async function readRuns(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Paper ledger file is not valid JSON.");
  }

  if (!parsed || !Array.isArray(parsed.runs)) {
    throw new Error("Paper ledger file is missing a runs array.");
  }
  return parsed.runs;
}

async function writeRuns(filePath, runs) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify({ runs }, null, 2), "utf8");
  // copyFile replaces the destination on Windows. rename does not.
  await copyFile(temp, filePath);
  await rm(temp, { force: true });
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
