import { createClient, hasSupabaseEnv } from "@/lib/supabase-server";
import type { AuditAction, AuditEvent, AuditSnapshot } from "@/lib/types";

export type AuditChangedFields = Record<string, { after: unknown; before: unknown }>;

type LogAuditEventInput = {
  action: AuditAction;
  afterData?: AuditSnapshot | null;
  bankAccountId?: string | null;
  beforeData?: AuditSnapshot | null;
  branchId?: string | null;
  changedFields?: AuditChangedFields | null;
  description?: string | null;
  entityId?: string | null;
  entityName: string;
};

export type AuditEventFilters = {
  action?: string;
  actorId?: string;
  bankAccountId?: string;
  branchId?: string;
  endDate?: string;
  entityName?: string;
  keyword?: string;
  startDate?: string;
};

function equalAuditValue(first: unknown, second: unknown) {
  return JSON.stringify(first ?? null) === JSON.stringify(second ?? null);
}

export function getAuditChangedFields(beforeData?: AuditSnapshot | null, afterData?: AuditSnapshot | null) {
  const before = beforeData ?? {};
  const after = afterData ?? {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

  return [...keys].reduce<AuditChangedFields>((changes, key) => {
    const beforeValue = before[key] ?? null;
    const afterValue = after[key] ?? null;
    if (!equalAuditValue(beforeValue, afterValue)) {
      changes[key] = { before: beforeValue, after: afterValue };
    }
    return changes;
  }, {});
}

export async function logAuditEvent({
  action,
  afterData = null,
  bankAccountId = null,
  beforeData = null,
  branchId = null,
  changedFields,
  description = null,
  entityId = null,
  entityName
}: LogAuditEventInput) {
  if (!hasSupabaseEnv()) return;

  try {
    const supabase = await createClient();
    const resolvedChangedFields = changedFields ?? getAuditChangedFields(beforeData, afterData);
    await supabase.rpc("log_audit_event", {
      p_action: action,
      p_after_data: afterData,
      p_bank_account_id: bankAccountId,
      p_before_data: beforeData,
      p_branch_id: branchId,
      p_changed_fields: Object.keys(resolvedChangedFields).length ? resolvedChangedFields : null,
      p_description: description,
      p_entity_id: entityId,
      p_entity_name: entityName
    });
  } catch {
    return;
  }
}

function matchesKeyword(event: AuditEvent, keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) return true;

  return [
    event.action,
    event.actor_email,
    event.description,
    event.entity_name,
    event.profiles?.full_name,
    JSON.stringify(event.after_data),
    JSON.stringify(event.before_data),
    JSON.stringify(event.changed_fields)
  ].some((value) => String(value ?? "").toLowerCase().includes(normalized));
}

export async function getAuditEvents(filters: AuditEventFilters = {}) {
  if (!hasSupabaseEnv()) return [];

  const supabase = await createClient();
  let query = supabase
    .from("audit_events")
    .select("*, branches(name, code), bank_accounts(name, bank_name, account_no), profiles(full_name)")
    .order("created_at", { ascending: false })
    .limit(300);

  if (filters.actorId && filters.actorId !== "all") query = query.eq("actor_id", filters.actorId);
  if (filters.action && filters.action !== "all") query = query.eq("action", filters.action);
  if (filters.entityName && filters.entityName !== "all") query = query.eq("entity_name", filters.entityName);
  if (filters.branchId && filters.branchId !== "all") query = query.eq("branch_id", filters.branchId);
  if (filters.bankAccountId && filters.bankAccountId !== "all") query = query.eq("bank_account_id", filters.bankAccountId);
  if (filters.startDate) query = query.gte("created_at", `${filters.startDate}T00:00:00`);
  if (filters.endDate) query = query.lte("created_at", `${filters.endDate}T23:59:59.999`);

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as AuditEvent[]).filter((event) => matchesKeyword(event, filters.keyword ?? ""));
}
