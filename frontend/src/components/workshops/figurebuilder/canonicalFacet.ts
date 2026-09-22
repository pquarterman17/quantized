import type { FigureDocument } from "../../../lib/figureDocument";

/** Clear only the facet arrangement; authored axis breaks can then take effect. */
export function withoutFacet(document: FigureDocument): FigureDocument {
  return {
    ...document,
    bindings: { ...document.bindings, facetKey: null },
    plot: { ...document.plot, view: { ...document.plot.view, stackMode: false } },
  };
}
