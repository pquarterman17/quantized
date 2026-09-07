// Import wizard (P1.6 item 2) — error-role assignment sub-state, split out of
// useImportWizard.ts to keep that hook under the ~400-line ceiling (the
// workshop pattern: state hook + view + sub-components; this is a second,
// narrower state hook rather than a Zustand slice because — like the REST of
// useImportWizard's state (columns/filters/preview) — it is scoped entirely
// to one open wizard session, never read outside this workshop, and is
// naturally reset by the wizard's own unmount-on-close (AppOverlays.tsx only
// mounts ImportWizardPanel while importWizardOpen).
//
// One WizardErrorRow per `error`-role column (lib/importwizard.errorRoleChannels),
// seeded from the SAME name-based suggestion the rest of the app uses
// (lib/importwizard.seedErrorRows -> errorRoles.inferErrorBindingsFromLabels).
// `target: null` means UNASSIGNED — never a guessed fallback ("no guess can
// silently attach error to the wrong signal", P1.6 item 2): only rows the
// user has explicitly assigned (target !== null) become real ErrorBindings.
//
// RESEED POLICY: rows reseed to a fresh suggestion whenever the underlying
// role/name ARRANGEMENT changes (a column's role or name edit, or a new file/
// filter) — tracked via a `role:name` signature string — but persist across
// every other re-preview (e.g. a delimiter/line-index tweak that leaves roles
// and names alone), so a user's explicit target/axis/side choice survives the
// debounced round-trips those edits still trigger.

import { useEffect, useRef, useState } from "react";

import type { ErrorBinding } from "../../../lib/errorRoles";
import { errorRoleChannels, finalChannelOrder, seedErrorRows, type WizardErrorRow } from "../../../lib/importwizard";
import type { ImportErrorBindingWire, ImportPreviewColumn } from "../../../lib/types";

const NO_BINDINGS: ImportErrorBindingWire[] = [];

export interface ImportErrorRolesState {
  errorRows: WizardErrorRow[];
  setErrorTarget: (channel: number, target: number | null) => void;
  setErrorAxis: (channel: number, axis: "x" | "y", remember?: boolean) => void;
  setErrorSide: (channel: number, side: ErrorBinding["side"]) => void;
  resetErrorEdits: () => void;
  resetErrorRows: () => void;
}

function signatureOf(columns: readonly ImportPreviewColumn[]): string {
  // P1-5 DEFECT 2: include `effective_name` (falling back to `name`) too --
  // seedErrorRows classifies against the EFFECTIVE name (lib/importwizard.
  // finalChannelOrder), so a label_line edit that changes effective_name
  // without touching the raw header name is a real arrangement change and
  // must reseed, not persist a suggestion computed against a stale name.
  return columns.map((c) => `${c.role}:${c.name}:${c.effective_name ?? c.name}`).join("|");
}

function seedFromWire(
  columns: ImportPreviewColumn[],
  confirmed: readonly ImportErrorBindingWire[],
  suggested: readonly ImportErrorBindingWire[],
  allowSuggestions: boolean,
): WizardErrorRow[] {
  const fallback = allowSuggestions ? seedErrorRows(columns) : errorRoleChannels(columns).map((column) => ({
    channel: column.channel,
    label: column.label,
    target: null,
    axis: "y" as const,
    side: "both" as const,
    provenance: "unassigned" as const,
    preferredAxis: null,
  }));
  const channels = finalChannelOrder(columns);
  const rawToChannel = new Map(channels.map((c) => [c.sourceIndex, c.channel]));
  return errorRoleChannels(columns).map((errorColumn) => {
    const binding = confirmed.find((b) => b.column === errorColumn.sourceIndex)
      ?? (allowSuggestions ? suggested.find((b) => b.column === errorColumn.sourceIndex) : undefined);
    const target = binding?.target === -1 ? -1 : rawToChannel.get(binding?.target ?? Number.NaN);
    if (!binding || target === undefined) {
      return fallback.find((row) => row.channel === errorColumn.channel)!;
    }
    return {
      channel: errorColumn.channel,
      label: errorColumn.label,
      target,
      axis: binding.axis,
      side: binding.side,
      provenance: confirmed.includes(binding) ? "confirmed" : "suggested",
      preferredAxis: binding.target === -1 ? null : binding.axis,
    };
  });
}

export function useImportErrorRoles(
  columns: ImportPreviewColumn[],
  confirmed: readonly ImportErrorBindingWire[] = NO_BINDINGS,
  suggested: readonly ImportErrorBindingWire[] = NO_BINDINGS,
  allowSuggestions = true,
): ImportErrorRolesState {
  const [rows, setRows] = useState<WizardErrorRow[]>([]);
  const [revision, setRevision] = useState(0);
  // `null` forces the NEXT effect run to reseed regardless of what the
  // signature turns out to be (resetErrorRows sets this) — the effect
  // itself re-runs on every `columns` REFERENCE change (every re-preview,
  // including one that leaves roles/names alone), but only actually
  // reseeds when the VALUE signature differs from the last one it saw, so
  // a user's explicit edit survives a reference-only change.
  const prevArrangement = useRef<string | null>(null);
  const prevWire = useRef<string | null>(null);
  const editedChannels = useRef(new Set<number>());

  useEffect(() => {
    const arrangement = signatureOf(columns);
    const wire = `${JSON.stringify(confirmed)}::${JSON.stringify(suggested)}::${allowSuggestions}`;
    if (arrangement === prevArrangement.current && wire === prevWire.current) return;
    const arrangementChanged = arrangement !== prevArrangement.current;
    prevArrangement.current = arrangement;
    prevWire.current = wire;
    if (arrangementChanged) editedChannels.current.clear();
    const seeded = columns.length ? seedFromWire(columns, confirmed, suggested, allowSuggestions) : [];
    setRows((current) => arrangementChanged ? seeded.map((row) => {
      // A suggestion persisted for settings parity is not promoted into an
      // explicit binding merely because the backend echoes it as confirmed.
      // Re-evaluate it when names/roles change, so a now-ambiguous guess is
      // removed from both the row and settings by the reconciliation effect.
      const previous = current.find((item) => item.channel === row.channel);
      if (previous?.provenance !== "suggested") return row;
      return seedFromWire(columns, [], suggested, allowSuggestions)
        .find((item) => item.channel === row.channel) ?? row;
    }) : seeded.map((row) => {
      const previous = current.find((item) => item.channel === row.channel);
      const sameSuggestedValue = previous?.provenance === "suggested"
        && previous.target === row.target
        && previous.axis === row.axis
        && previous.side === row.side;
      return editedChannels.current.has(row.channel) || sameSuggestedValue ? previous ?? row : row;
    }));
  }, [columns, confirmed, suggested, allowSuggestions, revision]);

  function patch(channel: number, p: Partial<WizardErrorRow>): void {
    editedChannels.current.add(channel);
    setRows((rs) => rs.map((r) => (
      r.channel === channel ? { ...r, ...p, provenance: "manual" } : r
    )));
  }

  return {
    errorRows: rows,
    setErrorTarget: (channel, target) => patch(channel, { target }),
    setErrorAxis: (channel, axis, remember = true) => patch(
      channel,
      { axis, ...(remember ? { preferredAxis: axis } : {}) },
    ),
    setErrorSide: (channel, side) => patch(channel, { side }),
    resetErrorEdits: () => {
      editedChannels.current.clear();
      prevArrangement.current = null;
      prevWire.current = null;
      setRows([]);
      setRevision((value) => value + 1);
    },
    resetErrorRows: () => {
      prevArrangement.current = null;
      prevWire.current = null;
      editedChannels.current.clear();
      setRows([]);
    },
  };
}
