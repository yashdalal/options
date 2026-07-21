import { calculateProximity } from "@/domain/proximity";
import type { MonitorSnapshot, OptionType, ReportSide } from "@/domain/types";

function expiryDate(daysFromNow: number): { iso: string; label: string } {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  const iso = date.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase();
  return { iso, label };
}

function reportSide(optionType: OptionType, strike: number, spot: number): ReportSide {
  return {
    strike,
    ...calculateProximity(optionType, strike, spot),
  };
}

export function getDemoMonitorSnapshot(): MonitorSnapshot {
  const nearExpiry = expiryDate(10);
  const nextExpiry = expiryDate(38);

  return {
    reportDate: new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    })
      .format(new Date())
      .replaceAll(" ", "-"),
    generatedAt: new Date().toISOString(),
    optionPositionCount: 12,
    downloadedPriceCount: 6,
    missingSymbols: [],
    groups: [
      {
        expiryIso: nearExpiry.iso,
        expiryLabel: nearExpiry.label,
        rows: [
          {
            company: "RELIANCE",
            spot: 1512.4,
            call: reportSide("CALL", 1520, 1512.4),
            put: reportSide("PUT", 1480, 1512.4),
          },
          {
            company: "HDFCBANK",
            spot: 1998.65,
            call: reportSide("CALL", 2100, 1998.65),
            put: reportSide("PUT", 1900, 1998.65),
          },
          {
            company: "INFY",
            spot: 1614.2,
            call: reportSide("CALL", 1650, 1614.2),
            put: reportSide("PUT", 1550, 1614.2),
          },
          {
            company: "SBIN",
            spot: 852.75,
            call: reportSide("CALL", 900, 852.75),
            put: reportSide("PUT", 800, 852.75),
          },
        ],
      },
      {
        expiryIso: nextExpiry.iso,
        expiryLabel: nextExpiry.label,
        rows: [
          {
            company: "TCS",
            spot: 3338.1,
            call: reportSide("CALL", 3500, 3338.1),
            put: reportSide("PUT", 3200, 3338.1),
          },
          {
            company: "BOSCHLTD",
            spot: 38220.5,
            call: reportSide("CALL", 40000, 38220.5),
            put: reportSide("PUT", 36000, 38220.5),
          },
        ],
      },
    ],
  };
}
