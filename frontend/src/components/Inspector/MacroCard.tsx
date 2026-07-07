// Inspector card for the macro recorder: a Record/Pause toggle, the running list
// of captured steps, and Copy / Download of the reproducible script. The store
// owns recording + the step log; this card is the control surface + export.

import { copyText } from "../../lib/clipboard";
import { saveBlob } from "../../lib/download";
import { pipelineToScript } from "../../lib/pipeline";
import { useApp } from "../../store/useApp";
import { Button, Card } from "../primitives";

export default function MacroCard() {
  const recording = useApp((s) => s.macroRecording);
  const steps = useApp((s) => s.macroSteps);
  const startMacro = useApp((s) => s.startMacro);
  const stopMacro = useApp((s) => s.stopMacro);
  const clearMacro = useApp((s) => s.clearMacro);
  const setStatus = useApp((s) => s.setStatus);

  const copyScript = (): void => {
    copyText(pipelineToScript(steps)).then((ok) =>
      setStatus(ok ? `copied macro — ${steps.length} steps` : "clipboard unavailable"),
    );
  };

  const downloadScript = (): void => {
    saveBlob(new Blob([pipelineToScript(steps)], { type: "text/plain" }), "macro.qzm");
    setStatus(`saved macro.qzm — ${steps.length} steps`);
  };

  return (
    <Card title="Macro recorder" count={steps.length} defaultOpen={false}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <Button
          variant={recording ? "danger" : "primary"}
          size="sm"
          onClick={() => (recording ? stopMacro() : startMacro())}
        >
          {recording ? "❚❚ Pause" : "● Record"}
        </Button>
        <Button size="sm" onClick={clearMacro} disabled={steps.length === 0 && !recording}>
          Clear
        </Button>
      </div>

      {steps.length === 0 ? (
        <div className="qzk-ds-meta" style={{ fontStyle: "italic" }}>
          {recording ? "Recording… act on the plot to capture steps." : "No steps recorded."}
        </div>
      ) : (
        <ol className="qzk-macro-list">
          {steps.map((s, i) => (
            <li key={s.id} title={s.code}>
              <span className="qzk-macro-num">{i + 1}</span>
              <span className="qzk-macro-label">{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <Button size="sm" onClick={copyScript} disabled={steps.length === 0}>
          Copy script
        </Button>
        <Button size="sm" onClick={downloadScript} disabled={steps.length === 0}>
          Download .qzm
        </Button>
      </div>
    </Card>
  );
}
