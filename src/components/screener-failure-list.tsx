import { WarningIcon } from "@/components/warning-icon";
import type { CompanyScreenFailure } from "@/lib/investment-report-runner";

type ScreenerFailureListProps = {
  failures: CompanyScreenFailure[];
};

export function ScreenerFailureList({ failures }: ScreenerFailureListProps) {
  if (failures.length === 0) {
    return null;
  }
  const companyLabel = failures.length === 1 ? "company" : "companies";
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <WarningIcon className="mt-0.5 size-4 shrink-0 text-amber-500" />
      <div className="min-w-0">
        <p className="font-semibold">
          {failures.length} {companyLabel} failed to screen
        </p>
        <ul className="mt-1 space-y-0.5">
          {failures.map((failure) => (
            <li key={failure.symbol} className="break-words">
              <span className="font-semibold">{failure.symbol}</span>
              <span className="text-amber-800">: {failure.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
