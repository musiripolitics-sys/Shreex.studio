import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "brand" | "join" | "host" | "outline" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:opacity-50";

const sizes = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-7 py-3.5 text-base",
};

const variants: Record<Variant, string> = {
  brand:
    "bg-brand text-white shadow-[0_8px_30px_-8px_rgba(255,106,26,0.7)] hover:bg-brand-soft hover:-translate-y-0.5 focus-visible:ring-brand",
  join: "bg-join text-white hover:bg-join-soft hover:-translate-y-0.5 focus-visible:ring-join",
  host: "bg-host text-white hover:bg-host-soft hover:-translate-y-0.5 focus-visible:ring-host",
  outline:
    "border border-line bg-surface text-fg hover:border-brand hover:text-brand focus-visible:ring-brand",
  ghost: "text-muted hover:text-fg focus-visible:ring-line",
};

type ButtonProps = {
  variant?: Variant;
  size?: keyof typeof sizes;
} & ComponentProps<typeof Link>;

export function Button({
  variant = "brand",
  size = "md",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <Link
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
