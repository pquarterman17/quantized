// MACRO RECORDER + PIPELINE, extracted from store/useApp.ts (audit P4.1 —
// "decompose high-risk frontend god-modules, characterization tests first";
// store-size ratchet, MAIN_PLAN #2). Composed into the ONE useApp store
// instance exactly like ./plotViewSettings, ./reportsFigureDocs,
// ./viewAppliers and ./workspaceHydration — read store/windows.ts's header
// first: `useApp` spreads `createMacroPipelineSlice(set)` into the store, so
// every existing `useApp((s) => ...)` selector and
// `useApp.getState().recordMacro(...)` call keeps working. This file is a
// code boundary, not a second store.
//
// WHAT THIS MODULE OWNS: the macro recorder (`startMacro`/`stopMacro`
// arm/disarm the recorder; curated call sites throughout the store call
// `recordMacro` UNCONDITIONALLY — the gate on whether that actually appends
// a step, and the anti-self-recording-loop guard while a replay is in
// progress, both live here) and the editable pipeline view, #6
// (`updateStepParams`/`toggleStep`/`removeStep`/`moveStep`/`insertStep`/
// `loadSteps`/`setPipelineRunning`), over the SAME `macroSteps` list the
// recorder fills — one source of truth for the script export (the Inspector
// card) and the pipeline runner. This is a genuine own-state slice (mirrors
// store/gadget.ts's shape), not a shared-field mutator like
// store/corrections.ts: `macroRecording`/`macroSteps`/`pipelineRunning` are
// declared and initialized HERE, not on `AppState`'s own literal.
//
// Cohesion, confirmed by grep across store/*.ts before the move: nothing
// outside this cluster WRITES `macroRecording`/`macroSteps`/`pipelineRunning`
// except `store/workspaceHydration.ts`'s `loadWorkspace` (a bulk `.dwk`
// restore, `ws.macroSteps ?? []` — a plain-object-literal write, the same
// "bulk restores stay outside the cluster" shape every earlier P4.1 domain
// documents for its own fields, not a functional dependency on this slice).
//
// Undo-history contract: unlike every earlier P4.1 domain (PlotView writers,
// report/figure-doc lifecycle, bulk view appliers), NONE of these eleven
// actions call `get().recordHistory` or `toast(...)` — macro/pipeline edits
// are not part of the undo stack (history.ts's own exclusion list covers
// transient tool/selection state; this is simply the pre-existing,
// unchanged behavior being pinned, not a judgment about whether it should be
// undoable) and never toast.
//
// WHAT IT MUST NOT IMPORT: nothing from `../components`, and no React — this
// is store-layer code (architecture.test.ts's "store/ layering guard"
// enforces it; the grandfathered set is three files and only shrinks). Only
// `lib/` pure helpers (here: `lib/pipeline`'s step primitives) and the
// `AppState` TYPE from ./useApp (type-only, so the runtime import graph
// stays one-directional: useApp -> here).
//
// Characterization tests: store/macroPipeline.characterization.test.ts pins,
// per action AND per branch, the exact set of top-level store keys each call
// changes (a poisoned whole-getState() diff) — including the one genuine
// short-circuit (`moveStep`'s "id not found" branch returns a literal `{}`,
// writing nothing at all) versus every other unmatched-id branch
// (`updateStepParams`/`toggleStep`/`removeStep`), which still produces a NEW
// `macroSteps` array reference via `.map`/`.filter` even though its content
// is unchanged. Written and run GREEN against the pre-extraction code in
// useApp.ts, and passes byte-unchanged against this module.

import {
  makeStep,
  moveStep as movePipelineStep,
  regenerateStep,
  type PipelineStep,
  type StepKind,
} from "../lib/pipeline";
import type { AppState } from "./useApp";

type SliceSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

export interface MacroPipelineSlice {
  // Macro recorder: when `macroRecording` is on, curated actions append a step;
  // the Inspector card exports `macroSteps` as a reproducible script. Steps are
  // TYPED (lib/pipeline): runnable kinds carry {kind, params} so the pipeline
  // view (#6) edits and re-runs the same list the script exports — one source
  // of truth. `pipelineRunning` suppresses recording while the runner replays
  // steps through these same store actions (no self-recording loops).
  macroRecording: boolean;
  macroSteps: PipelineStep[];
  pipelineRunning: boolean;

  startMacro: () => void;
  stopMacro: () => void;
  clearMacro: () => void;
  // Append a step IFF recording is on (callers invoke unconditionally — the
  // gate lives here so the "are we recording?" check isn't scattered).
  recordMacro: (
    label: string,
    code: string,
    typed?: { kind: StepKind; params: Record<string, unknown> },
  ) => void;
  // Pipeline view (#6): edit the recorded step list in place.
  updateStepParams: (id: string, params: Record<string, unknown>) => void;
  toggleStep: (id: string) => void;
  removeStep: (id: string) => void;
  moveStep: (id: string, delta: number) => void;
  insertStep: (step: PipelineStep) => void;
  // Replace the whole step list (loading a template, #2).
  loadSteps: (steps: PipelineStep[]) => void;
  setPipelineRunning: (running: boolean) => void;
}

export function createMacroPipelineSlice(set: SliceSet): MacroPipelineSlice {
  return {
    macroRecording: false,
    macroSteps: [],
    pipelineRunning: false,

    startMacro: () => set({ macroRecording: true }),
    stopMacro: () => set({ macroRecording: false }),
    clearMacro: () => set({ macroSteps: [], macroRecording: false }),
    recordMacro: (label, code, typed) =>
      set((s) =>
        s.macroRecording && !s.pipelineRunning
          ? {
              macroSteps: [
                ...s.macroSteps,
                makeStep(typed?.kind ?? "ui", label, code, typed?.params ?? {}),
              ],
            }
          : {},
      ),
    updateStepParams: (id, params) =>
      set((s) => ({
        macroSteps: s.macroSteps.map((st) =>
          st.id === id ? regenerateStep({ ...st, params }) : st,
        ),
      })),
    toggleStep: (id) =>
      set((s) => ({
        macroSteps: s.macroSteps.map((st) =>
          st.id === id ? { ...st, enabled: !st.enabled } : st,
        ),
      })),
    removeStep: (id) =>
      set((s) => ({ macroSteps: s.macroSteps.filter((st) => st.id !== id) })),
    moveStep: (id, delta) =>
      set((s) => {
        const i = s.macroSteps.findIndex((st) => st.id === id);
        return i < 0 ? {} : { macroSteps: movePipelineStep(s.macroSteps, i, delta) };
      }),
    insertStep: (step) => set((s) => ({ macroSteps: [...s.macroSteps, step] })),
    loadSteps: (macroSteps) => set({ macroSteps }),
    setPipelineRunning: (pipelineRunning) => set({ pipelineRunning }),
  };
}
