// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
import type { ReactNode } from "react";
import clsx from "clsx";

export function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={clsx("qz-check", disabled && "qz-disabled")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      {children}
    </label>
  );
}
