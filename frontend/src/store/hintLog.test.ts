import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HINT_LOG_MAX, startHintLog, useHintLog } from "./hintLog";
import { toast, useToasts } from "./toasts";
import { useApp } from "./useApp";

let stop: () => void;
beforeEach(() => {
  useHintLog.getState().clear();
  useToasts.setState({ toasts: [] });
  useApp.setState({ status: "ready", statusDanger: null, statusWarn: null });
  stop = startHintLog();
});
afterEach(() => stop());

describe("hint log", () => {
  it("records status messages with their tone, newest last", () => {
    useApp.getState().setStatus("loaded x");
    useApp.getState().setStatus("could not save", "danger");
    useApp.getState().setStatus("careful", "warn");
    const e = useHintLog.getState().entries;
    expect(e.map((x) => [x.text, x.tone, x.source])).toEqual([
      ["loaded x", "ok", "status"],
      ["could not save", "danger", "status"],
      ["careful", "warn", "status"],
    ]);
    expect(typeof e[0]!.at).toBe("number");
  });

  it("records a toast with the LABEL of its action, never the callback", () => {
    toast("Imported 3 files", "ok", { action: { label: "Undo", onClick: () => {} } });
    const [entry] = useHintLog.getState().entries;
    expect(entry).toMatchObject({ text: "Imported 3 files", tone: "ok", source: "toast", actions: ["Undo"] });
    expect(JSON.stringify(entry)).not.toContain("onClick");
  });

  it("merges a toast that repeats the status line into one row", () => {
    useApp.getState().setStatus("chunk would not load", "danger");
    toast("chunk would not load", "danger", { action: { label: "Retry", onClick: () => {} } });
    const e = useHintLog.getState().entries;
    expect(e).toHaveLength(1);
    expect(e[0]!.actions).toEqual(["Retry"]);
  });

  it("keeps only the last HINT_LOG_MAX entries", () => {
    for (let i = 0; i < HINT_LOG_MAX + 5; i++) useApp.getState().setStatus(`m${i}`);
    const e = useHintLog.getState().entries;
    expect(e).toHaveLength(HINT_LOG_MAX);
    expect(e[0]!.text).toBe("m5");
    expect(e[e.length - 1]!.text).toBe(`m${HINT_LOG_MAX + 4}`);
  });

  it("stops listening after stop(), and Clear empties the log", () => {
    useApp.getState().setStatus("one");
    useHintLog.getState().clear();
    expect(useHintLog.getState().entries).toHaveLength(0);
    stop();
    useApp.getState().setStatus("two");
    expect(useHintLog.getState().entries).toHaveLength(0);
    stop = startHintLog();
  });

  it("does not change the status line or the toasts it listens to", () => {
    useApp.getState().setStatus("plain");
    toast("a toast");
    expect(useApp.getState().status).toBe("plain");
    expect(useToasts.getState().toasts.map((t) => t.msg)).toEqual(["a toast"]);
  });

  it("is memory only: it writes no storage and the diagnostics code never reads it", () => {
    localStorage.clear();
    useApp.getState().setStatus("a path C:/secret/name.dat");
    expect(localStorage.length).toBe(0);
    const src = readFileSync(join(__dirname, "hintLog.ts"), "utf8");
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|writePrefSlot|fetch\(/);
    const dirs = [join(__dirname), join(__dirname, "../lib")];
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => /^diagnostics.*\.ts$/.test(n) && !n.includes(".test."))) {
        expect(readFileSync(join(dir, f), "utf8")).not.toContain("hintLog");
      }
    }
  });
});
