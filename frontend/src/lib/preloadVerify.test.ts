// The build gate behind scripts/preloadPrune.mjs (bundle diet slice 8, review
// round): scripts/preloadVerify.mjs re-derives, from EMITTED code, what every
// dynamic import's preload list must still contain, and the build fails on a
// shortfall. Measured on the real build: a prune sabotaged to drop one extra
// entry fails `npm run build` with 96 violations. These cases pin the rule on
// small hand-written chunks in Vite's real output shape.

import { describe, expect, it } from "vitest";

import { verifyPreloadLists } from "../../scripts/preloadVerify.mjs";

const header = (files: string[]) =>
  `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=${JSON.stringify(files)})))=>i.map(i=>d[i]);\n`;

/** index (entry) -> useApp; index import()s Dialog, which statically imports
 *  shared + useApp and carries dialog.css; Panel is lazy and import()s Deep
 *  with a `.then` wrapper, Deep importing shared. */
function build(indexList: string[], deepList = ["assets/Deep.js"]) {
  const table = [...new Set([...indexList])];
  const index =
    (table.length ? header(table) : "") +
    `import"./useApp.js";const a=h(()=>import("./Dialog.js"),` +
    (indexList.length ? `__vite__mapDeps([${indexList.map((f) => table.indexOf(f)).join(",")}]));` : `[]);`);
  const panel =
    header(deepList) +
    `import"./shared.js";const b=h(()=>import("./Deep.js").then(e=>e.x),__vite__mapDeps([${deepList.map((_, i) => i).join(",")}]));`;
  return {
    "assets/index.js": { code: index, css: [], isEntry: true },
    "assets/useApp.js": { code: "export const u=1;", css: [], isEntry: false },
    "assets/Dialog.js": { code: 'import"./shared.js";import"./useApp.js";export default 1;', css: ["assets/dialog.css"], isEntry: false },
    "assets/shared.js": { code: "export const s=1;", css: [], isEntry: false },
    "assets/Panel.js": { code: panel, css: [], isEntry: false },
    "assets/Deep.js": { code: 'import"./shared.js";export const x=1;', css: [], isEntry: false },
  };
}

describe("preloadVerify (bundle diet slice 8 build gate)", () => {
  it("accepts a pruned list that keeps every chunk not already loaded, and the CSS", async () => {
    // useApp is in the entry closure, shared is in Panel's own closure.
    const r = await verifyPreloadLists(build(["assets/Dialog.js", "assets/shared.js", "assets/dialog.css"]));
    expect(r).toEqual({ sites: 2, checked: 2, violations: [] });
  });

  it("fails a list that lost a needed chunk", async () => {
    const r = await verifyPreloadLists(build(["assets/Dialog.js", "assets/dialog.css"]));
    expect(r.violations).toEqual(["assets/index.js -> assets/Dialog.js: needs assets/shared.js, not in its preload list"]);
  });

  it("fails a list that lost the target itself, or its CSS", async () => {
    expect((await verifyPreloadLists(build(["assets/shared.js", "assets/dialog.css"]))).violations).toEqual([
      "assets/index.js -> assets/Dialog.js: needs assets/Dialog.js, not in its preload list",
    ]);
    expect((await verifyPreloadLists(build(["assets/Dialog.js", "assets/shared.js"]))).violations).toEqual([
      "assets/index.js -> assets/Dialog.js: CSS assets/dialog.css (of assets/Dialog.js) not in its preload list",
    ]);
  });

  it("checks an emptied list too, and attributes a `.then`-wrapped list to its import()", async () => {
    expect((await verifyPreloadLists(build([]))).violations).toHaveLength(3); // Dialog, shared, dialog.css
    expect((await verifyPreloadLists(build(["assets/Dialog.js", "assets/shared.js", "assets/dialog.css"], []))).violations).toEqual([
      "assets/Panel.js -> assets/Deep.js: needs assets/Deep.js, not in its preload list",
    ]);
  });

  it("checks an emptied list in the async-destructure shape (review round 2: it used to be skipped)", async () => {
    // Vite's `h(async()=>{let{x:e}=await import("./X");...},[])` shape.
    const chunks = build(["assets/Dialog.js", "assets/shared.js", "assets/dialog.css"]);
    chunks["assets/Panel.js"] = {
      code: 'import"./shared.js";const b=h(async()=>{let{x:e}=await import("./Deep.js");return{default:e}},[]);',
      css: [],
      isEntry: false,
    };
    const r = await verifyPreloadLists(chunks);
    expect(r.sites).toBe(2);
    expect(r.violations).toEqual(["assets/Panel.js -> assets/Deep.js: needs assets/Deep.js, not in its preload list"]);
  });

  it("fails an import() whose preload list it cannot find, rather than skipping it", async () => {
    const chunks = build(["assets/Dialog.js", "assets/shared.js", "assets/dialog.css"]);
    chunks["assets/Panel.js"] = { code: 'import"./shared.js";const b=import("./Deep.js");', css: [], isEntry: false };
    const r = await verifyPreloadLists(chunks);
    expect(r.violations).toEqual(["assets/Panel.js -> assets/Deep.js: import() with no recognisable preload list"]);
  });
});
