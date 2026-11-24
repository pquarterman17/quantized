// Names the dataset in an "add dataset" undo entry (UX audit 10, P1-8): four
// identical "add dataset" rows said nothing, and "Undid add dataset" removed
// mpms without saying so. The label is recorded by the store before the dataset
// exists, so the name is recovered by diffing the entry's snapshot (the state
// BEFORE the edit) against the state after it: the next entry's snapshot, or
// the live datasets for the newest entry. Pure; no store import.

interface Named { id: string; name: string }
interface Entry { label: string; snapshot: { datasets: readonly Named[] } }

export function namedHistoryLabel(history: readonly Entry[], index: number, live: readonly Named[]): string {
  const entry = history[index];
  if (!entry) return "";
  if (entry.label !== "add dataset") return entry.label;
  const before = new Set(entry.snapshot.datasets.map((d) => d.id));
  const after = history[index + 1]?.snapshot.datasets ?? live;
  const added = after.filter((d) => !before.has(d.id));
  if (added.length === 1) return `add dataset ${added[0]!.name}`;
  return added.length > 1 ? `add ${added.length} datasets` : entry.label;
}
