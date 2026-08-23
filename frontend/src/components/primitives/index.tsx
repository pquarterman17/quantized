// qz-* design-system primitives (TypeScript port of the kit's React specs).
// Thin wrappers over the `qz-*` class layer in styles/components.css; all
// styling is token-driven. Cursors are `default`; icons are Unicode glyphs.

import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import clsx from "clsx";

// RangeSlider, BufferedNumberField, Card, RichLabelInput, SymbolPalette,
// IconButton, MetaRow, SegmentedControl, NumberField, Checkbox, Switch,
// SliderRow, Pill, and DataTable deliberately do NOT re-export from here
// (bundle-size pass 2026-08-18, widened 2026-08-23/R8 — see
// scripts/check-bundle-size.mjs's header for the ratchet this barrel keeps
// tripping): every consumer of theirs is a lazy workshop/Inspector panel,
// but a static re-export in this barrel creates a static import edge from
// THIS module — which Button/Select/StatusDot/Badge/RichText below force
// into the eager chunk — to those files, dragging them along regardless of
// who actually uses them. Import them from their own file directly (e.g.
// `"../primitives/Card"`, `"../primitives/NumberField"`) instead. Before
// adding ANY export to this barrel, verify it has a genuinely eager
// consumer (grep for a real import, not just a text match) — that check is
// exactly what the 2026-08-23 pass found missing for eight of the symbols
// above, none of which had ever been reachable outside a lazy panel.
// `RichText` stays barrel-exported: `components/Stage/PlotLegend.tsx`
// (always-eager Stage tree) needs it via this same barrel.
export { default as RichText } from "./RichText";

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
