// The annotation anchor dot is opt-out (audit 6 lane M): only an explicit
// `dot: false` hides it, the field survives a .dwk round trip and rides the
// export request, and an older annotation with no `dot` keeps today's look.

import { describe, expect, it } from "vitest";

import { mergeFigureOverrides } from "./figureOverrides";
import { sanitizeFigureOverrides } from "./figureOverridesSanitize";
import { viewOverrides } from "./figureViewOverrides";
import { defaultPlotView, sanitizeAnnotations } from "./plotview";

describe("Annotation.dot", () => {
  it("round-trips through the saved-view sanitizer; absent stays absent", () => {
    const saved = JSON.parse(JSON.stringify([
      { id: "t", x: 1, y: 2, text: "note", dot: false },
      { id: "p", x: 3, y: 4, text: "peak" },
      { id: "q", x: 3, y: 4, text: "junk", dot: "no" },
    ]));
    const out = sanitizeAnnotations(saved);
    expect(out[0].dot).toBe(false);
    expect("dot" in out[1]).toBe(false);
    expect("dot" in out[2]).toBe(false);
  });

  it("rides the export request only when false", () => {
    const v = { ...defaultPlotView(), annotations: [
      { id: "t", x: 1, y: 2, text: "note", dot: false },
      { id: "p", x: 3, y: 4, text: "peak" },
    ] };
    const ann = viewOverrides(v)?.annotations;
    expect(ann?.[0]).toMatchObject({ dot: false });
    expect(ann?.[1] && "dot" in ann[1]).toBe(false);
  });

  it("a view annotation's canvas-px size rides the export in points (14 px = 10.5 pt)", () => {
    const v = { ...defaultPlotView(), annotations: [{ id: "t", x: 1, y: 2, text: "note", size: 14 }, { id: "p", x: 1, y: 2, text: "peak" }] };
    const out = viewOverrides(v);
    expect(out?.annotations?.[0].size).toBe(10.5);
    expect(out?.annotations?.[1] && "size" in out.annotations[1]).toBe(false);
    expect(out && "annotation_size_px" in out).toBe(false); // no unit flag on the wire
  });

  it("Figure Builder: a publication annotation's pt size never changes with the view's other annotations", () => {
    const pub = { annotations: [{ x: 1, y: 2, text: "typed", size: 12 }] };
    const plain = viewOverrides(defaultPlotView());
    const withBox = viewOverrides({ ...defaultPlotView(), annotations: [{ id: "t", x: 1, y: 2, text: "box", size: 14 }] });
    expect(mergeFigureOverrides(plain, pub)?.annotations).toEqual(pub.annotations);
    expect(mergeFigureOverrides(withBox, pub)?.annotations).toEqual(pub.annotations);
  });

  it("survives the override sanitizer used on stored export overrides", () => {
    const out = sanitizeFigureOverrides({ annotations: [{ x: 1, y: 2, text: "a", dot: false }, { x: 1, y: 2, text: "b" }] });
    expect(out?.annotations?.[0]).toMatchObject({ dot: false });
    expect(out?.annotations?.[1] && "dot" in out.annotations[1]).toBe(false);
  });
});
