// "Metadata → factors" workshop — state hook (audit P2.5, "metadata cleanup /
// promotion to factors"). Two jobs over one picked set of datasets:
//
//  - PROMOTE: pick a scalar metadata field (top level, or inside an instrument
//    sidecar) and add it as a per-row factor column. The plan
//    (lib/metadataFactor.planFactor) is recomputed on every edit and shown row
//    by row — the value each dataset's rows will get, and which datasets have
//    none (blank, reported, never defaulted) — before "Add factor column".
//  - CLEAN UP: the keys present across the picks with their coverage; merge
//    synonyms into one key and normalize values (trim, case, units). Each rule
//    joins a draft; every change the draft makes is previewed
//    (lib/metadataCleanup.planCleanup) before "Apply".
//
// Both commits are lib/metadataRun.ts (one undo entry, one recorded pipeline
// step). The preview and the commit plan with the SAME pure function; the
// commit re-plans on the full data, so a still-loading book is never
// committed from its preview.

import { useMemo, useState } from "react";

import { planCleanup, type CleanupPlan, type NormalizeRule, type UnifyRule } from "../../../lib/metadataCleanup";
import { planFactor, type FactorAs } from "../../../lib/metadataFactor";
import { keysAcross, pathFromId, pathId, type MetaKeyInfo } from "../../../lib/metadataKeys";
import { applyMetadataCleanup, promoteFactor } from "../../../lib/metadataRun";
import { toast } from "../../../store/toasts";
import { useMetaFactorsDialog } from "../../../store/metaFactorsDialog";
import { useApp } from "../../../store/useApp";

export type MetaTab = "promote" | "cleanup";

const message = (e: unknown): string => (e instanceof Error ? e.message : "failed");

export function useMetaFactors() {
  const seed = useMetaFactorsDialog((s) => s.seed);
  const datasets = useApp((s) => s.datasets);
  const [picked, setPicked] = useState<string[]>(() => (seed ?? []).filter((id) => datasets.some((d) => d.id === id)));
  const [tab, setTab] = useState<MetaTab>("promote");
  const [keyId, setKeyId] = useState("");
  const [as, setAs] = useState<FactorAs | "auto">("auto");
  const [name, setName] = useState<string | null>(null); // null = follow the key
  const [draft, setDraft] = useState<CleanupPlan>({ unify: [], normalize: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo(
    () => picked.flatMap((id) => datasets.find((d) => d.id === id) ?? []),
    [picked, datasets],
  );
  const keys: MetaKeyInfo[] = useMemo(() => keysAcross(targets), [targets]);
  // A key that no picked dataset carries any more falls back to the first.
  const key = keys.find((k) => pathId(k.path) === keyId) ?? keys[0] ?? null;
  const path = key?.path ?? null;
  const columnName = name ?? (path ? path[path.length - 1] : "");
  const plan = useMemo(() => (path ? planFactor(targets, path, as, columnName) : null), [targets, path, as, columnName]);
  const cleanup = useMemo(() => planCleanup(targets, draft), [targets, draft]);

  const togglePick = (id: string, on: boolean) => {
    setError(null);
    setPicked((p) => (on ? (p.includes(id) ? p : [...p, id]) : p.filter((x) => x !== id)));
  };

  async function commit(run: () => Promise<{ note: string }>, after: () => void): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const out = await run();
      toast(out.note, "ok");
      after();
    } catch (e) {
      setError(`not applied — ${message(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const promote = () =>
    plan && path && !plan.blocked
      ? commit(() => promoteFactor(useApp.getState, picked, path, plan.as, plan.name), () => setName(null))
      : Promise.resolve();

  const applyCleanup = () =>
    commit(() => applyMetadataCleanup(useApp.getState, picked, draft), () => setDraft({ unify: [], normalize: [] }));

  return {
    datasets,
    picked,
    togglePick,
    tab,
    setTab,
    keys,
    key,
    setKey: (id: string) => {
      setKeyId(id);
      setName(null);
      setError(null);
    },
    as,
    setAs,
    columnName,
    setName,
    plan,
    promote,
    draft,
    addUnify: (rule: UnifyRule) => setDraft((d) => ({ ...d, unify: [...d.unify, rule] })),
    addNormalize: (rule: NormalizeRule) => setDraft((d) => ({ ...d, normalize: [...d.normalize, rule] })),
    removeRule: (kind: keyof CleanupPlan, i: number) =>
      setDraft((d) => ({ ...d, [kind]: d[kind].filter((_, k) => k !== i) })),
    cleanup,
    applyCleanup,
    busy,
    error,
    close: () => useMetaFactorsDialog.setState({ seed: null }),
    pathFromId,
  };
}

export type MetaFactorsState = ReturnType<typeof useMetaFactors>;
