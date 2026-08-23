// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
import type { ReactNode } from "react";

interface MetaRowProps {
  label: ReactNode;
  value: ReactNode;
  title?: string;
}

export function MetaRow({ label, value, title }: MetaRowProps) {
  return (
    <div className="qz-meta-row">
      <span className="qz-k">{label}</span>
      <span className="qz-v" title={title}>
        {value}
      </span>
    </div>
  );
}
