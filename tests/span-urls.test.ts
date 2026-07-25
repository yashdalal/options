import { describe, expect, it } from "vitest";
import {
  previousCalendarDates,
  spanZipUrl,
} from "@/server/span/urls";

describe("span urls", () => {
  it("builds archives host zip urls", () => {
    expect(spanZipUrl("20260724", "s")).toBe(
      "https://nsearchives.nseindia.com/archives/nsccl/span/nsccl.20260724.s.zip",
    );
    expect(spanZipUrl("20260724", "i5")).toContain(".i5.zip");
  });

  it("walks previous calendar dates newest first", () => {
    expect(previousCalendarDates("20260725", 3)).toEqual([
      "20260725",
      "20260724",
      "20260723",
    ]);
  });
});
