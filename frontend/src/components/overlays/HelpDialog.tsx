// Help hub (GUI_INTERACTION #17). A searchable topic list plus browse tabs,
// following ShortcutsDialog's chrome/Esc conventions. Content is pure data
// (lib/helpContent + lib/shortcuts); this is the renderer. Open state lives in
// store/help (a standalone slice — see it for why not useApp).
//
// Slice 1 ships the Search tab (the "searchable tool help" the plan asks for,
// over the analysis-tool catalog) and a Keyboard & mouse tab that REUSES the
// existing shortcut data rather than duplicating it. The importing/origin tabs
// are added by later slices; the store's HelpSection type already lists them.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  actionToHelpItem,
  searchHelpItems,
  type ScoredHelpItem,
} from "../../lib/helpContent";
import { buildAppActions } from "../../appCommands";
import {
  IMPORT_FORMATS,
  formatToHelpItem,
  type ImportFormat,
} from "../../lib/importFormats";
import { ORIGIN_TIPS, tipToHelpItem as originTipToHelpItem } from "../../lib/originTips";
import { JMP_TIPS, tipToHelpItem as jmpTipToHelpItem } from "../../lib/jmpTips";
import { isMacPlatform, shortcutGroupsFor } from "../../lib/shortcuts";
import { Button } from "../primitives";
import { useHelp, type HelpSection } from "../../store/help";
import { useApp } from "../../store/useApp";
import { mergeCommands, useCommands, type Action } from "../../store/commands";

const IS_MAC = isMacPlatform();

const TABS: { id: HelpSection; label: string }[] = [
  { id: "search", label: "Topics" },
  { id: "shortcuts", label: "Keyboard & mouse" },
  { id: "importing", label: "Importing data" },
  { id: "origin", label: "From Origin" },
  { id: "jmp", label: "From JMP" },
];

// Curated actions (store setters are stable, so this builds once — same
// discipline appCommands.ts documents for buildAppActions callers).
const CURATED_ACTIONS = buildAppActions(useApp.getState);
const COMMAND_HELP_ITEMS = CURATED_ACTIONS.filter((action) => action.description).map(
  actionToHelpItem,
);

// The static part of the searchable index — every curated command, formats,
// Origin tips, and JMP tips. Registry-published commands (relink-sources,
// paste-workbook, take-over-editing, open-as-copy, and any future command
// published the same way) are NOT curated — see `registryHelpItems` in the
// component below, merged in live from `useCommands` the same way
// CommandPalette already merges it into the ⌘K palette, so a new registry
// command reaches Help automatically instead of needing a hand-edit here.
const STATIC_SEARCH_ITEMS = [
  ...COMMAND_HELP_ITEMS,
  ...IMPORT_FORMATS.map(formatToHelpItem),
  ...ORIGIN_TIPS.map(originTipToHelpItem),
  ...JMP_TIPS.map(jmpTipToHelpItem),
];

/** Formats grouped by category, in first-appearance order (for the browse tab). */
function formatsByCategory(): [string, ImportFormat[]][] {
  const groups = new Map<string, ImportFormat[]>();
  for (const f of IMPORT_FORMATS) {
    const g = groups.get(f.category);
    if (g) g.push(f);
    else groups.set(f.category, [f]);
  }
  return [...groups];
}

export default function HelpDialog() {
  const open = useHelp((s) => s.open);
  const section = useHelp((s) => s.section);
  const setSection = useHelp((s) => s.setSection);
  const close = useHelp((s) => s.closeHelp);
  const query = useHelp((s) => s.query);
  const setQuery = useHelp((s) => s.setQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuCmds, setMenuCmds] = useState<Action[]>([]);

  // Esc closes even when focus isn't inside the dialog (ShortcutsDialog rule).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  // Focus the box when the Topics tab is showing.
  useEffect(() => {
    if (open && section === "search") inputRef.current?.focus();
  }, [open, section]);

  // Snapshot the runtime command registry on open — the same non-reactive
  // discipline CommandPalette uses for `useCommands.getState().menuCommands`
  // (see store/commands.ts's header comment), so a command a hook publishes
  // AFTER Help was already open still shows up the next time it's opened.
  useEffect(() => {
    if (open) setMenuCmds(useCommands.getState().menuCommands);
  }, [open]);

  // Described registry commands (relink-sources, paste-workbook,
  // take-over-editing, open-as-copy, …) merged in on top of the curated set,
  // deduped the same way the palette dedupes (curated wins on a label
  // collision). A registry command with no description is dropped rather
  // than reaching `actionToHelpItem`, which throws on a missing description.
  const registryHelpItems = useMemo(() => {
    const described = menuCmds.filter((a) => a.description);
    const merged = mergeCommands(CURATED_ACTIONS, described);
    return merged.slice(CURATED_ACTIONS.length).map(actionToHelpItem);
  }, [menuCmds]);

  const searchItems = useMemo(
    () => [...STATIC_SEARCH_ITEMS, ...registryHelpItems],
    [registryHelpItems],
  );

  const results = useMemo(
    () => searchHelpItems(searchItems, query),
    [query, searchItems],
  );

  if (!open) return null;

  return (
    <div className="qz-overlay-backdrop" onMouseDown={close}>
      <div
        className="qzk-glass qz-dialog qzk-help"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Help"
      >
        <h2>Help</h2>
        <div className="qzk-help-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={section === t.id}
              className={`qzk-help-tab${section === t.id ? " active" : ""}`}
              onClick={() => setSection(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {section === "search" ? (
          <SearchTab query={query} setQuery={setQuery} results={results} inputRef={inputRef} />
        ) : section === "importing" ? (
          <ImportingTab />
        ) : section === "origin" ? (
          <OriginTab />
        ) : section === "jmp" ? (
          <JmpTab />
        ) : (
          <ShortcutsTab />
        )}

        <div className="qz-btn-row">
          <Button variant="primary" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function SearchTab({
  query,
  setQuery,
  results,
  inputRef,
}: {
  query: string;
  setQuery: (q: string) => void;
  results: ScoredHelpItem[];
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <input
        ref={inputRef}
        className="qz-cmdk-input"
        placeholder="Search tools and topics…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search help"
      />
      <div className="qzk-help-list">
        {results.length === 0 && <div className="qz-cmdk-empty">No matching topics</div>}
        {results.map((r) => (
          <div key={r.key} className="qzk-help-row">
            <div className="qzk-help-row-head">
              <span className="qzk-help-title">{highlight(r.title, r.hits)}</span>
              {r.meta && <span className="qzk-help-meta">{r.meta}</span>}
            </div>
            <div className="qzk-help-detail">{r.detail}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function ShortcutsTab() {
  const groups = shortcutGroupsFor(IS_MAC);
  return (
    <div className="qzk-sc-cols">
      {groups.map((g) => (
        <div key={g.title} className="qzk-sc-group">
          <div className="qzk-sc-title">{g.title}</div>
          {g.items.map((s) => (
            <div key={s.keys} className="qzk-sc-row">
              {/* shortcutGroupsFor already platform-translated these keys. */}
              <kbd className="qzk-kbd">{s.keys}</kbd>
              <span className="qzk-sc-desc">{s.desc}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ImportingTab() {
  return (
    <div className="qzk-help-list">
      <div className="qzk-help-detail" style={{ marginBottom: 6 }}>
        Import via File ▸ Import data…, or drag a file onto the window. Any
        delimited text file also works through the Import Wizard's guided
        preview.
      </div>
      {formatsByCategory().map(([category, formats]) => (
        <div key={category} className="qzk-help-fmt-group">
          <div className="qzk-sc-title">{category}</div>
          {formats.map((f) => (
            <div key={f.exts[0]} className="qzk-help-row">
              <div className="qzk-help-row-head">
                <span className="qzk-help-title">{f.name}</span>
                <span className="qzk-help-meta">{f.exts.join(" ")}</span>
              </div>
              {f.note && <div className="qzk-help-detail">{f.note}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function OriginTab() {
  return (
    <div className="qzk-help-list">
      <div className="qzk-help-detail" style={{ marginBottom: 6 }}>
        Familiar Origin workflows and where they live here.
      </div>
      {ORIGIN_TIPS.map((t) => (
        <div key={t.id} className="qzk-help-row">
          <div className="qzk-help-title">{t.origin}</div>
          <div className="qzk-help-detail">{t.quantized}</div>
        </div>
      ))}
    </div>
  );
}

function JmpTab() {
  return (
    <div className="qzk-help-list">
      <div className="qzk-help-detail" style={{ marginBottom: 6 }}>
        Familiar JMP workflows and where they live here.
      </div>
      {JMP_TIPS.map((t) => (
        <div key={t.id} className="qzk-help-row">
          <div className="qzk-help-title">{t.jmp}</div>
          <div className="qzk-help-detail">{t.quantized}</div>
        </div>
      ))}
    </div>
  );
}

function highlight(title: string, hits: number[]): ReactNode {
  if (hits.length === 0) return title;
  const set = new Set(hits);
  return title.split("").map((ch, i) =>
    set.has(i) ? (
      <mark key={i} className="qz-cmdk-hit">
        {ch}
      </mark>
    ) : (
      ch
    ),
  );
}
