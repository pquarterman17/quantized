// "Copy diagnostics" (Help menu / ⌘K), body only. Lazy: commands/uiCommands.ts
// imports it on the pick, so neither it nor the diagnostics renderer sits in
// the entry chunk. Shape and settings only; lib/diagnostics.ts says what is
// withheld and why, and diagnostics.test.ts holds the redaction guarantee.

import { copyText } from "../lib/clipboard";
import { saveBlob } from "../lib/download";
import type { StoreGet } from "../lib/exportActive";
import { diagnosticsText } from "../store/diagnostics";
import { toast } from "../store/toasts";

export async function copyDiagnostics(s: StoreGet): Promise<void> {
  // Synchronous (P3.4 review round, 2026-09-14): reads the backend identity
  // `store/backendHealth.ts` cached from App.tsx's startup probe rather than
  // awaiting a fresh network round-trip between the click and the clipboard.
  const text = diagnosticsText();
  if (await copyText(text)) {
    s().setStatus("diagnostics copied — no dataset names, paths, or values included");
    toast("diagnostics copied to the clipboard", "ok");
    return;
  }
  // `copyText` resolves false (it does not throw) in an insecure context or a
  // browser without the async clipboard API. Stopping at "could not copy"
  // would throw the bundle away, and the user in a degraded environment is
  // exactly the one who needs a bug report: fall back to a file download.
  saveBlob(
    new Blob([text], { type: "text/plain" }),
    `quantized-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`,
  );
  s().setStatus("clipboard unavailable — diagnostics saved as a file instead");
  toast("clipboard unavailable — diagnostics downloaded", "info");
}
