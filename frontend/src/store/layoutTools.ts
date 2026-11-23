// The tool windows mounted as layout windows (WORKSPACE_LAYOUT_PLAN P4). A
// tool's open flag lives in its own workshop store, as in classic mode; when
// its `ToolWindow` mounts in windows mode it registers here (LayoutToolWindow)
// with what the layout chrome needs: its title, its own close, and the two DOM
// nodes its header and body are portalled into. The layout frame (docked or
// floating) adopts those nodes, so moving a tool between slots MOVES its DOM
// instead of remounting the workshop (its local state survives a re-dock).
//
// Session state only, never saved: the layout's `tool:*` placement is what is
// saved, and a placement whose tool is not mounted here is never drawn.

import { useSyncExternalStore } from "react";

import { isLayoutHostMounted, setLayoutHostFlag } from "./layoutHostFlag";

export interface LayoutToolEntry {
  id: string;
  /** The title bar's text (the ToolWindow `title` when it is a string). */
  title: string;
  /** The workshop's own close (its ✕), or undefined when it has none. */
  onClose?: () => void;
  helpTopic?: string;
  /** The ToolWindow's default float width and position (first float only). */
  width: number;
  x?: number;
  y?: number;
  /** The portal targets: the fixed header band (if any) and the body. */
  head: HTMLElement | null;
  body: HTMLElement;
  /** The tool reports a run in progress (its `busy` prop). */
  busy: boolean;
  /** The host has put back this tool's saved pin (until then a pin check would misread the
   *  tool's own first seed as a lost pin). */
  pinRestored: boolean;
  /** Pinned automatically for the run (never saved): the dataset id. */
  autoPin: string | null;
}

let tools: ReadonlyMap<string, LayoutToolEntry> = new Map();
const listeners = new Set<() => void>();

/** The last title each tool registered with. A tool that has closed is out of the registry, but the
 *  live region still names its window ("Curve Fit closed", not "curvefit closed"; UX pass 3 M5). */
const titles = new Map<string, string>();
export const rememberedToolTitle = (id: string): string | undefined => titles.get(id);

function publish(next: Map<string, LayoutToolEntry>): void {
  for (const [id, tool] of next) titles.set(id, tool.title);
  tools = next;
  for (const l of listeners) l();
}

/** Register (or update) a mounted tool; returns the unregister. */
export function registerLayoutTool(entry: LayoutToolEntry): () => void {
  publish(new Map(tools).set(entry.id, entry));
  return () => {
    if (tools.get(entry.id)?.body !== entry.body) return;
    const next = new Map(tools);
    next.delete(entry.id);
    publish(next);
  };
}

/** Change a mounted tool's fields (no-op when absent or unchanged). */
export function patchLayoutTool(id: string, patch: Partial<Omit<LayoutToolEntry, "id" | "body">>): void {
  const cur = tools.get(id);
  if (!cur || (Object.keys(patch) as (keyof typeof patch)[]).every((k) => cur[k] === patch[k])) return;
  publish(new Map(tools).set(id, { ...cur, ...patch }));
}

export const layoutTool = (id: string): LayoutToolEntry | undefined => tools.get(id);
export const isToolMounted = (id: string): boolean => tools.has(id);
export const mountedTools = (): ReadonlyMap<string, LayoutToolEntry> => tools;

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const read = () => tools;

/** The mounted tools, live. */
export function useLayoutTools(): ReadonlyMap<string, LayoutToolEntry> {
  return useSyncExternalStore(subscribe, read, read);
}

/** Whether the layout host is on screen. In windows mode a full-workspace view
 *  (the Quick Figure Builder, Library tiles) replaces it for a while; a tool
 *  opened then keeps the classic floating frame instead of going into a window
 *  nothing would draw. */
const hostListeners = new Set<() => void>();
export function setLayoutHostMounted(on: boolean): void {
  if (isLayoutHostMounted() === on) return;
  setLayoutHostFlag(on);
  for (const l of hostListeners) l();
}
const subscribeHost = (l: () => void) => (hostListeners.add(l), () => void hostListeners.delete(l));
const readHost = isLayoutHostMounted;
export function useLayoutHostMounted(): boolean {
  return useSyncExternalStore(subscribeHost, readHost, readHost);
}

/** Tests only. */
export function resetLayoutToolsForTests(): void {
  publish(new Map());
}
