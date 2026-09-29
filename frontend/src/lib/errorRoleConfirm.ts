// A user's explicit DECISION about an error pairing, made durable. Confirming
// an adjacency-only pairing (the Quick Figure Builder's "Use as error bars" or
// any explicit error-role assignment there, a ticked box in Quick Plot's
// question, an Inspector error-role edit or confirm) adds it to the dataset's
// `metadata.error_roles` -- the P1.6 error-binding contract a parser or import
// filter already writes (`lib/importTypes.ts`'s `ImportErrorBindingWire`). No
// new field: `errorRoles.isDeclaredBinding` reads that list, so the confidence
// grade (lib/errorBindingConfidence.ts) never asks about it again, and it
// travels with the DataStruct through `.dwk` save/reopen.
//
// Declining is NOT recorded: an unticked box or a Cancel writes nothing, so the
// question comes back next time. Removing a binding in the Inspector withdraws
// a recorded confirmation for that column (`withdrawErrorBindingConfirmation`).
//
// LAZY (every caller is a lazy surface). Plain `set()`s with no history entry
// of their own, so each write rides the caller's undo unit (the figure's
// `createWindow`, or the Inspector's `setErrorRoles`).

import { useApp } from "../store/useApp";
import { reviewSeedErrorBindings } from "./errorBindingConfidence";
import { sanitizeBindings, type ErrorBinding } from "./errorRoles";
import type { Dataset } from "./types";

function writeDeclared(datasetId: string, next: (current: ErrorBinding[]) => ErrorBinding[]): void {
  useApp.setState((s) => ({
    datasets: s.datasets.map((d): Dataset => {
      if (d.id !== datasetId) return d;
      const current = sanitizeBindings(d.data.metadata?.["error_roles"], d.data.labels.length) ?? [];
      return { ...d, data: { ...d.data, metadata: { ...d.data.metadata, error_roles: next(current) } } };
    }),
  }));
}

/** Record `bindings` as confirmed on `datasetId` (replacing any earlier
 *  declaration for the same error column). A no-op for an empty list. */
export function confirmErrorBindings(datasetId: string, bindings: readonly ErrorBinding[]): void {
  if (bindings.length === 0) return;
  const channels = new Set(bindings.map((b) => b.channel));
  writeDeclared(datasetId, (current) => [
    ...current.filter((b) => !channels.has(b.channel)),
    ...bindings.map(({ channel, target, axis, side }) => ({ channel, target, axis, side })),
  ]);
}

/** Withdraw any recorded declaration for error column `channel`. */
export function withdrawErrorBindingConfirmation(datasetId: string, channel: number): void {
  const ds = useApp.getState().datasets.find((d) => d.id === datasetId);
  const current = ds && sanitizeBindings(ds.data.metadata?.["error_roles"], ds.data.labels.length);
  if (!current?.some((b) => b.channel === channel)) return;
  writeDeclared(datasetId, (list) => list.filter((b) => b.channel !== channel));
}

/** The Quick Figure Builder's commit: every pairing the grade would have asked
 *  about that the user nonetheless put in the created figure's mapping (via
 *  "Use as error bars" or an explicit error-role assignment) is confirmed. */
export function confirmAppliedPairings(dataset: Dataset, applied: readonly ErrorBinding[]): void {
  const asked = reviewSeedErrorBindings(dataset).confirm;
  confirmErrorBindings(
    dataset.id,
    asked.filter((s) => applied.some((b) => b.channel === s.channel && b.target === s.target && b.axis === s.axis && b.side === s.side)),
  );
}
