import { chooseAndImport } from "../../lib/importEntry";
import { makeDemoDataset } from "../../lib/demo";
import { formatShortcut, isMacPlatform } from "../../lib/shortcutFormat";
import { runAction, useCommands } from "../../store/commands";
import { nextDatasetId, useApp } from "../../store/useApp";

/** Lightweight center workspace used after Remove all and on a fresh project.
 *  The primary actions mirror the File menu; each shows the shortcut that
 *  reaches it (⌘/Ctrl localized like the menus). The whole window is the
 *  file drop target (components/Shell/WindowFileDrop), not just this card. */
export default function EmptyProjectStage() {
  const importFiles = useApp((s) => s.importFiles);
  const importPaths = useApp((s) => s.importPaths);
  const addDataset = useApp((s) => s.addDataset);
  const setStatus = useApp((s) => s.setStatus);
  const pasteData = useApp((s) => s.pasteDataFromClipboard);
  const setImportWizardOpen = useApp((s) => s.setImportWizardOpen);
  const mac = isMacPlatform();

  const openProject = (): void => {
    // The File-menu command owns the confirm / native-dialog / lock flow.
    const cmd = useCommands.getState().menuCommands.find((a) => a.id === "open-workspace");
    if (cmd) runAction(cmd);
    else setStatus("Open project: use File ▸ Open workspace…");
  };
  const loadDemo = (): void =>
    addDataset({ id: nextDatasetId(), name: "demo-vsm.dat", data: makeDemoDataset() });

  const actions: { label: string; keys: string; run: () => void; primary?: boolean }[] = [
    { label: "Import data…", keys: "⌘O", run: () => void chooseAndImport({ importFiles, importPaths }), primary: true },
    { label: "Paste from clipboard", keys: "⌘V", run: () => void pasteData() },
    { label: "Open project…", keys: "", run: openProject },
    { label: "Demo dataset", keys: "", run: loadDemo },
  ];
  return (
    <section className="qzk-stage-cell qzk-empty-project" aria-label="Empty project">
      <div>
        <h2>No data loaded</h2>
        <p>Drop files anywhere in the window, or start here.</p>
        <div className="qzk-empty-actions">
          {actions.map((a) => (
            <button key={a.label} className={`qz-btn${a.primary ? " qz-primary" : ""}`} type="button" onClick={a.run}>
              <span>{a.label}</span>
              {a.keys && <kbd>{formatShortcut(a.keys, mac)}</kbd>}
            </button>
          ))}
        </div>
        <p className="qzk-empty-hint">
          <button className="qz-btn qz-ghost qz-sm" type="button" onClick={() => setImportWizardOpen(true)}>
            Guided import…
          </button>
          <span>
            <kbd>{formatShortcut("⌘K", mac)}</kbd> command palette
          </span>
        </p>
      </div>
    </section>
  );
}
