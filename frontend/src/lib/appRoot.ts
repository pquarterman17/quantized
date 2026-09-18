// The app shell's own programmatically-focusable landing spot — the LAST
// place a closing surface can hand focus to before `<body>`.
//
// WHY (P3.3 round 3, review finding 4). `useDialogFocus`'s `focusSafeLanding`
// aimed at the Library's focus-loss container (`lib/scrollOutFocus.ts`), which
// only three VIRTUALIZED renderers put in the DOM. With zero rows the Library
// renders the flat branch and no container at all — its own comment calls that
// "the most common launch state" — and the Details search branch renders none
// while its `Suspense` fallback is up. `?.focus()` on a missing element is a
// silent no-op, so focus stayed on `<body>`: the documented data-loss spot
// (`lib/focusGuard.ts` — `useGlobalShortcuts`' Delete/Backspace treats body as
// fair game), while the records claimed "never `<body>`".
//
// The shell root always exists, so the promise can now actually be kept.
// `tabIndex: -1` is load-bearing and deliberately NOT 0: script-focusable
// only, or the whole app would become a Tab stop of its own.

/** Marker attribute on the shell root (`App.tsx`'s `.qzk-app`). */
export const APP_ROOT_FOCUS_ATTR = "data-app-root";
export const APP_ROOT_FOCUS_SELECTOR = `[${APP_ROOT_FOCUS_ATTR}]`;

/** Spread onto the shell root. Keeps "focusable by script" and
 *  "findable by the fallback" from drifting apart. */
export const appRootFocusProps = { tabIndex: -1, [APP_ROOT_FOCUS_ATTR]: "" } as const;
