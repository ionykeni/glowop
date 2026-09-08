// Role hierarchy and permission definitions

export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  QUOTES_MANAGER: "QUOTES_MANAGER",
  OPERATIONS: "OPERATIONS",
  HOUSEKEEPING_MANAGER: "HOUSEKEEPING_MANAGER",
  HOUSEKEEPING_STAFF: "HOUSEKEEPING_STAFF",
  KITCHEN: "KITCHEN",
  MAINTENANCE: "MAINTENANCE",
  VIEWER: "VIEWER",
  MECHINA_USER: "MECHINA_USER",
};

export const ROLE_LABELS = {
  SUPER_ADMIN: "סופר מנהל",
  ADMIN: "מנהל",
  QUOTES_MANAGER: "אחראי/ת הצעות מחיר",
  OPERATIONS: "תפעול",
  HOUSEKEEPING_MANAGER: "מנהל משק בית",
  HOUSEKEEPING_STAFF: "צוות משק בית",
  KITCHEN: "מטבח",
  MAINTENANCE: "עובד תחזוקה",
  VIEWER: "צופה",
  MECHINA_USER: "משתמש מכינה",
};

// Navigation links each role can see
// Format: { to, label, icon_name }
export const ROLE_NAV_LINKS = {
  SUPER_ADMIN:          ["dashboard", "approved-groups", "calendar", "allocation", "common-spaces", "housekeeping", "kitchen", "maintenance", "admin", "mechina-spaces", "meeting-summaries", "work-schedule", "cleaning-hours"],
  ADMIN:                ["dashboard", "approved-groups", "calendar", "allocation", "common-spaces", "housekeeping", "kitchen", "maintenance", "admin", "mechina-spaces", "meeting-summaries", "work-schedule", "cleaning-hours"],
  QUOTES_MANAGER:       ["quotes"],
  OPERATIONS:           ["dashboard", "calendar", "common-spaces", "maintenance", "work-schedule", "my-shifts"],
  HOUSEKEEPING_MANAGER: ["dashboard", "calendar", "allocation", "housekeeping", "approved-groups", "maintenance", "my-shifts", "cleaning-hours"],
  HOUSEKEEPING_STAFF:   ["dashboard", "calendar", "housekeeping", "my-shifts"],
  KITCHEN:              ["dashboard", "calendar", "kitchen"],
  MAINTENANCE:          ["common-spaces", "maintenance", "my-shifts"],
  VIEWER:               ["dashboard", "calendar"],
  MECHINA_USER:         ["mechina-spaces"],
};

// Pages (route prefixes) each role can access
export const ROLE_ALLOWED_ROUTES = {
  SUPER_ADMIN: "*", // all
  ADMIN:       ["dashboard", "approved-groups", "calendar", "allocation", "common-spaces", "housekeeping", "kitchen", "kitchen-report", "maintenance", "admin", "groups", "quotes", "inventory", "cleaning-hours", "mechina-spaces", "meeting-summaries", "work-schedule", "my-shifts"],
  QUOTES_MANAGER: ["quotes"],
  OPERATIONS:  ["dashboard", "calendar", "common-spaces", "maintenance", "work-schedule", "my-shifts"],
  HOUSEKEEPING_MANAGER: ["dashboard", "calendar", "allocation", "housekeeping", "approved-groups", "cleaning-hours", "maintenance", "my-shifts"],
  HOUSEKEEPING_STAFF:   ["dashboard", "calendar", "housekeeping", "my-shifts"],
  KITCHEN:              ["dashboard", "calendar", "kitchen", "kitchen-report"],
  MAINTENANCE:          ["common-spaces", "maintenance", "my-shifts"],
  VIEWER:               ["dashboard", "calendar"],
  MECHINA_USER:         ["mechina-spaces"],
};

// Permissions — what actions a role can perform
export const PERMISSIONS = {
  // Group actions
  CREATE_GROUP:      ["SUPER_ADMIN", "ADMIN"],
  EDIT_GROUP:        ["SUPER_ADMIN", "ADMIN"],
  DELETE_GROUP:      ["SUPER_ADMIN", "ADMIN"],
  ARCHIVE_GROUP:     ["SUPER_ADMIN", "ADMIN"],
  APPROVE_PROFILE:   ["SUPER_ADMIN", "ADMIN"],

  // Commercial
  CREATE_QUOTE:      ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"],
  EDIT_QUOTE:        ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"],
  APPROVE_QUOTE:     ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"],
  EDIT_PRICES:       ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"],
  DELETE_QUOTE:      ["SUPER_ADMIN", "ADMIN", "QUOTES_MANAGER"],

  // Operational
  MANAGE_MEALS:      ["SUPER_ADMIN", "ADMIN"],
  MANAGE_ACTIVITIES: ["SUPER_ADMIN", "ADMIN"],
  VIEW_SPACE_BLOCKS: ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "MAINTENANCE"],
  MANAGE_SPACE_BLOCKS: ["SUPER_ADMIN", "ADMIN"],
  MANAGE_ALLOCATION: ["SUPER_ADMIN", "ADMIN", "HOUSEKEEPING_MANAGER"],
  CONFIRM_ALLOCATION:["SUPER_ADMIN", "ADMIN", "HOUSEKEEPING_MANAGER"],

  // Housekeeping
  HOUSEKEEPING_ACTIONS: ["SUPER_ADMIN", "ADMIN", "HOUSEKEEPING_MANAGER", "HOUSEKEEPING_STAFF"],
  MARK_TENT_READY:      ["SUPER_ADMIN", "ADMIN", "HOUSEKEEPING_MANAGER", "HOUSEKEEPING_STAFF"],

  // Kitchen
  KITCHEN_ACTIONS:   ["SUPER_ADMIN", "ADMIN", "KITCHEN"],

  // Admin / system
  MANAGE_USERS:      ["SUPER_ADMIN"],
  SYSTEM_SETTINGS:   ["SUPER_ADMIN"],
  VIEW_ADMIN:        ["SUPER_ADMIN", "ADMIN"],

  // Guest form links
  CREATE_GUEST_LINK: ["SUPER_ADMIN", "ADMIN"],

  // Reports / PDFs
  GENERATE_REPORTS:  ["SUPER_ADMIN", "ADMIN", "HOUSEKEEPING_MANAGER"],

  // Post-stay summary (סיכום שהייה)
  MANAGE_POST_STAY:  ["SUPER_ADMIN", "ADMIN"],

  // Maintenance
  CREATE_MAINTENANCE_ISSUE: ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "HOUSEKEEPING_MANAGER", "HOUSEKEEPING_STAFF", "MAINTENANCE"],
  CLOSE_MAINTENANCE_ISSUE:  ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "HOUSEKEEPING_MANAGER", "MAINTENANCE"],

  // Review alerts acknowledgement
  ACKNOWLEDGE_ALERT: ["SUPER_ADMIN", "ADMIN", "KITCHEN", "HOUSEKEEPING_MANAGER", "HOUSEKEEPING_STAFF"],

  // Mechina module
  VIEW_MECHINA_MODULE:   ["SUPER_ADMIN", "ADMIN", "MECHINA_USER"],
  MANAGE_MECHINA_REQUESTS: ["SUPER_ADMIN", "ADMIN"],
  SUBMIT_MECHINA_REQUEST:  ["MECHINA_USER"],

  // Work schedule (סידור עבודה)
  MANAGE_WORK_SCHEDULE: ["SUPER_ADMIN", "ADMIN"],
  VIEW_WORK_SCHEDULE: ["SUPER_ADMIN", "ADMIN", "OPERATIONS", "HOUSEKEEPING_MANAGER", "HOUSEKEEPING_STAFF", "MAINTENANCE"],
};

export function hasPermission(role, permission) {
  if (!role) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}

export function canAccessRoute(role, pathname) {
  if (!role) return false;
  const allowed = ROLE_ALLOWED_ROUTES[role];
  if (allowed === "*") return true;
  // Extract route key from pathname (strip leading /)
  const key = pathname.replace(/^\//, "").split("/")[0] || "dashboard";
  // root "/" redirects role-specific landing pages before rendering a module
  if (key === "") return allowed.includes("dashboard") || allowed.includes("quotes");
  return allowed.includes(key);
}