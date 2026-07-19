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
  HELP_TOOLS,
  searchHelpItems,
  toolToHelpItem,
  type ScoredHelpItem,
} from "../../lib/helpContent";
import {
  IMPORT_FORMATS,
  formatToHelpItem,
  type ImportFormat,
} from "../../lib/importFormats";
import { isMacPlatform, shortcutGroupsFor } from "../../lib/shortcuts";
import { Button } from "../primitives";
import { useHelp, type HelpSection } from "../../store/help";

const IS_MAC = isMacPlatform();

const TABS: { id: HelpSection; label: string }[] = [
  { id: "search", label: "Topics" },
  { id: "shortcuts", label: "Keyboard & mouse" },
  { id: "importing", label: "Importing data" },
];

// The one searchable index — tools AND formats, so a search covers both.
const SEARCH_ITEMS = [...HELP_TOOLS.map(toolToHelpItem), ...IMPORT_FORMATS.map(formatToHelpItem)];

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
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Fresh search each open; focus the box when the Topics tab is showing.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  useEffect(() => {
    if (open && section === "search") inputRef.current?.focus();
  }, [open, section]);

  const results = useMemo(() => searchHelpItems(SEARCH_ITEMS, query), [query]);

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
