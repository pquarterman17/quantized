// The Button and Select primitives, split out of ./index.tsx (bundle diet slice
// 32): every consumer is a lazy dialog or panel, so they ship with those. The
// barrel re-exports them by name, so no importer changed.

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import clsx from "clsx";

// ── Button ────────────────────────────────────────────────────────────────
type ButtonVariant = "default" | "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "regular" | "sm";
  icon?: ReactNode;
}

export function Button({
  children,
  variant = "default",
  size = "regular",
  icon,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "qz-btn",
        variant === "primary" && "qz-primary",
        variant === "ghost" && "qz-ghost",
        variant === "danger" && "qz-danger",
        size === "sm" && "qz-sm",
        className,
      )}
      {...rest}
    >
      {icon != null && <span className="qz-btn-icon">{icon}</span>}
      {children}
    </button>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string }[];
}

export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <select className={clsx("qz-select", className)} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
