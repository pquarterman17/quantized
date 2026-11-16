// Curve Fit's model picker: the registry models under Origin's category
// headings (lib/fitModelCatalog.ts, re-audit #14), then the custom equations,
// with a search box and a "Recent" group on top (lib/fitModelPicker.ts).
// The list itself stays a native <select> with <optgroup>s, so the keyboard
// and screen readers get the grouping for free and the option VALUES are the
// registry names, unchanged -- each exactly once (a recent model moves to
// Recent), and Recent changes only when a fit RUNS, so ArrowDown on the closed
// select walks straight through it. While a search is typed the select opens as
// a listbox of the matches: ArrowDown moves from the search box into it and
// arrowing there selects without leaving the search; Enter, a click or leaving
// the list commits (clears the search). Enter in the box picks the first match,
// Escape clears the search.

import { useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ModelGroup, ModelOption } from "../../../lib/fitModelCatalog";
import { filterModels, readRecents, subscribeRecents, withRecents } from "../../../lib/fitModelPicker";

const MAX_ROWS = 10;
const recentsKey = () => readRecents().join("\n"); // a primitive: a stable snapshot

export default function ModelSelect({
  groups,
  custom,
  value,
  onChange,
}: {
  groups: readonly ModelGroup[];
  /** "Custom equation…" and the saved equations, last, under their own heading. */
  custom: readonly ModelOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const recentsSnap = useSyncExternalStore(subscribeRecents, recentsKey);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLSelectElement>(null);
  const searching = query.trim() !== "";
  const shown = useMemo(() => {
    const recents = recentsSnap === "" ? [] : recentsSnap.split("\n");
    const f = filterModels(groups, custom, query, value);
    // The matches proper (the current model is always kept in the list above).
    const hits = filterModels(groups, custom, query, "\u0000");
    return {
      groups: searching ? f.groups : withRecents(f.groups, recents),
      custom: f.custom,
      first: hits.groups[0]?.options[0]?.value ?? hits.custom[0]?.value,
    };
  }, [groups, custom, query, value, recentsSnap, searching]);
  const rows = shown.groups.reduce((n, g) => n + g.options.length + 1, 0) + shown.custom.length + 1;

  return (
    <>
      <input
        ref={searchRef}
        type="search"
        className="qz-input"
        aria-label="Search models"
        placeholder="Search models…"
        value={query}
        style={{ width: "100%", marginBottom: 4 }}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && searching) {
            e.preventDefault();
            listRef.current?.focus();
          } else if (e.key === "Enter" && searching) {
            e.preventDefault();
            if (shown.first !== undefined) {
              setQuery("");
              onChange(shown.first);
            }
          } else if (e.key === "Escape" && query !== "") {
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
      />
      <select
        ref={listRef}
        className="qz-select"
        aria-label="Model"
        value={value}
        {...(searching ? { size: Math.min(MAX_ROWS, rows) } : {})}
        // Selecting never clears the search: arrowing through the matches fires change too.
        onChange={(e) => onChange(e.target.value)}
        // An option clicked in the open list, or Enter, commits the choice.
        onClick={(e) => {
          if (searching && (e.target as HTMLElement).tagName === "OPTION") setQuery("");
        }}
        onBlur={(e) => {
          if (searching && e.relatedTarget !== searchRef.current) setQuery("");
        }}
        onKeyDown={(e) => {
          if ((e.key === "Escape" || e.key === "Enter") && searching) {
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
      >
        {shown.groups.map((g) => (
          <optgroup key={g.group} label={g.group}>
            {g.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
        {shown.custom.length > 0 && (
          <optgroup label="Custom equations">
            {shown.custom.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {searching && shown.first === undefined && (
        <div className="qzk-ds-meta" role="status">No model matches "{query.trim()}".</div>
      )}
    </>
  );
}
