// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
//
// A WAI-ARIA radio group (one value out of N, no panels — so radios, not
// tabs): roving tabindex (the checked radio, else the first, is the one Tab
// stop) and Left/Right/Up/Down/Home/End move focus AND select, wrapping. A
// handled key is defaultPrevented so the global dataset arrows skip it.
import type { KeyboardEvent, ReactNode } from "react";
import clsx from "clsx";

export type SegOption<T extends string> = T | { value: T; label: ReactNode };

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: SegOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const values = options.map((opt) => (typeof opt === "string" ? opt : opt.value) as T);
  const tabStop = Math.max(0, values.indexOf(value));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
    const at = radios.indexOf(e.target as HTMLElement);
    const n = radios.length;
    const to = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key in STEP ? (at + STEP[e.key] + n) % n : -1;
    if (at < 0 || to < 0) return;
    e.preventDefault();
    radios[to].focus();
    if (values[to] !== value) onChange?.(values[to]);
  };

  return (
    <div className={clsx("qz-seg", className)} role="radiogroup" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {options.map((opt, i) => {
        const val = values[i];
        const label = typeof opt === "string" ? opt : opt.label;
        return (
          <button
            key={val}
            type="button"
            role="radio"
            aria-checked={val === value}
            tabIndex={i === tabStop ? 0 : -1}
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
