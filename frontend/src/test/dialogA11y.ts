// One reusable accessibility audit for a rendered dialog or tool window
// (P3.3 follow-up: "the dialog basics", audited the same way everywhere).
//
// The earlier passes pinned focus-in / Tab trap / restore dialog by dialog
// (`overlays/dialogFocus.a11y.test.tsx`). This helper asks the same questions
// of ANY dialog in one call, plus the ones no test asked yet: does every form
// control have a programmatic label (not a placeholder), is every
// `aria-invalid` field tied to its message, and can a keyboard / screen-reader
// user reach the reason a disabled button gives?
//
// It returns a list of findings instead of throwing on the first, so a test
// reads `expect(await auditDialog(...)).toEqual([])` and a failure names every
// gap at once.
//
// MODALITY. The app's modal dialogs deliberately carry NO `aria-modal` (R12,
// `lib/modalInert.ts`: it silenced the app's live regions); modality is the
// background's `inert`. So "is it modal" is asked of the background — the
// opener must sit under an `inert` ancestor while the dialog is open — and an
// `aria-modal` is reported, matching `architecture.test.ts`.

import { isInaccessible, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { computeAccessibleDescription, computeAccessibleName } from "dom-accessibility-api";

export interface DialogAuditOptions {
  /** A focused control outside the dialog that "opened" it. Focus must come
   *  back here on close, and (modal) it must be inert while the dialog is up. */
  opener: HTMLElement;
  /** Backdrop dialogs trap Tab and make the background inert; a tool window
   *  is non-modal and does neither. Default true. */
  modal?: boolean;
  /** Whether Escape is expected to close it. Default true. */
  escape?: boolean;
  user: UserEvent;
}

const FIELDS = "input:not([type=hidden]), select, textarea";
const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
]
  .map((s) => `${s}:not([tabindex="-1"])`)
  .join(",");

function describeEl(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const type = el.getAttribute("type") ? `[type=${el.getAttribute("type")}]` : "";
  const hint = el.getAttribute("placeholder") ?? el.getAttribute("value") ?? el.textContent?.trim().slice(0, 30) ?? "";
  return `<${el.tagName.toLowerCase()}${id}${type}> "${hint}"`;
}

/** Text of the elements an IDREF list names, or null when one is missing. */
function idrefText(el: Element, attr: string): string | null {
  const ids = (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
  if (ids.length === 0) return null;
  const parts: string[] = [];
  for (const id of ids) {
    const target = el.ownerDocument.getElementById(id);
    if (!target) return null;
    parts.push(target.textContent?.trim() ?? "");
  }
  return parts.join(" ").trim();
}

/** The structural checks: everything that can be read off the DOM as it is. */
export function staticDialogIssues(dialog: HTMLElement, opts: { modal?: boolean } = {}): string[] {
  const issues: string[] = [];
  const role = dialog.getAttribute("role");
  if (role !== "dialog" && role !== "alertdialog") issues.push(`root has role=${role ?? "none"}, not dialog`);

  // Named by its VISIBLE title: aria-labelledby that resolves to rendered
  // text inside the dialog. An aria-label alone names it, but a sighted
  // screen-reader user then hears something other than what they see.
  // A dialog with NO visible heading (the command palette) may use aria-label.
  const labelled = idrefText(dialog, "aria-labelledby");
  const headingless = !dialog.querySelector("h1,h2,h3,h4,h5,h6,[role=heading]");
  if (labelled === null && headingless && dialog.getAttribute("aria-label")?.trim()) {
    // named, and there is no visible title it could have pointed at
  } else if (labelled === null) {
    issues.push("no aria-labelledby pointing at a rendered title");
  } else if (!labelled) {
    issues.push("aria-labelledby points at an empty title");
  } else {
    const firstId = (dialog.getAttribute("aria-labelledby") ?? "").split(/\s+/)[0];
    const title = dialog.ownerDocument.getElementById(firstId);
    if (title && !dialog.contains(title)) issues.push("aria-labelledby points outside the dialog");
    if (title && isInaccessible(title)) issues.push("aria-labelledby points at a hidden title");
  }
  if (dialog.hasAttribute("aria-describedby") && idrefText(dialog, "aria-describedby") === null) {
    issues.push("aria-describedby names a missing element");
  }
  if (dialog.hasAttribute("aria-modal")) issues.push("carries aria-modal (R12: modality is the background's inert)");
  if (opts.modal === false && dialog.closest("[inert]")) issues.push("non-modal surface is itself inert");

  for (const el of dialog.querySelectorAll<HTMLElement>(FIELDS)) {
    if (isInaccessible(el)) continue;
    const name = computeAccessibleName(el).trim();
    if (!name) {
      issues.push(
        el.hasAttribute("placeholder")
          ? `${describeEl(el)} is labelled only by its placeholder`
          : `${describeEl(el)} has no programmatic label`,
      );
    }
    if (el.getAttribute("aria-invalid") === "true") {
      const msg = idrefText(el, "aria-describedby") ?? idrefText(el, "aria-errormessage");
      if (!msg) issues.push(`${describeEl(el)} is aria-invalid with no linked message`);
    }
  }

  // A disabled <button> is not focusable, so a reason carried only in its
  // tooltip is out of a keyboard user's reach, and out of a screen reader's
  // unless it is ALSO the computed description. Either keep it focusable
  // (aria-disabled) or link visible text with aria-describedby.
  for (const el of dialog.querySelectorAll<HTMLButtonElement>("button:disabled")) {
    if (isInaccessible(el)) continue;
    const name = computeAccessibleName(el).trim();
    const reason = (el.getAttribute("data-tip-desc") ?? el.getAttribute("title") ?? "").trim();
    // A reason already in the button's own text is in its name: reachable.
    if (!reason || name.includes(reason)) continue;
    if (!idrefText(el, "aria-describedby")) {
      issues.push(`disabled ${describeEl(el)} explains itself only in a tooltip ("${reason}")`);
    } else if (!computeAccessibleDescription(el).trim()) {
      issues.push(`disabled ${describeEl(el)} has an empty description`);
    }
  }
  return issues;
}

/** Full audit: the static checks, then the keyboard contract — focus in on
 *  open, Tab trapped (modal), Escape closes, focus back on the opener. The
 *  dialog must already be open (and `opts.opener` must have had focus when it
 *  opened). `getDialog` is re-asked after Escape, so it may return null. */
export async function auditDialog(
  getDialog: () => HTMLElement | null,
  opts: DialogAuditOptions,
): Promise<string[]> {
  const modal = opts.modal ?? true;
  const dialog = getDialog();
  if (!dialog) return ["dialog is not rendered"];
  const issues = staticDialogIssues(dialog, { modal });

  if (modal && !opts.opener.closest("[inert]")) issues.push("background is not inert while the dialog is open");

  try {
    await waitFor(() => {
      if (!dialog.contains(document.activeElement)) throw new Error("focus outside");
    });
  } catch {
    issues.push(`focus did not move into the dialog on open (it is on ${describeEl(document.activeElement ?? document.body)})`);
    // Put it there so the remaining checks still say something useful.
    (dialog.querySelector<HTMLElement>(TABBABLE) ?? dialog).focus();
  }

  if (modal) {
    const stops = dialog.querySelectorAll(TABBABLE).length + 2;
    for (const shift of [false, true]) {
      for (let i = 0; i < stops; i++) {
        await opts.user.tab({ shift });
        if (!dialog.contains(document.activeElement)) {
          issues.push(`${shift ? "Shift+Tab" : "Tab"} leaves the dialog after ${i + 1} press(es)`);
          (dialog.querySelector<HTMLElement>(TABBABLE) ?? dialog).focus();
          break;
        }
      }
    }
  }

  if (opts.escape ?? true) {
    if (!dialog.contains(document.activeElement)) (dialog.querySelector<HTMLElement>(TABBABLE) ?? dialog).focus();
    await opts.user.keyboard("{Escape}");
    try {
      await waitFor(() => {
        const still = getDialog();
        if (still?.isConnected) throw new Error("still open");
      });
    } catch {
      issues.push("Escape did not close it");
      return issues;
    }
    if (document.activeElement !== opts.opener) {
      issues.push(`focus did not return to the opener on close (it is on ${describeEl(document.activeElement ?? document.body)})`);
    }
  }
  return issues;
}
