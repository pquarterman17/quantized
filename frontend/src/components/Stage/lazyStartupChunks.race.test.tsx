// Figures leftover g: the Origin-escape rewrite (lib/originEscapes.ts) and
// the region-shade / off-scale drawing (lib/uplotRegionShades.ts) are lazy
// chunks every session starts loading at startup. A plot drawn BEFORE they
// land used to keep its literal `\g(m)` and miss its shades until some
// unrelated rebuild. This test FORCES that race (docs/testing.md): both
// chunk imports are held behind gates the test opens, so the "drawn before
// the chunk" state is certain, not a timing accident -- then asserts the
// redraw happens when, and only when, each chunk settles.

import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import RichText from "../primitives/RichText";
import { awaitsOriginEscapes, richLabelAst } from "../../lib/richtext";
import { regionDecorReady } from "../../lib/uplotOverlays";
import { plotDecorNeeds, useLazyPlotParts } from "./useLazyPlotParts";

const gates = vi.hoisted(() => {
  let openEscapes = () => {};
  let openShades = () => {};
  const escapes = new Promise<void>((r) => (openEscapes = r));
  const shades = new Promise<void>((r) => (openShades = r));
  return { escapes, shades, openEscapes: () => openEscapes(), openShades: () => openShades() };
});

vi.mock("../../lib/originEscapes", async (importOriginal) => {
  await gates.escapes;
  return importOriginal();
});
vi.mock("../../lib/uplotRegionShades", async (importOriginal) => {
  await gates.shades;
  return importOriginal();
});

/** A viewport stand-in: counts the rebuilds `useLazyPlotParts` asks for. */
function useRebuilds(texts: string[], overlays: boolean): number {
  const [epoch, setEpoch] = useState(0);
  useLazyPlotParts([], "zoom", () => setEpoch((e) => e + 1), { texts, overlays });
  return epoch;
}

describe("startup chunks landing after the first draw (forces the race)", () => {
  it("a plot with an escape label and a shade rebuilds once both settle; a legend label re-renders", async () => {
    const label = "\\g(m)\\-(0)H (T)";
    // Drawn before either chunk: the label is literal and the shades absent.
    expect(awaitsOriginEscapes(label)).toBe(true);
    expect(regionDecorReady()).toBe(false);
    const textOf = (s: string) => JSON.stringify(richLabelAst(s) ?? s);
    expect(textOf(label)).not.toContain("μ");
    const { result } = renderHook(() => useRebuilds([label], true));
    render(<RichText text={label} />);
    expect(screen.getByText(label)).toBeInTheDocument();

    // Shades land first: the plot still waits for the escape rewrite.
    await act(async () => {
      gates.openShades();
      await Promise.resolve();
    });
    await waitFor(() => expect(regionDecorReady()).toBe(true));
    expect(result.current).toBe(0);

    // The escape rewrite lands: ONE rebuild, and the legend shows Greek.
    act(() => gates.openEscapes());
    await waitFor(() => expect(result.current).toBe(1));
    expect(await screen.findByText("μ")).toBeInTheDocument();
    expect(screen.queryByText(label)).toBeNull();
    expect(awaitsOriginEscapes(label)).toBe(false);
    expect(textOf(label)).toContain("μ");
  });

  it("collects every label a viewport draws, and its overlays", () => {
    const needs = plotDecorNeeds(
      ["title", null],
      { xLabel: "T (K)", series: [{ label: "\\g(c)" }] },
      [{ text: "peak" }],
      2,
    );
    expect(needs).toEqual({ texts: ["title", null, "T (K)", "\\g(c)", "peak"], overlays: true });
    expect(plotDecorNeeds([], null, null, 0).overlays).toBe(false);
  });
});
