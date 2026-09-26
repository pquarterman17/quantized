import { askParams, type ParamField, type ParamValues } from "../components/overlays/ParamDialog";
import type { StoreGet } from "./exportActive";
import type { DataStruct } from "./types";
import type { AggregateMode, JoinMode } from "./worksheetTransforms";

/** The Data-menu reshape dialogs (transpose / stack / unstack / join). Each
 *  collects its parameters, then hands them to `lib/transformRun.ts`, which
 *  computes the result, shows the P2.5 warning review (duplicate keys, rows
 *  lost, unit mismatch — the last needs an explicit confirm) BEFORE anything is
 *  created, stamps the warnings into the derived dataset's metadata, and
 *  records a replayable pipeline step. The same function replays that step.
 *
 *  `lib/worksheetTransforms.ts` (the reshape math) and `transformRun.ts` load
 *  behind ONE dynamic import. Each command STARTS the fetch before it opens its
 *  `ParamDialog` and awaits it only after the dialog resolves, so the download
 *  overlaps the user's think-time instead of landing between OK and the result.
 *  A chunk-load failure (offline, evicted asset) surfaces through `withErrors`
 *  below as Vite's own message. */
const runner = () => import("./transformRun");

function columnOptions(data: DataStruct): string[] {
  return ["-1: X / time", ...data.labels.map((label, index) => `${index}: ${label}`)];
}

function optionIndex(value: unknown): number {
  return Number.parseInt(String(value).split(":", 1)[0], 10);
}

async function activeData(s: StoreGet): Promise<ReturnType<StoreGet>["datasets"][number] | null> {
  const id = s().activeId;
  if (!id) { s().setStatus("select a dataset first"); return null; }
  return (await s().resolveDataset(id)) ?? null;
}

async function withErrors(s: StoreGet, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (error) { s().setStatus(error instanceof Error ? error.message : "worksheet transform failed"); }
}

/** Start the chunk fetch while a dialog is open; the dialog may be cancelled
 *  and never await it, so its rejection is pre-handled. */
function prefetch(): ReturnType<typeof runner> {
  const pending = runner();
  pending.catch(() => {});
  return pending;
}

export function runTransposeWorksheet(s: StoreGet): void {
  void withErrors(s, async () => {
    const source = await activeData(s);
    if (!source) return;
    const pending = prefetch();
    const params = await askParams("Transpose worksheet", [{
      key: "confirm", label: "Create one output column per input row", type: "boolean", default: true,
      hint: "The source remains unchanged; original labels and units are kept in provenance.",
    }]);
    if (!params || !params.confirm) return;
    const { runTransform, reviewTransform } = await pending;
    await runTransform(s, { op: "transpose" }, source.id, reviewTransform);
  });
}

export function runStackWorksheet(s: StoreGet): void {
  void withErrors(s, async () => {
    const source = await activeData(s);
    if (!source) return;
    const pending = prefetch();
    const params = await askParams("Stack columns to long form", [{
      key: "channels", label: "Channels (1-based, comma-separated)", type: "text",
      default: source.data.labels.map((_, index) => index + 1).join(","),
      hint: "Produces X/time, Source channel, and Value columns; channels with different units are flagged before anything is created.",
    }]);
    if (!params) return;
    const channels = String(params.channels).split(",").map((token) => Number.parseInt(token.trim(), 10) - 1);
    const { runTransform, reviewTransform } = await pending;
    await runTransform(s, { op: "stack", channels }, source.id, reviewTransform);
  });
}

export function runUnstackWorksheet(s: StoreGet): void {
  void withErrors(s, async () => {
    const source = await activeData(s);
    if (!source) return;
    const options = columnOptions(source.data);
    const fields: ParamField[] = [
      { key: "key", label: "Row key", type: "select", default: options[0], options },
      { key: "category", label: "Category column", type: "select", default: options[1] ?? options[0], options },
      { key: "value", label: "Value column", type: "select", default: options[2] ?? options[1] ?? options[0], options },
      { key: "aggregate", label: "Duplicate key/category cells", type: "select", default: "mean", options: ["mean", "first", "last"] },
    ];
    const pending = prefetch();
    const params = await askParams("Unstack / pivot to wide form", fields);
    if (!params) return;
    const { runTransform, reviewTransform } = await pending;
    await runTransform(s, {
      op: "unstack",
      key: optionIndex(params.key),
      category: optionIndex(params.category),
      value: optionIndex(params.value),
      aggregate: String(params.aggregate) as AggregateMode,
    }, source.id, reviewTransform);
  });
}

export function runJoinWorksheets(s: StoreGet): void {
  void withErrors(s, async () => {
    const left = await activeData(s);
    if (!left) return;
    const candidates = s().datasets.filter((dataset) => dataset.id !== left.id);
    if (!candidates.length) throw new Error("Import or create a second dataset before joining");
    const datasetOptions = candidates.map((dataset) => `${dataset.name} — ${dataset.id}`);
    const leftOptions = columnOptions(left.data);
    const initial: ParamField[] = [
      { key: "right", label: "Dataset to join", type: "select", default: datasetOptions[0], options: datasetOptions },
      { key: "leftKey", label: "Active dataset key", type: "select", default: leftOptions[0], options: leftOptions },
      { key: "mode", label: "Rows to retain", type: "select", default: "inner", options: ["inner", "left", "right", "full"] },
    ];
    const pending = prefetch();
    const first = await askParams("Join datasets by numeric key — step 1 of 2", initial);
    if (!first) return;
    const rightId = candidates[datasetOptions.indexOf(String(first.right))]?.id;
    const right = rightId ? await s().resolveDataset(rightId) : null;
    if (!right) throw new Error("The selected join dataset is unavailable");
    const rightOptions = columnOptions(right.data);
    const second: ParamValues | null = await askParams("Join datasets by numeric key — step 2 of 2", [{
      key: "rightKey", label: `${right.name} key`, type: "select", default: rightOptions[0], options: rightOptions,
      hint: "Duplicate keys use their first row. Duplicate, blank and unmatched keys and differing key units are counted for review before anything is created.",
    }]);
    if (!second) return;
    const { runTransform, reviewTransform } = await pending;
    await runTransform(s, {
      op: "join",
      leftKey: optionIndex(first.leftKey),
      rightKey: optionIndex(second.rightKey),
      mode: String(first.mode) as JoinMode,
      with: { id: right.id, name: right.name },
    }, left.id, reviewTransform);
  });
}
