// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel (including BufferedNumberField.tsx, which wraps this),
// so this must not live in the eager barrel.
import type { InputHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

interface NumberFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string | number;
  onChange?: (value: string) => void;
  numeric?: boolean;
  unit?: ReactNode;
  width?: number;
}

export function NumberField({
  value,
  onChange,
  numeric = true,
  unit,
  width = 72,
  className,
  ...rest
}: NumberFieldProps) {
  const input = (
    <input
      className={clsx("qz-input", numeric && "qz-num", className)}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      style={{ width }}
      {...rest}
    />
  );
  if (!unit) return input;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      {input}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-sm)",
          color: "var(--text-faint)",
        }}
      >
        {unit}
      </span>
    </span>
  );
}
