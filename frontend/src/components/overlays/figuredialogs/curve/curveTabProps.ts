// The props every curve tab takes. A tab reads a value and calls onChange over
// it; it never touches the store's curve fields, so the popup mounts it over a
// draft and a docked panel card could mount the same tab over the live setter.

import type { SeriesStyle } from "../../../../lib/types";
import type { DraftSetStyle } from "../../../../store/commitCurveDraft";
import type { CurveContext } from "./useCurveContext";

export interface CurveTabProps {
  channel: number;
  style: SeriesStyle;
  setSeriesStyle: DraftSetStyle;
  ctx: CurveContext;
}

export const tabRow = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } as const;
