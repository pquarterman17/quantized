// The annotation and shape object menus, their registry actions and the
// selection mini-toolbar's strip, loaded on demand (bundle diet slice 30,
// `plans/BUNDLE_HEADROOM.md`). Everything here runs only after the user does
// something to a plot object: a right-click, a double-click on a label, a
// text-box placement, or a selection in pointer mode. The hooks that own the
// canvas bridges (`useAnnotationEdit`, `useShapeEdit`, `useShapeDraw`) and
// `SelectionMiniToolbar` stay eager and reach this module through
// `./objectMenusLoader`, which warms it as soon as a plot has an object to
// act on.
//
// The menu builders are the hooks' former `openMenu` bodies, moved verbatim:
// they read the store at the moment the menu opens and write through the same
// store actions, so the items, their order and their effects are unchanged.

import { buildMenuItems, resolveLabel, runContextAction, type ContextAction } from "../../lib/contextActions";
import type { Annotation } from "../../lib/types";
import { SERIES_VARS, cssVar } from "../../lib/uplotOpts";
import { DEFAULT_SHAPE_WIDTH, resolveShapeOpacity } from "../../lib/uplotShapes";
import { useApp } from "../../store/useApp";
import type { ContextMenuItem, Swatch } from "../overlays/ContextMenu";
import {
  annotationActions,
  annotationDeleteAction,
  annotationEditActions,
  annotationSizeActions,
  shapeActions,
  shapeDeleteAction,
  shapeToggleActions,
  type AnnotationActionTarget,
  type AnnotationConv,
  type ShapeActionTarget,
  type ShapeConv,
} from "./annotationShapeActions";

export { createAnnotationFromDialog, editAnnotationText } from "./annotationShapeActions";

// ── annotation object menu (was useAnnotationEdit's openMenu) ───────────

/** MAIN #27 "text box" Frame opacity submenu steps — same 25/50/75/100%
 *  shape as the Shape object menu's Opacity submenu (`useShapeEdit`). */
const FRAME_OPACITY_STEPS = [0.25, 0.5, 0.75, 1] as const;

const updateAnnotation = (id: string, patch: Partial<Annotation>): void => useApp.getState().updateAnnotation(id, patch);

// MAIN #27 "text box": set/replace the frame wholesale (a preset click) or
// patch just its opacity (the Opacity submenu, preserving any existing
// fill/stroke — e.g. Solid + a later opacity pick keeps the surface fill).
const setFrame = (id: string, frame: Annotation["frame"]) => updateAnnotation(id, { frame });
const setFrameOpacity = (id: string, opacity: number) => {
  const a = useApp.getState().annotations.find((x) => x.id === id);
  updateAnnotation(id, { frame: { ...(a?.frame ?? {}), opacity } });
};

/** The items of the menu a right-click on annotation `id` opens. */
export function annotationMenuItems(id: string, conv: AnnotationConv): ContextMenuItem[] {
  const a = useApp.getState().annotations.find((x) => x.id === id);
  const frameOpacity = a?.frame?.opacity ?? 1;
  const target = { id, conv };
  return [
    { header: a?.text || "Annotation" },
    ...buildMenuItems(annotationEditActions, target),
    // Frame: a parameterized picker (presets + an opacity submenu) — stays
    // hand-built, spliced between the registry blocks (the datasetRowMenu
    // "Move to …" precedent).
    {
      label: "Frame",
      submenu: [
        { label: "None", checked: !a?.frame, run: () => setFrame(id, undefined) },
        {
          label: "Subtle",
          checked: !!a?.frame && a.frame.fill === undefined,
          run: () => setFrame(id, { opacity: 0.15 }),
        },
        {
          label: "Solid",
          checked: !!a?.frame?.fill,
          // A canvas fillStyle needs a RESOLVED color, not a live
          // var(--x) reference — read the surface token NOW.
          run: () => setFrame(id, { fill: cssVar("--surface-2") || "#2a2a33", opacity: 1 }),
        },
        { separator: true },
        {
          label: "Opacity",
          disabled: !a?.frame,
          submenu: FRAME_OPACITY_STEPS.map((pct) => ({
            label: `${Math.round(pct * 100)}%`,
            checked: Math.abs(frameOpacity - pct) < 1e-6,
            run: () => setFrameOpacity(id, pct),
          })),
        },
      ],
    },
    ...buildMenuItems(annotationSizeActions, target),
    { separator: true },
    ...buildMenuItems([annotationDeleteAction], target),
  ];
}

// ── shape object menu (was useShapeEdit's openMenu) ─────────────────────

const OPACITY_STEPS = [0.25, 0.5, 0.75, 1] as const;
const WIDTH_STEPS = [1, 2, 3] as const;

/** The items of the menu a right-click on shape `id` opens, or null when the
 *  shape no longer exists (no menu opens). */
export function shapeMenuItems(id: string, conv: ShapeConv): ContextMenuItem[] | null {
  const s = useApp.getState().shapes.find((x) => x.id === id);
  if (!s) return null;
  const updateShape = useApp.getState().updateShape;
  const opacity = resolveShapeOpacity(s);
  const width = s.width ?? DEFAULT_SHAPE_WIDTH;
  const canFill = s.kind === "rect" || s.kind === "ellipse";
  const target = { id, conv };
  // The "ink" swatch shows the app's general foreground token as a stand-in
  // (the REAL resolved plot ink color depends on this window's background
  // override, resolved only at draw/export time) — clicking it clears the
  // override so the shape reverts to that resolved ink color.
  const strokeSwatches: Swatch[] = [
    ...SERIES_VARS.map((tok, i) => ({
      key: tok,
      title: `Series ${i + 1}`,
      css: `var(${tok})`,
      active: s.stroke === tok,
      run: () => updateShape(id, { stroke: tok }),
    })),
    {
      key: "ink",
      title: "Annotation ink (default)",
      css: cssVar("--text") || "#eee",
      active: s.stroke == null,
      run: () => updateShape(id, { stroke: undefined }),
    },
  ];
  const fillSwatches: Swatch[] = [
    ...SERIES_VARS.map((tok, i) => ({
      key: tok,
      title: `Series ${i + 1}`,
      css: `var(${tok})`,
      active: s.fill === tok,
      run: () => updateShape(id, { fill: tok }),
    })),
    {
      key: "match-stroke",
      title: "Match stroke (default)",
      css: cssVar("--text") || "#eee",
      active: s.fill == null,
      run: () => updateShape(id, { fill: undefined }),
    },
  ];
  return [
    { header: `${s.kind[0].toUpperCase()}${s.kind.slice(1)}` },
    { header: "Stroke" },
    { swatches: strokeSwatches },
    ...(canFill ? ([{ header: "Fill" }, { swatches: fillSwatches }] as ContextMenuItem[]) : []),
    {
      label: "Opacity",
      submenu: OPACITY_STEPS.map((pct) => ({
        label: `${Math.round(pct * 100)}%`,
        checked: Math.abs(opacity - pct) < 1e-6,
        run: () => updateShape(id, { opacity: pct }),
      })),
    },
    {
      label: "Width",
      submenu: WIDTH_STEPS.map((w) => ({
        label: `${w} pt`,
        checked: width === w,
        run: () => updateShape(id, { width: w }),
      })),
    },
    ...buildMenuItems(shapeToggleActions, target),
    { separator: true },
    ...buildMenuItems([shapeDeleteAction], target),
  ];
}

// ── selection mini-toolbar strip (was SelectionMiniToolbar's body) ──────

function Strip<T>({ kind, actions, target }: { kind: string; actions: ContextAction<T>[]; target: T }) {
  return (
    <div className="qzk-glass qzk-tool-hud qzk-mini-toolbar" role="toolbar" aria-label="Selected object actions">
      <span className="hint">{kind}</span>
      {actions
        .filter((a) => !a.hidden?.(target))
        .map((a) => (
          <button
            key={a.id}
            type="button"
            className={a.danger || a.destructive ? "danger" : undefined}
            disabled={a.enabled ? !a.enabled(target) : false}
            onClick={() => runContextAction(a, target)}
          >
            {resolveLabel(a, target)}
          </button>
        ))}
    </div>
  );
}

export function AnnotationStrip({ id }: { id: string }) {
  const target: AnnotationActionTarget = { id, conv: null };
  return <Strip kind="Annotation" actions={annotationActions} target={target} />;
}

export function ShapeStrip({ id, kind }: { id: string; kind: string }) {
  const target: ShapeActionTarget = { id, conv: null };
  return <Strip kind={kind} actions={shapeActions} target={target} />;
}
