"use client";

import { useEffect, useRef, useState } from "react";

type NumberInputProps = {
  value: number;
  onValueChange: (next: number) => void;
  min?: number;
  integer?: boolean;
  disabled?: boolean;
  className?: string;
};

function parseDraft(raw: string, integer: boolean): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") {
    return null;
  }
  const next = Number(trimmed);
  if (!Number.isFinite(next)) {
    return null;
  }
  return integer ? Math.floor(next) : next;
}

export function NumberInput({
  value,
  onValueChange,
  min,
  integer = false,
  disabled,
  className,
}: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  function commit(raw: string, clampBelowMin: boolean): number | null {
    const parsed = parseDraft(raw, integer);
    if (parsed === null) {
      return null;
    }
    if (min !== undefined && parsed < min) {
      return clampBelowMin ? min : null;
    }
    return parsed;
  }

  return (
    <input
      type="number"
      min={min}
      disabled={disabled}
      className={className}
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const next = commit(raw, false);
        if (next !== null) {
          onValueChange(next);
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        const next = commit(draft, true);
        if (next === null) {
          setDraft(String(value));
          return;
        }
        setDraft(String(next));
        if (next !== value) {
          onValueChange(next);
        }
      }}
    />
  );
}
