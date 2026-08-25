import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import PreviewOverlay from "./PreviewOverlay";
import type { FigureHitmap } from "../../../lib/previewmap";

const MAP: FigureHitmap = {
  image: "",
  width: 600,
  height: 400,
  elements: [
    { id: "title", x0: 250, y0: 10, x1: 350, y1: 30 },
    { id: "legend", x0: 450, y0: 60, x1: 560, y1: 120 },
    { id: "ann:0", x0: 200, y0: 200, x1: 240, y1: 216 },
  ],
  axes: {
    x0: 60,
    y0: 40,
    x1: 580,
    y1: 360,
    xlim: [0, 10],
    ylim: [0, 100],
    xlog: false,
    ylog: false,
  },
};

const setup = () => {
  const onSelect = vi.fn();
  const onEditText = vi.fn();
  const onDragEnd = vi.fn();
  render(
    <PreviewOverlay
      src="data:image/png;base64,"
      map={MAP}
      textOf={(id) => (id === "title" ? "Old title" : "")}
      onSelect={onSelect}
      onEditText={onEditText}
      onDragEnd={onDragEnd}
    />,
  );
  return { onSelect, onEditText, onDragEnd };
};

const el = (id: string) => document.querySelector<HTMLElement>(`[data-element="${id}"]`)!;

describe("PreviewOverlay", () => {
  it("click selects an element (#13)", () => {
    const { onSelect } = setup();
    fireEvent.click(el("legend"));
    expect(onSelect).toHaveBeenCalledWith("legend");
  });

  it("right-click opens an element-aware menu without selecting", () => {
    const { onSelect } = setup();
    fireEvent.contextMenu(el("legend"), { clientX: 24, clientY: 36 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Legend")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Properties…" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("advertises the available preview interactions in hitbox titles", () => {
    setup();
    expect(el("title")).toHaveAttribute("title", "Title \u2014 double-click to edit; right-click for properties");
    expect(el("legend")).toHaveAttribute("title", "Legend \u2014 drag to move; right-click for properties");
    expect(el("ann:0")).toHaveAttribute("title", "Annotation \u2014 drag to move; right-click for properties");
  });

  it("Properties uses the same selection pathway as a click", () => {
    const { onSelect } = setup();
    fireEvent.contextMenu(el("legend"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Properties…" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("legend");
  });

  it("offers text editing through the existing inline editor", () => {
    const { onEditText } = setup();
    fireEvent.contextMenu(el("title"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit text…" }));
    const input = screen.getByDisplayValue("Old title");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditText).toHaveBeenCalledExactlyOnceWith("title", "Old title");
  });

  it("keeps unavailable series properties visibly inert", () => {
    const seriesMap = { ...MAP, elements: [...MAP.elements, { id: "series:0", x0: 1, y0: 1, x1: 2, y1: 2 }] };
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={seriesMap} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.contextMenu(el("series:0"));
    expect(screen.getByRole("menuitem", { name: "Series properties — edit on Stage" })).toBeDisabled();
    expect(el("series:0")).toHaveAttribute("title", "Series \u2014 properties are edited on Stage");
    expect(onSelect).not.toHaveBeenCalled();
  });

  // F2.3b: once the canonical draft has per-series controls to open,
  // `canonicalSeries` flips the SAME hitbox from inert to a real Properties…
  // action, routed through the ordinary click-select pathway.
  it("routes a series hitbox to Properties… once canonicalSeries is enabled", () => {
    const seriesMap = { ...MAP, elements: [...MAP.elements, { id: "series:0", x0: 1, y0: 1, x1: 2, y1: 2 }] };
    const onSelect = vi.fn();
    render(
      <PreviewOverlay
        src="data:image/png;base64,"
        map={seriesMap}
        textOf={() => ""}
        onSelect={onSelect}
        onEditText={vi.fn()}
        onDragEnd={vi.fn()}
        canonicalSeries
      />,
    );
    expect(el("series:0").getAttribute("title")).toContain("right-click for properties");

    fireEvent.contextMenu(el("series:0"));
    expect(screen.queryByRole("menuitem", { name: "Series properties — edit on Stage" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Properties…" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("series:0");

    onSelect.mockClear();
    fireEvent.click(el("series:0"));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("series:0");
  });

  it("puts the smaller legend hitbox above an overlapping series hitbox", () => {
    const overlapMap = {
      ...MAP,
      elements: [...MAP.elements, { id: "series:0", x0: 400, y0: 0, x1: 599, y1: 200 }],
    };
    render(
      <PreviewOverlay src="data:image/png;base64," map={overlapMap} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    expect(Number(el("legend").style.zIndex)).toBeGreaterThan(Number(el("series:0").style.zIndex));
    fireEvent.contextMenu(el("legend"));
    expect(screen.getByText("Legend")).toBeInTheDocument();
  });

  it("inherits ContextMenu keyboard navigation", () => {
    setup();
    fireEvent.contextMenu(el("title"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Properties…" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Edit text…" }));
  });

  it("double-click on a text element opens the inline editor and commits (#14)", () => {
    const { onEditText } = setup();
    fireEvent.doubleClick(el("title"));
    const input = screen.getByDisplayValue("Old title");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEditText).toHaveBeenCalledWith("title", "New title");
  });

  it("escape cancels the inline edit without committing", () => {
    const { onEditText } = setup();
    fireEvent.doubleClick(el("title"));
    fireEvent.keyDown(screen.getByDisplayValue("Old title"), { key: "Escape" });
    expect(onEditText).not.toHaveBeenCalled();
  });

  it("dragging the legend reports the drop point; a 1px jiggle does not (#14)", () => {
    const { onDragEnd } = setup();
    const legend = el("legend");
    // jsdom has no layout — getBoundingClientRect is all zeros, so the drop
    // maps to [0,0]; the assertion is about the CALL semantics, not coords.
    fireEvent.pointerDown(legend, { clientX: 500, clientY: 90, pointerId: 1 });
    fireEvent.pointerMove(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd.mock.calls[0][0]).toBe("legend");

    onDragEnd.mockClear();
    fireEvent.pointerDown(legend, { clientX: 500, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(legend, { clientX: 501, clientY: 90, pointerId: 1 });
    expect(onDragEnd).not.toHaveBeenCalled(); // click-sized movement = no drag
  });

  it("annotations are draggable, non-text elements have no inline editor", () => {
    const { onDragEnd, onEditText } = setup();
    const ann = el("ann:0");
    fireEvent.doubleClick(ann);
    expect(onEditText).not.toHaveBeenCalled();
    fireEvent.pointerDown(ann, { clientX: 210, clientY: 208, pointerId: 2 });
    fireEvent.pointerUp(ann, { clientX: 260, clientY: 250, pointerId: 2 });
    // F2.4e: onDragEnd now also reports the press origin (2 more numbers),
    // for shapes' delta-translation — every caller receives it, annotations
    // included, even though only the shape branch reads it.
    expect(onDragEnd).toHaveBeenCalledWith(
      "ann:0",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  // F2.4e: shapes join the draggable set (F2.4d already added reference
  // lines the same way) -- the tooltip drops its old "right-click only"
  // wording, and a drag reports the drop point AND the press origin so the
  // hook can translate by the pointer's delta.
  it("shapes are draggable and report both the drop point and press origin (F2.4e)", () => {
    const shapeMap = { ...MAP, elements: [...MAP.elements, { id: "shape:0", x0: 300, y0: 250, x1: 340, y1: 280 }] };
    const onDragEnd = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={shapeMap} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={onDragEnd} />,
    );
    const shapeEl = document.querySelector<HTMLElement>('[data-element="shape:0"]')!;
    expect(shapeEl).toHaveAttribute("title", "Shape — drag to move; right-click for properties");
    fireEvent.pointerDown(shapeEl, { clientX: 310, clientY: 260, pointerId: 3 });
    fireEvent.pointerUp(shapeEl, { clientX: 330, clientY: 270, pointerId: 3 });
    expect(onDragEnd).toHaveBeenCalledWith(
      "shape:0",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("right-click during an in-progress drag clears the armed drag state", () => {
    const { onDragEnd } = setup();
    const legend = el("legend");
    fireEvent.pointerDown(legend, { clientX: 500, clientY: 90, pointerId: 1 });
    fireEvent.pointerMove(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    fireEvent.contextMenu(legend, { clientX: 520, clientY: 130 });
    // A pointerUp after the context menu interrupted the drag must NOT report
    // a drop — the armed drag state was cleared, not carried through.
    fireEvent.pointerUp(legend, { clientX: 520, clientY: 130, pointerId: 1 });
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("the inline text-edit input sits above every hitbox, including large series boxes (PR #116 regression)", () => {
    const bigMap: FigureHitmap = {
      ...MAP,
      elements: [
        ...MAP.elements,
        { id: "series:0", x0: 60, y0: 40, x1: 580, y1: 360 },
        { id: "series:1", x0: 60, y0: 40, x1: 580, y1: 200 },
      ],
    };
    render(
      <PreviewOverlay
        src="data:image/png;base64,"
        map={bigMap}
        textOf={(id) => (id === "title" ? "Old title" : "")}
        onSelect={vi.fn()}
        onEditText={vi.fn()}
        onDragEnd={vi.fn()}
      />,
    );
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="title"]')!);
    const input = screen.getByDisplayValue("Old title");
    const inputZ = Number(input.style.zIndex);
    for (const id of bigMap.elements.map((e) => e.id)) {
      const hitboxZ = Number(document.querySelector<HTMLElement>(`[data-element="${id}"]`)!.style.zIndex);
      expect(inputZ).toBeGreaterThan(hitboxZ);
    }
  });

  it("double-clicking a second text element commits the first edit's unsaved value (#116 follow-up)", () => {
    const withXlabel: FigureHitmap = {
      ...MAP,
      elements: [...MAP.elements, { id: "xlabel", x0: 250, y0: 370, x1: 350, y1: 390 }],
    };
    const onEditText = vi.fn();
    render(
      <PreviewOverlay
        src="data:image/png;base64,"
        map={withXlabel}
        textOf={(id) => (id === "title" ? "Old title" : id === "xlabel" ? "Old x" : "")}
        onSelect={vi.fn()}
        onEditText={onEditText}
        onDragEnd={vi.fn()}
      />,
    );
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="title"]')!);
    fireEvent.change(screen.getByDisplayValue("Old title"), { target: { value: "New title" } });
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="xlabel"]')!);
    expect(onEditText).toHaveBeenCalledExactlyOnceWith("title", "New title");
    // the second edit is now open, seeded from its own current value
    expect(screen.getByDisplayValue("Old x")).toBeInTheDocument();
  });

  it("is keyboard-reachable: ContextMenu key / Shift+F10 open the menu, Enter selects (GUI_INTERACTION #8 parity)", () => {
    const { onSelect } = setup();
    const legend = el("legend");
    expect(legend).toHaveAttribute("tabindex", "0");
    expect(legend).toHaveAttribute("role", "button");
    expect(legend).toHaveAttribute("aria-label", "Legend — drag to move; right-click for properties");

    fireEvent.keyDown(legend, { key: "ContextMenu" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("Legend")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.keyDown(legend, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });

    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(legend, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("legend");

    onSelect.mockClear();
    fireEvent.keyDown(legend, { key: " " });
    expect(onSelect).toHaveBeenCalledWith("legend");
  });
});

// FU-facet-hitmap: a faceted hitmap's `elements` repeat ids across panels
// (every panel draws its own "title"/"series:0") -- these guard the two
// real risks that repetition introduces: a React key collision, and
// double-click silently mis-committing a facet panel's own label into the
// whole-figure title field.
describe("PreviewOverlay — facet elements (FU-facet-hitmap)", () => {
  const FACET_MAP: FigureHitmap = {
    image: "",
    width: 600,
    height: 400,
    elements: [
      { id: "title", panel: 0, x0: 10, y0: 10, x1: 100, y1: 30 },
      { id: "series:0", panel: 0, x0: 10, y0: 40, x1: 290, y1: 200 },
      { id: "title", panel: 1, x0: 310, y0: 10, x1: 400, y1: 30 },
      { id: "series:0", panel: 1, x0: 310, y0: 40, x1: 590, y1: 200 },
    ],
    panels: [
      { panel: 0, label: "level 0", x0: 0, y0: 0, x1: 300, y1: 400, xlim: [0, 10], ylim: [0, 10], xlog: false, ylog: false },
      { panel: 1, label: "level 1", x0: 300, y0: 0, x1: 600, y1: 400, xlim: [100, 200], ylim: [100, 200], xlog: false, ylog: false },
    ],
  };

  const elAt = (id: string, panel: number) =>
    document.querySelector<HTMLElement>(`[data-element="${id}"][data-panel="${panel}"]`)!;

  it("renders one hitbox per panel for a repeated id, not a collapsed/collided one", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    expect(document.querySelectorAll('[data-element="title"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-element="series:0"]')).toHaveLength(2);
    expect(elAt("title", 0)).toBeInTheDocument();
    expect(elAt("title", 1)).toBeInTheDocument();
    expect(elAt("title", 0)).not.toBe(elAt("title", 1));
  });

  it("hovering one panel's title does not also outline the other panel's title", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.pointerEnter(elAt("title", 0));
    expect(elAt("title", 0).style.outline).toContain("var(--accent)");
    expect(elAt("title", 1).style.outline).not.toContain("var(--accent)");
  });

  it("double-clicking a facet panel's title does NOT open the whole-figure title editor", () => {
    const onEditText = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => "figure title"} onSelect={vi.fn()} onEditText={onEditText} onDragEnd={vi.fn()} />,
    );
    fireEvent.doubleClick(elAt("title", 1));
    expect(screen.queryByDisplayValue("figure title")).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onEditText).not.toHaveBeenCalled();
  });

  it("right-clicking a facet panel's title names the panel, offers no text edit, and Properties is disabled (G3)", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.contextMenu(elAt("title", 1));
    expect(screen.getByText("Panel 2 title")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Edit text…" })).not.toBeInTheDocument();
    // FU-facet-hitmap fix round 2 (G3): the header correctly names the
    // panel, but Properties… must NOT be an enabled action that silently
    // hands the click to the whole-figure Text & fonts group underneath.
    expect(screen.queryByRole("menuitem", { name: "Properties…" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Properties unavailable" })).toBeDisabled();
  });

  // Superseded by fix round 5 (V2): a facet series element used to
  // click-select like the flat path (per-series controls resolving
  // generically to the Series group), but the style edit that opened is
  // INERT on the facet render path (`draw_facet_grid` ignores
  // `series_styles` entirely) -- gated the same way a panel title is.
  // See the dedicated "gated facet panel series line stays inert (V2)"
  // describe block below for full coverage; this one just pins the
  // updated behavior at its original call site.
  it("does NOT click-select a facet series element -- gated, unlike the flat path (V2)", () => {
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.click(elAt("series:0", 1));
    expect(onSelect).not.toHaveBeenCalled();
  });

  // FU-facet-hitmap fix round 2 (G3): the double-click path already guarded
  // against silently editing the whole-figure title (`isTextEditable`); the
  // single-click and keyboard-select paths must be guarded the SAME way —
  // routing "title" through `onSelect` opens the flat path's Text & fonts
  // group (the whole-figure suptitle control), which is exactly as wrong
  // for a facet panel's own label as the double-click edit was.
  it("single-clicking a facet panel's title does NOT focus the whole-figure Text & fonts group", () => {
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.click(elAt("title", 1));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter/Space on a focused facet panel's title also does NOT select it", () => {
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.keyDown(elAt("title", 1), { key: "Enter" });
    fireEvent.keyDown(elAt("title", 1), { key: " " });
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Superseded by V2, same as the click test above.
  it("Enter on a focused facet panel's SERIES element also does NOT select it (V2)", () => {
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.keyDown(elAt("series:0", 1), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});


// FU-facet-hitmap fix round 3 (J1): `editing` must resolve against the
// CURRENT `map` by (id, panel) BOTH -- a bare id lookup either threw
// (element genuinely absent from the new map) or silently snapped onto
// the WRONG panel's box (id present, but under a different panel).
describe("PreviewOverlay — editing survives a hitmap change without crashing (J1)", () => {
  const FLAT_WITH_LABELS: FigureHitmap = {
    image: "",
    width: 600,
    height: 400,
    elements: [
      { id: "title", x0: 250, y0: 10, x1: 350, y1: 30 },
      { id: "xlabel", x0: 250, y0: 370, x1: 350, y1: 390 },
    ],
    axes: { x0: 60, y0: 40, x1: 580, y1: 360, xlim: [0, 10], ylim: [0, 100], xlog: false, ylog: false },
  };
  const FACETED: FigureHitmap = {
    image: "",
    width: 600,
    height: 400,
    elements: [
      { id: "title", panel: 0, x0: 10, y0: 10, x1: 100, y1: 30 },
      { id: "series:0", panel: 0, x0: 10, y0: 40, x1: 290, y1: 200 },
    ],
    panels: [
      { panel: 0, label: "level 0", x0: 0, y0: 0, x1: 300, y1: 400, xlim: [0, 10], ylim: [0, 10], xlog: false, ylog: false },
    ],
  };

  it("does NOT throw when the edited element (xlabel) is entirely absent from a new (faceted) hitmap", () => {
    const { rerender } = render(
      <PreviewOverlay src="data:image/png;base64," map={FLAT_WITH_LABELS} textOf={() => "X axis"} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="xlabel"]')!);
    expect(screen.getByDisplayValue("X axis")).toBeInTheDocument();
    expect(() =>
      rerender(
        <PreviewOverlay src="data:image/png;base64," map={FACETED} textOf={() => "X axis"} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
      ),
    ).not.toThrow();
    // Ignored, not thrown: the stale editor simply stops rendering.
    expect(screen.queryByDisplayValue("X axis")).not.toBeInTheDocument();
  });

  it("does NOT silently reposition a stale flat 'title' edit over a facet panel's own title box", () => {
    const { rerender } = render(
      <PreviewOverlay src="data:image/png;base64," map={FLAT_WITH_LABELS} textOf={() => "Figure title"} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="title"]')!);
    expect(screen.getByDisplayValue("Figure title")).toBeInTheDocument();
    // FACETED DOES contain a "title" element -- panel 0's own category
    // label -- with the SAME id as the stale flat edit. Before the fix, a
    // bare-id `find` would match it and reposition the (still-open,
    // whole-figure) editor over panel 0's box instead of recognizing this
    // is a DIFFERENT element (panel undefined vs panel 0).
    rerender(
      <PreviewOverlay src="data:image/png;base64," map={FACETED} textOf={() => "Figure title"} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    expect(screen.queryByDisplayValue("Figure title")).not.toBeInTheDocument();
  });

  it("keeps editing open, correctly positioned, when the SAME (id, panel) element persists across a rerender", () => {
    const { rerender } = render(
      <PreviewOverlay src="data:image/png;base64," map={FLAT_WITH_LABELS} textOf={() => "Figure title"} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="title"]')!);
    expect(screen.getByDisplayValue("Figure title")).toBeInTheDocument();
    // A fresh map object, same shape (still id "title", panel undefined) --
    // an ordinary debounced-preview re-render, not a hitmap SHAPE change --
    // must not close the editor.
    const FLAT_WITH_LABELS_2: FigureHitmap = { ...FLAT_WITH_LABELS, elements: [...FLAT_WITH_LABELS.elements] };
    rerender(
      <PreviewOverlay src="data:image/png;base64," map={FLAT_WITH_LABELS_2} textOf={() => "Figure title"} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Figure title")).toBeInTheDocument();
  });

  // Fix round 4 (P2): once an edited element stops resolving (the input
  // already correctly stops rendering, J1), `editing` itself must clear --
  // otherwise a LATER edit on a completely different element ghost-commits
  // the vanished one's stale value through `onEditText` when it opens.
  it("does NOT ghost-commit a vanished edit's stale value when a later, different element is edited (P2)", () => {
    const onEditText = vi.fn();
    const textOf = (id: string) => (id === "xlabel" ? "Old X" : "Old Title");
    const { rerender } = render(
      <PreviewOverlay src="data:image/png;base64," map={FLAT_WITH_LABELS} textOf={textOf} onSelect={vi.fn()} onEditText={onEditText} onDragEnd={vi.fn()} />,
    );
    // Start editing "xlabel" and change its draft value -- if this ever
    // ghost-commits, it must NOT be this ("Edited X"), never mind the
    // original "Old X".
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="xlabel"]')!);
    fireEvent.change(screen.getByDisplayValue("Old X"), { target: { value: "Edited X" } });

    // "xlabel" vanishes from the next hitmap (e.g. the label was cleared) --
    // the input correctly stops rendering (J1); `editing` must clear too.
    const WITHOUT_XLABEL: FigureHitmap = {
      ...FLAT_WITH_LABELS,
      elements: FLAT_WITH_LABELS.elements.filter((e) => e.id !== "xlabel"),
    };
    rerender(
      <PreviewOverlay src="data:image/png;base64," map={WITHOUT_XLABEL} textOf={textOf} onSelect={vi.fn()} onEditText={onEditText} onDragEnd={vi.fn()} />,
    );
    expect(screen.queryByDisplayValue("Edited X")).not.toBeInTheDocument();

    // Now edit a DIFFERENT, still-real element ("title"). Opening it must
    // NOT have silently fired onEditText("xlabel", "Edited X") first.
    fireEvent.doubleClick(document.querySelector<HTMLElement>('[data-element="title"]')!);
    expect(onEditText).not.toHaveBeenCalled();

    // Committing THIS edit fires onEditText with its OWN value only.
    fireEvent.change(screen.getByDisplayValue("Old Title"), { target: { value: "New Title" } });
    fireEvent.keyDown(screen.getByDisplayValue("New Title"), { key: "Enter" });
    expect(onEditText).toHaveBeenCalledExactlyOnceWith("title", "New Title");
  });
});

// FU-facet-hitmap fix round 3 (J3), extended round 5 (V2): a GATED hitbox
// (no click/select/edit target -- a facet panel's own title/legend/series
// line) must not present as an interactive control: no tabstop, no button
// role, no pointer cursor. An ACTIONABLE hitbox (the whole-figure's own
// title/xlabel/ylabel -- `panel` absent, J2) keeps every affordance exactly
// as before. As of V2, EVERY panel-scoped element kind is gated -- there is
// no remaining "actionable, panel-scoped" example, so the contrast case
// below uses the whole-figure title a facet response also carries.
describe("PreviewOverlay — gated hitboxes drop interactive affordances (J3)", () => {
  const FACET_MAP_J3: FigureHitmap = {
    image: "",
    width: 600,
    height: 400,
    elements: [
      { id: "title", x0: 250, y0: 10, x1: 350, y1: 30 }, // whole-figure (J2) -- no `panel`
      { id: "title", panel: 0, x0: 10, y0: 10, x1: 100, y1: 30 },
      { id: "series:0", panel: 0, x0: 10, y0: 40, x1: 290, y1: 200 },
    ],
    panels: [
      { panel: 0, label: "level 0", x0: 0, y0: 0, x1: 300, y1: 400, xlim: [0, 10], ylim: [0, 10], xlog: false, ylog: false },
    ],
  };
  const j3El = (id: string, panel: number) =>
    document.querySelector<HTMLElement>(`[data-element="${id}"][data-panel="${panel}"]`)!;

  it("a gated facet panel title has no tabIndex, no button role, and a default (non-pointer) cursor", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_J3} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const title = j3El("title", 0);
    expect(title).not.toHaveAttribute("tabindex");
    expect(title).not.toHaveAttribute("role");
    expect(title).not.toHaveAttribute("aria-label");
    expect(title.style.cursor).toBe("default");
  });

  it("a gated facet panel SERIES line drops the same affordances (V2)", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_J3} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const series = j3El("series:0", 0);
    expect(series).not.toHaveAttribute("tabindex");
    expect(series).not.toHaveAttribute("role");
    expect(series.style.cursor).toBe("default");
  });

  it("the WHOLE-FIGURE title (panel absent, J2) alongside it stays fully actionable -- tabstop, button role, pointer cursor", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_J3} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const wholeFigureTitle = document.querySelector<HTMLElement>('[data-element="title"]:not([data-panel])')!;
    expect(wholeFigureTitle).toHaveAttribute("tabindex", "0");
    expect(wholeFigureTitle).toHaveAttribute("role", "button");
    expect(wholeFigureTitle).toHaveAttribute("aria-label");
  });

  it("the flat path's own elements are unaffected -- every affordance stays exactly as before", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={MAP} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const title = el("title");
    expect(title).toHaveAttribute("tabindex", "0");
    expect(title).toHaveAttribute("role", "button");
  });

  it("hover still outlines a gated element -- only the tabstop/role/cursor affordances are dropped", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_J3} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const title = j3El("title", 0);
    fireEvent.pointerEnter(title);
    expect(title.style.outline).toContain("var(--accent)");
  });
});

// FU-facet-hitmap fix round 4 (P1): a facet panel's own LEGEND is real and
// hit-testable (draw_facet_grid draws one whenever a panel has more than
// one series), but stays fully INERT -- no per-panel position/title
// override exists yet. Gated the SAME way J3 gates a panel title: no
// tabstop/role/pointer cursor, no drag start, Properties unavailable.
describe("PreviewOverlay — a gated facet panel legend stays inert (P1)", () => {
  const FACET_MAP_LEGEND: FigureHitmap = {
    image: "",
    width: 600,
    height: 400,
    elements: [
      { id: "legend", panel: 0, x0: 200, y0: 60, x1: 280, y1: 120 },
      { id: "series:0", panel: 0, x0: 10, y0: 40, x1: 290, y1: 200 },
    ],
    panels: [
      { panel: 0, label: "level 0", x0: 0, y0: 0, x1: 300, y1: 400, xlim: [0, 10], ylim: [0, 10], xlog: false, ylog: false },
    ],
  };
  const legendEl = () => document.querySelector<HTMLElement>('[data-element="legend"][data-panel="0"]')!;

  it("has no tabIndex, no button role, and a default (non-pointer, non-move) cursor", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_LEGEND} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const legend = legendEl();
    expect(legend).not.toHaveAttribute("tabindex");
    expect(legend).not.toHaveAttribute("role");
    expect(legend.style.cursor).toBe("default");
  });

  it("does not start a drag -- a full pointerdown/move/up sequence never calls onDragEnd", () => {
    const onDragEnd = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_LEGEND} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={onDragEnd} />,
    );
    const legend = legendEl();
    fireEvent.pointerDown(legend, { clientX: 240, clientY: 90 });
    fireEvent.pointerMove(legend, { clientX: 260, clientY: 100 });
    fireEvent.pointerUp(legend, { clientX: 260, clientY: 100 });
    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("click does not select it, and the context menu offers no Properties action", () => {
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_LEGEND} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    fireEvent.click(legendEl());
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.contextMenu(legendEl());
    expect(screen.getByText("Panel 1 legend")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Properties…" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Properties unavailable" })).toBeDisabled();
  });

  it("the flat path's own legend is completely unaffected -- draggable, selectable, real Properties…", () => {
    const onSelect = vi.fn();
    render(
      <PreviewOverlay src="data:image/png;base64," map={MAP} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const legend = el("legend");
    expect(legend).toHaveAttribute("tabindex", "0");
    expect(legend).toHaveAttribute("role", "button");
    expect(legend.style.cursor).toBe("move");
    fireEvent.click(legend);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("legend");
  });
});

// FU-facet-hitmap fix round 5 (V2): a facet panel's own SERIES line
// routed "Properties…" to the generic Series group, but a style edit made
// there is INERT on the facet render path today (draw_facet_grid ignores
// series_styles entirely) -- gated the SAME way P1 gated the legend.
describe("PreviewOverlay — a gated facet panel series line stays inert (V2)", () => {
  const FACET_MAP_SERIES: FigureHitmap = {
    image: "",
    width: 600,
    height: 400,
    elements: [
      { id: "series:0", panel: 0, x0: 10, y0: 40, x1: 290, y1: 200 },
      { id: "title", panel: 0, x0: 10, y0: 10, x1: 100, y1: 30 },
    ],
    panels: [
      { panel: 0, label: "level 0", x0: 0, y0: 0, x1: 300, y1: 400, xlim: [0, 10], ylim: [0, 10], xlog: false, ylog: false },
    ],
  };
  const seriesEl = () => document.querySelector<HTMLElement>('[data-element="series:0"][data-panel="0"]')!;

  it("has no tabIndex, no button role, and a default cursor", () => {
    render(
      <PreviewOverlay src="data:image/png;base64," map={FACET_MAP_SERIES} textOf={() => ""} onSelect={vi.fn()} onEditText={vi.fn()} onDragEnd={vi.fn()} />,
    );
    const series = seriesEl();
    expect(series).not.toHaveAttribute("tabindex");
    expect(series).not.toHaveAttribute("role");
    expect(series.style.cursor).toBe("default");
  });

  it("click does not select it, even with canonicalSeries enabled", () => {
    const onSelect = vi.fn();
    render(
      <PreviewOverlay
        src="data:image/png;base64,"
        map={FACET_MAP_SERIES}
        textOf={() => ""}
        onSelect={onSelect}
        onEditText={vi.fn()}
        onDragEnd={vi.fn()}
        canonicalSeries
      />,
    );
    fireEvent.click(seriesEl());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("the context menu offers 'Properties unavailable', not a live (but actually inert) Properties… action", () => {
    render(
      <PreviewOverlay
        src="data:image/png;base64,"
        map={FACET_MAP_SERIES}
        textOf={() => ""}
        onSelect={vi.fn()}
        onEditText={vi.fn()}
        onDragEnd={vi.fn()}
        canonicalSeries
      />,
    );
    fireEvent.contextMenu(seriesEl());
    expect(screen.getByText("Panel 1 series")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Properties…" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Series properties — edit on Stage" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Properties unavailable" })).toBeDisabled();
  });

  it("the flat path's own series line is completely unaffected -- selectable, real Properties… once canonicalSeries is on", () => {
    const onSelect = vi.fn();
    const seriesMap = { ...MAP, elements: [...MAP.elements, { id: "series:0", x0: 1, y0: 1, x1: 2, y1: 2 }] };
    render(
      <PreviewOverlay src="data:image/png;base64," map={seriesMap} textOf={() => ""} onSelect={onSelect} onEditText={vi.fn()} onDragEnd={vi.fn()} canonicalSeries />,
    );
    const series = el("series:0");
    expect(series).toHaveAttribute("tabindex", "0");
    expect(series).toHaveAttribute("role", "button");
    fireEvent.contextMenu(series);
    expect(screen.getByRole("menuitem", { name: "Properties…" })).toBeInTheDocument();
    fireEvent.click(series);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("series:0");
  });
});
