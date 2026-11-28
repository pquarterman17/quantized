// Forces the first-paint race of a draft field: a gesture that lands right after the component commits,
// before React has run that commit's passive effects. A reset-on-mount effect (`useEffect(() => setDraft(value), [value])`)
// then replays the OLD value over what the user just typed. The MutationObserver callback runs in the microtask
// right after the commit, ahead of the passive-effect task, so this hits that window on every run
// (docs/testing.md: force the race, do not repeat it). Rendered outside act() on purpose: act would flush the
// effects before the observer could fire.

import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** Mount `ui`; call `act` with the element `find` returns on the first commit that has it. Resolves after `act` ran. */
export function actOnFirstCommit<T extends HTMLElement>(
  ui: ReactElement,
  find: () => T | null,
  act: (el: T) => void,
): Promise<{ root: Root; host: HTMLElement; unmount: () => void }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const prev = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const unmount = (): void => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    root.unmount();
    host.remove();
    globalThis.IS_REACT_ACT_ENVIRONMENT = prev;
  };
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      const el = find();
      if (!el) return;
      mo.disconnect();
      globalThis.IS_REACT_ACT_ENVIRONMENT = prev;
      act(el);
      resolve({ root, host, unmount });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    root.render(ui);
  });
}

/** Let React's passive effects and any queued renders run. */
export const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
