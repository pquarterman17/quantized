/** Persisted shared-selection schema. Keep this tiny so result sanitization can
 * enforce the version without pulling selection/runtime code into startup. */
export const ANALYSIS_SELECTION_VERSION = 1 as const;
