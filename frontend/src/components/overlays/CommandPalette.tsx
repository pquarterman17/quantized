// Ported from fermiviewer frontend/src/components/overlays/CommandPalette.tsx.
// ⌘K fuzzy command palette. Curated actions come from App; menu commands are
// published by the MenuBar into the commands store and merged on open.
// quantized-only divergence from the fermiviewer original: also merges
// GUI_INTERACTION #8's context-action registry entries
// (`lib/paletteContextActions`) for the active dataset / selected annotation
// / selected shape — fermiviewer has no such registry yet; see
// `store/commands.ts`'s MAIN #9 note for the "keep in sync, document
// divergences" precedent this follows.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { fuzzy } from "../../lib/fuzzy";
import { formatShortcut, isMacPlatform } from "../../lib/shortcutFormat";
import { mergeCommands, PALETTE_LABEL, runAction, useCommands, type Action } from "../../store/commands";
import { useApp } from "../../store/useApp";
import { useOpenerCapture } from "./openerCapture";

export type { Action };

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

  const matches = useMemo(() => {
    return allActions
      .map((a) => {
        // Match the visible label first (so highlight hits map to it); fall back
        // to hidden keywords (aliases like "diraculator") with no highlight.
        const ml = fuzzy(query, a.label);
        if (ml) return { a, m: ml };
        const mk = a.keywords ? fuzzy(query, a.keywords) : null;
        if (mk) return { a, m: { score: mk.score, hits: [] as number[] } };
        // A fuzzy subsequence over a full sentence matches too much. Search
        // descriptions by precise substring, while labels/keywords remain
        // typo-tolerant.
        const q = query.trim().toLowerCase();
        const md = q && a.description?.toLowerCase().includes(q);
        return { a, m: md ? { score: 0, hits: [] as number[] } : null };
      })
      .filter((x): x is { a: Action; m: NonNullable<typeof x.m> } => !!x.m)
      .sort((x, y) => y.m.score - x.m.score);
  }, [allActions, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const run = (a: Action) => {
    close();
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
  const runs: ((typeof matches)[number] & { i: number })[][] = [];
  matches.forEach((x, i) => {
    if (x.a.group !== matches[i - 1]?.a.group) runs.push([]);
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
              <div id={`${listId}-g${r}`} className="qz-cmdk-group" role="presentation">
                {grp[0].a.group}
              </div>
              {grp.map(({ a, m, i }) => (
                <div
                  key={a.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === cursor}
                  className={`qz-cmdk-item${i === cursor ? " active" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={() => run(a)}
                >
                  <span className="qz-cmdk-copy">
                    <span>{highlight(a.label, m.hits)}</span>
                    {a.description && (
                      <span className="qz-cmdk-desc">{a.description}</span>
                    )}
                  </span>
                  {a.shortcut && <span className="qz-shortcut">{formatShortcut(a.shortcut, IS_MAC)}</span>}
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
