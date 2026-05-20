import type { Branch } from "@/lib/types";

export type BranchGroupId = "all" | "owned100" | "putatan-only" | "custom";

export type BranchGroup = {
  id: BranchGroupId;
  label: string;
  branchNames: string[];
};

export const branchGroups: BranchGroup[] = [
  { id: "owned100", label: "100% Owned Clinics", branchNames: ["Papar", "Ranau", "Kinabatangan"] },
  { id: "putatan-only", label: "Putatan Only", branchNames: ["Putatan"] },
  { id: "all", label: "All Branches", branchNames: ["Putatan", "Papar", "Ranau", "Kinabatangan"] },
  { id: "custom", label: "Custom Selection", branchNames: [] }
];

export function normalizeBranchName(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function getBranchGroup(groupId: string | null | undefined) {
  return branchGroups.find((group) => group.id === groupId) ?? branchGroups.find((group) => group.id === "all")!;
}

export function resolveGroupBranchIds(group: BranchGroup, branches: Branch[]) {
  if (group.id === "custom") return [];
  const groupNames = new Set(group.branchNames.map(normalizeBranchName));
  return branches.filter((branch) => groupNames.has(normalizeBranchName(branch.name))).map((branch) => branch.id);
}

export function toParamArray(value: string | string[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function resolveSelectedBranchIds({
  allowedBranches,
  branchParam,
  branchesParam,
  groupParam,
  canSelectMultiple
}: {
  allowedBranches: Branch[];
  branchParam?: string | string[];
  branchesParam?: string | string[];
  groupParam?: string;
  canSelectMultiple: boolean;
}) {
  const allowedIds = new Set(allowedBranches.map((branch) => branch.id));
  const group = getBranchGroup(groupParam);
  const explicitBranchIds = [...toParamArray(branchParam), ...toParamArray(branchesParam)].filter((branchId) => allowedIds.has(branchId));

  if (!canSelectMultiple) {
    return allowedBranches[0] ? [allowedBranches[0].id] : [];
  }

  if (group.id === "custom") {
    return explicitBranchIds.length > 0 ? Array.from(new Set(explicitBranchIds)) : allowedBranches.map((branch) => branch.id);
  }

  if (!groupParam && explicitBranchIds.length > 0) {
    return Array.from(new Set(explicitBranchIds));
  }

  const groupBranchIds = resolveGroupBranchIds(group, allowedBranches);
  return groupBranchIds.length > 0 ? groupBranchIds : allowedBranches.map((branch) => branch.id);
}
