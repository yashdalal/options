type WarnHoverTipProps = {
  children: string;
};

export function WarnHoverTip({ children }: WarnHoverTipProps) {
  return (
    <span
      tabIndex={0}
      className="group relative inline-flex cursor-help text-amber-600 outline-none"
    >
      <svg
        viewBox="0 0 16 16"
        className="size-3.5 shrink-0"
        aria-hidden="true"
      >
        <path
          fill="currentColor"
          d="M8.86 1.5a1 1 0 0 0-1.72 0L.66 12.2A1 1 0 0 0 1.52 13.7h12.96a1 1 0 0 0 .86-1.5L8.86 1.5ZM8 5.25a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0V6A.75.75 0 0 1 8 5.25Zm0 6a.875.875 0 1 1 0-1.75A.875.875 0 0 1 8 11.25Z"
        />
      </svg>
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
