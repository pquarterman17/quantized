// Real OS-style file drag-and-drop. jsdom cannot construct a live
// `DataTransfer`/`File` pair or dispatch a real `drop` event a React
// `onDrop` handler observes correctly — the literal reason this suite exists
// (see Library.tsx's `onDrop`/`onDragOver`, which gates on
// `e.dataTransfer.types.includes("Files")`). `File`/`DataTransfer` aren't
// structured-cloneable across the Node/browser boundary, so the transfer is
// built INSIDE the page via `page.evaluateHandle` and the events are
// dispatched against that live handle — the documented Playwright pattern
// for exercising native HTML5 drop zones.

import fs from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

/** Drop the file at `fixturePath` onto `target` (a Locator for the drop
 *  zone), simulating a real OS file drag from the desktop. */
export async function dropFileOnto(page: Page, target: Locator, fixturePath: string, mimeType = "text/csv"): Promise<void> {
  const buffer = fs.readFileSync(fixturePath);
  const base64 = buffer.toString("base64");
  const fileName = path.basename(fixturePath);

  const dataTransfer = await page.evaluateHandle(
    ({ base64, fileName, mimeType }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], fileName, { type: mimeType });
      const dt = new DataTransfer();
      dt.items.add(file);
      return dt;
    },
    { base64, fileName, mimeType },
  );

  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
}
