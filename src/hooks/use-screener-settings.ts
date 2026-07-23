"use client";

import { useEffect, useState } from "react";
import {
  readScreenerSettings,
  writeScreenerSettings,
  type ScreenerSettings,
} from "@/lib/screener-settings";

export function useScreenerSettings() {
  const [settings, setSettings] = useState<ScreenerSettings>(() => readScreenerSettings());

  useEffect(() => {
    writeScreenerSettings(settings);
  }, [settings]);

  return [settings, setSettings] as const;
}
