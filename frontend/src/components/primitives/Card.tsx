import type { ReactNode } from "react";

import { openHelpTopic } from "../../store/help";

export interface CardProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  /** When set, show a small contextual-help action in the card header. */
  helpTopic?: string;
  children: ReactNode;
}

/** Collapsible design-system card with optional contextual Help. */
export default function Card({
  title,
  count,
  defaultOpen = true,
  helpTopic,
  children,
}: CardProps) {
  return (
    <details className="qz-card" open={defaultOpen}>
      <summary>
        {title}
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
            ?
          </button>
        )}
      </summary>
      <div className="qz-card-body">{children}</div>
    </details>
  );
}
