/** Stable lock key for the browser build's single shared autosave slot. */
export const BROWSER_AUTOSAVE_LOCK_PATH = "qz://browser-autosave-session";


// `readOnlyOpenReason` lives in ./projectLockReasons.ts: no eager module uses it.
export * from "./projectLockReasons";
