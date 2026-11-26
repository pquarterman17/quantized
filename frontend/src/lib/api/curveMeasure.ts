// /api/curve-measure wrappers: intersection of two curves, level crossings and
// rise / fall time on raw (X, Y) arrays. Lazy-workshop-only, so they live in
// their own sibling (see lib/api.ts's header) and are NOT re-exported from it.
// Shapes come from the generated OpenAPI schema, never hand-copied.

import { postJSON } from "./http";
import type { components } from "./schema";

type Schemas = components["schemas"];

export type IntersectBody = Schemas["IntersectRequest"];
export type IntersectResult = Schemas["IntersectResponse"];
export type IntersectionPoint = Schemas["IntersectionOut"];
export type LevelCrossingBody = Schemas["LevelCrossingRequest"];
export type LevelCrossingResult = Schemas["LevelCrossingResponse"];
export type StepTimeBody = Schemas["StepTimeRequest"];
export type StepTimeResult = Schemas["StepTimeResponse"];

export const measureIntersect = (body: IntersectBody): Promise<IntersectResult> =>
  postJSON("/api/curve-measure/intersect", body);

export const measureLevelCrossings = (body: LevelCrossingBody): Promise<LevelCrossingResult> =>
  postJSON("/api/curve-measure/level-crossings", body);

export const measureStepTime = (body: StepTimeBody): Promise<StepTimeResult> =>
  postJSON("/api/curve-measure/step-time", body);
