// Axis-title interaction bridge for buildOpts (mirrors useAnnotationEdit).
// Saved offsets + styles ALWAYS apply — a repositioned/formatted title stays
// put in every tool — while the drag + right-click Format menu are enabled
// only in the pointer tool. Also owns the Format context-menu state so
// PlotStage stays under its ceiling.

import { useMemo, useState } from "react";

import type { ContextMenuItem } from "../overlays/ContextMenu";
import type { AxisKey } from "../../lib/types";
import type { AxisLabelEditOpts } from "../../lib/uplotRichLabels";
import { useApp } from "../../store/useApp";

interface Menu {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/** Title-size presets offered under Format ▸ Size, in pt (the Axis dialog's unit);
 *  the stored size is px (pt x 4/3), the export sends it back as pt. */
const SIZE_PRESETS_PT = [8, 9, 10, 11, 12, 14, 16, 18] as const;

export function useAxisLabelEdit(tool: string): {
  bridge: AxisLabelEditOpts;
  menu: Menu | null;
  closeMenu: () => void;
} {
  const offsets = useApp((s) => s.axisLabelOffsets);
  const styles = useApp((s) => s.axisLabelStyles);
  const setAxisLabelOffset = useApp((s) => s.setAxisLabelOffset);
  const setAxisLabelStyle = useApp((s) => s.setAxisLabelStyle);
  const [open, setOpen] = useState<{ axis: AxisKey; x: number; y: number } | null>(null);
  const closeMenu = () => setOpen(null);

  const bridge = useMemo<AxisLabelEditOpts>(
    () => ({
      offsets,
      styles,
      interactive: tool === "pointer",
      onMove: (axis, offset) => setAxisLabelOffset(axis, offset),
      onReset: (axis) => setAxisLabelOffset(axis, null),
      onContextMenu: (axis, x, y) => setOpen({ axis, x, y }),
    }),
    [tool, offsets, styles, setAxisLabelOffset],
  );

  const menu = useMemo<Menu | null>(() => {
    if (!open) return null;
    const axis = open.axis;
    const st = styles[axis] ?? {};
    const items: ContextMenuItem[] = [
      {
        label: "Format",
        submenu: [
          {
            label: "Size",
            submenu: SIZE_PRESETS_PT.map((pt) => ({
              label: `${pt} pt`,
              checked: st.size != null && Math.abs(st.size * 0.75 - pt) < 0.01,
              run: () => setAxisLabelStyle(axis, { size: Math.round((pt * 4 / 3) * 1e4) / 1e4 }),
            })),
          },
          { label: "Italic", checked: !!st.italic, run: () => setAxisLabelStyle(axis, { italic: !st.italic }) },
          { label: "Bold", checked: !!st.bold, run: () => setAxisLabelStyle(axis, { bold: !st.bold }) },
        ],
      },
      { separator: true },
      {
        label: "Reset position",
        disabled: offsets[axis] === undefined,
        title: offsets[axis] === undefined ? "Already at its default position." : undefined,
        run: () => setAxisLabelOffset(axis, null),
      },
      {
        label: "Reset format",
        disabled: styles[axis] === undefined,
        title: styles[axis] === undefined ? "Already at its default format." : undefined,
        run: () => setAxisLabelStyle(axis, { size: undefined, italic: false, bold: false }),
      },
    ];
    return { x: open.x, y: open.y, items };
  }, [open, styles, offsets, setAxisLabelStyle, setAxisLabelOffset]);

  return { bridge, menu, closeMenu };
}
