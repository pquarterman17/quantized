import assert from "node:assert/strict";
import test from "node:test";

import { chromeEnv } from "./origin_shared.mjs";

test("chromeEnv forces a UTF-8 locale when the inherited one cannot map non-ASCII paths", () => {
  // the container default: nothing set, LC_CTYPE falls back to POSIX
  assert.equal(chromeEnv({ PATH: "/bin" }, "linux").LC_ALL, "C.UTF-8");
  assert.equal(chromeEnv({ LANG: "C" }, "linux").LC_ALL, "C.UTF-8");
  assert.equal(chromeEnv({ LC_ALL: "POSIX", LANG: "en_US.UTF-8" }, "linux").LC_ALL, "C.UTF-8");
  assert.equal(chromeEnv({ PATH: "/bin" }, "linux").PATH, "/bin");
});

test("chromeEnv leaves a UTF-8 locale and Windows alone", () => {
  const utf8 = { LANG: "en_US.UTF-8" };
  assert.equal(chromeEnv(utf8, "linux"), utf8);
  assert.equal(chromeEnv({ LC_CTYPE: "C.utf8" }, "darwin").LC_ALL, undefined);
  const win = { PATH: "C:/x" };
  assert.equal(chromeEnv(win, "win32"), win);
});
