/**
 * RBAC catalog for the ServeX admin panel.
 *
 * Permissions are simple string keys (`module.action`). Each employee stores
 * an explicit list of granted keys; `['*']` (or the super_admin role) means
 * everything. An admin user WITHOUT an employee profile is treated as full
 * access so the original/seed admin is never locked out.
 */

export type StaffRole = "super_admin" | "manager" | "dispatcher" | "support" | "finance";

export const PERMISSION_CATALOG: { group: string; items: { key: string; label: string }[] }[] = [
    { group: "Overview", items: [{ key: "dashboard.view", label: "View dashboard" }] },
    { group: "Requests", items: [
        { key: "requests.view", label: "View service requests & tracking" },
        { key: "requests.assign", label: "Assign / dispatch mistris" },
    ] },
    { group: "Mistris", items: [
        { key: "mistris.view", label: "View mistris" },
        { key: "mistris.manage", label: "Approve / feature mistris" },
    ] },
    { group: "Customers", items: [
        { key: "users.view", label: "View customers" },
        { key: "users.manage", label: "Edit / suspend customers" },
    ] },
    { group: "Ratings", items: [
        { key: "ratings.view", label: "View ratings" },
        { key: "ratings.moderate", label: "Approve / reject ratings" },
    ] },
    { group: "Catalog", items: [
        { key: "services.manage", label: "Manage services & pricing" },
        { key: "banners.manage", label: "Manage hero banners" },
    ] },
    { group: "Finance", items: [
        { key: "expenses.view", label: "View expenses report" },
        { key: "expenses.manage", label: "Add / edit / delete expenses" },
        { key: "payouts.view", label: "View provider earnings & payouts" },
        { key: "payouts.manage", label: "Settle / collect commission" },
    ] },
    { group: "Engagement", items: [
        { key: "broadcast.send", label: "Send broadcasts (push / SMS)" },
    ] },
    { group: "System", items: [
        { key: "sms.view", label: "View SMS logs" },
        { key: "audit.view", label: "View audit logs" },
        { key: "employees.view", label: "View employees" },
        { key: "employees.manage", label: "Add / edit employees" },
        { key: "settings.view", label: "View business settings" },
        { key: "settings.manage", label: "Edit business settings" },
    ] },
];

export const ALL_PERMISSIONS: string[] = PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key));

export const ROLE_DEFINITIONS: {
    key: StaffRole;
    label: string;
    description: string;
    defaultPermissions: string[];
}[] = [
    {
        key: "super_admin",
        label: "Super Admin",
        description: "Full access to everything, including managing employees.",
        defaultPermissions: ["*"],
    },
    {
        key: "manager",
        label: "Manager",
        description: "Runs day-to-day operations — everything except managing employees.",
        defaultPermissions: ALL_PERMISSIONS.filter((p) => p !== "employees.manage"),
    },
    {
        key: "dispatcher",
        label: "Dispatcher",
        description: "Tracks live requests and assigns mistris.",
        defaultPermissions: ["dashboard.view", "requests.view", "requests.assign", "mistris.view", "ratings.view"],
    },
    {
        key: "support",
        label: "Support",
        description: "Handles customers and moderates ratings.",
        defaultPermissions: ["dashboard.view", "requests.view", "users.view", "ratings.view", "ratings.moderate"],
    },
    {
        key: "finance",
        label: "Finance",
        description: "Tracks expenses, provider payouts, payments, requests, and system logs.",
        defaultPermissions: ["dashboard.view", "requests.view", "expenses.view", "expenses.manage", "payouts.view", "payouts.manage", "sms.view", "audit.view"],
    },
];

export const STAFF_ROLES: StaffRole[] = ROLE_DEFINITIONS.map((r) => r.key);

/** Resolve the effective permission list. No profile / super_admin => ['*']. */
export function effectivePermissions(
    role: string | null | undefined,
    explicit: string[] | null | undefined
): string[] {
    if (!role) return ["*"]; // legacy admin without a profile
    if (role === "super_admin") return ["*"];
    const list = Array.isArray(explicit) ? explicit : [];
    if (list.includes("*")) return ["*"];
    return list;
}

export function hasPermission(perms: string[], key: string): boolean {
    return perms.includes("*") || perms.includes(key);
}
