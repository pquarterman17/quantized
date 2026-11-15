// Extracted from GridViewport.tsx (component-ceiling headroom): where each
// read-only Origin text column renders relative to the numeric run, per the
// file's own column order (worksheet audit follow-up) rather than always
// trailing every numeric column. `textColumnAnchors` (worksheetTable.ts,
// shared with Copy/Export) says which channel each text column follows in
// the file; `layoutTextColumns` (./textColumns) groups that against the
// CURRENTLY visible window so GridHeader/GridRow/GridStatsFooter each render
// every text column in exactly one spot. `anchors` is exposed too — the
// reveal-scroll effect needs it independent of the current scroll window, to
// resolve a target that may not be visible yet.

import { useMemo } from "react";

import type { TextColumn } from "../../../lib/originTextColumns";
import type { DataStruct } from "../../../lib/types";
import { layoutTextColumns, type TextColumnLayout } from "./textColumns";
import { textColumnAnchors } from "./worksheetTable";

export interface TextColumnPlacement {
  anchors: number[];
  layout: TextColumnLayout;
}

export function useTextColumnLayout(
  data: DataStruct,
  textCols: readonly TextColumn[],
  visibleCols: readonly number[],
): TextColumnPlacement {
  const anchors = useMemo(() => textColumnAnchors(data, textCols), [data, textCols]);
  const layout = useMemo(
    () => layoutTextColumns(textCols, anchors, visibleCols),
    [textCols, anchors, visibleCols],
  );
  return { anchors, layout };
}
