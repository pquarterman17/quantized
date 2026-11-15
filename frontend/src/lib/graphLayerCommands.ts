// Insert ▸ Inset graph / Image / Table (origin gap audit 3 #15): add a graph
// layer to the focused plot as one undo step. An inset graph or a table
// opens straight into Layer properties (to pick its curves / type its
// cells); an image comes from a file the user picks — PNG, JPEG or SVG (an
// SVG also keeps a PNG rendering, which the vector export embeds, since
// matplotlib cannot read SVG). Loaded on the first Insert of a layer.

import {
  DEFAULT_LAYER_AT,
  MAX_IMAGE_CHARS,
  defaultAxis,
  type GraphLayer,
  type ImageLayer,
  type LayerKind,
} from "./graphLayers";
import { openFilePicker } from "./openFilePicker";
import { openFigureDialog } from "../store/figureDialogs";
import { addLayer, nextLayerId } from "../store/graphLayerEdit";
import { toast } from "../store/toasts";
import { useApp } from "../store/useApp";

export const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml";
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml" };
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

/** An SVG drawn to a PNG data URL (its long side `RASTER_PX`). */
async function rasterize(img: HTMLImageElement): Promise<string> {
  const w = img.naturalWidth || 300;
  const h = img.naturalHeight || 150;
  const k = RASTER_PX / Math.max(w, h);
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
  raster: (img: { naturalWidth: number; naturalHeight: number }, src: string) => Promise<string>;
}
const BROWSER: ImageDeps = {
  load: loadImage,
  raster: (img) => rasterize(img as HTMLImageElement),
};

/** The image layer for `file`, or the reason it cannot be one. Placed in
 *  the upper left, sized to the image's own aspect. */
export async function imageLayerFromFile(file: File, deps: ImageDeps = BROWSER): Promise<ImageLayer | string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = TYPES[ext] ?? (Object.values(TYPES).includes(file.type) ? file.type : "");
  if (!type) return `${file.name} is not a PNG, JPEG or SVG image`;
  let src = await readDataUrl(file);
  src = src.replace(/^data:[^;,]*;/, `data:${type};`); // a blank or generic file type
  if (src.length > MAX_IMAGE_CHARS) return `${file.name} is too large to place on a graph (keep images under about 3 MB)`;
  let img: { naturalWidth: number; naturalHeight: number };
  try {
    img = await deps.load(src);
  } catch {
    return `${file.name} could not be read as an image`;
  }
  const raster = type === "image/svg+xml" ? await deps.raster(img, src).catch(() => "") : undefined;
  if (raster === "") return `${file.name} could not be prepared for export`;
  const [l, t, w] = DEFAULT_LAYER_AT.image;
  const aspect = img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalHeight / img.naturalWidth : 1;
  const h = Math.min(0.6, Math.max(0.08, w * 1.6 * aspect)); // the plot frame is about 1.6 wide per 1 tall
  return { id: nextLayerId(), kind: "image", at: [l, t, w, h], src, name: file.name, ...(raster ? { raster } : {}) };
}

function newLayer(kind: Exclude<LayerKind, "image">): GraphLayer {
  const at = [...DEFAULT_LAYER_AT[kind]] as GraphLayer["at"];
  return kind === "inset"
    ? { id: nextLayerId(), kind, at, curves: [], x: defaultAxis(), y: defaultAxis(), mark: "line" }
    : { id: nextLayerId(), kind, at, rows: [["Quantity", "Value"], ["", ""]], header: true };
}

/** Insert a `kind` layer on the focused plot. */
export function insertGraphLayer(kind: LayerKind, pick: typeof openFilePicker = openFilePicker, deps: ImageDeps = BROWSER): void {
  const s = useApp.getState();
  if (!s.datasets.some((d) => d.id === s.activeId)) return toast("open a graph first, then insert a layer", "danger");
  if (s.polarMode || s.statMode || s.stackMode) return toast("layers draw on an XY plot: switch off polar, statistics or stacked view first", "danger");
  if (kind !== "image") {
    const layer = newLayer(kind);
    addLayer(layer);
    return openFigureDialog({ kind: "graphLayer", id: layer.id });
  }
  pick((files) => {
    if (!files[0]) return;
    void imageLayerFromFile(files[0], deps).then((out) => (typeof out === "string" ? toast(out, "danger") : addLayer(out)));
  }, IMAGE_ACCEPT);
}
