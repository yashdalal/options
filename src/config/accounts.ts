export const ACCOUNT_IDS = ["prakash", "gopa", "huf"] as const;

export type AccountId = (typeof ACCOUNT_IDS)[number];

export type AccountDefinition = {
  id: AccountId;
  label: string;
  envPrefix: string;
};

export const ACCOUNT_DEFINITIONS: readonly AccountDefinition[] = [
  { id: "prakash", label: "Prakash", envPrefix: "KOTAK_PRAKASH" },
  { id: "gopa", label: "Gopa", envPrefix: "KOTAK_GOPA" },
  { id: "huf", label: "HUF", envPrefix: "KOTAK_HUF" },
] as const;

export function isAccountId(value: string): value is AccountId {
  return ACCOUNT_IDS.includes(value as AccountId);
}
