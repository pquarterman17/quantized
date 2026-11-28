// A series style as the magnifier inset draws it: drop lines and size-by points are not drawn there (the export's
// inset omits them and warns), the rug marks are (plan item 20): each series' ticks along the inset's own axes.

import type { SeriesStyle } from "../../lib/types";

export const insetCellStyle = (s: SeriesStyle | undefined): SeriesStyle | undefined => s && { ...s, dropLines: undefined, sizeBy: undefined };
