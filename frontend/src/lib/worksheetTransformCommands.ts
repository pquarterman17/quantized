import { askParams, type ParamField, type ParamValues } from "../components/overlays/ParamDialog";
import type { StoreGet } from "./exportActive";
import type { DataStruct } from "./types";
import {
  joinWorksheets,
  stackWorksheet,
  transposeWorksheet,
  unstackWorksheet,
  type AggregateMode,
  type JoinMode,
} from "./worksheetTransforms";

let sequence = 0;

function columnOptions(data: DataStruct): string[] {
  return ["-1: X / time", ...data.labels.map((label, index) => `${index}: ${label}`)];
}

function optionIndex(value: unknown): number {
  return Number.parseInt(String(value).split(":", 1)[0], 10);
}

function addDerived(s: StoreGet, sourceName: string, suffix: string, data: DataStruct): void {
  const id = `transform-${Date.now().toString(36)}-${++sequence}`;
  s().addDataset({ id, name: `${sourceName} (${suffix})`, data });
  s().setStatus(`created ${sourceName} (${suffix})`);
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

export function runTransposeWorksheet(s: StoreGet): void {
  void withErrors(s, async () => {
    const source = await activeData(s);
    if (!source) return;
    const params = await askParams("Transpose worksheet", [{
      key: "confirm", label: "Create one output column per input row", type: "boolean", default: true,
      hint: "The source remains unchanged; original labels and units are kept in provenance.",
    }]);
    if (!params || !params.confirm) return;
    addDerived(s, source.name, "transposed", transposeWorksheet(source.data));
  });
}

export function runStackWorksheet(s: StoreGet): void {
  void withErrors(s, async () => {
    const source = await activeData(s);
    if (!source) return;
    const params = await askParams("Stack columns to long form", [{
      key: "channels", label: "Channels (1-based, comma-separated)", type: "text",
      default: source.data.labels.map((_, index) => index + 1).join(","),
      hint: "Produces X/time, Source channel, and Value columns; the source remains unchanged.",
    }]);
    if (!params) return;
    const channels = String(params.channels).split(",").map((token) => Number.parseInt(token.trim(), 10) - 1);
    addDerived(s, source.name, "stacked", stackWorksheet(source.data, channels));
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
    const params = await askParams("Unstack / pivot to wide form", fields);
    if (!params) return;
    const data = unstackWorksheet(
      source.data,
      optionIndex(params.key),
      optionIndex(params.category),
      optionIndex(params.value),
      String(params.aggregate) as AggregateMode,
    );
    addDerived(s, source.name, "unstacked", data);
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
    const first = await askParams("Join datasets by numeric key — step 1 of 2", initial);
    if (!first) return;
    const rightId = candidates[datasetOptions.indexOf(String(first.right))]?.id;
    const right = rightId ? await s().resolveDataset(rightId) : null;
    if (!right) throw new Error("The selected join dataset is unavailable");
    const rightOptions = columnOptions(right.data);
    const second: ParamValues | null = await askParams("Join datasets by numeric key — step 2 of 2", [{
      key: "rightKey", label: `${right.name} key`, type: "select", default: rightOptions[0], options: rightOptions,
      hint: "Duplicate keys use their first row to avoid an accidental many-to-many expansion.",
    }]);
    if (!second) return;
    const data = joinWorksheets(
      left.data,
      right.data,
      optionIndex(first.leftKey),
      optionIndex(second.rightKey),
      String(first.mode) as JoinMode,
    );
    addDerived(s, `${left.name} + ${right.name}`, "joined", data);
  });
}
