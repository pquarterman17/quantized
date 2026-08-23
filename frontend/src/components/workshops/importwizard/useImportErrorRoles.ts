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
import { seedErrorRows, type WizardErrorRow } from "../../../lib/importwizard";
import type { ImportPreviewColumn } from "../../../lib/types";

export interface ImportErrorRolesState {
  errorRows: WizardErrorRow[];
  setErrorTarget: (channel: number, target: number | null) => void;
  setErrorAxis: (channel: number, axis: "x" | "y") => void;
  setErrorSide: (channel: number, side: ErrorBinding["side"]) => void;
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

export function useImportErrorRoles(columns: ImportPreviewColumn[]): ImportErrorRolesState {
  const [rows, setRows] = useState<WizardErrorRow[]>([]);
  // `null` forces the NEXT effect run to reseed regardless of what the
  // signature turns out to be (resetErrorRows sets this) — the effect
  // itself re-runs on every `columns` REFERENCE change (every re-preview,
  // including one that leaves roles/names alone), but only actually
  // reseeds when the VALUE signature differs from the last one it saw, so
  // a user's explicit edit survives a reference-only change.
  const prevSignature = useRef<string | null>(null);

  useEffect(() => {
    const sig = signatureOf(columns);
    if (sig === prevSignature.current) return;
    prevSignature.current = sig;
    setRows(columns.length ? seedErrorRows(columns) : []);
  }, [columns]);

  function patch(channel: number, p: Partial<WizardErrorRow>): void {
    setRows((rs) => rs.map((r) => (r.channel === channel ? { ...r, ...p } : r)));
  }

  return {
    errorRows: rows,
    setErrorTarget: (channel, target) => patch(channel, { target }),
    setErrorAxis: (channel, axis) => patch(channel, { axis }),
    setErrorSide: (channel, side) => patch(channel, { side }),
    resetErrorRows: () => {
      prevSignature.current = null;
      setRows([]);
    },
  };
}
