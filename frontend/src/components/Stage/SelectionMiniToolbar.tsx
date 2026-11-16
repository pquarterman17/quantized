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

import { useEffect, useState } from "react";

import { useApp } from "../../store/useApp";
import { loadObjectMenus, objectMenus } from "./objectMenusLoader";

/** The object-menu module, re-rendering once it lands. Starts the load only
 *  while `wanted` (a live selection in pointer mode); a failed load shows no
 *  strip and the next selection tries again (the right-click menu reports
 *  its own failure). */
function useObjectMenus(wanted: boolean) {
  const [mod, setMod] = useState(objectMenus);
  useEffect(() => {
    if (!wanted || mod) return;
    let live = true;
    loadObjectMenus().then(
      (m) => {
        if (live) setMod(() => m);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [wanted, mod]);
  return mod;
}

export default function SelectionMiniToolbar() {
  const plotTool = useApp((s) => s.plotTool);
  const selectedAnnotationId = useApp((s) => s.selectedAnnotationId);
  const selectedShapeId = useApp((s) => s.selectedShapeId);
  const annotations = useApp((s) => s.annotations);
  const shapes = useApp((s) => s.shapes);

  const annotation =
    plotTool === "pointer" && selectedAnnotationId ? annotations.find((a) => a.id === selectedAnnotationId) : undefined;
  const shape =
    plotTool === "pointer" && !annotation && selectedShapeId ? shapes.find((x) => x.id === selectedShapeId) : undefined;
  // The strip and its registry actions load with the object menus (bundle
  // diet slice 30); nothing shows until they have.
  const m = useObjectMenus(Boolean(annotation ?? shape));
  if (!m) return null;

  if (annotation) return <m.AnnotationStrip id={annotation.id} />;
  if (!shape) return null;
  const kind = `${shape.kind[0].toUpperCase()}${shape.kind.slice(1)}`;
  return <m.ShapeStrip id={shape.id} kind={kind} />;
}
