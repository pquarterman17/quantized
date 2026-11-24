// Quick Convert: the window's state. The file list, the three options (output
// folder, format, overwrite), the live preview (what each file is guessed to be)
// and the run. The pure parts are in quickConvertModel.ts, the job in
// useConvertJob.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  convertConfig,
  convertPreview,
  stageConvertFile,
  type ConvertConfig,
  type FilePreview,
  type OutDirStatus,
} from "../../../lib/api/convertQuick";
import { baseName, plainError, type QcFile } from "./quickConvertModel";
import { useConvertJob } from "./useConvertJob";

const PREVIEW_DEBOUNCE_MS = 250;
let nextId = 0;
const newId = (): string => `qc${++nextId}`;

export function useQuickConvert(prefill: boolean) {
  const [config, setConfig] = useState<ConvertConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [files, setFiles] = useState<QcFile[]>([]);
  const [outDir, setOutDir] = useState("");
  const [format, setFormat] = useState("auto");
  const [overwrite, setOverwrite] = useState(false);
  const [metadata, setMetadata] = useState(true);
  const [report, setReport] = useState(true);
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const [previewPaths, setPreviewPaths] = useState<string[]>([]);
  const [outStatus, setOutStatus] = useState<OutDirStatus>("same");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const { job, start, cancel, reset } = useConvertJob();

  const addPaths = useCallback((paths: string[], staged = false, names?: string[]) => {
    setFiles((cur) => {
      const have = new Set(cur.map((f) => f.path));
      const fresh = paths
        .map((path, i) => ({ path, name: names?.[i] ?? baseName(path) }))
        .filter((p) => !have.has(p.path))
        .map((p): QcFile => ({ id: newId(), path: p.path, name: p.name, staged, phase: "ready" }));
      return fresh.length ? [...cur, ...fresh] : cur;
    });
    reset();
  }, [reset]);

  useEffect(() => {
    let live = true;
    convertConfig().then(
      (c) => {
        if (!live) return;
        setConfig(c);
        if (prefill && c.prefill.length) addPaths(c.prefill);
      },
      (e: unknown) => live && setConfigError(e instanceof Error ? e.message : "Could not reach Quantized."),
    );
    return () => {
      live = false;
    };
  }, [prefill, addPaths]);

  /** Upload dropped / picked File objects one at a time (a browser gives no path). */
  const addFiles = useCallback(
    async (picked: File[]) => {
      const rows = picked.map((f): QcFile => ({ id: newId(), path: `staging:${newId()}`, name: f.name, staged: true, phase: "staging" }));
      setFiles((cur) => [...cur, ...rows]);
      reset();
      for (const [i, file] of picked.entries()) {
        const row = rows[i];
        try {
          const staged = await stageConvertFile(file);
          setFiles((cur) => cur.map((f) => (f.id === row.id ? { ...f, path: staged.path, phase: "ready" } : f)));
        } catch (e) {
          const error = e instanceof Error ? e.message : "upload failed";
          setFiles((cur) => cur.map((f) => (f.id === row.id ? { ...f, phase: "failed", error } : f)));
        }
      }
    },
    [reset],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((cur) => cur.filter((f) => f.id !== id));
    reset();
  }, [reset]);
  const clearFiles = useCallback(() => {
    setFiles([]);
    reset();
  }, [reset]);

  const ready = useMemo(() => files.filter((f) => f.phase === "ready"), [files]);
  // Not yet previewed counts as convertible; only a file the guess marked as an error
  // (e.g. "Unknown type") is certain to fail, so it is left out of the run and the count.
  const previewByPath = useMemo(() => new Map(previewPaths.map((p, i) => [p, previews[i]] as const)), [previews, previewPaths]);
  const convertible = useMemo(() => ready.filter((f) => !previewByPath.get(f.path)?.error), [ready, previewByPath]);
  const skipped = ready.length - convertible.length;
  const readyKey = JSON.stringify([ready.map((f) => f.path), outDir.trim(), format]);

  // Re-guess whenever the inputs or the choices change (debounced; a newer request
  // aborts the older one, so a slow parse can never overwrite a fresher answer).
  useEffect(() => {
    const paths = ready.map((f) => f.path);
    if (!paths.length) {
      setPreviews([]);
      setPreviewPaths([]);
      setPreviewError(null);
      return;
    }
    const ac = new AbortController();
    setPreviewing(true);
    const t = setTimeout(() => {
      convertPreview({ paths, out_dir: outDir.trim() || null, format }, ac.signal)
        .then((r) => {
          setPreviews(r.files);
          setPreviewPaths(paths);
          setOutStatus(r.out_dir_status as OutDirStatus);
          setPreviewError(null);
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return;
          setPreviews([]);
          setPreviewPaths([]);
          setPreviewError(plainError(e instanceof Error ? e.message : String(e)));
        })
        .finally(() => !ac.signal.aborted && setPreviewing(false));
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
    // `readyKey` is the value-identity of everything read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey]);

  const previewOf = useMemo(() => (path: string): FilePreview | undefined => previewByPath.get(path), [previewByPath]);

  const needsFolder = convertible.some((f) => f.staged) && !outDir.trim();
  const blocker: string | null =
    !ready.length
      ? "Add at least one file."
      : !convertible.length && !previewing
        ? "None of these files can be converted: remove them or add files of a known type."
      : files.some((f) => f.phase === "staging")
        ? "Waiting for uploads to finish."
        : needsFolder
          ? "Dropped files have no folder of their own: choose an output folder."
          : outStatus === "not_a_folder" && outDir.trim()
            ? "The output folder is a file; choose a folder."
            : previewError
              ? previewError
              : null;

  const run = useCallback(() => {
    if (blocker) return;
    void start({
      paths: convertible.map((f) => f.path),
      out_dir: outDir.trim() || null,
      format,
      overwrite,
      metadata,
      allow_partial: false,
      report,
    });
  }, [blocker, start, convertible, outDir, format, overwrite, metadata, report]);

  // Changing a choice after a run clears its result: the rows go back to "Ready".
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) {
      touched.current = true;
      return;
    }
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outDir, format, overwrite, metadata, report]);

  return {
    config, configError, files, ready, convertible, skipped, previewOf, previewing, previewError, outStatus,
    outDir, setOutDir, format, setFormat, overwrite, setOverwrite, metadata, setMetadata, report, setReport,
    addPaths, addFiles, removeFile, clearFiles, job, run, cancel, blocker, needsFolder,
  };
}
