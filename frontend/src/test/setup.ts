import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { afterEach } from "vitest";

// Node 20+ ships its OWN `localStorage` global (experimental, file-backed).
// It is an own accessor on globalThis, so vitest's jsdom environment skips
// installing jsdom's Storage over it — and Node's getter returns `undefined`
// unless the process was started with `--localstorage-file`. The result on a
// default Homebrew Node 26 is that `localStorage` is undefined in EVERY test,
// failing 176 of them across 22 files (2026-07-29) with a message
// ("Cannot read properties of undefined") that names neither Node nor the
// flag. CI didn't catch it because CI runs Node 22, where the global isn't
// exposed yet — the classic shape of a bug that only bites fresh checkouts.
//
// Restoring a real jsdom Storage keeps the suite honest on any Node instead
// of merely asking developers to downgrade (.nvmrc pins 22 for exactly that
// reason — belt and braces, not a substitute). A throwaway JSDOM is the
// cheapest way to get genuine Storage semantics — quota events, key
// coercion, `length`/`key()` — rather than a hand-rolled Map that would
// drift from what the browser and CI actually do. setupFiles run once per
// test FILE, so each file gets its own isolated storage, which is what the
// `localStorage.clear()` in the affected suites' beforeEach already assumes.
if (globalThis.localStorage === undefined) {
  const { localStorage } = new JSDOM("", { url: "http://localhost/" }).window;
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    configurable: true,
    writable: true,
  });
}

// `globals` is off in the vitest config, so RTL's automatic afterEach cleanup
// doesn't register itself. Unmount rendered components/hooks between tests so a
// prior test's lingering store subscriptions can't intercept a later test's
// state changes (otherwise renderHook instances accumulate within a file).
afterEach(() => {
  cleanup();
});
