// When the open 3-D panel sits BESIDE the scene instead of over it. The panel is
// `PANEL_W` wide; the scene keeps its 8 px margin on both sides and `DOCK_GAP`
// between it and the panel. It docks only if the scene is then still at least
// `MIN_SCENE_W` wide: 480 px is the narrowest the box, its axis titles and the
// 96 px colour bar share without `frameFor` having to shrink the margins (that
// narrow regime starts below 600 px, and the panel takes the scene past it only
// when the pane is wide to begin with). That is a stage of 754 px and up: a full
// width map (about 940) docks, a half-width window (about 640) keeps the overlay.

export const PANEL_W = 250;
export const DOCK_GAP = 8;
export const MIN_SCENE_W = 480;
/** The scene's right inset (px) when the panel is docked. */
export const DOCK_INSET = PANEL_W + DOCK_GAP;

/** Whether a stage `stageW` px wide leaves the scene enough room beside the panel (unmeasured: no). */
export const dockFits = (stageW: number | undefined): boolean => !!stageW && stageW - 16 - DOCK_INSET >= MIN_SCENE_W;
