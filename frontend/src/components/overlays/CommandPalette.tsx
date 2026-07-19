// Ported from fermiviewer frontend/src/components/overlays/CommandPalette.tsx.
// ⌘K fuzzy command palette. Curated actions come from App; menu commands are
// published by the MenuBar into the commands store and merged on open.
// quantized-only divergence from the fermiviewer original: also merges
// GUI_INTERACTION #8's context-action registry entries
// (`lib/paletteContextActions`) for the active dataset / selected annotation
// / selected shape — fermiviewer has no such registry yet; see
// `store/commands.ts`'s MAIN #9 note for the "keep in sync, document
// divergences" precedent this follows.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { contextPaletteActions } from "../../lib/paletteContextActions";
import { fuzzy } from "../../lib/fuzzy";
import { formatShortcut, isMacPlatform } from "../../lib/shortcuts";
import { mergeCommands, useCommands, type Action } from "../../store/commands";
import { useApp } from "../../store/useApp";

export type { Action };

// Resolved once at module load — the host platform does not change.
const IS_MAC = isMacPlatform();

export default function CommandPalette({ actions }: { actions: Action[] }) {
  const open = useApp((s) => s.cmdkOpen);
  const setCmdk = useApp((s) => s.setCmdk);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [menuCmds, setMenuCmds] = useState<Action[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // Context-selection commands (the active dataset / selected annotation
      // / selected shape's registry actions) are computed fresh each open —
      // non-reactive by design, same snapshot discipline as menuCommands.
      setMenuCmds([...useCommands.getState().menuCommands, ...contextPaletteActions()]);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
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
        return { a, m: mk ? { score: mk.score, hits: [] as number[] } : null };
      })
      .filter((x): x is { a: Action; m: NonNullable<typeof x.m> } => !!x.m)
      .sort((x, y) => y.m.score - x.m.score);
  }, [allActions, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  const run = (a: Action) => {
    setCmdk(false);
    a.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setCmdk(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(matches.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && matches[cursor]) {
      run(matches[cursor].a);
    }
    e.stopPropagation();
  };

  let lastGroup = "";

  return (
    <div className="qz-overlay-backdrop" onMouseDown={() => setCmdk(false)}>
      <div className="qzk-glass qz-cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qz-cmdk-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="qz-cmdk-list">
          {matches.length === 0 && (
            <div className="qz-cmdk-empty">No matching commands</div>
          )}
          {matches.map(({ a, m }, i) => {
            const header =
              a.group !== lastGroup ? (
                <div className="qz-cmdk-group">{a.group}</div>
              ) : null;
            lastGroup = a.group;
            return (
              <div key={a.id}>
                {header}
                <div
                  className={`qz-cmdk-item${i === cursor ? " active" : ""}`}
                  onMouseEnter={() => setCursor(i)}
                  onMouseDown={() => run(a)}
                >
                  <span>{highlight(a.label, m.hits)}</span>
                  {a.shortcut && <span className="qz-shortcut">{formatShortcut(a.shortcut, IS_MAC)}</span>}
                </div>
              </div>
            );
          })}
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
