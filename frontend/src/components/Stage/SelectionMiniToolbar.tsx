// GUI_INTERACTION #8's "(optional) selection mini-toolbar" — the fourth
// registry consumer alongside the right-click menus, the ⌘K palette
// (lib/paletteContextActions), and (implicitly) the object menus themselves.
// A slim floating strip offering the currently-selected annotation/shape's
// registry actions without a right-click. Shares ToolHud's top-left corner
// (`.qzk-tool-hud`'s CSS class, for its base glass/typography styling) and
// render logic — the two are mutually exclusive by construction: ToolHud
// only renders for a non-pointer tool, this only for pointer mode with a
// live selection. conv-dependent entries (the pin toggle) pass `conv: null`
// and self-hide, same as the palette bridge.
//
// GUI_INTERACTION #17: unlike ToolHud (plain status text, nothing to
// click), this strip has real buttons — so it needs a real, unobstructed
// hit area. `.qzk-mini-toolbar` in shell.css overrides `.qzk-tool-hud`'s
// `top: 12px` to sit below the floating plot toolbar's row instead, since
// that toolbar can span nearly the full stage width at common viewports
// and would otherwise paint over (and swallow clicks on) this strip's
// rightmost buttons.

import { runContextAction, type ContextAction } from "../../lib/contextActions";
import { useApp } from "../../store/useApp";
import {
  annotationActions,
  shapeActions,
  type AnnotationActionTarget,
  type ShapeActionTarget,
} from "./annotationShapeActions";

function resolveLabel<T>(a: ContextAction<T>, t: T): string {
  return typeof a.label === "function" ? a.label(t) : a.label;
}

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

export default function SelectionMiniToolbar() {
  const plotTool = useApp((s) => s.plotTool);
  const selectedAnnotationId = useApp((s) => s.selectedAnnotationId);
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const annotations = useApp((s) => s.annotations);
  const shapes = useApp((s) => s.shapes);

  if (plotTool !== "pointer") return null;

  const annotation = selectedAnnotationId ? annotations.find((a) => a.id === selectedAnnotationId) : undefined;
  if (annotation) {
    const target: AnnotationActionTarget = { id: annotation.id, conv: null };
    return <Strip kind="Annotation" actions={annotationActions} target={target} />;
  }

  const shape = selectedShapeId ? shapes.find((x) => x.id === selectedShapeId) : undefined;
  if (!shape) return null;
  const target: ShapeActionTarget = { id: shape.id, conv: null };
  const kind = `${shape.kind[0].toUpperCase()}${shape.kind.slice(1)}`;
  return <Strip kind={kind} actions={shapeActions} target={target} />;
}
