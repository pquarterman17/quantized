// ORIGIN_PLOT_TYPE_PARITY_PLAN item 9: the request bodies the app's own
// Origin export commands build for what is on screen, captured instead of
// downloaded (tools/plot_corpus/roundtrip_run.py posts them to the backend and
// opens the result in Origin).
//
//   ogs  File > Export Origin (.ogs)...        commands/fileCommandsLazy.runExportOrigin
//   opj  File > Export Origin project (.opj)... commands/originProjectExport.runExportOriginProject
//   com  File > Send to Origin (COM)...         commands/fileCommandsLazy.runSendToOrigin
//
// Each command is run as the menu runs it; only its transport is swapped. The
// .ogs and COM bodies are handed to a recording function (both commands take
// their api call as an argument). The .opj command imports its transport, so
// the corpus test file mocks `lib/api/originProject` to write into `capture`.

import { runExportOriginProject } from "../../commands/originProjectExport";
import { runExportOrigin, runSendToOrigin } from "../../commands/fileCommandsLazy";
import { useApp } from "../../store/useApp";

export interface OriginExports {
  ogs: unknown;
  opj: unknown;
  com: unknown;
  /** The status line after each command whose body was not captured. */
  notes: Record<string, string>;
}

/** Written by the corpus test's `lib/api/originProject` mock. A global, not a
 *  module export: the mock factory cannot import this module (it is still
 *  loading when the factory runs). */
const capture = globalThis as { __qzOpjCapture?: unknown };

export async function originExports(): Promise<OriginExports> {
  const s = useApp.getState;
  const notes: Record<string, string> = {};
  let ogs: unknown = null;
  await runExportOrigin(s, async (body) => {
    ogs = body;
  });
  if (ogs === null) notes.ogs = s().status;
  capture.__qzOpjCapture = null;
  await runExportOriginProject(s);
  const opj = capture.__qzOpjCapture ?? null;
  if (opj === null) notes.opj = s().status;
  let com: unknown = null;
  await runSendToOrigin(
    s,
    async () => ({ available: true }),
    async (body) => {
      com = body;
      return { books: [], rows: [] };
    },
  );
  if (com === null) notes.com = s().status;
  return { ogs, opj, com, notes };
}
