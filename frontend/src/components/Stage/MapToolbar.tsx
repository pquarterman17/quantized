// Float toolbar for the 2-D map viewer — extracted out of MapStage.tsx
// (RSM_CUTS_PLAN item 6, "PAY FIRST") to buy headroom for the box-ROI
// wiring before it lands: MapStage was 396/400 lines, one grouped-props
// dumb view away from the extraction the size ratchet always wants first.
// Pure presentation: every control's VALUE and CALLBACK is owned by
// MapStage (channel picks, colormap, cut tool state, the new ROI arm
// toggle); this component only lays them out. No behaviour change from
// the block it replaces.

import { useCallback, useEffect, useId, useRef, useState, type Ref } from "react";

import type { ColormapName } from "../../lib/colormap";
import { lazyRegion } from "../../lib/lazyRegion";
import { useAnalysisExtras } from "../../store/analysisExtras";
import type { CutMode, CutSpace } from "../../lib/mapcuts";
import { mapViewFor } from "../../lib/mapView";
import { useApp } from "../../store/useApp";
import MapToolbarColorLimits from "./MapToolbarColorLimits";
import MapToolbarBoxPick from "./MapToolbarBoxPick";
import MapToolbarCutTools from "./MapToolbarCutTools";
import type { PickMode } from "./useMapPickTool";
import { useCompactToolbar, useStageSize } from "./useCompactStage";
import { dockFits } from "./map3dDockFit";
import { useMap3dPanelOpen } from "./useMap3dPanelOpen";

// The static 3-D view panel is a lazy chunk, fetched on first open.
const Map3dPanel = lazyRegion(() => import("./Map3dPanel"), "3-D view");

/** Box-ROI arm/disarm state (RSM_CUTS_PLAN item 6). Defined here (not in
 *  useMapRoi.ts) so this toolbar's extraction commit — step 1, "PAY
 *  FIRST" — stands alone with no dependency on the ROI hook that lands
 *  after it; useMapRoi.ts imports this type instead of the reverse. */
export type RoiMode = "off" | "roi";

/** Cut-ruler arm/disarm state (RSM_CUTS_PLAN item 7) — same reasoning as
 *  `RoiMode`: lives here so useMapRuler.ts imports the type, not the
 *  reverse. Box and ruler are mutually exclusive; MapStage.tsx's
 *  toggleRoi/toggleRuler/setCutMode keep only one of {roi, ruler, cuts}
 *  armed at a time. */
export type RulerMode = "off" | "ruler";

/** Sector-wedge arm/disarm state (RSM_CUTS_PLAN item 12) — same reasoning as
 *  `RoiMode`/`RulerMode`: lives here so useMapSectorWedge.ts imports the
 *  type, not the reverse. Mutually exclusive with box/ruler/cuts (same
 *  canvas pointer gestures). */
export type WedgeMode = "off" | "sector";

export interface MapToolbarProps {
  /** The dataset THIS map instance is bound to — the Stage tab's active
   *  dataset, or (document window) whatever it is bound to explicitly. Every
   *  write this toolbar makes already keys off it (`onCmapChange`,
   *  `onToggleLogZ`, …); the colour-limit control below is the same —
   *  it writes through `setMapColorLimits(datasetId, …)`, never the
   *  app-wide active dataset (P2.8 residual (a)). */
  datasetId: string | null;
  /** What THIS map instance's own last paint used as its colour range —
   *  `undefined` before its first paint, `null` when nothing was paintable
   *  (review round 7, finding 1). Forwarded to `MapToolbarColorLimits` so its
   *  "effective" hint describes what THIS toolbar's own canvas is doing,
   *  never another open map's, even when they share a dataset. */
  painted: readonly [number, number] | null | undefined;

  /** Angular ⇄ Q axis toggle (only shown when the dataset carries both). */
  qAvailable: boolean;
  isAngular: boolean;
  isQ: boolean;
  onAngular: () => void;
  onQ: () => void;

  /** X/Y/Z channel pickers. */
  labels: string[];
  keys: [number, number, number];
  onKeyChange: (slot: 0 | 1 | 2, value: number) => void;

  cmap: ColormapName;
  cmapOptions: string[];
  onCmapChange: (v: ColormapName) => void;
  logZ: boolean;
  onToggleLogZ: () => void;
  contourOn: boolean;
  onToggleContour: () => void;

  /** Cut tools (H/V/segment/projections) — only meaningful on an RSM axis
   *  pair, hence the whole group is gated on `cutSpace != null`. */
  cutSpace: CutSpace | null;
  gridable: boolean;
  cutMode: CutMode;
  onSetCutMode: (m: CutMode) => void;
  cutWidth: number;
  onSetCutWidth: (w: number) => void;
  cutWidthTooltip: string;
  onProjection: (axis: "pixels" | "frames") => void;

  /** Box ROI arm/disarm (RSM_CUTS_PLAN item 6) — lives in the same
   *  cutSpace-gated group as the other drawing tools; MapStage keeps it
   *  mutually exclusive with `cutMode` (arming one disarms the other). */
  roiMode: RoiMode;
  onToggleRoi: () => void;

  /** Cut-ruler arm/disarm (RSM_CUTS_PLAN item 7) — same group, mutually
   *  exclusive with both `roiMode` and `cutMode`. */
  rulerMode: RulerMode;
  onToggleRuler: () => void;

  /** Sector-wedge arm/disarm (RSM_CUTS_PLAN item 12) — visible only when
   *  `qAvailable` (the wedge is meaningless without Q columns at all);
   *  disabled with a reason, not hidden, when `cutSpace` isn't currently
   *  "q" (the wedge needs the Q view on screen — see `useMapSectorWedge.ts`'s
   *  header). */
  wedgeMode: WedgeMode;
  onToggleWedge: () => void;

  /** The Box can be drawn here: on an RSM pair (its button is in the cut tools)
   *  or on any other map's own axes (its button is the standalone one). */
  boxDrawable: boolean;
  /** Pick-point arm/disarm — click the map to fill the pixel-extraction
   *  location (lib/mapPick.ts). Mutually exclusive with the other tools. */
  pickMode: PickMode;
  onTogglePick: () => void;

  /** ⤓ — opens the export dialog (vector PDF/SVG by default, or PNG). */
  onExport: () => void;
  /** Receives the dock element, so the stage can keep its map below it. */
  dockRef?: Ref<HTMLDivElement>;
}

export default function MapToolbar(props: MapToolbarProps) {
  const {
    datasetId,
    painted,
    qAvailable,
    isAngular,
    isQ,
    onAngular,
    onQ,
    labels,
    keys,
    onKeyChange,
    cmap,
    cmapOptions,
    onCmapChange,
    logZ,
    onToggleLogZ,
    contourOn,
    onToggleContour,
    cutSpace,
    gridable,
    cutMode,
    onSetCutMode,
    cutWidth,
    onSetCutWidth,
    cutWidthTooltip,
    onProjection,
    roiMode,
    onToggleRoi,
    rulerMode,
    onToggleRuler,
    wedgeMode,
    onToggleWedge,
    boxDrawable,
    pickMode,
    onTogglePick,
    onExport,
    dockRef,
  } = props;
  // Starts closed (it covers half the scene); remembers the last choice (lib/map3dPanelPrefs.ts).
  const [show3d, setShow3d] = useMap3dPanelOpen();
  const on3d = useApp((s) => !!mapViewFor(s.mapViews, datasetId).view3d);

  const own = useRef<HTMLDivElement | null>(null);
  const size = useStageSize(own);
  const compact = useCompactToolbar(size);
  // Wide enough: the stage docks the open panel beside the scene (`map3dDockFit.ts`), so none floats here.
  const docked = show3d && dockFits(size?.w);
  const [menu, setMenu] = useState(false);
  const menuId = useId();
  // Stable, so React does not detach and re-attach the ref (a null then the element into the parent) every render.
  const setDock = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el;
      if (typeof dockRef === "function") dockRef(el);
      else if (dockRef) (dockRef as { current: HTMLDivElement | null }).current = el;
    },
    [dockRef],
  );
  const open = compact && menu;
  // A widened window forgets the menu, so narrowing it again does not pop it open unasked.
  useEffect(() => {
    if (!compact) setMenu(false);
  }, [compact]);
  // Closing the menu unmounts the colour-limit fields: blur first so a typed limit commits (blur is its commit) instead of vanishing.
  const closeMenu = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && own.current?.contains(focused)) focused.blur();
    setMenu(false);
  };
  // The collapsed menu closes on Escape (focus returns to its button) and on a press outside it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!own.current?.contains(e.target as Node)) closeMenu();
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  // Closing the 3-D panel hands focus back to the button that opens it (the Map tools button when collapsed).
  const close3d = () => {
    setShow3d(false);
    own.current?.querySelector<HTMLElement>(compact ? "[data-map-menu]" : "[data-map3d-btn]")?.focus();
  };
  const controls = (
    <>
      {qAvailable && (
        <>
          <button
            aria-pressed={isAngular}
            className={`qzk-tool-btn${isAngular ? " active" : ""}`}
            title="Angular axes (2θ / ω)"
            onClick={onAngular}
          >
            2θ/ω
          </button>
          <button aria-label="Q-space axes" aria-pressed={isQ} className={`qzk-tool-btn${isQ ? " active" : ""}`} title="Reciprocal-space axes (Qx / Qz)" onClick={onQ}>
            Q
          </button>
          <span className="qzk-tool-sep" />
        </>
      )}
      {(["X", "Y", "Z"] as const).map((axis, slot) => (
        <Picker
          key={axis}
          label={axis}
          name={`${axis} channel`}
          value={keys[slot]}
          options={labels.map((lab, i) => ({ v: i, text: lab }))}
          onChange={(v) => onKeyChange(slot as 0 | 1 | 2, Number(v))}
        />
      ))}
      <span className="qzk-tool-sep" />
      <Picker
        label="map"
        name="Colormap"
        value={cmap}
        options={cmapOptions.map((n) => ({ v: n, text: n }))}
        onChange={(v) => onCmapChange(v as ColormapName)}
      />
      <button
        aria-label="Log intensity scale"
        aria-pressed={logZ}
        className={`qzk-tool-btn${logZ ? " active" : ""}`}
        title="Log intensity scale (for high-dynamic-range data like RSM)"
        onClick={onToggleLogZ}
      >
        log
      </button>
      <button
        aria-label="Contours"
        aria-pressed={contourOn}
        className={`qzk-tool-btn${contourOn ? " active" : ""}`}
        title="Contour lines (level count + lin/log spacing live in the Inspector's 2-D map card)"
        onClick={onToggleContour}
      >
        ∿
      </button>
      <MapToolbarColorLimits datasetId={datasetId} painted={painted} />
      <button
        aria-label="3-D view"
        data-map3d-btn=""
        aria-expanded={show3d}
        className={`qzk-tool-btn${on3d || show3d ? " active" : ""}`}
        title="3-D view — Surface, 3-D scatter or 3-D waterfall: drag to rotate, wheel to zoom; ⤓ exports the view on screen"
        onClick={() => {
          setShow3d((v) => !v);
          closeMenu(); // collapsed: the 3-D panel opens under the Map tools button instead
        }}
      >
        3D
      </button>
      {cutSpace != null && (
        <MapToolbarCutTools
          qAvailable={qAvailable}
          cutSpace={cutSpace}
          gridable={gridable}
          cutMode={cutMode}
          onSetCutMode={onSetCutMode}
          cutWidth={cutWidth}
          onSetCutWidth={onSetCutWidth}
          cutWidthTooltip={cutWidthTooltip}
          onProjection={onProjection}
          roiMode={roiMode}
          onToggleRoi={onToggleRoi}
          rulerMode={rulerMode}
          onToggleRuler={onToggleRuler}
          wedgeMode={wedgeMode}
          onToggleWedge={onToggleWedge}
        />
      )}
      <MapToolbarBoxPick
        showBox={cutSpace == null && boxDrawable}
        roiMode={roiMode}
        onToggleRoi={onToggleRoi}
        pickMode={pickMode}
        onTogglePick={onTogglePick}
      />
      <button aria-label="Map operations" className="qzk-tool-btn" title="Map operations: crop, flip, rotate, level, map math" onClick={() => { useAnalysisExtras.getState().show("map-ops"); closeMenu(); }}>
        ⊞
      </button>
      <span className="qzk-tool-sep" />
      <button aria-label="Export map" className="qzk-tool-btn" title="Export map (PDF, SVG or PNG)…" onClick={onExport}>
        ⤓
      </button>
    </>
  );
  return (
    <div
      ref={setDock}
      className={`qzk-glass qzk-float-tools${compact ? " qzk-map-compact" : ""}`}
      role={compact ? undefined : "toolbar"}
      aria-label={compact ? undefined : "Map tools"}
      style={{ gap: 8, padding: "6px 8px", zIndex: 3 }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation();
        setMenu(false);
        own.current?.querySelector<HTMLElement>("[data-map-menu]")?.focus();
      }}
    >
      {compact ? (
        <>
          <button type="button" data-map-menu="" className="qzk-tool-btn qzk-map-menu-btn" aria-expanded={open} aria-controls={menuId} title="Map tools: channels, colormap, cuts, export" onClick={() => setMenu((v) => !v)}>
            Map tools ▾
          </button>
          {open && (
            <div id={menuId} role="toolbar" aria-label="Map tools" className="qzk-glass qzk-map-menu" style={{ maxWidth: Math.max(160, (size?.w ?? 320) - 16), maxHeight: Math.max(120, (size?.h ?? 240) - 56) }}>
              {controls}
            </div>
          )}
        </>
      ) : (
        controls
      )}
      {show3d && !docked &&
        (compact ? (
          <div className="qzk-map-3d-anchor">
            <Map3dPanel datasetId={datasetId} onClose={close3d} />
          </div>
        ) : (
          <Map3dPanel datasetId={datasetId} onClose={close3d} />
        ))}
    </div>
  );
}

// A compact labeled <select> for the float toolbar (channel / colormap / grid).
function Picker({
  label,
  value,
  options,
  onChange,
  title,
  name,
}: {
  label: string;
  /** Accessible name, when the visible `label` is too terse to be one ("X"). */
  name?: string;
  value: string | number;
  options: { v: string | number; text: string }[];
  onChange: (v: string) => void;
  title?: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }} title={title}>
      {label}
      <select className="qz-select" aria-label={name} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={String(o.v)} value={o.v}>
            {o.text}
          </option>
        ))}
      </select>
    </label>
  );
}
