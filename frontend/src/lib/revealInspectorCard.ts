// Bring an Inspector card into view from outside it (the ⌘K "Error bars…"
// command). The Inspector's cards are uncontrolled `<details>` (components/
// primitives/Card.tsx), and the error-bar controls live in the "Error columns"
// card, collapsed by default — so a command that wants the user AT them has to
// expand the right sidebar, open that card, and move focus to its header.
//
// DOM-level on purpose: the Inspector is owned by another lane and has no
// open-request seam. A heading match (not a class or an index) keeps this
// working when cards are reordered; a miss reports `false` so the caller can
// say why nothing happened (no dataset selected, so the card does not render).

/** Expand and focus the Inspector card titled `title`. Waits one frame so a
 *  just-expanded sidebar has rendered. Resolves `true` when the card was found. */
export function revealInspectorCard(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      const heading = Array.from(document.querySelectorAll(".qz-card-heading")).find(
        (el) => el.textContent?.trim() === title,
      );
      const card = heading?.closest("details");
      if (!card) {
        resolve(false);
        return;
      }
      card.open = true;
      const summary = card.querySelector("summary");
      summary?.scrollIntoView?.({ block: "nearest" });
      summary?.focus();
      resolve(true);
    });
  });
}
