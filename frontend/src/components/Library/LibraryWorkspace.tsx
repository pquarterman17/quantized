// PR E: wide, main-workspace Tile browser. It consumes the same canonical
// hierarchy and open/select dispatchers as Tree and Details; it never invents
// a second Library model or mutates the active plot merely by browsing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LibraryNode, LibraryNodeKey } from "../../lib/libraryHierarchy";
import { useApp } from "../../store/useApp";
import { openLibraryNode, selectLibraryNode } from "./libraryOpen";
import { useLibraryHierarchyModel } from "./useLibraryHierarchyRows";

interface Props {
  onClose: () => void;
}

const KIND_LABEL: Record<LibraryNode["kind"], string> = {
  folder: "Folder",
  workbook: "Workbook",
  worksheet: "Worksheet",
  "origin-figure": "Origin figure",
  "editable-figure": "Editable figure",
  "publication-figure": "Publication figure",
  page: "Figure page",
  report: "Report",
};

const KIND_GLYPH: Record<LibraryNode["kind"], string> = {
  folder: "▰",
  workbook: "▤",
  worksheet: "▦",
  "origin-figure": "⌁",
  "editable-figure": "⌁",
  "publication-figure": "⌁",
  page: "▧",
  report: "≡",
};

function selectedKey(): LibraryNodeKey | null {
  const s = useApp.getState();
  if (s.librarySelection) return `${s.librarySelection.kind}:${s.librarySelection.id}` as LibraryNodeKey;
  return s.selectedIds[0] ? `worksheet:${s.selectedIds[0]}` : null;
}

function worksheetDimensions(node: Extract<LibraryNode, { kind: "worksheet" }>): string {
  // DataStruct.values is row-major (N rows × M value columns); time is a
  // separate axis vector and labels/units describe the M value columns.
  const rows = node.entity.data.values.length;
  const cols = node.entity.data.labels.length || node.entity.data.values[0]?.length || 0;
  return `${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"} × ${cols.toLocaleString()} ${cols === 1 ? "column" : "columns"}`;
}

function WorksheetPreview({ node }: { node: Extract<LibraryNode, { kind: "worksheet" }> }) {
  const columnCount = Math.min(4, node.entity.data.labels.length || node.entity.data.values[0]?.length || 0);
  const labels = Array.from(
    { length: columnCount },
    (_, index) => node.entity.data.labels[index] || `Column ${index + 1}`,
  );
  const rows = node.entity.data.values.slice(0, 3);
  return (
    <div className="qzk-tile-table" aria-label={`Data preview for ${node.name}`}>
      <div className="qzk-tile-table-row head">
        {labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
      {rows.map((row, rowIndex) => (
        <div className="qzk-tile-table-row" key={rowIndex}>
          {Array.from({ length: columnCount }, (_, col) => (
            <span key={col}>{row[col] == null ? "—" : String(row[col])}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function TilePreview({ node }: { node: LibraryNode }) {
  if (node.kind === "worksheet") return <WorksheetPreview node={node} />;
  if (node.kind === "folder" || node.kind === "workbook") {
    const children = node.children.length;
    return (
      <div className="qzk-tile-placeholder">
        <span aria-hidden="true">{KIND_GLYPH[node.kind]}</span>
        <small>{children} item{children === 1 ? "" : "s"}</small>
      </div>
    );
  }
  return (
    <div className="qzk-tile-placeholder">
      <span aria-hidden="true">{KIND_GLYPH[node.kind]}</span>
      <small>{node.source.missingDatasetIds.length ? "Source unavailable" : "Preview arrives in PR E-c"}</small>
    </div>
  );
}

function parentChain(node: LibraryNode | undefined, byKey: ReadonlyMap<LibraryNodeKey, LibraryNode>): LibraryNode[] {
  const chain: LibraryNode[] = [];
  let cursor = node;
  while (cursor) {
    chain.unshift(cursor);
    cursor = cursor.parentKey ? byKey.get(cursor.parentKey) : undefined;
  }
  return chain;
}

export default function LibraryWorkspace({ onClose }: Props) {
  const { hierarchy } = useLibraryHierarchyModel();
  const selection = useApp((s) => s.librarySelection);
  const selectedIds = useApp((s) => s.selectedIds);
  const initialKey = selectedKey();
  const initialNode = initialKey ? hierarchy.byKey.get(initialKey) : undefined;
  const [containerKey, setContainerKey] = useState<LibraryNodeKey | null>(() =>
    initialNode?.kind === "folder" || initialNode?.kind === "workbook" ? initialNode.key : initialNode?.parentKey ?? null,
  );
  const lastSelectionKey = useRef<LibraryNodeKey | null>(initialKey);
  const [rovingKey, setRovingKey] = useState<LibraryNodeKey | null>(initialKey);

  // The still-visible sidebar tree is a navigator for this workspace. When
  // its current folder/workbook changes, show that container; selecting a
  // child keeps its containing overview visible.
  useEffect(() => {
    const key = selection
      ? (`${selection.kind}:${selection.id}` as LibraryNodeKey)
      : selectedIds[0]
        ? (`worksheet:${selectedIds[0]}` as LibraryNodeKey)
        : null;
    if (!key || key === lastSelectionKey.current) return;
    lastSelectionKey.current = key;
    const node = hierarchy.byKey.get(key);
    if (!node) return;
    const nextContainer = node.kind === "folder" || node.kind === "workbook" ? node.key : node.parentKey;
    if (nextContainer !== containerKey) setContainerKey(nextContainer);
  }, [selection, selectedIds, hierarchy, containerKey]);

  const container = containerKey ? hierarchy.byKey.get(containerKey) : undefined;
  const items = container ? container.children : hierarchy.roots;
  const currentSelectedKey = selectedKey();
  const selectedInItems = items.some((node) => node.key === currentSelectedKey);
  const rovingInItems = items.some((node) => node.key === rovingKey);
  const tabStopKey = rovingInItems ? rovingKey : selectedInItems ? currentSelectedKey : items[0]?.key ?? null;
  const breadcrumbs = useMemo(() => parentChain(container, hierarchy.byKey), [container, hierarchy.byKey]);

  const close = useCallback((): void => {
    const key = selectedKey();
    if (key) useApp.getState().requestReveal(key);
    onClose();
    if (!key) return;
    let attempts = 0;
    const restoreFocus = (): void => {
      const row = document.querySelector(`[data-lib-row="${CSS.escape(key)}"], [data-ds-id="${CSS.escape(key.replace(/^worksheet:/, ""))}"]`) as HTMLElement | null;
      if (row) row.focus();
      else if (++attempts < 5) requestAnimationFrame(restoreFocus);
    };
    requestAnimationFrame(restoreFocus);
  }, [onClose]);

  // The narrow tree intentionally remains interactive while Tiles occupies
  // the Stage. Escape therefore belongs to the whole workspace session, not
  // only descendants of the tile section: focus may still be on the sidebar
  // Tiles button or a tree row when the user presses it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      // This workspace owns the keystroke. Do not also let the window-level
      // plot-tool Escape handler clear an unchanged plot gesture/tool.
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  const selectOrBrowse = (node: LibraryNode): void => {
    selectLibraryNode(node);
    if (node.kind === "folder" || node.kind === "workbook") setContainerKey(node.key);
  };

  const moveFocus = (current: HTMLElement, delta: number): void => {
    const tiles = [...current.closest(".qzk-tile-grid")!.querySelectorAll<HTMLElement>("[data-library-tile]")];
    const index = tiles.indexOf(current);
    tiles[Math.max(0, Math.min(tiles.length - 1, index + delta))]?.focus();
  };

  return (
    <section className="qzk-library-workspace" aria-label="Library workspace">
      <header className="qzk-library-workspace-head">
        <div>
          <div className="qzk-library-workspace-eyebrow">Library</div>
          <h1>{container?.name ?? "Project"}</h1>
          <nav className="qzk-library-breadcrumbs" aria-label="Library location">
            <button type="button" onClick={() => setContainerKey(null)}>Project</button>
            {breadcrumbs.map((node) => (
              <span key={node.key}>
                <span aria-hidden="true">/</span>
                <button type="button" onClick={() => setContainerKey(node.key)}>{node.name}</button>
              </span>
            ))}
          </nav>
        </div>
        <button type="button" className="qzk-library-return" onClick={close} title="Return to the unchanged active plot (Esc)">
          ← Back to plot <kbd>Esc</kbd>
        </button>
      </header>

      <div className="qzk-library-workspace-summary">
        <span>{items.length} item{items.length === 1 ? "" : "s"}</span>
        <span>Single-click selects or browses · Double-click or Enter opens</span>
      </div>

      {items.length === 0 ? (
        <div className="qzk-library-workspace-empty">This location is empty.</div>
      ) : (
        <div className="qzk-tile-grid" role="grid" aria-label={`${container?.name ?? "Project"} items`}>
          {items.map((node) => {
            const selected = node.key === currentSelectedKey;
            const dimensions = node.kind === "worksheet" ? worksheetDimensions(node) : null;
            return (
              <article
                key={node.key}
                role="gridcell"
                data-library-tile={node.key}
                className={`qzk-library-tile${selected ? " selected" : ""}`}
                tabIndex={node.key === tabStopKey ? 0 : -1}
                aria-label={`${node.name}, ${KIND_LABEL[node.kind]}`}
                onClick={() => selectOrBrowse(node)}
                onDoubleClick={() => openLibraryNode(node)}
                onFocus={() => setRovingKey(node.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    openLibraryNode(node);
                  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    event.preventDefault(); moveFocus(event.currentTarget, 1);
                  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    event.preventDefault(); moveFocus(event.currentTarget, -1);
                  }
                }}
              >
                <TilePreview node={node} />
                <div className="qzk-library-tile-copy">
                  <strong title={node.name}>{node.name}</strong>
                  <span>{KIND_LABEL[node.kind]}{dimensions ? ` · ${dimensions}` : ""}</span>
                  {node.source.missingDatasetIds.length > 0 && <em>Source unavailable</em>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
