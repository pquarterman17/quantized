// Bundle diet slice 6 (plans/BUNDLE_HEADROOM.md): Library.tsx's flat-list
// fallback body — the `else if (shown.length > 0)` branch reached only when
// the search box is empty, the hierarchy has produced zero rows, AND there is
// something in `shown` to draw anyway. Split out purely so `DatasetRow.tsx`
// (and the row-only siblings it exclusively pulls in — DatasetRowPreview,
// DatasetRowParts, Sparkline, datasetRowMenu) stop riding Library.tsx's own
// eager import into the entry chunk: LibraryTree.tsx and SmartFoldersSection.tsx
// already import DatasetRow directly, but both are themselves lazy chunks, so
// this was the ONLY static edge keeping DatasetRow eager.
//
// PR C (see Library.tsx's own header) means `rows.length === 0` implies
// `datasets.length === 0` — every dataset always yields at least one
// hierarchy row (lib/libraryHierarchy.ts's buildLibraryHierarchy adds a
// worksheet node per dataset unconditionally, and flattenLibraryHierarchy
// always includes every root-level node) — which in turn means `shown`
// (filtered from `datasets`) is empty too. So `shown.length > 0` can NEVER
// be true at the same time as `rows.length === 0` in today's app: this
// component is an UNREACHABLE guard, not a live fallback. It is kept rather
// than deleted only because that invariant lives in a different module
// (lib/libraryHierarchy.ts) and this file should not assume it without
// proof — not because anything here still needs it. Do not describe this as
// "the flat list" in a way that implies it renders in practice; nothing
// exercises that claim because nothing can.
import DatasetRow from "./DatasetRow";
import type { Dataset } from "../../lib/types";

interface LibraryFlatRowsProps {
  shown: Dataset[];
  datasets: Dataset[];
  activeId: string | null;
  selectedIds: string[];
  canReorder: boolean;
  sheetOf: Map<string, number>;
  onFilterTag: (tag: string) => void;
}

export default function LibraryFlatRows({
  shown,
  datasets,
  activeId,
  selectedIds,
  canReorder,
  sheetOf,
  onFilterTag,
}: LibraryFlatRowsProps) {
  return (
    <>
      {shown.map((d) => (
        <DatasetRow
          key={d.id}
          dataset={d}
          active={d.id === activeId}
          selected={selectedIds.includes(d.id)}
          showReorder={canReorder}
          canMoveUp={datasets.indexOf(d) > 0}
          canMoveDown={datasets.indexOf(d) < datasets.length - 1}
          onFilterTag={onFilterTag}
          sheetNumber={sheetOf.get(d.id)}
          depth={0}
        />
      ))}
    </>
  );
}
