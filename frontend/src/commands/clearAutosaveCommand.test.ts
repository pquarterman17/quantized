// "Clear autosaved workspace…" (silent-failure audit 2026-10-01): the command
// fired `void clearAutosave()` and announced success unconditionally, so a
// refused clear left the snapshot to be offered again with no word.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveAutosave, setAutosaveBackend } from "../lib/autosave";
import { memoryBackend } from "../lib/autosaveBackend";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";
import { buildFileCommands } from "./fileCommands";

function runClear(): void {
  const cmd = buildFileCommands(useApp.getState).find((c) => c.id === "clear-autosave");
  if (!cmd) throw new Error("no clear-autosave command");
  void cmd.run();
}

beforeEach(() => {
  useApp.setState({ status: "" });
  useToasts.setState({ toasts: [] });
});
afterEach(() => setAutosaveBackend(memoryBackend()));

describe("clear-autosave command", () => {
  it("reports a failed clear on the status line and as a danger toast", async () => {
    setAutosaveBackend({ ...memoryBackend(), clear: () => Promise.reject(new Error("storage blocked")) });
    runClear();
    await expect.poll(() => useApp.getState().status).toContain("couldn't clear the autosaved workspace");
    expect(useApp.getState().status).toContain("storage blocked");
    expect(useToasts.getState().toasts.some((t) => t.kind === "danger" && t.msg.includes("storage blocked"))).toBe(true);
  });

  it("confirms only after the clear actually succeeded", async () => {
    const backend = memoryBackend();
    setAutosaveBackend(backend);
    await saveAutosave({ datasets: [] });
    runClear();
    await expect.poll(() => useApp.getState().status).toBe("autosaved workspace cleared (current library unchanged)");
    expect(await backend.read()).toEqual([]);
  });
});
