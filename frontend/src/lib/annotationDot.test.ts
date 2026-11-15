// The annotation anchor dot is opt-out (audit 6 lane M): only an explicit
// `dot: false` hides it, the field survives a .dwk round trip and rides the
// export request, and an older annotation with no `dot` keeps today's look.

import { describe, expect, it } from "vitest";

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

  it("survives the override sanitizer used on stored export overrides", () => {
    const out = sanitizeFigureOverrides({ annotations: [{ x: 1, y: 2, text: "a", dot: false }, { x: 1, y: 2, text: "b" }] });
    expect(out?.annotations?.[0]).toMatchObject({ dot: false });
    expect(out?.annotations?.[1] && "dot" in out.annotations[1]).toBe(false);
  });
});
