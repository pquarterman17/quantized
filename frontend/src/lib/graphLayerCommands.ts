// Insert ▸ Inset graph / Image / Table (origin gap audit 3 #15): add a graph
// layer to the focused plot as one undo step. An inset graph or a table
// opens as a draft in Layer properties (to pick its curves / type its
// cells; Apply adds it); an image comes from a file the user picks — PNG,
// JPEG or SVG by its bytes (an SVG also keeps a PNG rendering, which the
// vector export embeds, since matplotlib cannot read SVG). Loaded on the
// first Insert of a layer.

import {
  DEFAULT_LAYER_AT,
  MAX_IMAGE_CHARS,
  MAX_IMAGE_PIXELS,
  MAX_LAYERS,
  defaultAxis,
  type GraphLayer,
  type ImageLayer,
  type LayerKind,
} from "./graphLayers";
import { newCurve } from "./layerContents";
import { is2DMap } from "./mapdata";
import { openFilePicker } from "./openFilePicker";
import { curveX, ownXKey } from "./perSeriesX";
import { effectiveChannels } from "./plotdata";
import type { LinkedCurve } from "./types";
import { openFigureDialog } from "../store/figureDialogs";
import { addLayer, layersOf, nextLayerId } from "../store/graphLayerEdit";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";

export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml";
/** Long side of an SVG's PNG rendering, px: crisp at a typical export size. */
const RASTER_PX = 1600;

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("not a readable image"));
    img.src = src;
  });
}

/** An SVG drawn to a PNG data URL (its long side `px`). */
async function rasterize(img: HTMLImageElement, px: number): Promise<string> {
  const w = img.naturalWidth || 300;
  const h = img.naturalHeight || 150;
  const k = px / Math.max(w, h);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export interface ImageDeps {
  load: (src: string) => Promise<{ naturalWidth: number; naturalHeight: number }>;
  /** A PNG rendering of an SVG, its long side `px`. */
  raster: (img: { naturalWidth: number; naturalHeight: number }, src: string, px: number) => Promise<string>;
}
const BROWSER: ImageDeps = {
  load: loadImage,
  raster: (img, _src, px) => rasterize(img as HTMLImageElement, px),
};

function readBytes(file: Blob, n: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsArrayBuffer(file.slice(0, n));
  });
}

/** What the file's BYTES are — never its name: a JPEG saved as `.png` shows
 *  on screen but no export reader takes it under the wrong label. "" when it
 *  is none of PNG, JPEG or SVG. */
export async function sniffImageType(file: Blob): Promise<string> {
  const b = await readBytes(file, 4096);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const text = new TextDecoder().decode(b).replace(/^\uFEFF/, "");
  return /^\s*</.test(text) && /<svg[\s>/]/i.test(text) ? "image/svg+xml" : "";
}

/** The image layer for `file`, or the reason it cannot be one. Placed in
 *  the upper left, sized to the image's own aspect. The type comes from the
 *  bytes, the pixel count is bounded, and an SVG's export rendering must fit
 *  the same size cap as any image. */
export async function imageLayerFromFile(file: File, deps: ImageDeps = BROWSER): Promise<ImageLayer | string> {
  const tooLarge = `${file.name} is too large to place on a graph (keep images under about 3 MB and 25 megapixels)`;
  if (file.size > (MAX_IMAGE_CHARS * 3) / 4) return tooLarge;
  const type = await sniffImageType(file);
  if (!type) return `${file.name} is not a PNG, JPEG or SVG image`;
  let src = await readDataUrl(file);
  src = src.replace(/^data:[^;,]*;/, `data:${type};`); // what the bytes are, whatever the name or file type says
  if (src.length > MAX_IMAGE_CHARS) return tooLarge;
  let img: { naturalWidth: number; naturalHeight: number };
  try {
    img = await deps.load(src);
  } catch {
    return `${file.name} could not be read as an image`;
  }
  const svg = type === "image/svg+xml";
  if (!svg && img.naturalWidth * img.naturalHeight > MAX_IMAGE_PIXELS) return tooLarge;
  let raster: string | undefined;
  for (const px of svg ? [RASTER_PX, RASTER_PX / 2] : []) {
    raster = await deps.raster(img, src, px).catch(() => "");
    if (!raster) return `${file.name} could not be prepared for export`;
    if (raster.length <= MAX_IMAGE_CHARS) break;
  }
  if (raster && raster.length > MAX_IMAGE_CHARS) return tooLarge;
  const [l, t, w] = DEFAULT_LAYER_AT.image;
  const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalHeight / img.naturalWidth : 1;
  const h = Math.min(0.6, Math.max(0.08, w * 1.6 * aspect)); // the plot frame is about 1.6 wide per 1 tall
  return { id: nextLayerId(), kind: "image", at: [l, Math.max(0, Math.min(t, 0.98 - h)), w, h], src, name: file.name, ...(raster ? { raster } : {}) };
}

/** Most curves a new inset starts with (a crowded graph would make a muddy
 *  thumbnail; more can be added in Layer properties). */
const MAX_SEED_CURVES = 8;

/** The active graph's visible curves as the new inset's starting set, each on
 *  its own X (Origin copies the parent's curves into a new inset). Empty when
 *  the active dataset is a map or has none plotted. */
function parentCurves(): LinkedCurve[] {
  const s = useApp.getState();
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || is2DMap(ds.data)) return [];
  const own = curveX(ds, s.xKey); // undefined = an X / non-curve column, never a curve
  return effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder)
    .filter((ch) => !s.hiddenChannels.includes(ch) && own[ch] !== undefined)
    .slice(0, MAX_SEED_CURVES)
    // The parent's own X per curve: a chosen X column, or the nearest preceding
    // X on a multi-X sheet (R2 against T2); null (the book's X) otherwise.
    .map((ch) => newCurve(ds, s.xKey === null ? null : ownXKey(ds, s.xKey, ch), ch));
}

function newLayer(kind: Exclude<LayerKind, "image">): GraphLayer {
  const at = [...DEFAULT_LAYER_AT[kind]] as GraphLayer["at"];
  return kind === "inset"
    ? { id: nextLayerId(), kind, at, curves: parentCurves(), x: defaultAxis(), y: defaultAxis(), mark: "line" }
    : { id: nextLayerId(), kind, at, rows: [["Quantity", "Value"], ["", ""]], header: true };
}

/** Insert a `kind` layer on the focused plot. An inset graph or a table is
 *  a DRAFT in Layer properties until Apply adds it (one undo step), so
 *  Cancel leaves nothing behind. */
export function insertGraphLayer(kind: LayerKind, pick: typeof openFilePicker = openFilePicker, deps: ImageDeps = BROWSER): void {
  const s = useApp.getState();
  if (!s.datasets.some((d) => d.id === s.activeId)) return toast("open a graph first, then insert a layer", "danger");
  if (s.polarMode || s.statMode || s.stackMode) return toast("layers draw on an XY plot: switch off polar, statistics or stacked view first", "danger");
  if (layersOf().length >= MAX_LAYERS) return toast(`a plot holds at most ${MAX_LAYERS} layers`, "danger");
  if (kind !== "image") {
    const layer = newLayer(kind);
    return openFigureDialog({ kind: "graphLayer", id: layer.id, draft: layer });
  }
  pick((files) => {
    if (!files[0]) return;
    void imageLayerFromFile(files[0], deps).then((out) => (typeof out === "string" ? toast(out, "danger") : addLayer(out)));
  }, IMAGE_ACCEPT);
}
