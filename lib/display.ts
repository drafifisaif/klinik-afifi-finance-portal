import type { Profile } from "@/lib/types";

export function shortId(value: string | null | undefined, length = 8) {
  if (!value) return "-";
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

export function userDisplayLabel(
  profile: Pick<Profile, "email" | "full_name"> | null | undefined,
  userId?: string | null,
  email?: string | null
) {
  return profile?.full_name || profile?.email || email || shortId(userId);
}

export function byteSize(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "-";
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
