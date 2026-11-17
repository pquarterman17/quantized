// The file name a Save / Save As offers when the project has none yet (UX9-I):
// the open project's own name, else the dataset the user is looking at (its
// file stem + `.dwk`, so "sample7.csv" offers "sample7.dwk"), and only for an
// empty session the generic `workspace.dwk`. Pure.

/** Characters no file system accepts in a name (Windows' set covers POSIX). */
const BAD = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** Device names Windows refuses as a file name, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** `name` as a `.dwk` file name, or null when nothing usable is left. */
export function dwkNameFrom(name: string | null | undefined): string | null {
  const stem = (name ?? "").replace(/\.(?=[^./\\]*[A-Za-z])[^./\\]{1,8}$/, "").replace(BAD, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 120).replace(/[\s.]+$/, "");
  if (!stem || !/[^_]/.test(stem)) return null;
  return `${RESERVED.test(stem) ? "_" : ""}${stem}.dwk`; // "CON.dwk" cannot be created on Windows
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
