// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
import type { ReactNode } from "react";
import clsx from "clsx";

export type SegOption<T extends string> = T | { value: T; label: ReactNode };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx("qz-seg", className)} role="tablist">
      {options.map((opt) => {
        const val = (typeof opt === "string" ? opt : opt.value) as T;
        const label = typeof opt === "string" ? opt : opt.label;
        return (
          <button
            key={val}
            role="tab"
            aria-selected={val === value}
            className={clsx("qz-seg-btn", val === value && "qz-active")}
            onClick={() => onChange?.(val)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
