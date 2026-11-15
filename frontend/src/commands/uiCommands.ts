// View/Edit/Help-menu command registry entries (theme, density, accent,
// panel toggles, stage tab, command palette, paste, keyboard shortcuts,
// text formatting help) — split out of appCommands.ts (that module's own
// store-size ratchet, zero headroom). appCommands.ts stays the thin
// aggregator; this module owns every command whose `group` is "View",
// "Edit", or "Help" — the small app-chrome groups that don't warrant their
// own module. Behavior is unchanged — this is a verbatim move.

import { copyText } from "../lib/clipboard";
// Static, not dynamic: lib/download is already in the eager graph (the export
// commands use it), so importing it here costs nothing, while a dynamic
// import measured 0.7 kB WORSE — the extra chunk boundary outweighed a
// deferral that defers nothing.
import { saveBlob } from "../lib/download";
import type { StoreGet } from "../lib/exportActive";
import { toast } from "../store/toasts";
import { openHelp, useHelp } from "../store/help";
import { PALETTE_LABEL, PALETTE_SHORTCUT, type Action } from "../store/commands";
import { showInteractionHints } from "../components/overlays/InteractionHints";

/** Build the View/Edit/Help-group curated palette actions against the live
 *  store handle (`useApp.getState`) — store setters are stable, so callers
 *  build once. */
export function buildUiCommands(s: StoreGet): Action[] {
  return [
    {
      id: "theme",
      group: "View",
      section: "Appearance",
      label: "Toggle theme",
      run: () => s().setTheme(s().theme === "dark" ? "light" : "dark"),
    },
    {
      id: "density",
      group: "View",
      section: "Appearance",
      label: "Cycle density",
      run: () => {
        const order = ["compact", "regular", "comfy"] as const;
        s().setDensity(order[(order.indexOf(s().density) + 1) % order.length]);
      },
    },
    {
      id: "accent",
      group: "View",
      section: "Appearance",
      label: "Cycle accent color",
      run: () => {
        const order = ["violet", "teal", "ocean", "amber", "rose"] as const;
        s().setAccent(order[(order.indexOf(s().accent) + 1) % order.length]);
      },
    },
    {
      id: "toggle-excluded-rows",
      group: "View",
      section: "Appearance",
      label: "Toggle greyed excluded rows",
      checked: () => s().excludedDisplay === "grey",
      run: () => s().setPref("excludedDisplay", s().excludedDisplay === "grey" ? "hide" : "grey"),
    },
    {
      id: "left",
      group: "View",
      label: "Toggle library panel",
      checked: () => !s().leftCollapsed,
      shortcut: "⌘[",
      run: () => s().toggleLeft(),
    },
    {
      id: "right",
      group: "View",
      label: "Toggle inspector panel",
      checked: () => !s().rightCollapsed,
      shortcut: "⌘]",
      run: () => s().toggleRight(),
    },
    {
      id: "column-switcher",
      group: "View",
      section: "Panels & workspace",
      label: "Column switcher (flip through channels)…",
      disabled: () => !s().activeId,
      disabledReason: "Import or select a dataset first",
      run: () => s().setColumnSwitcherOpen(true),
    },
    {
      id: "worksheet",
      group: "View",
      label: "Show worksheet",
      checked: () => s().stageTab === "worksheet",
      disabled: () => !s().activeId,
      disabledReason: "Import or select a dataset first",
      run: () => s().setStageTab("worksheet"),
    },
    {
      id: "workflow",
      group: "View",
      section: "Panels & workspace",
      label: "Show workflow",
      checked: () => s().stageTab === "technique" || s().stageTab === "analysis",
      disabled: () => !s().activeId,
      disabledReason: "Import or select a dataset first",
      run: () => s().setStageTab("technique"),
    },
    // GUI_INTERACTION #10: restores every open-or-ever-opened floating
    // ToolWindow (curve fit, peaks, baseline, …) to its own default
    // position/size, uncollapsed — the recovery path for a window dragged
    // off-screen or left collapsed/tiny after a monitor change.
    {
      id: "reset-tool-windows",
      group: "View",
      section: "Panels & workspace",
      label: "Reset window positions",
      run: () => s().resetToolWindowPositions(),
    },
    {
      id: "plot",
      group: "View",
      label: "Show plot",
      checked: () => s().stageTab === "plot",
      disabled: () => !s().activeId,
      disabledReason: "Import or select a dataset first",
      run: () => s().setStageTab("plot"),
    },
    // ── Edit ──
    {
      id: "palette",
      group: "Edit",
      label: PALETTE_LABEL,
      shortcut: PALETTE_SHORTCUT,
      run: () => s().setCmdk(true),
    },
    {
      id: "paste-data",
      group: "Edit",
      label: "Paste data",
      shortcut: "⌘V",
      run: () => void s().pasteDataFromClipboard(),
    },
    {
      id: "help",
      group: "Help",
      label: "Help topics…",
      // Standalone store (store/help) — imported directly like toasts, not a
      // useApp flag (see store/help for why).
      run: () => openHelp("search"),
    },
    {
      id: "shortcuts",
      group: "Help",
      label: "Keyboard shortcuts",
      shortcut: "?",
      run: () => s().setShortcutsOpen(true),
    },
    // GOTO #11: the rich-text label micro-syntax reference (Help menu + ⌘K).
    { id: "text-format-help", group: "Help", label: "Text formatting", run: () => s().setTextFormatHelpOpen(true) },
    // P3.4: "copyable diagnostic bundle excludes raw/private data by default".
    // Shape and settings only — see lib/diagnostics.ts for what is withheld
    // and why, and diagnostics.test.ts for the redaction guarantee.
    {
      id: "copy-diagnostics",
      group: "Help",
      label: "Copy diagnostics",
      run: () => {
        void (async () => {
          // Dynamic import: the bundle is only ever needed AFTER this action,
          // so neither the renderer nor the collector belongs in the eager
          // graph that `commands/` otherwise sits in. Eagerly importing it put
          // the build over the size ratchet, which is precisely the case
          // check-bundle-size.mjs tells you to solve this way. `Shell/MenuBar`
          // warms this same chunk when the Help menu opens, so from the
          // second click in a session onward this `await` resolves from the
          // module cache instantly; the first click of a session can still
          // await a real fetch for it (P3.4 review round, finding 3).
          const { diagnosticsText } = await import("../store/diagnostics");
          // Synchronous (P3.4 review round, 2026-09-14): reads the backend
          // identity `store/backendHealth.ts` cached from App.tsx's startup
          // probe rather than awaiting a fresh network round-trip here — see
          // that module's header for why an awaited probe belongs nowhere
          // between this click and the clipboard write below.
          const text = diagnosticsText();
          if (await copyText(text)) {
            s().setStatus("diagnostics copied — no dataset names, paths, or values included");
            toast("diagnostics copied to the clipboard", "ok");
            return;
          }
          // `copyText` resolves false (it does not throw) in an insecure
          // context or a browser without the async clipboard API. Reporting
          // "could not copy" and stopping there threw the bundle away and left
          // the user with no way to obtain it — and the user hitting a
          // degraded environment is exactly the one who needs a bug report.
          // Fall back to the app's own download mechanism.
          saveBlob(
            new Blob([text], { type: "text/plain" }),
            `quantized-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`,
          );
          s().setStatus("clipboard unavailable — diagnostics saved as a file instead");
          toast("clipboard unavailable — diagnostics downloaded", "info");
        })().catch((reason: unknown) => {
          // The detached body had no outer catch, so a rejected dynamic import
          // — a chunk that 404s after a deploy, an offline desktop shell —
          // became an unhandled rejection and the user saw nothing at all.
          const why = reason instanceof Error ? reason.message : String(reason);
          s().setStatus(`could not produce diagnostics: ${why}`);
          toast("could not produce diagnostics", "danger");
        });
      },
    },
    {
      id: "what-is-this",
      group: "Help",
      label: "What is this?",
      run: () => useHelp.getState().toggleWhatIsThis(),
    },
    {
      id: "interaction-hints",
      group: "Help",
      label: "Show interaction hints",
      run: showInteractionHints,
    },
  ];
}
