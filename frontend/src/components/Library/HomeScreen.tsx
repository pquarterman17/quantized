// The empty-Library home screen (MAIN_PLAN #38).
//
// The empty Library used to say "Drop files here" and nothing else, which makes
// the most common launch state — no project open yet — the least useful screen
// in the app. This is the resume-work surface: what you had open, where your
// data lives, and whether your last session was saved.
//
// COMPOSES, never duplicates (#38's own instruction): recents and working paths
// come from the #31 stores, recovery health from the #32 one. Nothing here owns
// state, so nothing here can disagree with the menus and panels that show the
// same things elsewhere.
//
// Non-destructive by construction. A missing or offline source is SHOWN and
// nothing more — no automatic cleanup, no "tidy up your recents", because a
// share that is merely unmounted must never be treated as a deleted file.

import { useEffect, useId, useState, useRef } from "react";
import { plural } from "../../lib/plural";

import { pathState, type PathState } from "../../lib/desktopBridge";
import { makeFirstRunExample, type FirstRunExampleKind } from "../../lib/firstRunExamples";
import { plotIntentStageTab } from "../../lib/stagetab";
import { recentKey, recentParentLabel, relativeTime, type RecentFile } from "../../lib/recentFiles";
import { reopenRecent } from "../../lib/reopenRecent";
import { openRecentProject } from "../../commands/recentProjectsCommands";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import { nextDatasetId, useApp } from "../../store/useApp";
import { useRecentProjects } from "../../store/recentProjects";
import { useWorkingPaths } from "../../store/workingPaths";

/** Short badge for a source's reachability. `ok`/`unknown` render nothing —
 *  a badge on every healthy row is noise, and "unknown" (no desktop bridge to
 *  ask) must not look like a problem. */
export function stateBadge(state: PathState): { text: string; tone: string } | null {
  if (state === "offline") return { text: "offline", tone: "var(--warn, #c80)" };
  if (state === "missing") return { text: "missing", tone: "var(--danger, #d33)" };
  if (state === "invalid") return { text: "bad path", tone: "var(--danger, #d33)" };
  if (state === "permission_denied") return { text: "no access", tone: "var(--warn, #c80)" };
  return null;
}

/** Probe each recent entry that HAS a path. Entries without one are skipped:
 *  a browser upload never had a path, so there is nothing to check and
 *  claiming otherwise would be a false signal. */
function useRecentStates(recent: RecentFile[]): Record<string, PathState> {
  const [states, setStates] = useState<Record<string, PathState>>({});
  const key = recent.map((r) => r.path ?? "").join("|");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      recent.filter((r) => r.path).map(async (r) => [recentKey(r), await pathState(r.path!)] as const),
    ).then((pairs) => {
      if (!cancelled) setStates(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // Re-probe when the set of paths changes, not on every render.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return states;
}

/** Load a first-run example as ONE user action, through the ordinary
 *  `addDataset` entry point (the same one import/paste/demo use).
 *
 *  Synchronous on purpose. The generator ships in Home's own lazy chunk
 *  (Library.tsx loads Home through `lazyRegion`), so it costs the eager
 *  bundle nothing — and a second dynamic import here would only reopen an
 *  async gap in which a real import could land first and the example then
 *  pile on top of it.
 *
 *  Never over existing data: Home is mounted only over an empty Library, but
 *  a fast double-click dispatches twice before React re-renders Home away. */
function loadFirstRunExample(kind: FirstRunExampleKind): void {
  const s = useApp.getState();
  if (s.datasets.length > 0) return;
  const example = makeFirstRunExample(kind);
  const ds = { id: nextDatasetId(), name: example.name, data: example.data };
  s.addDataset(ds); // records the one "add dataset" undo entry
  // Grouping + tab ride that same entry: its pre-mutation snapshot already
  // restores both. `setGroupKey` would push a SECOND "change group" entry
  // (one Undo then leaves an ungrouped dataset behind) and record a macro
  // step the user never took. The tab is plot-intent routing (the rule
  // "Plot (make active)" uses), so a Worksheet-tab start still shows a plot.
  useApp.setState({ groupKey: example.groupKey, stageTab: plotIntentStageTab(ds) });
  s.setStatus(`loaded example: ${example.description}`);
}

export default function HomeScreen({ onImport }: { onImport: () => void }) {
  const recent = useApp((s) => s.recent);
  const removeRecent = useApp((s) => s.removeRecent);
  const recentProjects = useRecentProjects((s) => s.recentProjects);
  const homeRef = useRef<HTMLDivElement>(null);
  // A double-click on a project row must not start a second reopen: the
  // second would find the first's workspace applied and ask "Replace the
  // current workspace?" about the very project just opened.
  const reopening = useRef(false);
  const examplesLabelId = useId();
  const paths = useWorkingPaths((s) => s.paths);
  const setPinned = useWorkingPaths((s) => s.setPinned);
  // Not `usePath`: a `use`-prefixed local reads as a React hook (and trips
  // rules-of-hooks when called in the onClick below) — it is a store action.
  const recordPathUse = useWorkingPaths((s) => s.use);
  const health = useAutosaveStatus((s) => s.health);
  const states = useRecentStates(recent);
  const reopenProject = async (name: string, path: string): Promise<void> => {
    if (reopening.current) return;
    reopening.current = true;
    try {
      await openRecentProject(name, path); // the one missing/offline-aware path
    } finally {
      reopening.current = false;
    }
  };

  return (
    // tabIndex/keydown: hardening review fix — the recents ✕ removal needs a
    // SURVIVING focus anchor (removeRowSafely) + a stray-Delete absorber, or
    // Chromium orphans focus to <body> and the next Delete removes the
    // active dataset (lib/focusGuard.ts's incident class).
    <div ref={homeRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer} style={{ padding: 10, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div className="qzk-menu-label">Start here</div>
        <button className="qz-btn" onClick={onImport} style={{ width: "100%" }}>
          ⊞ Import data…
        </button>
        <button
          className="qzk-menu-item"
          onClick={() => useApp.getState().setImportWizardOpen(true)}
          style={{ width: "100%", marginTop: 4, textAlign: "center" }}
        >
          Guided import for unfamiliar files…
        </button>
        <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
          Drop files anywhere here. Quantized plots the first usable columns;
          then drag columns onto X, Y, or Y2 to change them.
        </div>
      </div>

      {recentProjects.length > 0 && (
        <div>
          <div className="qzk-menu-label">Recent projects</div>
          {recentProjects.slice(0, 4).map((project) => (
            <button
              key={project.path}
              className="qzk-menu-item"
              style={{ width: "100%", textAlign: "left" }}
              title={project.path}
              onClick={() => void reopenProject(project.name, project.path)}
            >
              <span className="qzk-menu-trunc">{project.name}</span>
              <span className="qz-shortcut">{relativeTime(project.at, Date.now())}</span>
            </button>
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div>
          <div className="qzk-menu-label">Recent</div>
          {recent.slice(0, 6).map((r) => {
            const badge = stateBadge(states[recentKey(r)] ?? "unknown");
            return (
              <div
                key={recentKey(r)}
                className="qz-meta-row"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <button
                  className="qzk-menu-item"
                  style={{ flex: 1, textAlign: "left" }}
                  title={r.path ?? `${r.name} — re-opens the import picker`}
                  onClick={() => void reopenRecent(useApp.getState(), r)}
                >
                  <span className="qzk-menu-trunc">
                    {r.name}{r.path ? ` — ${recentParentLabel(r.path)}` : ""}
                  </span>
                </button>
                {badge && (
                  <span className="qz-shortcut" style={{ color: badge.tone }} title={
                    badge.text === "offline"
                      ? "The drive or share is not available right now — it will work again when reconnected"
                      : "Not found at its saved location — opening will let you locate it"
                  }>
                    {badge.text}
                  </span>
                )}
                <span className="qz-shortcut">{relativeTime(r.at, Date.now())}</span>
                {/* Retrospective-audit P2 fix: no tabIndex — a click on a
                    tabindex'd span focuses it, and this click unmounts the
                    span: focus fell to <body>, arming the global Delete. */}
                <span
                  role="button"
                  aria-label={`Remove ${r.name} from recent`}
                  title="Remove from recent"
                  className="qz-shortcut"
                  onClick={() => removeRowSafely(homeRef.current, () => removeRecent(r))}
                >
                  ✕
                </span>
              </div>
            );
          })}
        </div>
      )}

      {paths.length > 0 && (
        <div>
          <div className="qzk-menu-label">Working paths</div>
          {paths.slice(0, 6).map((p) => (
            <div
              key={p.path}
              className="qz-meta-row"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <button
                className="qzk-menu-item"
                style={{ flex: 1, textAlign: "left" }}
                title={`${p.path} — import dialogs will open here`}
                onClick={() => {
                  recordPathUse(p.path);
                  onImport();
                }}
              >
                <span className="qzk-menu-trunc">{p.label}</span>
              </button>
              <span
                role="button"
                tabIndex={-1}
                aria-label={p.pinned ? `Unpin ${p.label}` : `Pin ${p.label}`}
                title={p.pinned ? "Unpin" : "Pin so it is never evicted"}
                className="qz-shortcut"
                onClick={() => setPinned(p.path, !p.pinned)}
              >
                {p.pinned ? "★" : "☆"}
              </span>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="qzk-menu-label" id={examplesLabelId}>Try an example</div>
        <div
          role="group"
          aria-labelledby={examplesLabelId}
          style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}
        >
          <button className="qzk-menu-item" title="Load a simple 1-D line example" onClick={() => loadFirstRunExample("line")}>
            1-D
          </button>
          <button className="qzk-menu-item" title="Load data grouped by lot" onClick={() => loadFirstRunExample("grouped")}>
            Grouped
          </button>
          <button className="qzk-menu-item" title="Load a small 2-D intensity map" onClick={() => loadFirstRunExample("map")}>
            2-D
          </button>
        </div>
        <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
          Examples are generated locally and never replace your files.
        </div>
      </div>

      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {health.error ? (
          <span role="alert" style={{ color: "var(--danger, #d33)" }}>
            ⚠ autosave is failing — use File ▸ Save workspace
          </span>
        ) : health.savedAt != null ? (
          <>
            Autosave healthy · {health.count} recovery point
            {plural(health.count)}
          </>
        ) : (
          "Nothing autosaved yet"
        )}
      </div>
    </div>
  );
}
