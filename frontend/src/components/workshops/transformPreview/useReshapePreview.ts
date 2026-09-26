// Reshape & combine workshop — state hook (audit P2.5, "previewed append,
// keyed join, reshape"). The op and its fields are previewed LIVE through
// `computeTransform` (lib/transformRun.ts) — the SAME function the commit and
// the pipeline replay run — debounced, and nothing is added to the workspace
// until Create. Create then runs `runTransform` with the same params: one
// undo entry, provenance and warnings stamped into the metadata, and one
// recorded, replayable `transform` step.
//
// Create is disabled while the preview is stale (an edit, or a changed input
// dataset, since the last preview), and a unit mismatch keeps it disabled
// until the explicit acknowledgment for THIS form is ticked. When the commit
// computes different warnings than were previewed — a still-loading Origin
// book whose full rows arrive at Create — it falls back to the review dialog
// rather than creating silently.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  computeTransform,
  reviewTransform,
  runTransform,
  type TransformComputed,
  type TransformPreview,
} from "../../../lib/transformRun";
import { needsConfirm } from "../../../lib/transformWarnings";
import type { Dataset } from "../../../lib/types";
import { toast } from "../../../store/toasts";
import { useTransformPreviewDialog } from "../../../store/transformPreviewDialog";
import { useApp } from "../../../store/useApp";
import { formToRun, seedForm, type TransformForm } from "./transformForm";

/** Debounce between an edit and the preview. */
export const PREVIEW_DELAY_MS = 150;

interface Preview {
  key: string;
  computed?: TransformComputed;
  error?: string;
}

export interface ReshapeState {
  datasets: Dataset[];
  form: TransformForm;
  setForm: (patch: Partial<TransformForm>) => void;
  /** Why the form cannot be previewed yet, if it cannot. */
  formError: string | null;
  loading: boolean;
  computed: TransformComputed | null;
  error: string | null;
  /** An input is a still-loading book: the preview is counted on its loaded
   *  preview rows, and Create resolves the full data first. */
  previewOnly: boolean;
  blockedByUnits: boolean;
  unitsAcknowledged: boolean;
  setUnitsAcknowledged: (ok: boolean) => void;
  canCreate: boolean;
  busy: boolean;
  commitError: string | null;
  create: () => Promise<void>;
  close: () => void;
}

const message = (e: unknown, fallback: string): string => (e instanceof Error ? e.message : fallback);

// A dataset's identity token: the store replaces a Dataset object on every
// edit (data, exclusions, filters), so a new object = possibly new rows.
const tokens = new WeakMap<Dataset, number>();
let nextToken = 0;
function tokenOf(ds: Dataset): number {
  let t = tokens.get(ds);
  if (t === undefined) {
    t = ++nextToken;
    tokens.set(ds, t);
  }
  return t;
}

/** The warnings the commit may create without asking again: exactly the
 *  sentences that were previewed (and acknowledged, for a unit mismatch). */
function samePreview(a: TransformPreview, b: TransformPreview): boolean {
  const ta = a.warnings.map((w) => w.text);
  const tb = b.warnings.map((w) => w.text);
  return ta.length === tb.length && ta.every((t, i) => t === tb[i]);
}

export function useReshapePreview(): ReshapeState {
  const op = useTransformPreviewDialog((s) => s.op);
  const seed = useTransformPreviewDialog((s) => s.seed);
  const close = useTransformPreviewDialog((s) => s.close);
  const datasets = useApp((s) => s.datasets);
  const [form, setFormState] = useState<TransformForm>(() => seedForm(op ?? "merge", seed, datasets));
  const [preview, setPreview] = useState<Preview>({ key: "" });
  const [ackFor, setAckFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const run = useMemo(() => formToRun(form, datasets), [form, datasets]);
  const inputs = useMemo(
    () =>
      typeof run === "string"
        ? []
        : [run.primaryId, ...run.otherIds].flatMap((id) => datasets.find((d) => d.id === id) ?? []),
    [run, datasets],
  );
  // Everything the preview depends on: the params and every input's data (by
  // object identity — `tokenOf`).
  const key = useMemo(
    () => (typeof run === "string" ? "" : JSON.stringify([run.params, inputs.map((d) => [d.id, tokenOf(d)])])),
    [run, inputs],
  );

  // Re-run when the KEY changes, not whenever an unrelated store change hands
  // `run`/`inputs` a new identity. The inputs are read from a ref.
  const latest = useRef({ run, inputs });
  useEffect(() => {
    latest.current = { run, inputs };
  });
  useEffect(() => {
    const { run, inputs } = latest.current;
    if (typeof run === "string" || !inputs.length) return;
    let live = true;
    const timer = setTimeout(() => {
      const [primary, ...others] = inputs;
      computeTransform(run.params, primary, others).then(
        (computed) => { if (live) setPreview({ key, computed }); },
        (e: unknown) => { if (live) setPreview({ key, error: message(e, "the transform failed") }); },
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);

  const fresh = preview.key === key && key !== "";
  const computed = fresh ? (preview.computed ?? null) : null;
  const unitsAcknowledged = ackFor === key && key !== "";
  const blockedByUnits = !!computed && needsConfirm(computed.preview.warnings) && !unitsAcknowledged;

  function setForm(patch: Partial<TransformForm>): void {
    setCommitError(null);
    setFormState((f) => {
      const next = { ...f, ...patch };
      // A new primary dataset has different columns: re-seed its fields.
      if (patch.primary !== undefined && patch.primary !== f.primary) {
        const fresh = seedForm(f.op, [patch.primary, f.right], datasets);
        return { ...next, channels: fresh.channels, key: fresh.key, category: fresh.category, value: fresh.value, leftKey: "-1" };
      }
      if (patch.right !== undefined && patch.right !== f.right) return { ...next, rightKey: "-1" };
      return next;
    });
  }

  async function create(): Promise<void> {
    if (typeof run === "string" || !computed || blockedByUnits) return;
    const previewed = computed.preview;
    setBusy(true);
    setCommitError(null);
    try {
      const out = await runTransform(useApp.getState, run.params, run.primaryId, (pv) =>
        samePreview(pv, previewed) ? Promise.resolve(true) : reviewTransform(pv),
      );
      if (out) {
        toast(`created ${out.name}`, "ok");
        close();
      }
    } catch (e) {
      setCommitError(`not created — ${message(e, "the transform failed")}`);
    } finally {
      setBusy(false);
    }
  }

  return {
    datasets,
    form,
    setForm,
    formError: typeof run === "string" ? run : null,
    loading: key !== "" && !fresh,
    computed,
    error: fresh ? (preview.error ?? null) : null,
    previewOnly: inputs.some((d) => d.pending),
    blockedByUnits,
    unitsAcknowledged,
    setUnitsAcknowledged: (ok) => setAckFor(ok ? key : null),
    canCreate: !!computed && !blockedByUnits && !busy,
    busy,
    commitError,
    create,
    close,
  };
}
