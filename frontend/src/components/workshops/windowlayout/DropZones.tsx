// The drop-zone preview over the desk while a title bar is dragged (the
// mockup's dashed accent outline): the zone a release would dock into, drawn
// at the size the docked region will have (the desk's `--wl-*` edge sizes),
// and, for a docked window, a ghost label that follows the pointer. Nothing
// is drawn when a release would float the window. Purely visual; the drag
// itself is layoutDrag.ts.

import { useDragView } from "./layoutDrag";

export default function DropZones() {
  const view = useDragView();
  if (!view) return null;
  return (
    <div className="qzk-wl-zones" aria-hidden="true" data-testid="wl-zones">
      {view.slot && <div className={`qzk-wl-zone qzk-wl-zone-${view.slot}`} data-testid="wl-dropzone" data-slot={view.slot} />}
      {view.ghost && (
        <div className="qzk-wl-ghost" style={{ left: view.x, top: view.y }}>
          {view.title}
        </div>
      )}
    </div>
  );
}
