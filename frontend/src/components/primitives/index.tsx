// qz-* design-system primitives (TypeScript port of the kit's React specs).
// Thin wrappers over the `qz-*` class layer in styles/components.css; all
// styling is token-driven. Cursors are `default`; icons are Unicode glyphs.

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import clsx from "clsx";

export { RangeSlider, type RangeSliderProps } from "./RangeSlider";
export { default as RichText } from "./RichText";
export { default as RichLabelInput } from "./RichLabelInput";
export {
  default as SymbolPalette,
  insertLabelToken,
  countUnescapedDollars,
  type PaletteEntry,
} from "./SymbolPalette";

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

// ── IconButton ──────────────────────────────────────────────────────────────
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function IconButton({
  children,
  active = false,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button className={clsx("qz-icon-btn", active && "qz-active", className)} {...rest}>
      {children}
    </button>
  );
}

// ── Card (collapsible <details>) ───────────────────────────────────────────
interface CardProps {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function Card({ title, count, defaultOpen = true, children }: CardProps) {
  return (
    <details className="qz-card" open={defaultOpen}>
      <summary>
        {title}
        {count != null && (
          <span className="qz-badge" style={{ marginLeft: "auto" }}>
            {count}
          </span>
        )}
      </summary>
      <div className="qz-card-body">{children}</div>
    </details>
  );
}

// ── MetaRow ─────────────────────────────────────────────────────────────────
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

// ── Badge ───────────────────────────────────────────────────────────────────
type Tone = "neutral" | "accent" | "ok" | "danger" | "warn";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "qz-badge",
        tone === "accent" && "qz-accent",
        tone === "ok" && "qz-ok",
        tone === "danger" && "qz-danger",
        tone === "warn" && "qz-warn",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── StatusDot ───────────────────────────────────────────────────────────────
export function StatusDot({ tone = "neutral", label }: { tone?: Tone; label?: ReactNode }) {
  const dot = (
    <span
      className={clsx(
        "qz-dot",
        tone === "ok" && "qz-ok",
        tone === "danger" && "qz-danger",
        tone === "warn" && "qz-warn",
        tone === "accent" && "qz-accent",
      )}
    />
  );
  if (label == null) return dot;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {dot}
      <span style={{ fontSize: "var(--font-size-sm)", color: "var(--text-dim)" }}>
        {label}
      </span>
    </span>
  );
}

// ── SegmentedControl ────────────────────────────────────────────────────────
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

// ── NumberField ─────────────────────────────────────────────────────────────
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

// ── Checkbox ────────────────────────────────────────────────────────────────
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

// ── Switch ──────────────────────────────────────────────────────────────────
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
}) {
  const sw = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={clsx("qz-switch", checked && "qz-on")}
      onClick={() => onChange?.(!checked)}
    />
  );
  if (label == null) return sw;
  return (
    <label className="qz-check" style={{ justifyContent: "space-between" }}>
      <span>{label}</span>
      {sw}
    </label>
  );
}

// ── SliderRow ───────────────────────────────────────────────────────────────
export function SliderRow({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  format,
}: {
  label: ReactNode;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  format?: (value: number) => ReactNode;
}) {
  return (
    <div className="qz-slider-row">
      <span className="qz-k">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange?.(Number(e.target.value))}
      />
      <span className="qz-v">{format ? format(value) : value}</span>
    </div>
  );
}

// ── Pill ────────────────────────────────────────────────────────────────────
interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export function Pill({ children, active = false, className, ...rest }: PillProps) {
  return (
    <button
      className={clsx("qz-pill", active && "qz-active", className)}
      aria-pressed={active}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── DataTable ───────────────────────────────────────────────────────────────
export function DataTable({
  columns,
  rows,
}: {
  columns: ReactNode[];
  rows: ReactNode[][];
}) {
  return (
    <table className="qz-table">
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th key={i}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
