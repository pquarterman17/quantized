// The file name a Save / Save As offers when the project has none yet (UX9-I):
// the open project's own name, else the dataset the user is looking at (its
// file stem + `.dwk`, so "sample7.csv" offers "sample7.dwk"), and only for an
// empty session the generic `workspace.dwk`. Pure.

/** Characters no file system accepts in a name (Windows' set covers POSIX). */
const BAD = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** `name` as a `.dwk` file name, or null when nothing usable is left. */
export function dwkNameFrom(name: string | null | undefined): string | null {
  const stem = (name ?? "").replace(/\.[^./\\]{1,8}$/, "").replace(BAD, "_").replace(/^[\s.]+|[\s.]+$/g, "");
  return stem && /[^_]/.test(stem) ? `${stem}.dwk` : null;
}

interface SaveNameState {
  currentProject: { name: string } | null;
  datasets: readonly { id: string; name: string }[];
  activeId: string | null;
}

/** The project's name, or a name from the active (else first) dataset; null
 *  for an empty session (the caller's generic default stands). */
export function projectSaveName(s: SaveNameState): string | null {
  if (s.currentProject?.name) return s.currentProject.name;
  const ds = s.datasets.find((d) => d.id === s.activeId) ?? s.datasets[0];
  return dwkNameFrom(ds?.name);
}
