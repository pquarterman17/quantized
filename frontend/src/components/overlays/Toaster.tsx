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

import { useEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";

import { absorbStrayDeleteOnContainer } from "../../lib/focusGuard";
import { useToasts, type Toast, type ToastAction } from "../../store/toasts";

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
  // Where focus was before it entered each toast, to give it back after the
  // action button (which unmounts with its toast) is used.
  const cameFrom = useRef(new Map<number, Element | null>());
  // Focus moving WITHIN a toast is neither a new hold nor a release.
  const focusHold = (t: Toast, on: boolean) => (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    hold(t.id, on);
    if (on) cameFrom.current.set(t.id, e.relatedTarget);
    else cameFrom.current.delete(t.id);
  };
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
  const pill = (t: Toast) => {
    const asks = (t.actions?.length ?? 0) > 0;
    const msgId = `qzk-toast-msg-${t.id}`;
    const rect = isBlock(t);
    return (
      <div
        key={t.id}
        className={`qzk-toast${t.kind !== "info" ? ` ${t.kind}` : ""}${rect ? " rect" : ""}`}
        role={t.kind === "danger" ? "alert" : undefined}
        onClick={asks ? undefined : () => dismiss(t.id)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          dismiss(t.id);
          rootRef.current?.focus();
        }}
        onMouseEnter={() => hold(t.id, true)}
        onMouseLeave={() => hold(t.id, false)}
        onFocus={focusHold(t, true)}
        onBlur={focusHold(t, false)}
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
  const folded = (key: string, members: Toast[]) => {
    const each = (on: boolean) => () => members.forEach((m) => hold(m.id, on));
    // Focus moving WITHIN the folded toast is neither a new hold nor a release.
    const focusEach = (on: boolean) => (e: FocusEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) each(on)();
    };
    const close = () => {
      members.forEach((m) => dismiss(m.id));
      rootRef.current?.focus();
    };
    // "Show" unmounts this toast under the pointer and the focus, so no
    // mouseleave / blur would ever lift their holds (the members would then
    // never time out): park focus on the Delete-absorbing root, not <body>,
    // and lift both holds here (`hold` clamps at zero).
    const show = () => {
      rootRef.current?.focus();
      each(false)();
      each(false)();
      setShown(new Set([...shown, key]));
    };
    return (
      <div
        key={`group-${key}`}
        className={`qzk-toast ${members[0].kind} rect`}
        role={members[0].kind === "danger" ? "alert" : undefined}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}
        onMouseEnter={each(true)}
        onMouseLeave={each(false)}
        onFocus={focusEach(true)}
        onBlur={focusEach(false)}
      >
        {members[0].group!.summary(members.length)}
        <button type="button" className="qzk-toast-action" onClick={show}>
          Show
        </button>
        <CloseButton onClick={close} />
      </div>
    );
  };
  const stack = (list: Toast[]): ReactNode[] => {
    const byGroup = new Map<string, Toast[]>();
    for (const t of list) if (t.group) byGroup.set(t.group.key, [...(byGroup.get(t.group.key) ?? []), t]);
    return list.map((t) => {
      const members = t.group && !shown.has(t.group.key) ? byGroup.get(t.group.key)! : [];
      if (members.length <= GROUP_AFTER) return pill(t);
      return members[0] === t ? folded(t.group!.key, members) : null;
    });
  };
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
      {stack(toasts.filter((t) => t.kind !== "danger"))}
      <div className="qzk-toast-alerts" aria-live="assertive">
        {stack(toasts.filter((t) => t.kind === "danger"))}
      </div>
    </div>
  );
}

/** More than this many toasts of one group fold into one. */
const GROUP_AFTER = 2;
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
