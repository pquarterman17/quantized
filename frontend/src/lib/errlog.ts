// Ported from fermiviewer frontend/src/lib/errlog.ts (shared platform code —
// keep in sync). Client error ring buffer + bug-report bundler.

export interface ClientLogEntry {
  t: string;
  kind: "error" | "rejection" | "status";
  msg: string;
}

const CAP = 200;
const buffer: ClientLogEntry[] = [];

function push(kind: ClientLogEntry["kind"], msg: string): void {
  buffer.push({ t: new Date().toISOString().slice(11, 19), kind, msg });
  if (buffer.length > CAP) buffer.shift();
}

/** Install global listeners once (called from main). */
export function installErrLog(): void {
  window.addEventListener("error", (e) =>
    push("error", `${e.message} @ ${e.filename}:${e.lineno}`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    push("rejection", String(e.reason)),
  );
}

/** Status-bar messages double as a breadcrumb trail. */
export function logStatus(msg: string): void {
  push("status", msg);
}

export function clientLog(): ClientLogEntry[] {
  return [...buffer];
}

/** Assemble + download the full bug report (client + server halves). */
export async function downloadBugReport(): Promise<void> {
  let server: unknown = null;
  try {
    const r = await fetch("/api/debug/report");
    if (r.ok) server = await r.json();
  } catch {
    server = { error: "server unreachable" };
  }
  const report = {
    generated: new Date().toISOString(),
    userAgent: navigator.userAgent,
    url: location.href,
    client_log: clientLog(),
    server,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `quantized_bugreport_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
