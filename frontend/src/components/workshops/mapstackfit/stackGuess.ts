// Guess the independent variable of each layer of a map stack: a numeric
// metadata value that differs between the maps (a temperature, a field, a
// time), else the number in the file names that varies from map to map.
// A guess only: the panel shows every value in an editable box.

import type { Dataset } from "../../../lib/types";

export interface LayerGuess {
  values: string[];
  /** Where the numbers came from, for the hint line. */
  source: "metadata" | "names" | "none";
  label: string;
}

const PREFERRED = /temp|field|time|bias|power|angle|dose|pressure|voltage|current/i;
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

const stem = (name: string): string => name.replace(/\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,5}$/, "");

function fromMetadata(layers: readonly Dataset[]): LayerGuess | null {
  const first = layers[0]?.data.metadata ?? {};
  const keys = Object.keys(first).filter((k) => layers.every((d) => typeof d.data.metadata?.[k] === "number" && Number.isFinite(d.data.metadata[k] as number)));
  const varying = keys.filter((k) => new Set(layers.map((d) => d.data.metadata[k])).size === layers.length);
  const key = varying.find((k) => PREFERRED.test(k));
  if (!key) return null;
  return { values: layers.map((d) => String(d.data.metadata[key])), source: "metadata", label: key };
}

function fromNames(layers: readonly Dataset[]): LayerGuess | null {
  const tokens = layers.map((d) => stem(d.name).match(NUMBER) ?? []);
  if (tokens.some((t) => t.length === 0)) return null;
  const sameCount = tokens.every((t) => t.length === tokens[0]!.length);
  let pos = -1;
  if (sameCount) {
    for (let i = 0; i < tokens[0]!.length; i++) if (new Set(tokens.map((t) => Number(t[i]))).size > 1) pos = i;
  }
  const values = tokens.map((t) => t[pos >= 0 ? pos : t.length - 1]!);
  if (new Set(values.map(Number)).size < 2) return null;
  return { values, source: "names", label: "the file names" };
}

export function guessLayerValues(layers: readonly Dataset[]): LayerGuess {
  // No layer at all (a CSV alone ticks no map): the panel shows its "needs 3 maps" text instead.
  if (layers.length === 0) return { values: layers.map(() => ""), source: "none", label: "" };
  return fromMetadata(layers) ?? fromNames(layers) ?? { values: layers.map(() => ""), source: "none", label: "" };
}
