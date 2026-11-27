import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How margins are calculated · Near Expiry Monitor",
};

const exposureRates = [
  {
    product: "Index options and futures (NIFTY, BANKNIFTY, SENSEX…)",
    normal: "2%",
    deepOutOfMoney: "3% when the strike is more than 10% out of the money",
  },
  {
    product: "Stock options and futures",
    normal: "3.5%, plus any additional rate NSE sets for that stock",
    deepOutOfMoney:
      "5.25% (plus the same additional rate) when the strike is more than 30% out of the money",
  },
];

const lastCheck = [
  { underlying: "NIFTY, BANKNIFTY, SENSEX", gap: "within 0.1%" },
  {
    underlying: "RELIANCE, HDFCBANK, INFY, MARUTI, SBIN, KOTAKBANK",
    gap: "within 0.6%",
  },
  { underlying: "IDFCFIRSTB (18.5% NSE exposure rate)", gap: "within 2%" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      <div className="space-y-2 text-sm leading-6 text-zinc-700">{children}</div>
    </section>
  );
}

export default function MethodologyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800">
          ← Back
        </Link>
        <h1 className="text-xl font-semibold text-zinc-950">
          How margins are calculated
        </h1>
      </header>

      <Section title="Two different margin numbers">
        <p>
          <strong>Screener rows</strong>{" "}
          show Kotak&apos;s own margin for that
          single sell order. Kotak works it out against the account&apos;s open
          positions, so the same option can show a different margin on each
          account.
        </p>
        <p>
          <strong>The basket</strong>{" "}
          shows our estimate, because Kotak only
          prices one order at a time and has no way to price several legs
          together. The estimate uses the same exchange rules Kotak uses, so a
          single leg should match the row&apos;s Kotak margin closely.
        </p>
      </Section>

      <Section title="The estimate: SPAN risk + exposure">
        <p>
          <strong>SPAN risk</strong>{" "}
          comes from NSE&apos;s risk file, which the
          exchange publishes several times a day. The site loads the newest file
          every hour; &ldquo;Refresh file&rdquo; in the basket loads it
          immediately. For each underlying it takes the worst loss across
          NSE&apos;s 16 price and volatility scenarios, adds any charge for
          positions across different expiries, applies NSE&apos;s minimum
          charge for short options, and subtracts the value of the options
          bought or sold.
        </p>
        <p>
          <strong>Exposure</strong>{" "}
          (NSE calls it extreme loss margin) is a flat
          percentage of{" "}
          <em>spot price × quantity</em>{" "}
          for every sold option or
          future, whatever the strike. The percentages follow NSE circular{" "}
          <a
            className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950"
            href="https://nsearchives.nseindia.com/content/circulars/CMPT44391.pdf"
          >
            CMPT44391
          </a>
          . Each stock&apos;s current rate is read from NSE&apos;s daily
          exposure file, so stocks NSE marks as volatile are charged more
          automatically. If that file isn&apos;t available, the standard rates
          below are used.
        </p>
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500">
              <th className="py-1.5 pr-4 font-medium">Product</th>
              <th className="py-1.5 pr-4 font-medium">Rate</th>
              <th className="py-1.5 font-medium">Far out of the money</th>
            </tr>
          </thead>
          <tbody>
            {exposureRates.map((row) => (
              <tr key={row.product} className="border-b border-zinc-100 align-top">
                <td className="py-1.5 pr-4">{row.product}</td>
                <td className="py-1.5 pr-4">{row.normal}</td>
                <td className="py-1.5">{row.deepOutOfMoney}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="How we check it against Kotak">
        <p>
          We run a comparison script that asks Kotak for the margin on hundreds
          of real options and compares each one with our estimate. The last
          check (27 Nov 2026, 577 options on an account with no open
          positions in these names) came out as:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {lastCheck.map((row) => (
            <li key={row.underlying}>
              {row.underlying}: {row.gap}
            </li>
          ))}
        </ul>
        <p>
          When the rules change or the numbers drift, we rerun the script and
          update the formula.
        </p>
      </Section>

      <Section title="What the estimate doesn't include">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Physical delivery margin on stock options in expiry week. The basket
            shows a warning when this may apply.
          </li>
          <li>
            Kotak&apos;s netting against positions the account already holds,
            unless you pick that account in the basket.
          </li>
          <li>
            Price movement since NSE&apos;s last risk file. The exposure part
            uses the file&apos;s spot price, which can lag live prices by a few
            percent on volatile days.
          </li>
          <li>
            The higher 5% rate for index options expiring more than 9 months
            out.
          </li>
        </ul>
      </Section>
    </main>
  );
}
