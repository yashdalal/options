type WarningIconProps = {
  className?: string;
};

export function WarningIcon({ className = "size-3.5 shrink-0" }: WarningIconProps) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M8.86 1.5a1 1 0 0 0-1.72 0L.66 12.2A1 1 0 0 0 1.52 13.7h12.96a1 1 0 0 0 .86-1.5L8.86 1.5ZM8 5.25a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0V6A.75.75 0 0 1 8 5.25Zm0 6a.875.875 0 1 1 0-1.75A.875.875 0 0 1 8 11.25Z"
      />
    </svg>
  );
}
