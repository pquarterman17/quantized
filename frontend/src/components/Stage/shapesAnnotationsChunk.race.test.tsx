// Bundle diet slice 31: the drawn-shapes plugin (lib/uplotShapes.ts) and the
// text-annotation plugin (lib/uplotAnnotations.ts) are startup chunks. A plot
// built BEFORE they land wires neither plugin; once each settles the viewport
// must rebuild and `buildOpts` must then wire it. The chunk imports are held
// behind gates the test opens (docs/testing.md: force the race).

import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { annotationsReady, loadedAnnotations } from "../../lib/annotationsLoader";
import { loadedShapes, shapesReady } from "../../lib/shapesLoader";
import { useLazyPlotParts } from "./useLazyPlotParts";

const gates = vi.hoisted(() => {
  let openShapes = () => {};
  let openAnnotations = () => {};
  const shapes = new Promise<void>((r) => (openShapes = r));
  const annotations = new Promise<void>((r) => (openAnnotations = r));
  return { shapes, annotations, openShapes: () => openShapes(), openAnnotations: () => openAnnotations() };
});

vi.mock("../../lib/uplotShapes", async (importOriginal) => {
  await gates.shapes;
  return importOriginal();
});
vi.mock("../../lib/uplotAnnotations", async (importOriginal) => {
  await gates.annotations;
  return importOriginal();
});

function useRebuilds(shapes: boolean, annotations: boolean): number {
  const [epoch, setEpoch] = useState(0);
  useLazyPlotParts([], "zoom", () => setEpoch((e) => e + 1), { texts: [], overlays: false, shapes, annotations });
  return epoch;
}

describe("shapes and annotations chunks landing after the first draw (forces the race)", () => {
  it("each plugin is absent until its chunk lands, and a plot that needs it rebuilds once", async () => {
    expect(shapesReady()).toBe(false);
    expect(annotationsReady()).toBe(false);
    expect(loadedShapes()).toBeNull();
    expect(loadedAnnotations()).toBeNull();
    const { result } = renderHook(() => useRebuilds(true, true));

    await act(async () => {
      gates.openShapes();
      await Promise.resolve();
    });
    await waitFor(() => expect(shapesReady()).toBe(true));
    expect(loadedShapes()?.shapesPlugin).toBeTypeOf("function");
    // The annotation chunk is still pending: no rebuild yet.
    expect(result.current).toBe(0);

    act(() => gates.openAnnotations());
    await waitFor(() => expect(result.current).toBe(1));
    expect(loadedAnnotations()?.annotationPlugin).toBeTypeOf("function");
  });

  it("a plot with neither shapes nor annotations asks for nothing", async () => {
    const { result } = renderHook(() => useRebuilds(false, false));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(0);
  });
});
