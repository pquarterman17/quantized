import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// `globals` is off in the vitest config, so RTL's automatic afterEach cleanup
// doesn't register itself. Unmount rendered components/hooks between tests so a
// prior test's lingering store subscriptions can't intercept a later test's
// state changes (otherwise renderHook instances accumulate within a file).
afterEach(() => {
  cleanup();
});
