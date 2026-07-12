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

import type { RichNode } from "./richtext";
import { ASCENT_EM, DESCENT_EM, drawRich } from "./richtextCanvas";

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

export function richLabelsPlugin(asts: RichLabelAsts, style: RichLabelStyle): uPlot.Plugin {
  // Axis index convention fixed by buildOpts: 0 = x, 1 = y, 2 = y2.
  const byAxis: (RichNode[] | null | undefined)[] = [asts.x, asts.y, asts.y2];
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
        byAxis.forEach((ast, i) => {
          if (!ast || ast.length === 0) return;
          const axis = u.axes[i] as AxisWithLpos | undefined;
          if (!axis || axis._lpos == null) return;
          // Same defaults buildOpts produces: x bottom (2), y left (3), y2 right (1).
          const side = axis.side ?? (i === 0 ? 2 : i === 1 ? 3 : 1);
          const shiftDir = side === 0 || side === 3 ? -1 : 1;
          const lpos = Math.round((axis._lpos + (axis.labelGap ?? 0) * shiftDir) * pxr);
          const px = style.px * pxr; // uPlot scales fonts to device px; so do we
          const font = { px, family: style.family, weight: style.weight ?? "600" };
          ctx.save();
          if (side % 2 === 1) {
            // Vertical axes: rotate around the label band line at plot-center Y.
            ctx.translate(lpos, Math.round(u.bbox.top + u.bbox.height / 2));
            ctx.rotate((side === 3 ? -Math.PI : Math.PI) / 2);
            drawRich(ctx, ast, 0, -DESCENT_EM * px, font, style.color, "center");
          } else {
            const x = Math.round(u.bbox.left + u.bbox.width / 2);
            // side 2 (bottom): uPlot uses a TOP baseline at lpos; side 0: BOTTOM.
            const y = side === 2 ? lpos + ASCENT_EM * px : lpos - DESCENT_EM * px;
            drawRich(ctx, ast, x, y, font, style.color, "center");
          }
          ctx.restore();
        });
      },
    },
  };
}
