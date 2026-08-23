// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
import type { ReactNode } from "react";
import clsx from "clsx";

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
