// One human-readable byte formatter, shared by every surface that shows a
// size (Trash summary, Pack Project preview/progress). Binary units with a
// single decimal — the shape lib/trashSummary.test.ts pins — extended past
// MiB so a multi-gigabyte pack does not read "3072.0 MiB".
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}
