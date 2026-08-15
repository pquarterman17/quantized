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

import { useEffect, useState, useRef } from "react";

import { pathState, type PathState } from "../../lib/desktopBridge";
import { relativeTime, type RecentFile } from "../../lib/recentFiles";
import { reopenRecent } from "../../lib/reopenRecent";
import { useAutosaveStatus } from "../../store/autosaveStatus";
import { absorbStrayDeleteOnContainer, removeRowSafely } from "../../lib/focusGuard";
import { useApp } from "../../store/useApp";
import { useWorkingPaths } from "../../store/workingPaths";

/** Short badge for a source's reachability. `ok`/`unknown` render nothing —
 *  a badge on every healthy row is noise, and "unknown" (no desktop bridge to
 *  ask) must not look like a problem. */
export function stateBadge(state: PathState): { text: string; tone: string } | null {
  if (state === "offline") return { text: "offline", tone: "var(--warn, #c80)" };
  if (state === "missing") return { text: "missing", tone: "var(--danger, #d33)" };
  if (state === "invalid") return { text: "bad path", tone: "var(--danger, #d33)" };
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
      recent.filter((r) => r.path).map(async (r) => [r.name, await pathState(r.path!)] as const),
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

export default function HomeScreen({ onImport }: { onImport: () => void }) {
  const recent = useApp((s) => s.recent);
  const removeRecent = useApp((s) => s.removeRecent);
  const homeRef = useRef<HTMLDivElement>(null);
  const paths = useWorkingPaths((s) => s.paths);
  const setPinned = useWorkingPaths((s) => s.setPinned);
  // Not `usePath`: a `use`-prefixed local reads as a React hook (and trips
  // rules-of-hooks when called in the onClick below) — it is a store action.
  const recordPathUse = useWorkingPaths((s) => s.use);
  const health = useAutosaveStatus((s) => s.health);
  const states = useRecentStates(recent);

  return (
    // tabIndex/keydown: hardening review fix — the recents ✕ removal needs a
    // SURVIVING focus anchor (removeRowSafely) + a stray-Delete absorber, or
    // Chromium orphans focus to <body> and the next Delete removes the
    // active dataset (lib/focusGuard.ts's incident class).
    <div ref={homeRef} tabIndex={-1} onKeyDown={absorbStrayDeleteOnContainer} style={{ padding: 10, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <button className="qz-btn" onClick={onImport} style={{ width: "100%" }}>
          ⊞ Import data…
        </button>
        <div className="qzk-ds-meta" style={{ marginTop: 4, color: "var(--text-faint)" }}>
          or drop files anywhere in this panel
        </div>
      </div>

      {recent.length > 0 && (
        <div>
          <div className="qzk-menu-label">Recent</div>
          {recent.slice(0, 6).map((r) => {
            const badge = stateBadge(states[r.name] ?? "unknown");
            return (
              <div
                key={r.name}
                className="qz-meta-row"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <button
                  className="qzk-menu-item"
                  style={{ flex: 1, textAlign: "left" }}
                  title={r.path ?? `${r.name} — re-opens the import picker`}
                  onClick={() => void reopenRecent(useApp.getState(), r)}
                >
                  <span className="qzk-menu-trunc">{r.name}</span>
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
                  onClick={() => removeRowSafely(homeRef.current, () => removeRecent(r.name))}
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

      <div className="qzk-ds-meta" style={{ color: "var(--text-faint)" }}>
        {health.error ? (
          <span role="alert" style={{ color: "var(--danger, #d33)" }}>
            ⚠ autosave is failing — use File ▸ Save workspace
          </span>
        ) : health.savedAt != null ? (
          <>
            Autosave healthy · {health.count} recovery point
            {health.count === 1 ? "" : "s"}
          </>
        ) : (
          "Nothing autosaved yet"
        )}
      </div>
    </div>
  );
}
