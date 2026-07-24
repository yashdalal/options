export function LoadingProgressBar({ active, label }: { active: boolean; label: string }) {
  if (!active) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50" aria-live="polite">
      <div className="h-0.5 w-full overflow-hidden bg-zinc-200">
        <div className="h-full w-full animate-pulse bg-zinc-800" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
