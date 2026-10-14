import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

export type FinanceApiKey = {
  id: string;
  token: string;
  branch_ids: string[];
};

export type FinanceApiAuthResult =
  | { key: FinanceApiKey; error: null }
  | { key: null; error: "not_configured" | "invalid_config" | "unauthorized" };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseApiKeys(value: string): FinanceApiKey[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const keys = parsed.map((entry): FinanceApiKey | null => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry as Record<string, unknown>;
      if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)) return null;
      if (typeof item.token !== "string" || item.token.length < 32) return null;
      if (!Array.isArray(item.branch_ids) || item.branch_ids.length === 0) return null;
      if (!item.branch_ids.every((branchId) => typeof branchId === "string")) return null;

      const branchIds = item.branch_ids as string[];
      if (branchIds.includes("*") ? branchIds.length !== 1 : !branchIds.every((branchId) => uuidPattern.test(branchId))) return null;

      return { id: item.id, token: item.token, branch_ids: branchIds };
    });

    return keys.every((key): key is FinanceApiKey => key !== null) ? keys : null;
  } catch {
    return null;
  }
}

function tokensMatch(candidate: string, configured: string) {
  const candidateHash = createHash("sha256").update(candidate).digest();
  const configuredHash = createHash("sha256").update(configured).digest();
  return timingSafeEqual(candidateHash, configuredHash);
}

export function authenticateFinanceApiRequest(request: Request): FinanceApiAuthResult {
  const rawKeys = process.env.FINANCE_API_KEYS;
  if (!rawKeys) return { error: "not_configured", key: null };

  const keys = parseApiKeys(rawKeys);
  if (!keys) return { error: "invalid_config", key: null };

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const candidate = match?.[1] ?? "";
  const key = keys.find((configured) => tokensMatch(candidate, configured.token));

  return key ? { error: null, key } : { error: "unauthorized", key: null };
}

export function isFinanceApiUuid(value: string) {
  return uuidPattern.test(value);
}
