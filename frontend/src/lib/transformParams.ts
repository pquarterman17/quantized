/** Defensive decoder for persisted Pipeline Studio transform steps. */

import { metaParamsOf } from "./metadataRun";
import { signalTransformParamsOf } from "./signalTransform";
import type { TransformParams, DatasetRef } from "./transformRun";
import { resampleParamsOf } from "./transformResample";
import { simsParamsOf } from "./transformSims";
import { simsCompareParamsOf } from "./transformSimsCompare";
import type { AggregateMode, JoinMode } from "./worksheetTransforms";
import type { JoinKey, JoinKeyMode } from "./worksheetJoin";

const OPS = new Set([
  "transpose", "stack", "unstack", "join", "merge", "algebra", "split",
  "resample", "sims", "simscompare", "signal", "promote", "metaclean",
]);

/** Validate a recorded transform step (editable .dwk/template JSON). */
export function transformParamsOf(raw: Record<string, unknown>): TransformParams {
  const op = String(raw.op ?? "");
  if (!OPS.has(op)) throw new Error(`unknown transform "${op}"`);
  const num = (key: string): number => {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new Error(`transform "${op}" needs an integer "${key}"`);
    }
    return value;
  };
  const ref = (value: unknown): DatasetRef => {
    const item = (value ?? {}) as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id) {
      throw new Error(`transform "${op}" has no recorded second input`);
    }
    return { id: item.id, name: typeof item.name === "string" ? item.name : item.id };
  };
  switch (op) {
    case "transpose": return { op };
    case "stack": {
      const channels = raw.channels;
      if (!Array.isArray(channels) || !channels.length || !channels.every((item) => Number.isInteger(item))) {
        throw new Error('transform "stack" needs integer "channels"');
      }
      return { op, channels: channels as number[] };
    }
    case "unstack": {
      const aggregate = String(raw.aggregate ?? "mean");
      if (!["mean", "first", "last"].includes(aggregate)) throw new Error(`unknown aggregate "${aggregate}"`);
      return {
        op,
        key: num("key"),
        category: num("category"),
        value: num("value"),
        aggregate: aggregate as AggregateMode,
      };
    }
    case "join": {
      const mode = String(raw.mode ?? "inner");
      if (!["inner", "left", "right", "full"].includes(mode)) throw new Error(`unknown join mode "${mode}"`);
      const key = (name: string): JoinKey => typeof raw[name] === "string" && raw[name]
        ? raw[name] as string
        : num(name);
      const rawKeyMode = raw.keyMode;
      const keyMode = rawKeyMode === "text" || rawKeyMode === "code" ? rawKeyMode : undefined;
      return {
        op,
        leftKey: key("leftKey"),
        rightKey: key("rightKey"),
        mode: mode as JoinMode,
        ...(keyMode ? { keyMode: keyMode as JoinKeyMode } : {}),
        with: ref(raw.with),
      };
    }
    case "merge": {
      if (!Array.isArray(raw.with) || !raw.with.length) throw new Error('transform "merge" has no recorded inputs');
      const match = String(raw.match ?? "position");
      if (match !== "position" && match !== "name") throw new Error(`unknown append match "${match}"`);
      const sourceFactor = typeof raw.sourceFactor === "string" && raw.sourceFactor.trim()
        ? { sourceFactor: raw.sourceFactor }
        : {};
      return { op, with: raw.with.map(ref), ...(match === "name" ? { match } : {}), ...sourceFactor };
    }
    case "algebra":
      return {
        op,
        operation: String(raw.operation ?? ""),
        interp: String(raw.interp ?? "pchip"),
        with: ref(raw.with),
      };
    case "resample": return resampleParamsOf(raw);
    case "sims": return simsParamsOf(raw);
    case "simscompare": return simsCompareParamsOf(raw);
    case "signal": return signalTransformParamsOf(raw);
    case "promote":
    case "metaclean":
      return metaParamsOf(raw);
    default: {
      const tolerance = raw.tolerance;
      return {
        op: "split",
        col: num("col"),
        tolerance: typeof tolerance === "number" && Number.isFinite(tolerance) ? tolerance : null,
      };
    }
  }
}
