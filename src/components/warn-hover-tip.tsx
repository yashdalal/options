import { WarningIcon } from "@/components/warning-icon";

type WarnHoverTipProps = {
  children: string;
};

export function WarnHoverTip({ children }: WarnHoverTipProps) {
  return (
    <span
      tabIndex={0}
      className="group relative inline-flex cursor-help text-amber-600 outline-none"
    >
      <WarningIcon />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 w-64 -translate-x-1/2 rounded-lg bg-zinc-900 px-2.5 py-2 text-left text-xs font-normal text-zinc-50 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {children}
      </span>
      <span className="sr-only">{children}</span>
    </span>
  );
}
