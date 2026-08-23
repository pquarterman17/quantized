// Split out of primitives/index.tsx (R8 bundle-diet pass, 2026-08-23) — see
// that file's header comment for why: every consumer is a lazy workshop or
// Inspector panel, so this must not live in the eager barrel.
import type { ButtonHTMLAttributes } from "react";
import clsx from "clsx";

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
