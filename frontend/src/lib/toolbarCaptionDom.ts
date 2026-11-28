// The DOM half of "Toolbar button labels" (Preferences ▸ Plot, owner decision OG18), shared by the plot,
// Map and any later toolbar: put a short caption span beside a button's icon, or take it off again.
// Which text a button gets is the caller's table (`textFor`); a button it has no text for is left alone,
// so a button that already shows a word ("log", "Q") is never captioned twice. A stylesheet cannot do this
// part lazily and the CSP forbids an injected <style>, so the layout is CSSOM property writes.
// Off leaves the DOM exactly as it was: no span, no `data-label`, no inline style.

const LAYOUT = { gridAutoFlow: "column", gap: "4px", paddingInline: "7px", fontSize: "var(--type-label)" } as const;

/** Caption (`on`) or uncaption every `button.qzk-tool-btn` of `bar`. Idempotent; returns whether captions now show. */
export function applyToolbarCaptions(bar: HTMLElement | null, on: boolean, textFor: (button: HTMLButtonElement) => string | undefined): boolean {
  if (!bar) return false;
  for (const b of bar.querySelectorAll<HTMLButtonElement>("button.qzk-tool-btn")) {
    const text = textFor(b);
    b.querySelector(".qzk-tool-label")?.remove();
    for (const k of Object.keys(LAYOUT)) b.style.removeProperty(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
    delete b.dataset.label;
    if (!b.getAttribute("style")) b.removeAttribute("style"); // removeProperty can leave an empty attribute
    if (!on || text === undefined) continue;
    const span = document.createElement("span");
    span.className = "qzk-tool-label";
    span.setAttribute("aria-hidden", "true");
    span.textContent = text;
    b.append(span);
    b.dataset.label = text;
    Object.assign(b.style, LAYOUT);
  }
  return on;
}
