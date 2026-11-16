// UX-D: Tauri v2 intercepts OS file drops (tauri://drag-drop) unless the window
// sets dragDropEnabled:false -- on Windows/WebView2 HTML5 `drop` then never
// reaches the page, so neither the Library nor the window-wide handler would
// ever fire in the installer build. Config-level guard (no Tauri runtime here).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("tauri window config", () => {
  it("lets the webview receive DOM file drops", () => {
    const conf = JSON.parse(readFileSync("../src-tauri/tauri.conf.json", "utf8")) as {
      app: { windows: { label: string; dragDropEnabled?: boolean }[] };
    };
    const main = conf.app.windows.find((w) => w.label === "main");
    expect(main?.dragDropEnabled).toBe(false);
  });
});
