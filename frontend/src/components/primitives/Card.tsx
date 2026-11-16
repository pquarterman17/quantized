import { useContext, useEffect, useRef, type ReactNode } from "react";

import { openHelpTopic } from "../../store/help";
import { CardStateContext } from "./cardState";

export interface CardProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  /** When set, show a small contextual-help action in the card header. */
  helpTopic?: string;
  /** Identity for a CardStateContext provider (UX-A); defaults to a string
   *  `title`. Without a provider the card is uncontrolled, as before. */
  cardId?: string;
  children: ReactNode;
}

/** Collapsible design-system card with optional contextual Help. */
export default function Card({
  title,
  count,
  defaultOpen = true,
  helpTopic,
  cardId,
  children,
}: CardProps) {
  const ctl = useContext(CardStateContext);
  const id = cardId ?? (typeof title === "string" ? title : undefined);
  const api = id !== undefined ? ctl : null;
  const open = api && id !== undefined ? api.isOpen(id, defaultOpen) : defaultOpen;
  const ref = useRef<HTMLDetailsElement>(null);
  const reveal = api?.reveal;
  const revealN = reveal && reveal.id === id ? reveal.n : 0;
  useEffect(() => {
    if (revealN) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [revealN]);
  return (
    <details
      ref={ref}
      className="qz-card"
      open={open}
      data-card-id={api ? id : undefined}
      // Controlled under a provider: the user's toggle is reported, and the
      // provider's answer is what renders next.
      onToggle={
        api && id !== undefined
          ? (e) => {
              const now = e.currentTarget.open;
              if (now !== api.isOpen(id, defaultOpen)) api.setOpen(id, now);
            }
          : undefined
      }
    >
      <summary>
        {/* The title is its OWN node, never a bare text child of <summary>.
            Every affordance in this header (the count badge, the `?` action,
            whatever comes next) is a sibling inside <summary>, so a bare text
            child would fuse with them: adding `?` turned the summary's text
            content from "Axes" into "Axes?" and broke an e2e locator that had
            queried the title by exact text. Keeping the title wrapped means
            text queries and the summary's accessible name stay clean however
            many controls this header grows. */}
        <span className="qz-card-heading">{title}</span>
        {count != null && (
          <span className="qz-badge" style={{ marginLeft: "auto" }}>
            {count}
          </span>
        )}
        {helpTopic && (
          <button
            type="button"
            className="qz-card-help"
            style={count == null ? { marginLeft: "auto" } : undefined}
            aria-label={`Help for ${typeof title === "string" ? title : "this section"}`}
            data-tip="Open related help"
            data-tip-desc="Show Help already filtered to this section's related tools."
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openHelpTopic(helpTopic);
            }}
          >
            {/* Decorative: the accessible name comes from aria-label above. */}
            <span aria-hidden="true">?</span>
          </button>
        )}
      </summary>
      <div className="qz-card-body">{children}</div>
    </details>
  );
}
