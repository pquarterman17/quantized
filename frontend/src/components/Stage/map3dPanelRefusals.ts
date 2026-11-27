// Which 3-D refusals the 3-D PANEL can fix, so the view opens it for them
// (`Map3dStageView`). Matched on the refusal's own words (`Map3D/*3d.ts`, the
// route's messages); `map3dPanelRefusals.test.ts` builds each real refusal and
// fails if one is reworded. The rest point elsewhere and do NOT open the panel:
// a grid too small, a cap on the number of bars or vectors (resolution, crop and
// map operations), too few finite points, values too large for an axis, the
// vectors' `contour_source` (the rows, not a setting).
//
//   panel:  the vector columns not picked yet; more than 10 colour categories or
//           groups (pick another column); two colourings at once (clear one);
//           grouped bars without a category colour, or with rows that repeat a
//           position and category (pick a text column, or turn grouping off);
//           an absolute bar size missing or not above 0.

const IN_PANEL: readonly RegExp[] = [
  /need the vec_dx, vec_dy and vec_dz columns/,
  /(colour categories|groups); this column has \d+/,
  /(not both|not more than one): send /,
  /^grouped bars need /,
  /^bar_abs_[wd] must be a number above 0/,
];

export const refusalFixedInPanel = (message: string): boolean => IN_PANEL.some((re) => re.test(message));
