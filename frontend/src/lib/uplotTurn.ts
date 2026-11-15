// The overlay half of horizontal bars (lib/uplotOrient.ts has the notes):
// the upright view a turned plot hands its overlay draw hooks, the canvas
// context that keeps text upright, and the wrapper that applies them. Moved
// verbatim out of lib/uplotOrient.ts in bundle diet slice 27
// (plans/BUNDLE_HEADROOM.md). A LAZY chunk: `orientPlugins` there reads it
// once loaded, and that module starts the load at app startup.
import type uPlot from "uplot";

const DRAW_HOOKS = new Set(["draw", "drawClear", "drawAxes", "drawSeries"]);

/** The upright frame of a turned plot `u`: the view's bbox, and the canvas
 *  transform `[a, b, c, d, e, f]` from view to canvas pixels. */
export function turnedFrame(u: uPlot): { bbox: uPlot.BBox; matrix: [number, number, number, number, number, number] } {
  const { left, top, width, height } = u.bbox;
  // view (vx, vy) -> canvas (e - vy, f - vx): X up the canvas, Y across it.
  const e = top + left + width;
  const f = left + top + height;
  return { bbox: { left, top, width: height, height: width }, matrix: [0, -1, -1, 0, e, f] };
}

function isTurned(u: uPlot): boolean {
  return u.scales.x?.ori === 1;
}

/** An upright view of turned plot `u` for one draw hook (module notes). */
export function uprightView(u: uPlot): uPlot {
  const { bbox, matrix } = turnedFrame(u);
  const [, , , , e, f] = matrix;
  const pxr = globalThis.devicePixelRatio || 1; // uPlot's own pxRatio
  const turnedKey = (key: string): boolean => u.scales[key]?.ori === 1;
  // View position from the plot's own: canvas pixels flip about e/f; CSS
  // (plot-area) pixels about the plot area's turned size.
  const toView = (pos: number, key: string, canvas?: boolean): number => {
    if (canvas) return (turnedKey(key) ? f : e) - pos;
    return (turnedKey(key) ? u.bbox.height : u.bbox.width) / pxr - pos;
  };
  const ctx = uprightContext(u.ctx, matrix);
  return new Proxy(u, {
    get(target, prop, receiver) {
      if (prop === "bbox") return bbox;
      if (prop === "ctx") return ctx;
      if (prop === "valToPos") {
        return (v: number, key: string, canvas?: boolean) => toView(target.valToPos(v, key, canvas), key, canvas);
      }
      if (prop === "posToVal") {
        return (p: number, key: string, canvas?: boolean) => target.posToVal(toView(p, key, canvas), key, canvas);
      }
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// The view's "right" is up on the canvas and its "up" is right: arrows in a
// label turn with it, and so does the side the label sits on (view
// alignment -> canvas baseline, view baseline -> canvas alignment).
const TURNED_ARROW: Record<string, string> = { "▸": "▴", "◂": "▾", "▴": "▸", "▾": "◂" };
const BASELINE_FOR_ALIGN: Record<string, CanvasTextBaseline> = {
  left: "bottom", start: "bottom", right: "top", end: "top", center: "middle",
};
const ALIGN_FOR_BASELINE: Record<string, CanvasTextAlign> = {
  top: "right", hanging: "right", middle: "center",
  bottom: "left", alphabetic: "left", ideographic: "left",
};

/** `ctx` with the view transform applied and text kept upright: a label is
 *  placed where the view puts its anchor, then drawn unturned there, on the
 *  side of the anchor the view meant. */
function uprightContext(
  ctx: CanvasRenderingContext2D,
  [a, b, c, d, e, f]: [number, number, number, number, number, number],
): CanvasRenderingContext2D {
  const at = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f];
  const text = (draw: "fillText" | "strokeText") =>
    (s: string, x: number, y: number, maxWidth?: number): void => {
      const [cx, cy] = at(x, y);
      const label = s.replace(/[▸◂▴▾]/g, (ch) => TURNED_ARROW[ch]);
      const align = ALIGN_FOR_BASELINE[ctx.textBaseline] ?? "left";
      const baseline = BASELINE_FOR_ALIGN[ctx.textAlign] ?? "bottom";
      ctx.save();
      ctx.transform(a, b, c, d, f, e); // the view turn's inverse: back to plain canvas pixels
      ctx.textAlign = align;
      ctx.textBaseline = baseline;
      if (maxWidth === undefined) ctx[draw](label, cx, cy);
      else ctx[draw](label, cx, cy, maxWidth);
      ctx.restore();
    };
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === "fillText") return text("fillText");
      if (prop === "strokeText") return text("strokeText");
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
}

/** `plugins` with their draw hooks given the upright view of a turned plot
 *  (lib/uplotOrient.ts's notes); `orientPlugins` there calls this only when
 *  the plot has horizontal bars. */
export function turnPlugins(plugins: uPlot.Plugin[]): uPlot.Plugin[] {
  return plugins.map((plugin) => {
    const hooks: Record<string, unknown> = {};
    for (const [name, hook] of Object.entries(plugin.hooks)) {
      if (!DRAW_HOOKS.has(name) || typeof hook !== "function") {
        hooks[name] = hook;
        continue;
      }
      const draw = hook as (u: uPlot, ...rest: unknown[]) => void;
      hooks[name] = (u: uPlot, ...rest: unknown[]) => {
        if (!isTurned(u)) return draw(u, ...rest);
        const [ma, mb, mc, md, me, mf] = turnedFrame(u).matrix;
        u.ctx.save();
        u.ctx.transform(ma, mb, mc, md, me, mf);
        try {
          draw(uprightView(u), ...rest);
        } finally {
          u.ctx.restore();
        }
      };
    }
    return { ...plugin, hooks: hooks as uPlot.Plugin["hooks"] };
  });
}
