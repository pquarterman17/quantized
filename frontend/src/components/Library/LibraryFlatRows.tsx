// Bundle diet slice 6 (plans/BUNDLE_HEADROOM.md): Library.tsx's flat-list
// fallback body — the `else` branch reached when the search box is empty AND
// the hierarchy has produced zero rows. Split out purely so `DatasetRow.tsx`
// (and the row-only siblings it exclusively pulls in — DatasetRowPreview,
// DatasetRowParts, Sparkline, datasetRowMenu) stop riding Library.tsx's own
// eager import into the entry chunk: LibraryTree.tsx and SmartFoldersSection.tsx
// already import DatasetRow directly, but both are themselves lazy chunks, so
// this was the ONLY static edge keeping DatasetRow eager.
//
// PR C (see Library.tsx's own header) means this branch is reached only when
// `rows.length === 0` — and every dataset always yields at least one
// hierarchy row (lib/libraryHierarchy.ts's buildLibraryHierarchy adds a
// worksheet node per dataset unconditionally), so `rows.length === 0`
// implies `datasets.length === 0`, which in turn means `shown` (filtered from
// `datasets`) is empty too. In today's app this component therefore never
// renders an actual row — but it stays as a real fallback (not deleted)
// because that invariant lives in a different module and is not something
// this file should assume without proof; the emptiness makes deferring it
// strictly free rather than merely cheap.
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
