// Is the window-layout host on screen? A one-bit module of its own so the eager
// Window-menu command can ask without pulling the layout tool registry in
// (store/layoutTools.ts sets it and builds the hook on it).

let mounted = false;
export const isLayoutHostMounted = (): boolean => mounted;
export const setLayoutHostFlag = (on: boolean): void => {
  mounted = on;
};
