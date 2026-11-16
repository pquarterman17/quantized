// Toast stack (design interaction layer): a fixed column of glass pills above
// the status bar, docked over a side panel so it never covers the plot (the
// placement rules live in platform.css). Pure renderer — the queue + auto-dismiss live in
// store/toasts. Click a toast to dismiss it early; a toast carrying an
// action (store/toasts.ts's ToastAction) also renders an inline button —
// clicking it fires the action AND dismisses (PLOT_WORKFLOW_PLAN #4's
// batch-overlay offer is the first caller). Not clicking it is a legitimate
// decline: the toast still auto-dismisses on its own timer either way — but
// never while the pointer is over it or focus is in it (WCAG 2.2.1).
//
// UX audit 8 #9: a toast that wraps (a failure, one with buttons, a long
// line) is a rectangle with an explicit × (`.rect`), not a pill whose
// outline turns into an ellipse; and more than two toasts of one `group`
// (import failures) fold into one "3 files couldn't be read · Show".
//
// Holds belong to the rendered NODE (one toast, or one folded group), not to
// an event pair: folding, unfolding and "Show" swap nodes under the pointer
// and the focus, and the node that leaves never gets its mouseleave / blur.
// `useLayoutEffect` below lifts whatever a vanished node still held (and
// re-targets a folded node's holds when its members change), and parks focus
// that fell to <body> on the Delete-absorbing root.

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";

import { absorbStrayDeleteOnContainer } from "../../lib/focusGuard";
import { groupCount, useToasts, type Toast, type ToastAction } from "../../store/toasts";

/** What a rendered node holds: the toast ids under it, by pointer and focus. */
interface NodeHold {
  ids: number[];
  hover: boolean;
  focus: boolean;
}

/** One rendered entry of the stack: a toast, or several folded together. */
type Entry = { node: string; toast: Toast } | { node: string; key: string; members: Toast[] };

/** More than this many toasts of one group fold into one. */
const GROUP_AFTER = 2;

/** `list` as rendered: toasts in order, a group with more than `GROUP_AFTER`
 *  members (and not opened with "Show") folded into one entry at its first. */
function entries(list: Toast[], shown: ReadonlySet<string>): Entry[] {
  const byGroup = new Map<string, Toast[]>();
  for (const t of list) if (t.group) byGroup.set(t.group.key, [...(byGroup.get(t.group.key) ?? []), t]);
  const out: Entry[] = [];
  for (const t of list) {
    const members = t.group && !shown.has(t.group.key) ? byGroup.get(t.group.key)! : [];
    if (members.length <= GROUP_AFTER) out.push({ node: `t${t.id}`, toast: t });
    else if (members[0] === t) out.push({ node: `g:${t.group!.key}`, key: t.group!.key, members });
  }
  return out;
}

export default function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const hold = useToasts((s) => s.hold);
  const rootRef = useRef<HTMLDivElement>(null);
  // Folded groups the user opened with "Show"; forgotten once the group is gone.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const live = new Set(toasts.flatMap((t) => (t.group ? [t.group.key] : [])));
    if ([...shown].some((k) => !live.has(k))) setShown(new Set([...shown].filter((k) => live.has(k))));
  }, [toasts, shown]);
  const polite = entries(toasts.filter((t) => t.kind !== "danger"), shown);
  const assertive = entries(toasts.filter((t) => t.kind === "danger"), shown);

  const holds = useRef(new Map<string, NodeHold>());
  const grab = (node: string, ids: number[], kind: "hover" | "focus", on: boolean): void => {
    const h = holds.current.get(node) ?? { ids, hover: false, focus: false };
    if (h[kind] === on) return; // an unpaired leave (the toast appeared under the pointer)
    h[kind] = on;
    ids.forEach((id) => hold(id, on));
    if (h.hover || h.focus) holds.current.set(node, h);
    else holds.current.delete(node);
  };
  useLayoutEffect(() => {
    const live = new Map([...polite, ...assertive].map((e) => [e.node, "toast" in e ? [e.toast.id] : e.members.map((m) => m.id)]));
    let lostFocus = false;
    for (const [node, h] of holds.current) {
      const times = Number(h.hover) + Number(h.focus);
      const ids = live.get(node) ?? [];
      for (const id of ids) if (!h.ids.includes(id)) for (let i = 0; i < times; i++) hold(id, true);
      for (const id of h.ids) if (!ids.includes(id)) for (let i = 0; i < times; i++) hold(id, false);
      h.ids = ids;
      if (live.has(node)) continue;
      holds.current.delete(node);
      lostFocus ||= h.focus;
    }
    const active = document.activeElement;
    if (lostFocus && (!active || active === document.body)) rootRef.current?.focus();
  });

  // Where focus was before it entered each toast, to give it back after the
  // action button (which unmounts with its toast) is used.
  const cameFrom = useRef(new Map<number, Element | null>());
  // Focus moving WITHIN a node is neither a new hold nor a release.
  const focusHold = (node: string, ids: number[], on: boolean) => (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    grab(node, ids, "focus", on);
    if (ids.length !== 1) return;
    if (on) cameFrom.current.set(ids[0], e.relatedTarget);
    else cameFrom.current.delete(ids[0]);
  };
  const hoverProps = (node: string, ids: number[]) => ({
    onMouseEnter: () => grab(node, ids, "hover", true),
    onMouseLeave: () => grab(node, ids, "hover", false),
    onFocus: focusHold(node, ids, true),
    onBlur: focusHold(node, ids, false),
  });
  // Focus left on the vanishing button would drop to <body>, where Delete
  // removes the active dataset: return it, else to this Delete-absorbing root.
  const onAction = (t: Toast, a: ToastAction) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (a.keep) {
      a.onClick();
      return;
    }
    const btn = e.currentTarget;
    const back = cameFrom.current.get(t.id);
    a.onClick();
    dismiss(t.id);
    const stranded = () => document.activeElement === btn || document.activeElement === document.body;
    if (stranded() && back instanceof HTMLElement && back.isConnected) back.focus();
    if (stranded()) rootRef.current?.focus();
  };
  // A toast asking a QUESTION (several choices — the late-restore prompt)
  // does not vanish on a stray click on its body: only a choice or Escape
  // closes it. Each choice names the question it answers (aria-describedby),
  // so "Discard" is not read out with no context (review F9).
  const pill = (node: string, t: Toast) => {
    const asks = (t.actions?.length ?? 0) > 0;
    const msgId = `qzk-toast-msg-${t.id}`;
    const rect = isBlock(t);
    return (
      <div
        key={node}
        className={`qzk-toast${t.kind !== "info" ? ` ${t.kind}` : ""}${rect ? " rect" : ""}`}
        role={t.kind === "danger" ? "alert" : undefined}
        onClick={asks ? undefined : () => dismiss(t.id)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          dismiss(t.id);
          rootRef.current?.focus();
        }}
        {...hoverProps(node, [t.id])}
      >
        {asks ? <span id={msgId}>{t.msg}</span> : t.msg}
        {[...(t.action ? [t.action] : []), ...(t.actions ?? [])].map((a) => (
          <button key={a.label} type="button" className="qzk-toast-action" aria-describedby={asks ? msgId : undefined} onClick={onAction(t, a)}>
            {a.label}
          </button>
        ))}
        {rect && <CloseButton onClick={onAction(t, CLOSE)} />}
      </div>
    );
  };
  // Several toasts of one group: one toast for all of them, until "Show".
  const folded = (node: string, key: string, members: Toast[]) => {
    const close = () => {
      members.forEach((m) => dismiss(m.id));
      rootRef.current?.focus();
    };
    return (
      <div
        key={node}
        className={`qzk-toast ${members[0].kind} rect`}
        role={members[0].kind === "danger" ? "alert" : undefined}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
        {...hoverProps(node, members.map((m) => m.id))}
      >
        {members[0].group!.summary(members.reduce((n, m) => n + groupCount(m), 0))}
        <button type="button" className="qzk-toast-action" onClick={() => setShown(new Set([...shown, key]))}>
          Show
        </button>
        <CloseButton onClick={close} />
      </div>
    );
  };
  const render = (list: Entry[]): ReactNode[] =>
    list.map((e) => ("toast" in e ? pill(e.node, e.toast) : folded(e.node, e.key, e.members)));
  // Rendered even while empty: screen readers commonly skip a live region
  // that enters the DOM together with its first text, which lost the first
  // toast's announcement (often the only one). The same holds for the nested
  // assertive region a danger toast (role="alert") lands in: the nearest live
  // region wins, so a failure is announced at once and not also politely.
  return (
    // `data-live-region` (R12) exempts this element from the `inert` a modal
    // dialog puts on everything around it (lib/modalInert.ts, which also
    // catches this node appearing WHILE a dialog is open). Without it a toast
    // raised meanwhile reached the screen but not the accessibility tree.
    // Spelled as a literal: importing the constant would pull modalInert into
    // the entry chunk; modalInert.test.tsx pins the spelling.
    <div
      ref={rootRef}
      className="qzk-toaster"
      aria-live="polite"
      data-live-region=""
      tabIndex={-1}
      onKeyDown={absorbStrayDeleteOnContainer}
    >
      {render(polite)}
      <div className="qzk-toast-alerts" aria-live="assertive">
        {render(assertive)}
      </div>
    </div>
  );
}

/** The × "action": dismisses, returning focus like any other action. */
const CLOSE: ToastAction = { label: "Dismiss", onClick: () => undefined };

/** A toast that wraps: a failure, one with buttons, or a long line. */
const isBlock = (t: Toast): boolean =>
  t.kind === "danger" || !!t.action || (t.actions?.length ?? 0) > 0 || t.msg.length > 60;

/** The × glyph is drawn by CSS (`.qzk-toast-close::before`), so a toast's
 *  text content stays its message. */
function CloseButton({ onClick }: { onClick: (e: MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      className="qzk-toast-close"
      aria-label="Dismiss notification"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    />
  );
}
