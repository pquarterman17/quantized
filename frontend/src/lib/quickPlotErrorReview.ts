// Quick Plot's error-pairing REVIEW -- the lazy half of store/quickPlotRun.ts.
// Grades the dataset's seeded pairings (lib/errorBindingConfidence.ts): a
// unit-`blocked` one is withheld without being offered, and each
// adjacency-only (`low`) one is asked about, offered UNTICKED -- the plan's
// "adjacency alone is insufficient", so applying it takes a deliberate yes.

import { askParams } from "../store/paramDialog";
import { useApp } from "../store/useApp";
import { reviewSeedErrorBindings } from "./errorBindingConfidence";
import { figureSeedErrorBindings, type ErrorBinding } from "./errorRoles";
import type { ParamField } from "./params";
import type { DataStruct, Dataset } from "./types";

/** `"err" → "R"` / `"xerr" → the X axis`: how a pairing reads in a prompt. */
export function describePairing(data: DataStruct, b: ErrorBinding): string {
  const name = (ch: number) => `"${data.labels[ch] ?? `col ${ch}`}"`;
  return `${name(b.channel)} → ${b.target < 0 ? "the X axis" : name(b.target)}`;
}

/** Review `dataset`'s seeded pairings and, unless the user cancels the
 *  question, `create` the figure with what to leave out (store/quickPlotRun.ts's
 *  callback: true when a figure was made). A unit-blocked pairing is named on
 *  the status line after creation. */
export async function reviewQuickPlotPairings(
  dataset: Dataset,
  create: (withhold: readonly ErrorBinding[]) => boolean,
): Promise<void> {
  const review = reviewSeedErrorBindings(dataset);
  const kept = new Set([...review.apply, ...review.confirm].map((b) => b.channel));
  const withhold = figureSeedErrorBindings(dataset).filter((b) => !kept.has(b.channel));
  if (review.confirm.length > 0) {
    const fields: ParamField[] = review.confirm.map((b, i) => ({
      key: `pair${i}`,
      label: `Use ${describePairing(dataset.data, b)} as error bars`,
      type: "boolean",
      default: false,
      hint: "Only column position pairs these columns; no name or unit confirms it.",
    }));
    const answer = await askParams("Confirm suggested error bars", fields);
    if (!answer) {
      useApp.setState({ status: "Quick Plot cancelled: no figure was created" });
      return;
    }
    withhold.push(...review.confirm.filter((_, i) => answer[`pair${i}`] !== true));
  }
  if (create(withhold) && review.blocked.length > 0) {
    const names = review.blocked.map((b) => describePairing(dataset.data, b)).join(", ");
    useApp.setState((s) => ({ status: `${s.status}; ${names} not paired: units contradict` }));
  }
}
