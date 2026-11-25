// The server half of the preference slots (owner decision 2026-11-25):
// hydrate order (server beats localStorage; localStorage is the offline
// fallback), first-run migration, a mid-request edit, and the debounced
// write-through.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadInteractionPrefs, saveInteractionPrefs } from "../store/prefs";
import { useApp } from "../store/useApp";
import { PREFS_PUT_DEBOUNCE_MS, flushPrefsNow, startPrefsServerSync, stopPrefsServerSync } from "./prefsServerSync";

interface Call {
  method: string;
  body: { slots: Record<string, unknown> } | null;
}

function serverWith(slots: Record<string, unknown>, opts: { fail?: boolean; gate?: Promise<void> } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (opts.fail) throw new TypeError("Failed to fetch");
    if (method === "GET") {
      await opts.gate;
      return new Response(JSON.stringify({ slots, notice: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ slots: {} }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const puts = (calls: Call[]) => calls.filter((c) => c.method === "PUT");

beforeEach(() => {
  localStorage.clear();
  useApp.getState().setPref("accent", "violet");
  useApp.getState().setPref("sigFigs", 6);
});
afterEach(() => {
  stopPrefsServerSync();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useApp.getState().setPref("accent", "violet");
  useApp.getState().setPref("sigFigs", 6);
  localStorage.clear();
});

describe("hydrate", () => {
  it("the server's slots beat localStorage, in the store and in the cache", async () => {
    saveInteractionPrefs({ persistentTool: false });
    const calls = serverWith({
      "qz.prefs": { accent: "teal", sigFigs: 4 },
      "qz.interactionPrefs": { persistentTool: true },
    });
    await expect(startPrefsServerSync()).resolves.toBe("server");
    expect(useApp.getState().accent).toBe("teal");
    expect(useApp.getState().sigFigs).toBe(4);
    expect(document.documentElement.dataset.accent).toBe("teal");
    expect(JSON.parse(localStorage.getItem("qz.prefs")!).accent).toBe("teal");
    expect(loadInteractionPrefs().persistentTool).toBe(true);
    // Applying the server's values is not echoed back as an edit.
    expect(puts(calls).every((c) => !("qz.prefs" in (c.body?.slots ?? {})))).toBe(true);
  });

  it("an unreachable server leaves localStorage as the source and sends nothing", async () => {
    useApp.getState().setPref("accent", "amber");
    const calls = serverWith({}, { fail: true });
    await expect(startPrefsServerSync()).resolves.toBe("offline");
    expect(useApp.getState().accent).toBe("amber");
    useApp.getState().setPref("accent", "rose");
    await flushPrefsNow();
    expect(puts(calls)).toEqual([]);
  });

  it("a slot the user changed while the GET was in flight keeps the user's value and is pushed", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const calls = serverWith({ "qz.prefs": { accent: "teal" } }, { gate });
    const done = startPrefsServerSync();
    await Promise.resolve();
    useApp.getState().setPref("accent", "rose"); // the newer, local choice
    open();
    await expect(done).resolves.toBe("server");
    expect(useApp.getState().accent).toBe("rose");
    const pushed = puts(calls).map((c) => c.body!.slots["qz.prefs"] as { accent: string });
    expect(pushed.at(-1)?.accent).toBe("rose");
  });

  it("a boot-time rewrite with the SAME content does not count as a newer choice", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    serverWith({ "qz.prefs": { accent: "teal" } }, { gate });
    const done = startPrefsServerSync();
    await Promise.resolve();
    useApp.getState().setPref("accent", "violet"); // unchanged value, rewritten
    open();
    await done;
    expect(useApp.getState().accent).toBe("teal");
  });
});

describe("first-run migration", () => {
  it("an empty server file receives this browser's prefs", async () => {
    useApp.getState().setPref("accent", "ocean");
    saveInteractionPrefs({ persistentTool: true });
    const calls = serverWith({});
    await expect(startPrefsServerSync()).resolves.toBe("migrated");
    const [up] = puts(calls);
    expect((up.body!.slots["qz.prefs"] as { accent: string }).accent).toBe("ocean");
    expect(up.body!.slots["qz.interactionPrefs"]).toEqual({ persistentTool: true });
    expect(useApp.getState().accent).toBe("ocean"); // nothing lost
  });

  it("with nothing on either side there is nothing to send", async () => {
    localStorage.clear();
    const calls = serverWith({});
    await expect(startPrefsServerSync()).resolves.toBe("empty");
    expect(puts(calls)).toEqual([]);
  });
});

describe("write-through", () => {
  it("debounces a burst of edits into one PUT of the changed slots", async () => {
    const calls = serverWith({ "qz.prefs": { accent: "violet" } });
    await startPrefsServerSync();
    const before = puts(calls).length;
    vi.useFakeTimers();
    useApp.getState().setPref("accent", "teal");
    useApp.getState().setPref("accent", "amber");
    saveInteractionPrefs({ persistentTool: true });
    expect(puts(calls).length).toBe(before);
    await vi.advanceTimersByTimeAsync(PREFS_PUT_DEBOUNCE_MS + 10);
    const sent = puts(calls).slice(before);
    expect(sent).toHaveLength(1);
    expect((sent[0].body!.slots["qz.prefs"] as { accent: string }).accent).toBe("amber");
    expect(sent[0].body!.slots["qz.interactionPrefs"]).toEqual({ persistentTool: true });
  });

  it("a reset slot is sent as null, which deletes it on the server", async () => {
    const calls = serverWith({ "qz.prefs": { accent: "violet" } });
    await startPrefsServerSync();
    saveInteractionPrefs({ persistentTool: true });
    const { interactionPrefsSlot } = await import("../store/prefs");
    interactionPrefsSlot.reset();
    await flushPrefsNow();
    expect(puts(calls).at(-1)!.body!.slots["qz.interactionPrefs"]).toBeNull();
  });

  it("a slot outside the synced set is never sent", async () => {
    const calls = serverWith({ "qz.prefs": { accent: "violet" } });
    await startPrefsServerSync();
    const { writePrefSlot } = await import("./prefSlots");
    writePrefSlot("qz.prefsDialog", { tab: "Plot" });
    await flushPrefsNow();
    expect(puts(calls).some((c) => "qz.prefsDialog" in (c.body?.slots ?? {}))).toBe(false);
  });
});
