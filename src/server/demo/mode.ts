export function isDemoMode(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }
  const value = process.env.DEMO_MODE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
