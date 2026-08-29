// View/Edit/Help-menu command registry entries (theme, density, accent,
// panel toggles, stage tab, command palette, paste, keyboard shortcuts,
// text formatting help) — split out of appCommands.ts (that module's own
// store-size ratchet, zero headroom). appCommands.ts stays the thin
// aggregator; this module owns every command whose `group` is "View",
// "Edit", or "Help" — the small app-chrome groups that don't warrant their
// own module. Behavior is unchanged — this is a verbatim move.

import { copyText } from "../lib/clipboard";
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
      label: "Toggle theme",
      description: "Switch the application between light and dark appearance.",
      run: () => s().setTheme(s().theme === "dark" ? "light" : "dark"),
    },
    {
      id: "density",
      group: "View",
      label: "Cycle density",
      description: "Cycle interface spacing between compact, regular, and comfortable layouts.",
      run: () => {
        const order = ["compact", "regular", "comfy"] as const;
        s().setDensity(order[(order.indexOf(s().density) + 1) % order.length]);
      },
    },
    {
      id: "accent",
      group: "View",
      label: "Cycle accent color",
      description: "Cycle the interface highlight color without changing plot series colors.",
      run: () => {
        const order = ["violet", "teal", "ocean", "amber", "rose"] as const;
        s().setAccent(order[(order.indexOf(s().accent) + 1) % order.length]);
      },
    },
    {
      id: "left",
      group: "View",
      label: "Toggle library panel",
      description: "Show or hide the left project library and dataset browser.",
      shortcut: "⌘[",
      run: () => s().toggleLeft(),
    },
    {
      id: "right",
      group: "View",
      label: "Toggle inspector panel",
      description: "Show or hide the right properties Inspector for the current selection.",
      shortcut: "⌘]",
      run: () => s().toggleRight(),
    },
    {
      id: "column-switcher",
      group: "View",
      label: "Column switcher (flip through channels)…",
      description: "Quickly preview and switch the plotted data channels in the active dataset.",
      run: () => s().setColumnSwitcherOpen(true),
    },
    {
      id: "worksheet",
      group: "View",
      label: "Show worksheet",
      description: "Switch the central stage to the active dataset's worksheet.",
      run: () => s().setStageTab("worksheet"),
    },
    // GUI_INTERACTION #10: restores every open-or-ever-opened floating
    // ToolWindow (curve fit, peaks, baseline, …) to its own default
    // position/size, uncollapsed — the recovery path for a window dragged
    // off-screen or left collapsed/tiny after a monitor change.
    {
      id: "reset-tool-windows",
      group: "View",
      label: "Reset window positions",
      description: "Restore floating analysis windows to visible default positions and sizes.",
      run: () => s().resetToolWindowPositions(),
    },
    {
      id: "plot",
      group: "View",
      label: "Show plot",
      description: "Switch the central stage to the interactive plot.",
      run: () => s().setStageTab("plot"),
    },
    // ── Edit ──
    {
      id: "palette",
      group: "Edit",
      label: PALETTE_LABEL,
      description: "Search available commands by name, purpose, alias, or shortcut.",
      shortcut: PALETTE_SHORTCUT,
      run: () => s().setCmdk(true),
    },
    {
      id: "paste-data",
      group: "Edit",
      label: "Paste data",
      description: "Create a dataset from tabular text currently on the clipboard.",
      shortcut: "⌘V",
      keywords: "clipboard import tsv csv table",
      run: () => void s().pasteDataFromClipboard(),
    },
    {
      id: "help",
      group: "Help",
      label: "Help topics…",
      description: "Search tools, commands, import formats, shortcuts, and Origin migration guidance.",
      keywords: "documentation guide how to search tools help",
      // Standalone store (store/help) — imported directly like toasts, not a
      // useApp flag (see store/help for why).
      run: () => openHelp("search"),
    },
    {
      id: "shortcuts",
      group: "Help",
      label: "Keyboard shortcuts",
      description: "Open the keyboard and mouse shortcut reference.",
      shortcut: "?",
      run: () => s().setShortcutsOpen(true),
    },
    // GOTO #11: the rich-text label micro-syntax reference (Help menu + ⌘K).
    { id: "text-format-help", group: "Help", label: "Text formatting", description: "View syntax for Greek letters, scientific symbols, fractions, roots, and formatted plot text.", run: () => s().setTextFormatHelpOpen(true) },
    // P3.4: "copyable diagnostic bundle excludes raw/private data by default".
    // Shape and settings only — see lib/diagnostics.ts for what is withheld
    // and why, and diagnostics.test.ts for the redaction guarantee.
    {
      id: "copy-diagnostics",
      group: "Help",
      label: "Copy diagnostics",
      description:
        "Copy a plain-text report of app settings, display, and workspace size for a bug report — no dataset names, file paths, or measured values.",
      keywords: "bug report support troubleshoot environment version bundle",
      run: () => {
        void (async () => {
          // Dynamic import: the bundle is only ever needed AFTER this action,
          // so neither the renderer nor the collector belongs in the eager
          // graph that `commands/` otherwise sits in. Eagerly importing it put
          // the build 2.6 kB over the size ratchet, which is precisely the
          // case check-bundle-size.mjs tells you to solve this way rather than
          // by raising the budget.
          const { diagnosticsText } = await import("../store/diagnostics");
          const ok = await copyText(diagnosticsText());
          if (ok) {
            s().setStatus("diagnostics copied — no dataset names, paths, or values included");
            toast("diagnostics copied to the clipboard", "ok");
          } else {
            s().setStatus("could not copy diagnostics to the clipboard");
            toast("could not copy diagnostics", "danger");
          }
        })();
      },
    },
    {
      id: "what-is-this",
      group: "Help",
      label: "What is this?",
      description: "Point at an interface control to reveal its concise contextual explanation.",
      keywords: "inspect hover contextual help point identify tooltip",
      run: () => useHelp.getState().toggleWhatIsThis(),
    },
    {
      id: "interaction-hints",
      group: "Help",
      label: "Show interaction hints",
      description: "Replay the first-use hints for right-click, double-click, dragging, and plot controls.",
      keywords: "first run mouse right click double click drag drop tips",
      run: showInteractionHints,
    },
  ];
}
