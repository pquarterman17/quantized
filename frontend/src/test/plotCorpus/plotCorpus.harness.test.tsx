// ORIGIN_PLOT_TYPE_PARITY_PLAN item 3 -- the corpus run, driven by
// tools/plot_corpus/scratch_run.py. Skipped unless that driver sets
// QZ_PLOT_CORPUS_IN (specimens JSON) and QZ_PLOT_CORPUS_OUT; it also sets
// QZ_PLOT_CORPUS_API + QZ_PLOT_CORPUS_TOKEN, a live quantized backend the
// app's own `/api/...` calls (stat compute, map regrid) are forwarded to, so
// nothing on the recipe path is mocked.

import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { runSpecimen, type SpecimenIn, type SpecimenOut } from "./recipeHarness";

const IN = process.env.QZ_PLOT_CORPUS_IN;
const OUT = process.env.QZ_PLOT_CORPUS_OUT;
const API = process.env.QZ_PLOT_CORPUS_API;
const TOKEN = process.env.QZ_PLOT_CORPUS_TOKEN ?? "";

describe.skipIf(!IN || !OUT)("plot corpus: build every type from scratch", () => {
  it("replays every specimen's recipe", { timeout: 1_800_000 }, async () => {
    // jsdom has no ResizeObserver; the Stat Stage observes its host.
    vi.stubGlobal("ResizeObserver", class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    if (API) {
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const headers = new Headers(init.headers);
        headers.set("x-quantized-token", TOKEN);
        return realFetch(url.startsWith("/") ? `${API}${url}` : url, { ...init, headers });
      });
    }
    const specimens = JSON.parse(readFileSync(IN as string, "utf-8")) as SpecimenIn[];
    const out: SpecimenOut[] = [];
    for (const [i, sp] of specimens.entries()) out.push(await runSpecimen(sp, i));
    writeFileSync(OUT as string, JSON.stringify(out), "utf-8");
    expect(out).toHaveLength(specimens.length);
  });
});
