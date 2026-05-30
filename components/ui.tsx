import type { ReactNode } from "react";
import { motion } from "framer-motion";

export function Card({
  children,
  className = "",
  glow = false,
  noAnimate = false,
}: {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  noAnimate?: boolean;
}) {
  const cls = `relative overflow-hidden rounded-2xl border bg-panel transition-shadow duration-500 ${
    glow
      ? "border-brand/40 shadow-[0_10px_40px_-15px_rgba(196,140,52,0.15)]"
      : "border-border shadow-sm hover:shadow-md"
  } ${className}`;

  if (noAnimate) {
    return <div className={cls}>{children}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] as const }}
      className={cls}
    >
      {children}
    </motion.div>
  );
}

export function IconChip({ 
  children, 
  color,
  className = "" 
}: { 
  children: ReactNode; 
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-bg-soft/50 shadow-sm transition-all hover:border-brand/30 hover:shadow-sm ${className}`}
      style={color ? { color } : { color: "var(--color-muted)" }}
    >
      {children}
    </span>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4">
      <div className="flex items-center gap-3">
        {icon && <IconChip>{icon}</IconChip>}
        <div>
          <h3 className="font-display text-[16px] font-semibold tracking-tight text-fg">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-faint font-medium">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode, className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative overflow-hidden rounded-xl border border-border bg-panel px-5 py-6 transition-all duration-300 shadow-sm hover:shadow-md hover:border-border-strong/60"
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted/70">{label}</div>
      <div className="metric mt-3 text-2xl font-bold tracking-tighter text-fg">
        {value}
      </div>
      {sub && <div className="mt-2 text-[10px] font-mono text-muted/60 uppercase tracking-tight">{sub}</div>}
    </motion.div>
  );
}

export function Badge({
  children,
  color,
  subtle = true,
  className = "",
}: {
  children: ReactNode;
  color?: string;
  subtle?: boolean;
  className?: string;
}) {
  const c = color ?? "var(--color-muted)";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${className}`}
      style={{
        backgroundColor: subtle ? `color-mix(in oklab, ${c} 15%, transparent)` : c,
        color: subtle ? c : "var(--color-bg)",
        border: `1px solid color-mix(in oklab, ${c} 25%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}

export function Dot({ color, className = "" }: { color: string; className?: string }) {
  return (
    <span
      className={`h-1.5 w-1.5 rounded-full ring-2 ring-transparent transition-all duration-500 ${className}`}
      style={{ 
        backgroundColor: color,
        boxShadow: `0 0 10px ${color}`
      }}
    />
  );
}

export function Bar({
  value,
  max = 100,
  color = "var(--color-brand)",
  className = "",
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-border/40 ${className}`}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] as const }}
        className="h-full rounded-full"
        style={{ 
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}40`
         }}
      />
    </div>
  );
}

