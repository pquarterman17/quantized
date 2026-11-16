import { buildFileCommands } from "../../commands/fileCommands";
import { formatShortcut, isMacPlatform } from "../../lib/shortcutFormat";
import { runAction } from "../../store/commands";
import { useApp } from "../../store/useApp";

/** Lightweight center workspace used after Remove all and on a fresh project.
 *  The primary actions ARE the File-menu commands (same run bodies, labels and
 *  guards -- built from `buildFileCommands`, not a second copy), each showing
 *  the shortcut that reaches it (⌘/Ctrl localized like the menus). The whole
 *  window is the file drop target (components/Shell/WindowFileDrop). */
export default function EmptyProjectStage() {
  const pasteData = useApp((s) => s.pasteDataFromClipboard);
  const setImportWizardOpen = useApp((s) => s.setImportWizardOpen);
  const mac = isMacPlatform();
  const runCommand = (id: string): void => {
    const cmd = buildFileCommands(useApp.getState).find((a) => a.id === id);
    if (cmd) runAction(cmd);
  };

  const actions: { label: string; keys: string; run: () => void; primary?: boolean }[] = [
    { label: "Import data…", keys: "⌘O", run: () => runCommand("import"), primary: true },
    { label: "Paste from clipboard", keys: "⌘V", run: () => void pasteData() },
    { label: "Open workspace (.dwk)…", keys: "", run: () => runCommand("open-workspace") },
    { label: "Add demo dataset", keys: "", run: () => runCommand("demo") },
  ];
  return (
    <section className="qzk-stage-cell qzk-empty-project" aria-label="Empty project">
      <div>
        <h2>No data loaded</h2>
        <p>Drop files anywhere in the window, or start here.</p>
        <div className="qzk-empty-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              className={`qz-btn${a.primary ? " qz-primary" : ""}`}
              type="button"
              onClick={a.run}
              aria-keyshortcuts={a.keys ? a.keys.replace("⌘", mac ? "Meta+" : "Control+") : undefined}
            >
              <span>{a.label}</span>
              {a.keys && <kbd aria-hidden="true">{formatShortcut(a.keys, mac)}</kbd>}
            </button>
          ))}
        </div>
        <p className="qzk-empty-hint">
          <button className="qz-btn qz-ghost qz-sm" type="button" onClick={() => setImportWizardOpen(true)}>
            Guided import…
          </button>
          <span>
            <kbd aria-hidden="true">{formatShortcut("⌘K", mac)}</kbd> command palette
          </span>
        </p>
      </div>
    </section>
  );
}
