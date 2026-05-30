"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";

interface TooltipProps {
  title: string;
  description: string;
  example?: string;
  children?: React.ReactNode;
  align?: "left" | "center" | "right";
  wide?: boolean;
}

/**
 * Floating tooltip card. Appears above the trigger on hover/focus.
 * Use `<FieldHelp>` for label+icon combos inside form fields.
 */
export function Tooltip({ title, description, example, children, align = "left", wide = false }: TooltipProps) {
  const [open, setOpen] = useState(false);

  const pos =
    align === "center"
      ? "left-1/2 -translate-x-1/2"
      : align === "right"
        ? "right-0"
        : "left-0";
  const caretPos =
    align === "center"
      ? "left-1/2 -translate-x-1/2"
      : align === "right"
        ? "right-5"
        : "left-5";

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children ?? (
        <button
          type="button"
          tabIndex={0}
          className="flex items-center text-faint transition hover:text-muted focus:outline-none"
          aria-label={`Help: ${title}`}
        >
          <HelpCircle size={12} />
        </button>
      )}

      {open && (
        <div
          role="tooltip"
          className={`absolute bottom-full mb-2.5 z-[200] rounded-xl border border-border bg-panel p-3.5 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.15)] ${pos} ${wide ? "w-80" : "w-64"}`}
          style={{ pointerEvents: "none" }}
        >
          <p className="font-mono text-[10px] font-medium uppercase tracking-widest text-brand whitespace-normal break-words">
            {title}
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted whitespace-normal break-words">
            {description}
          </p>
          {example && (
            <div className="mt-2.5 rounded-lg bg-bg-soft px-2.5 py-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-faint">Example  </span>
              <span className="font-mono text-[11px] text-brand-2">{example}</span>
            </div>
          )}
          {/* caret */}
          <div className={`absolute top-full -mt-1 h-2 w-2 rotate-45 border-b border-r border-border bg-panel ${caretPos}`} />
        </div>
      )}
    </span>
  );
}

/** Renders a label + small ? icon that opens a tooltip. */
export function FieldHelp({
  label,
  title,
  description,
  example,
  align = "left",
}: {
  label: string;
  title: string;
  description: string;
  example?: string;
  align?: "left" | "center" | "right";
}) {
  return (
    <span className="inline-flex items-center gap-1.5 leading-none whitespace-nowrap">
      {label}
      <Tooltip title={title} description={description} example={example} align={align} />
    </span>
  );
}

/** A standalone inline tooltip trigger (for dashboard stat labels, etc.). */
export function Tip({ title, description, example }: { title: string; description: string; example?: string }) {
  return (
    <Tooltip title={title} description={description} example={example}>
      <HelpCircle size={11} className="text-faint cursor-help" />
    </Tooltip>
  );
}
