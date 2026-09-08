// Import wizard (P1.6 item 2) — error-BINDING state, split out of
// useImportWizard.ts to keep that hook under the general .ts module ceiling
// (architecture.test.ts). Pairs with useImportErrorRoles.ts: that hook owns the
// editor ROWS (one per `error`-role column, seeded from the backend's confirmed
// + suggested bindings); THIS hook owns the reconciliation between those rows
// and the `error_bindings` array actually sent to the backend and written into
// saved filters, plus every action that edits either side.
//
// The invariant it enforces, in one place rather than per action: for a column
// the editor represents, the ROW is authoritative. Anything else lets the
// controls the user is looking at disagree with what Import and "Save as
// filter…" persist.

import { useEffect, useState } from "react";

import type { ErrorBinding } from "../../../lib/errorRoles";
import {
  finalChannelOrder,
  withRole,
  type WizardErrorRow,
} from "../../../lib/importwizard";
import type {
  ImportErrorBindingProblem,
  ImportErrorBindingWire,
  ImportPreviewColumn,
  ImportPreviewResponse,
  ImportSettingsWire,
} from "../../../lib/types";
import { useImportErrorRoles } from "./useImportErrorRoles";

const NO_ERROR_BINDINGS: ImportErrorBindingWire[] = [];

export interface ImportErrorBindingsState {
  /** P1.6 item 2: one row per `error`-role column, editable target/axis/side. */
  errorRows: WizardErrorRow[];
  setErrorTarget: (channel: number, target: number | null) => void;
  setErrorAxis: (channel: number, axis: "x" | "y") => void;
  setErrorSide: (channel: number, side: ErrorBinding["side"]) => void;
  applyErrorSuggestion: (binding: ImportErrorBindingWire) => void;
  removeRejectedErrorBinding: (problem: ImportErrorBindingProblem) => void;
  /** Suppress name-based suggestions — set false whenever the settings in play
   *  carry an EXPLICIT `error_bindings` array (a saved filter, or a guess that
   *  already resolved them), so a stored "no bindings" decision is not
   *  re-guessed back into existence. */
  setAllowSuggestions: (allow: boolean) => void;
  resetErrorEdits: () => void;
  resetErrorRows: () => void;
}

export interface ImportErrorBindingsInput {
  columns: ImportPreviewColumn[];
  setColumns: (update: (current: ImportPreviewColumn[]) => ImportPreviewColumn[]) => void;
  settings: ImportSettingsWire | null;
  setSettings: (
    update: (current: ImportSettingsWire | null) => ImportSettingsWire | null,
  ) => void;
  patchSettings: (patch: Partial<ImportSettingsWire>) => void;
  preview: ImportPreviewResponse | null;
}

export function useImportErrorBindings({
  columns,
  setColumns,
  settings,
  setSettings,
  patchSettings,
  preview,
}: ImportErrorBindingsInput): ImportErrorBindingsState {
  const [allowErrorSuggestions, setAllowErrorSuggestions] = useState(true);
  const {
    errorRows,
    applyErrorRow,
    setErrorTarget: setErrorTargetLocal,
    setErrorAxis: setErrorAxisLocal,
    setErrorSide: setErrorSideLocal,
    resetErrorEdits,
    resetErrorRows,
  } =
    useImportErrorRoles(
      columns,
      preview?.error_bindings ?? NO_ERROR_BINDINGS,
      preview?.suggested_error_bindings ?? NO_ERROR_BINDINGS,
      allowErrorSuggestions,
    );

  // For columns represented by the editor, rows are authoritative: add,
  // replace, AND prune bindings so Import and saved filters cannot drift from
  // what the controls show. A binding the BACKEND rejected is left exactly as
  // it is, whether or not its column resolves here, until the user dismisses
  // the alert that names it: reconciling it away would delete the evidence
  // behind a visible problem, leave "Remove invalid setting" with nothing to
  // remove, and — for a saved filter — silently discard a pairing the user
  // never acknowledged. Reporting these instead of dropping them quietly is
  // the whole reason `error_binding_problems` carries a reason per entry.
  useEffect(() => {
    if (!columns.length) return;
    const order = finalChannelOrder(columns);
    const rawByChannel = new Map(order.map((item) => [item.channel, item.sourceIndex]));
    const channelByRaw = new Map(order.map((item) => [item.sourceIndex, item.channel]));
    // Compare the channel SET, not the count: re-roling a preceding `y` column
    // to `ignore` renumbers channels while the count stays equal, and the
    // stale rows would then be written against the new numbering (a plain y
    // column persisted as an error column). It self-corrects on the next
    // commit, but `settings` is read synchronously by `doImport`/
    // `saveAsFilter`, so a click landing in that window persists the wrong
    // pairing.
    const errorChannels = order
      .filter((item) => columns.find((c) => c.index === item.sourceIndex)?.role === "error")
      .map((item) => item.channel);
    const rowChannels = errorRows.map((row) => row.channel);
    if (
      errorChannels.length !== rowChannels.length
      || errorChannels.some((channel, i) => channel !== rowChannels[i])
    ) {
      return;
    }
    const rejectedColumns = new Set(
      (preview?.error_binding_problems ?? []).map((problem) => problem.column),
    );
    setSettings((current) => {
      if (!current) return current;
      const next: ImportErrorBindingWire[] = [];
      const emitted = new Set<number>();
      for (const binding of current.error_bindings ?? []) {
        const source = columns.find((column) => column.index === binding.column);
        if (!source || rejectedColumns.has(binding.column)) {
          next.push(binding);
          emitted.add(binding.column);
          continue;
        }
        const channel = channelByRaw.get(binding.column);
        const row = errorRows.find((item) => item.channel === channel);
        if (source.role !== "error" || !row || row.target === null || emitted.has(binding.column)) continue;
        const target = row.target === -1 ? -1 : rawByChannel.get(row.target);
        if (target === undefined) continue;
        next.push({ column: binding.column, target, axis: row.axis, side: row.side });
        emitted.add(binding.column);
      }
      for (const row of errorRows) {
        if (row.target === null) continue;
        const column = rawByChannel.get(row.channel);
        const target = row.target === -1 ? -1 : rawByChannel.get(row.target);
        if (column === undefined || target === undefined) continue;
        if (emitted.has(column)) continue;
        next.push({ column, target, axis: row.axis, side: row.side });
        emitted.add(column);
      }
      return JSON.stringify(next) === JSON.stringify(current.error_bindings ?? [])
        ? current
        : { ...current, error_bindings: next };
    });
  }, [columns, errorRows, preview, setSettings]);

  function applyErrorSuggestion(binding: ImportErrorBindingWire): void {
    if (!settings || !columns.length) return;
    const position = columns.findIndex((column) => column.index === binding.column);
    if (position < 0) return;
    setColumns((current) => current.map((column, i) => (
      i === position ? { ...column, role: "error" as const } : column
    )));
    patchSettings({
      roles: withRole(columns, position, "error"),
      error_bindings: [
        ...(settings.error_bindings ?? []).filter((item) => item.column !== binding.column),
        binding,
      ],
    });
    // The reconciliation effect treats the editor ROW as authoritative, so
    // writing only the settings makes Apply a NO-OP whenever suggestions are
    // not being seeded (any file opened through a saved filter that carries an
    // explicit `error_bindings` array): the role change reseeds the rows, this
    // column's fresh row is `unassigned` because suggestions are suppressed,
    // and the effect prunes the binding straight back out one render later --
    // before the debounced re-preview is even sent. `applyErrorRow` writes the
    // ROW too, in raw column indices so it survives the channel renumbering
    // the role change causes.
    applyErrorRow(binding.column, {
      target: binding.target,
      axis: binding.axis,
      side: binding.side,
    });
  }

  function persistErrorRow(channel: number, patch: Partial<WizardErrorRow>): void {
    if (!settings) return;
    const row = errorRows.find((item) => item.channel === channel);
    const source = finalChannelOrder(columns).find((item) => item.channel === channel);
    if (!row || !source) return;
    const next = { ...row, ...patch };
    const bindings = settings.error_bindings ?? [];
    const currentIndex = bindings.findIndex((item) => item.column === source.sourceIndex);
    if (next.target === null) {
      patchSettings({ error_bindings: bindings.filter((_, index) => index !== currentIndex) });
      return;
    }
    const target = next.target === -1
      ? -1
      : finalChannelOrder(columns).find((item) => item.channel === next.target)?.sourceIndex;
    if (target === undefined) return;
    const binding = {
      column: source.sourceIndex,
      target,
      axis: next.axis,
      side: next.side,
    };
    patchSettings({
      error_bindings: currentIndex < 0
        ? [...bindings, binding]
        : bindings.map((item, index) => index === currentIndex ? binding : item),
    });
  }

  function setErrorTarget(channel: number, target: number | null): void {
    const current = errorRows.find((row) => row.channel === channel);
    setErrorTargetLocal(channel, target);
    // The backend contract reserves target -1 for the x axis and rejects it
    // unless axis is also x. Keep the visible editor and persisted binding
    // valid in the same interaction instead of waiting for a rejected preview.
    const axis = target === -1 ? "x" : target !== null ? current?.preferredAxis ?? "y" : undefined;
    if (axis) setErrorAxisLocal(channel, axis, false);
    persistErrorRow(channel, { target, ...(axis ? { axis } : {}) });
  }

  function removeRejectedErrorBinding(problem: ImportErrorBindingProblem): void {
    if (!settings) return;
    const bindings = settings.error_bindings ?? [];
    let removeIndex = bindings.findIndex((binding) => (
      binding.column === problem.column
      && binding.target === problem.target
      && binding.axis === problem.axis
      && binding.side === problem.side
    ));
    if (removeIndex < 0 && problem.code === "malformed_entry") {
      // A malformed entry is echoed back with `-1`/`""` placeholders for the
      // fields that could not be parsed, so the exact-tuple match above never
      // hits. Match by POSITION among the shape-invalid entries instead of
      // taking the first one: with two unparseable entries, clicking the
      // second alert must not delete the first and leave the clicked alert
      // standing. The backend emits one problem per entry in settings order,
      // so the nth malformed problem is the nth shape-invalid binding.
      const invalid = bindings
        .map((binding, index) => ({ binding, index }))
        .filter(({ binding }) => {
          const raw = binding as unknown as Record<string, unknown>;
          return !Number.isInteger(raw.column)
            || !Number.isInteger(raw.target)
            || (raw.axis !== "x" && raw.axis !== "y")
            || (raw.side !== "both" && raw.side !== "+" && raw.side !== "-");
        });
      const problems = (preview?.error_binding_problems ?? [])
        .filter((item) => item.code === "malformed_entry");
      const rank = problems.indexOf(problem);
      removeIndex = invalid[rank >= 0 ? rank : 0]?.index ?? -1;
    }
    if (removeIndex < 0) return;
    patchSettings({
      error_bindings: bindings.filter((_, index) => index !== removeIndex),
    });
  }

  function setErrorAxis(channel: number, axis: "x" | "y"): void {
    setErrorAxisLocal(channel, axis);
    persistErrorRow(channel, { axis });
  }

  function setErrorSide(channel: number, side: ErrorBinding["side"]): void {
    setErrorSideLocal(channel, side);
    persistErrorRow(channel, { side });
  }

  return {
    errorRows,
    setErrorTarget,
    setErrorAxis,
    setErrorSide,
    applyErrorSuggestion,
    removeRejectedErrorBinding,
    setAllowSuggestions: setAllowErrorSuggestions,
    resetErrorEdits,
    resetErrorRows,
  };
}
