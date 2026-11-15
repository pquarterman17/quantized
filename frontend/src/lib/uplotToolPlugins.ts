// The tool-dock plugin family, one LAZY chunk (bundle diet slice 27,
// plans/BUNDLE_HEADROOM.md): the pointer tools (pan, cursor readout, measure,
// region statistics -- lib/uplotPointerTools.ts) and the region-analysis tools
// (integrate / FWHM -- lib/uplotRegionTools.ts). None of them runs until its
// tool is picked, or until an integral or FWHM result exists, which takes
// that tool first. `buildOpts` reads this module through `toolPlugins()`
// (lib/axisExtrasHook.ts) and skips them while it is still loading.

export { measurePlugin, panPlugin, readoutPlugin, statsPlugin } from "./uplotPointerTools";
export { fwhmPlugin, integratePlugin } from "./uplotRegionTools";
