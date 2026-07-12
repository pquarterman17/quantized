// Rich-text axis-label + title plugin (GOTO #5). `buildOpts` is the single
// chokepoint: when an axis label / title parses as rich text it blanks the
// plain uPlot label (label: "" still RESERVES the labelSize band) and pushes
// this plugin, so every plot window that builds through uplotOpts —
// PlotStage, snapshot/pinned windows, MultiPanel facets, waterfall, refl,
// inset — renders rich labels with zero per-caller wiring.
//
// Canvas axis labels replicate uPlot 1.6.32's own label pass (uPlot.esm.js
// "axis label" block): position from the axis's internal `_lpos` (the inner
// edge of the reserved label band, CSS px) + labelGap, centered on the plot
// area; side 2 (bottom x) draws with a TOP baseline, sides 3/1 (left/right
// y) rotate ∓90° around the band line with a BOTTOM baseline. Our renderer
// draws on the ALPHABETIC baseline, so top/bottom convert via fixed
// ascent/descent fractions (≈0.78/0.22 em of the UI font) — within ~1 px of
// uPlot's plain draw at label sizes.
//
// The title is a DOM element (uPlot's `.u-title` div): the init hook swaps
// its text content for rich DOM nodes (<i>/<sub>/<sup>), keeping uPlot's own
// layout/height reservation untouched.

import type uPlot from "uplot";

import { claimCursor } from "./annotationHit";
import { axisLabelRect, hitAxisLabel, type LabelRect } from "./axisLabelHit";
import type { RichNode } from "./richtext";
import { ASCENT_EM, DESCENT_EM, drawRich, measureRich } from "./richtextCanvas";
import type { AxisKey, AxisLabelOffsets } from "./types";

/** Drag-to-reposition the axis titles (Origin-parity, persisted in the view).
 *  `offsets` ALWAYS apply (a moved title stays moved in every tool); the drag
 *  interaction (and its onMove/onReset/onEdit commits) is only wired when
 *  `interactive` (the pointer tool). */
export interface AxisLabelEditOpts {
  offsets: AxisLabelOffsets;
  interactive: boolean;
  onMove: (axis: AxisKey, offset: [number, number]) => void;
  onReset: (axis: AxisKey) => void;
  onEdit?: (axis: AxisKey) => void;
}

const AXIS_KEYS: readonly AxisKey[] = ["x", "y", "y2"];
const DRAG_THRESHOLD = 3; // px — a shorter move is a click, not a drag

export interface RichLabelAsts {
  x?: RichNode[] | null;
  y?: RichNode[] | null;
  y2?: RichNode[] | null;
  title?: RichNode[] | null;
}

export interface RichLabelStyle {
  /** Axis-title font size in CSS px (uplotOpts's `titlePx`). */
  px: number;
  /** UI font family (the `--font-ui` stack — labels are prose, not data). */
  family: string;
  /** Label ink — the same axis stroke colour uPlot's plain label uses. */
  color: string;
  weight?: string;
}

/** AST -> DOM nodes for HTML surfaces owned imperatively (the uPlot title).
 *  React surfaces (legend, editor previews) use components/primitives/RichText
 *  instead; both renderers walk the same AST shape. */
export function richDomFragment(nodes: RichNode[], doc: Document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  for (const n of nodes) {
    if (n.kind === "text") {
      if (n.italic) {
        const i = doc.createElement("i");
        i.textContent = n.text;
        frag.appendChild(i);
      } else {
        frag.appendChild(doc.createTextNode(n.text));
      }
    } else if (n.kind === "frac") {
      // Stacked column with a rule (MAIN #28); mirrors RichText.tsx's CSS.
      const col = doc.createElement("span");
      col.style.cssText =
        "display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1.05;margin:0 0.15em";
      const num = doc.createElement("span");
      num.style.cssText = "border-bottom:1px solid currentColor;padding:0 0.15em";
      num.appendChild(richDomFragment(n.num, doc));
      const den = doc.createElement("span");
      den.style.cssText = "padding:0 0.15em";
      den.appendChild(richDomFragment(n.den, doc));
      col.append(num, den);
      frag.appendChild(col);
    } else if (n.kind === "sqrt") {
      const wrap = doc.createElement("span");
      wrap.style.whiteSpace = "nowrap";
      if (n.index) {
        const sup = doc.createElement("sup");
        sup.style.fontSize = "0.6em";
        sup.appendChild(richDomFragment(n.index, doc));
        wrap.appendChild(sup);
      }
      wrap.appendChild(doc.createTextNode("√"));
      const rad = doc.createElement("span");
      rad.style.cssText = "border-top:1px solid currentColor;padding:0 0.1em";
      rad.appendChild(richDomFragment(n.radicand, doc));
      wrap.appendChild(rad);
      frag.appendChild(wrap);
    } else if (n.kind === "bigop") {
      const glyph = doc.createElement("span");
      glyph.style.fontSize = "1.3em";
      glyph.textContent = n.op;
      if (!n.over && !n.under) {
        frag.appendChild(glyph);
      } else {
        const col = doc.createElement("span");
        col.style.cssText =
          "display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;line-height:1";
        if (n.over) {
          const o = doc.createElement("span");
          o.style.fontSize = "0.6em";
          o.appendChild(richDomFragment(n.over, doc));
          col.appendChild(o);
        }
        col.appendChild(glyph);
        if (n.under) {
          const u = doc.createElement("span");
          u.style.fontSize = "0.6em";
          u.appendChild(richDomFragment(n.under, doc));
          col.appendChild(u);
        }
        frag.appendChild(col);
      }
    } else {
      const el = doc.createElement(n.kind); // "sub" | "sup"
      el.style.fontSize = "0.7em"; // match the canvas SCRIPT_SCALE
      el.appendChild(richDomFragment(n.children, doc));
      frag.appendChild(el);
    }
  }
  return frag;
}

/** uPlot keeps the label band position on the axis object (internal). */
type AxisWithLpos = uPlot.Axis & { _lpos?: number };

export function richLabelsPlugin(
  asts: RichLabelAsts,
  style: RichLabelStyle,
  edit?: AxisLabelEditOpts,
  // Axes uPlot has BLANKED so the plugin must DRAW them (rich labels + any with
  // a drag offset). Others are drawn by uPlot at their default position; the
  // plugin only MEASURES them (for the drag hit-box) — this keeps plain,
  // unmoved titles on uPlot's own draw (zero rendering change).
  drawn?: Partial<Record<AxisKey, boolean>>,
): uPlot.Plugin {
  // Axis index convention fixed by buildOpts: 0 = x, 1 = y, 2 = y2.
  const byAxis: (RichNode[] | null | undefined)[] = [asts.x, asts.y, asts.y2];
  // CSS-px hit boxes for each drawn title, refreshed every draw (drag reads them).
  const rects: Partial<Record<AxisKey, LabelRect>> = {};
  // Live drag preview: overrides the committed offset for the dragged axis.
  let drag: { axis: AxisKey; live: [number, number] } | null = null;
  const offsetFor = (axis: AxisKey): [number, number] =>
    drag && drag.axis === axis ? drag.live : (edit?.offsets[axis] ?? [0, 0]);

  return {
    hooks: {
      init: (u: uPlot): void => {
        if (!asts.title) return;
        const el = u.root.querySelector(".u-title");
        if (!el) return;
        el.textContent = "";
        el.appendChild(richDomFragment(asts.title, el.ownerDocument));
      },
      draw: (u: uPlot): void => {
        const pxr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
        const { ctx } = u;
        const cssCenterX = (u.bbox.left + u.bbox.width / 2) / pxr;
        const cssCenterY = (u.bbox.top + u.bbox.height / 2) / pxr;
        byAxis.forEach((ast, i) => {
          const key = AXIS_KEYS[i];
          if (!ast || ast.length === 0) {
            delete rects[key];
            return;
          }
          const axis = u.axes[i] as AxisWithLpos | undefined;
          if (!axis || axis._lpos == null) {
            delete rects[key];
            return;
          }
          // Same defaults buildOpts produces: x bottom (2), y left (3), y2 right (1).
          const side = axis.side ?? (i === 0 ? 2 : i === 1 ? 3 : 1);
          const shiftDir = side === 0 || side === 3 ? -1 : 1;
          const lposCss = axis._lpos + (axis.labelGap ?? 0) * shiftDir;
          const lpos = Math.round(lposCss * pxr);
          const px = style.px * pxr; // uPlot scales fonts to device px; so do we
          const font = { px, family: style.family, weight: style.weight ?? "600" };
          const vertical = side % 2 === 1;
          // The plugin DRAWS a title only when uPlot blanked it (rich / offset)
          // or it's being dragged; otherwise uPlot draws it at default and the
          // plugin only measures its width for the hit box.
          const isDrawn = !!drawn?.[key] || drag?.axis === key;
          const [dx, dy] = isDrawn ? offsetFor(key) : ([0, 0] as [number, number]);
          let cssW = 0;
          ctx.save();
          if (!isDrawn) {
            cssW = measureRich(ctx, ast, font) / pxr;
          } else if (vertical) {
            ctx.translate(lpos + dx * pxr, Math.round(u.bbox.top + u.bbox.height / 2) + dy * pxr);
            ctx.rotate((side === 3 ? -Math.PI : Math.PI) / 2);
            cssW = drawRich(ctx, ast, 0, -DESCENT_EM * px, font, style.color, "center") / pxr;
          } else {
            const x = Math.round(u.bbox.left + u.bbox.width / 2) + dx * pxr;
            // side 2 (bottom): uPlot uses a TOP baseline at lpos; side 0: BOTTOM.
            const y = (side === 2 ? lpos + ASCENT_EM * px : lpos - DESCENT_EM * px) + dy * pxr;
            cssW = drawRich(ctx, ast, x, y, font, style.color, "center") / pxr;
          }
          ctx.restore();
          // Record the CSS-px grab box centered on the (offset) title.
          const cx = vertical ? lposCss + dx : cssCenterX + dx;
          const cy = vertical ? cssCenterY + dy : lposCss + style.px * 0.5 + dy;
          rects[key] = axisLabelRect(cx, cy, cssW, style.px, vertical);
        });
      },
      ready: edit?.interactive
        ? (u: uPlot): void => {
            const root = u.root;
            const at = (e: MouseEvent): { x: number; y: number } => {
              const r = root.getBoundingClientRect();
              return { x: e.clientX - r.left, y: e.clientY - r.top };
            };
            root.addEventListener("mousemove", (e: MouseEvent) => {
              if (drag) return; // cursor fixed while a drag owns the pointer
              const p = at(e);
              if (hitAxisLabel(rects, p.x, p.y)) {
                root.style.cursor = "move";
                claimCursor(e); // don't let a sibling plugin clobber it back
              }
            });
            root.addEventListener("dblclick", (e: MouseEvent) => {
              const axis = hitAxisLabel(rects, at(e).x, at(e).y);
              if (axis && edit.onEdit) {
                e.preventDefault();
                e.stopImmediatePropagation();
                edit.onEdit(axis);
              }
            });
            root.addEventListener("contextmenu", (e: MouseEvent) => {
              const axis = hitAxisLabel(rects, at(e).x, at(e).y);
              if (axis && edit.offsets[axis]) {
                e.preventDefault();
                e.stopImmediatePropagation();
                edit.onReset(axis);
                u.redraw();
              }
            });
            root.addEventListener("mousedown", (e: MouseEvent) => {
              if (e.button !== 0) return;
              const axis = hitAxisLabel(rects, at(e).x, at(e).y);
              if (!axis) return;
              e.preventDefault();
              // Same node hosts the annotation/shape mousedown listeners —
              // stopImmediatePropagation (not stopPropagation) so those siblings
              // don't ALSO start a gesture (see uplotOverlays' bug-hunt note).
              e.stopImmediatePropagation();
              const base = edit.offsets[axis] ?? ([0, 0] as [number, number]);
              drag = { axis, live: base };
              const onMove = (ev: MouseEvent): void => {
                drag = { axis, live: [base[0] + (ev.clientX - e.clientX), base[1] + (ev.clientY - e.clientY)] };
                u.redraw();
              };
              const onUp = (ev: MouseEvent): void => {
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                const final = drag?.live ?? base;
                const moved = Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) >= DRAG_THRESHOLD;
                drag = null;
                if (moved) edit.onMove(axis, final);
                u.redraw();
              };
              document.addEventListener("mousemove", onMove);
              document.addEventListener("mouseup", onUp);
            });
          }
        : undefined,
    },
  };
}
