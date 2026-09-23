import type { FigureDocument } from "../../../lib/figureDocument";

/** Clear only the facet arrangement; authored axis breaks can then take effect. */
export function withoutFacet(document: FigureDocument): FigureDocument {
  return {
    ...document,
    bindings: { ...document.bindings, facetKey: null },
    plot: { ...document.plot, view: { ...document.plot.view, stackMode: false } },
  };
}

/** Set the durable facet binding and keep the view's multi-panel flag in sync. */
export function withFacetKey(document: FigureDocument, facetKey: number | null): FigureDocument {
  return facetKey === null
    ? withoutFacet(document)
    : {
        ...document,
        bindings: { ...document.bindings, facetKey },
        plot: { ...document.plot, view: { ...document.plot.view, stackMode: true } },
      };
}
