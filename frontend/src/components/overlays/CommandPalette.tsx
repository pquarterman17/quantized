// Ported from fermiviewer frontend/src/components/overlays/CommandPalette.tsx.
// ⌘K fuzzy command palette. Curated actions come from App; menu commands are
// published by the MenuBar into the commands store and merged on open.
// quantized-only divergence from the fermiviewer original: also merges
// GUI_INTERACTION #8's context-action registry entries
// (`lib/paletteContextActions`) for the active dataset / selected annotation
// / selected shape — fermiviewer has no such registry yet; see
// `store/commands.ts`'s MAIN #9 note for the "keep in sync, document
// divergences" precedent this follows.
//
// Bundle diet slice 26 (2026-11-13): App mounts ./CommandPaletteGate.tsx, which
// loads this module on demand and warms it once the shell has mounted. The
// "this component is eager" notes below date from before that; their rules
// were kept unchanged rather than re-derived for a lazy body.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { rankActions } from "../../lib/paletteRank";
import { loadUsage, recentIds, recordUse, type UsageMap } from "../../lib/paletteUsage";
import { formatShortcut, isMacPlatform } from "../../lib/shortcutFormat";
import { mergeCommands, PALETTE_LABEL, runAction, useCommands, type Action } from "../../store/commands";
import { useApp } from "../../store/useApp";
import { useOpenerCapture } from "./openerCapture";

export type { Action };

/** One row: the command, the label characters to highlight, and the group
 *  header it sits under (a real group, "Recent", or the ranked "Results"). */
interface Match {
  a: Action;
  hits: number[];
  group: string;
}

const RECENT = "Recent";
const RESULTS = "Results";
const RECENT_LIMIT = 5;

// Resolved once at module load — the host platform does not change.
const IS_MAC = isMacPlatform();

// The background-`inert` registry every other modal uses (lib/modalInert.ts,
// via the lazy `useDialogFocus`), loaded with `import()`: this component is
// eager and must not pull it into the entry chunk. Kept once loaded, so a
// close can lift the inert synchronously before focus goes back.
let modalInert: typeof import("../../lib/modalInert") | undefined;

export default function CommandPalette({ actions }: { actions: Action[] }) {
  const open = useApp((s) => s.cmdkOpen);
  const setCmdk = useApp((s) => s.setCmdk);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [menuCmds, setMenuCmds] = useState<Action[]>([]);
  // Per-user run counts (lib/paletteUsage.ts), re-read on every open: they
  // feed the empty-query "Recent" group and the ranker's tie-breaking boost.
  const [usage, setUsage] = useState<UsageMap>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  // R2 (PRIMARY_SOFTWARE_AUDIT_PLAN): give focus back to whatever opened the
  // palette. Without it every close dropped focus on <body>, where the global
  // Delete binding removes the active dataset. This is `useOpenerRestore`'s
  // contract, minus its safe-landing fallback: that hook lives in the LAZY
  // `useDialogFocus` seam, which this eager component must not import (see
  // openerCapture.ts). `close` restores EAGERLY — before the input unmounts
  // (useOpenerRestore's doc has the measured reason) and before a run command
  // acts, so a dialog it opens captures the real opener; the effect cleanup is
  // the backstop for a close from anywhere else, and only acts on a dropped focus.
  const opener = useOpenerCapture(open);
  const restoreOpener = () => {
    if (opener.current?.isConnected) opener.current.focus();
  };
  useEffect(() => {
    if (!open) return;
    return () => {
      const active = document.activeElement;
      if (active === null || active === document.body) restoreOpener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `opener` is a ref
  }, [open]);
  // The page behind goes inert while the palette is open (registered a
  // microtask after the commit, before paint). A failed chunk load only costs
  // that: Tab is trapped here and the backdrop takes clicks.
  useLayoutEffect(() => {
    if (!open) return;
    let live = true;
    void import("../../lib/modalInert").then(
      (m) => {
        modalInert = m;
        if (live) m.registerModal(dialogRef);
      },
      () => {},
    );
    return () => {
      live = false;
      modalInert?.releaseModal(dialogRef);
    };
  }, [open]);
  const close = () => {
    // Lift the inert first: focus() into an inert background is refused.
    modalInert?.releaseModal(dialogRef);
    restoreOpener();
    setCmdk(false);
  };

  useEffect(() => {
    if (!open) return;
    let live = true;
    setQuery("");
    setCursor(0);
    const menu = useCommands.getState().menuCommands;
    setMenuCmds(menu);
    setUsage(loadUsage());
    // Context-selection commands (the active dataset / selected annotation
    // / selected shape's registry actions) are computed fresh each open —
    // non-reactive by design, same snapshot discipline as menuCommands. Their
    // registry loads with `import()` (a microtask once cached), which keeps
    // it and the action modules it reaches out of the entry chunk.
    void import("../../lib/paletteContextActions").then(
      (m) => {
        if (live) setMenuCmds([...menu, ...m.contextPaletteActions()]);
      },
      () => {},
    );
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      live = false;
    };
  }, [open]);

  const allActions = useMemo(
    () => mergeCommands(actions, menuCmds),
    [actions, menuCmds],
  );

  // Ranked best-first (lib/paletteRank.ts: whole word, prefix, synonym,
  // keyword, description, fuzzy last; every typed word must match). An empty
  // query lists the recently run commands first, then everything else.
  const matches = useMemo((): Match[] => {
    if (query.trim()) {
      return rankActions(allActions, query, usage).map(({ a, hits }) => ({ a, hits, group: RESULTS }));
    }
    const byId = new Map(allActions.map((a) => [a.id, a]));
    const recent = recentIds(usage, RECENT_LIMIT).flatMap((id) => {
      const a = byId.get(id);
      // A destructive command is never offered as "repeat last": Ctrl+K, Enter would be one key from it.
      return a && !a.perEntity && !a.danger ? [a] : [];
    });
    const seen = new Set(recent.map((a) => a.id));
    return [
      ...recent.map((a) => ({ a, hits: [], group: RECENT })),
      ...allActions.filter((a) => !seen.has(a.id)).map((a) => ({ a, hits: [], group: a.group })),
    ];
  }, [allActions, query, usage]);

  // Disabled commands stay listed (never hidden) with the menu's own reason,
  // evaluated once per open/list change rather than per row per render.
  const unavailable = useMemo(() => {
    const out = new Map<string, string>();
    for (const a of allActions) {
      const off = typeof a.disabled === "function" ? a.disabled() : a.disabled === true;
      if (!off) continue;
      const why = typeof a.disabledReason === "function" ? a.disabledReason() : a.disabledReason;
      out.set(a.id, why ?? "Unavailable right now");
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on every open
  }, [allActions, open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const run = (a: Action) => {
    if (unavailable.has(a.id)) return;
    close();
    if (!a.perEntity) recordUse(a.id);
    // P3.4 slice 2: routes through the shared chokepoint so an async
    // command (every File-menu export) registers an in-flight signal
    // StatusBar can show instead of firing untracked.
    runAction(a);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(matches.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && matches[cursor]) {
      // Consume the key: the command may open a dialog that focuses a button
      // before this key's keypress fires, and the browser would then "click"
      // that button (Plot > Break y-axis... landed on the dialog's X tab).
      e.preventDefault();
      run(matches[cursor].a);
    } else if (e.key === "Tab") {
      // The input is the palette's only Tab stop, so trapping Tab means
      // staying put rather than walking into the page behind the backdrop.
      e.preventDefault();
    }
    e.stopPropagation();
  };

  // Consecutive matches of one group form a labelled `group` (the header is
  // its name, not an option); a group can recur after a better-scoring match.
  const runs: (Match & { i: number })[][] = [];
  matches.forEach((x, i) => {
    if (x.group !== matches[i - 1]?.group) runs.push([]);
    runs[runs.length - 1].push({ ...x, i });
  });

  return (
    <div
      className="qz-overlay-backdrop"
      // preventDefault: the click's default focus move would otherwise land
      // on <body> after `close` has already put focus back on the opener.
      onMouseDown={(e) => {
        e.preventDefault();
        close();
      }}
    >
      {/* A headingless dialog, so named by aria-label; the input is an
          ARIA 1.2 combobox driving the listbox by aria-activedescendant. */}
      <div
        ref={dialogRef}
        className="qzk-glass qz-cmdk"
        role="dialog"
        aria-label={PALETTE_LABEL.replace("…", "")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="qz-cmdk-input"
          placeholder="Type a command…"
          role="combobox"
          aria-label="Command"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={matches[cursor] ? `${listId}-${cursor}` : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="qz-cmdk-list" id={listId} role="listbox" aria-label="Commands">
          {matches.length === 0 && (
            <div className="qz-cmdk-empty">No matching commands</div>
          )}
          {runs.map((grp, r) => (
            <div key={r} role="group" aria-labelledby={`${listId}-g${r}`}>
              <div
                id={`${listId}-g${r}`}
                className={grp[0].group === RESULTS ? "qz-sr-only" : "qz-cmdk-group"}
                role="presentation"
              >
                {grp[0].group}
              </div>
              {grp.map(({ a, hits, group, i }) => (
                <div
                  key={a.id}
                  id={`${listId}-${i}`}
                  role="option"
                  // The name is the label alone; the outcome, category and shortcut are
                  // the description (otherwise every span was run together into the name).
                  aria-label={a.label}
                  aria-describedby={`${listId}-${i}-d ${listId}-${i}-m`}
                  aria-selected={i === cursor}
                  aria-disabled={unavailable.has(a.id) || undefined}
                  className={`qz-cmdk-item${i === cursor ? " active" : ""}${unavailable.has(a.id) ? " disabled" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={(e) => {
                    // A disabled row is inert: keep focus in the input (a blur would strand Escape/Enter).
                    if (unavailable.has(a.id)) e.preventDefault();
                    else run(a);
                  }}
                >
                  <span className="qz-cmdk-copy">
                    <span>{highlight(a.label, hits)}</span>
                    {(unavailable.get(a.id) ?? a.description) && (
                      <span id={`${listId}-${i}-d`} className="qz-cmdk-desc">{unavailable.get(a.id) ?? a.description}</span>
                    )}
                  </span>
                  <span id={`${listId}-${i}-m`} className="qz-cmdk-meta">
                    {group !== a.group && <span className="qz-cmdk-cat">{a.group}</span>}
                    {a.shortcut && <span className="qz-shortcut">{formatShortcut(a.shortcut, IS_MAC)}</span>}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function highlight(label: string, hits: number[]): ReactNode {
  if (hits.length === 0) return label;
  const set = new Set(hits);
  return label.split("").map((ch, i) =>
    set.has(i) ? (
      <mark key={i} className="qz-cmdk-hit">
        {ch}
      </mark>
    ) : (
      ch
    ),
  );
}
