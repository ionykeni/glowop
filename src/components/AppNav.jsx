import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard, CheckSquare, CalendarDays, BedDouble,
  UtensilsCrossed, Wrench, ShieldAlert, Layers, Lock,
  Menu, X, Users, Search, ChevronDown, Settings, BookMarked, LogOut, NotebookPen,
  CalendarClock, Clock, BarChart3, FileText
} from "lucide-react";
import { revokeAccess } from "@/components/PilotAccessGate";
import { useRoleContext } from "@/lib/RoleContext";
import { ROLE_NAV_LINKS, ROLE_LABELS } from "@/lib/roles";
import { useAlertCounts } from "@/hooks/useAlertCounts";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import GlobalSearch from "@/components/search/GlobalSearch";
import MechinaPendingBadge from "@/components/mechina/MechinaPendingBadge";
import { usePendingWorkScheduleRequests } from "@/hooks/usePendingWorkScheduleRequests";

// Alert module mapping
const LINK_ALERT_MODULE = {
  kitchen:      "KITCHEN",
  allocation:   "ALLOCATION",
  housekeeping: "HOUSEKEEPING",
};

// Build initials from a full name — e.g. "Jonathan Kenigsberger" -> "JK"
function getInitials(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// All available nav links
const ALL_LINKS = [
  { key: "dashboard",       to: "/dashboard",       label: "בית",             icon: LayoutDashboard, group: "primary" },
  { key: "quotes",          to: "/quotes",          label: "הצעות מחיר",      icon: FileText,        group: "primary" },
  { key: "approved-groups", to: "/approved-groups", label: "קבוצות",          icon: CheckSquare,     group: "primary" },
  { key: "calendar",        to: "/calendar",        label: "לוח שנה",          icon: CalendarDays,    group: "primary" },
  { key: "allocation",      to: "/allocation",      label: "לינה",             icon: BedDouble,       group: "primary" },
  { key: "common-spaces",   to: "/common-spaces",   label: "מרחבי פעילות",    icon: Layers,          group: "primary" },
  { key: "housekeeping",    to: "/housekeeping",    label: "משק בית",          icon: BedDouble,       group: "ops" },
  { key: "kitchen",         to: "/kitchen",         label: "מטבח",             icon: UtensilsCrossed, group: "ops" },
  { key: "maintenance",     to: "/maintenance",     label: "תחזוקה",           icon: Wrench,          group: "ops" },
  { key: "mechina-spaces",  to: "/mechina-spaces",  label: "בקשות מרחבים",     icon: BookMarked,      group: "primary" },
  { key: "meeting-summaries", to: "/meeting-summaries", label: "סיכומי פגישות", icon: NotebookPen,   group: "primary" },
  { key: "work-schedule",   to: "/work-schedule",   label: "סידור עבודה",      icon: CalendarClock,   group: "ops" },
  { key: "cleaning-hours",  to: "/cleaning-hours",  label: "שעות עובדות ניקיון", icon: Clock,          group: "ops" },
  { key: "my-shifts",       to: "/my-shifts",       label: "המשמרות שלי",      icon: Clock,           group: "primary" },
];

function isActive(linkTo, pathname) {
  return linkTo === "/"
    ? pathname === "/"
    : pathname === linkTo || pathname.startsWith(linkTo + "/");
}

function AlertBadge({ count, small, urgent, amber }) {
  if (!count || count < 1) return null;
  const urgentClass = urgent ? "bg-red-600 animate-pulse" : amber ? "bg-amber-500" : "bg-red-500";
  return (
    <span className={`inline-flex items-center justify-center ${urgentClass} text-white font-bold rounded-full leading-none pointer-events-none
      ${small ? "min-w-[14px] h-3.5 text-[9px] px-0.5" : "min-w-[16px] h-4 text-[10px] px-1"}`}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

const ADMIN_ROLES_SET = new Set(["SUPER_ADMIN", "ADMIN", "OPERATIONS"]);

// Desktop primary nav pill
function NavPill({ to, label, icon: Icon, pathname, alertCount, role }) {
  const active = isActive(to, pathname);
  const isMechinaSpaces = to === "/mechina-spaces";
  const isAdminRole = ADMIN_ROLES_SET.has(role);
  return (
    <Link
      to={to}
      className={`relative flex items-center gap-1.5 px-3 py-1.5 text-sm whitespace-nowrap rounded-full transition-all duration-150 select-none
        ${active
          ? "bg-primary/10 text-primary font-semibold"
          : "text-slate-500 hover:text-slate-700 hover:bg-slate-100 font-medium"
        }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
      {alertCount > 0 && <AlertBadge count={alertCount} small />}
      {isMechinaSpaces && isAdminRole && <MechinaPendingBadge />}
    </Link>
  );
}

// Dropdown menu
function NavDropdown({ label, icon: Icon, items, pathname, alertCounts, urgentKeys = [] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const totalBadge = items.reduce((s, it) => s + (alertCounts[it.key] || 0), 0);
  const anyUrgent = items.some(it => urgentKeys.includes(it.key));
  const anyActive = items.some(it => isActive(it.to, pathname));

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full transition-all duration-150 select-none
          ${anyActive
            ? "bg-primary/10 text-primary font-semibold"
            : "text-slate-500 hover:text-slate-700 hover:bg-slate-100 font-medium"
          }`}
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span>{label}</span>
        {totalBadge > 0 && <AlertBadge count={totalBadge} small urgent={anyUrgent} />}
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-1.5 right-0 min-w-[180px] bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-50">
          {items.map(item => {
            const active = isActive(item.to, pathname);
            const cnt = alertCounts[item.key] || 0;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors
                  ${active
                    ? "text-primary bg-primary/6 font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-800"
                  }`}
              >
                <item.icon className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                <span className="flex-1">{item.label}</span>
                {cnt > 0 && <AlertBadge count={cnt} urgent={urgentKeys.includes(item.key)} amber={item.key === "work-schedule"} />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Mobile drawer link
function DrawerLink({ to, label, icon: Icon, pathname, onClick, alertCount, role, urgent = false, amber = false }) {
  const active = isActive(to, pathname);
  const isMechinaSpaces = to === "/mechina-spaces";
  const isAdminRole = ADMIN_ROLES_SET.has(role);
  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
        ${active ? "bg-primary/10 text-primary font-semibold" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1">{label}</span>
      {alertCount > 0 && <AlertBadge count={alertCount} urgent={urgent} amber={amber} />}
      {isMechinaSpaces && isAdminRole && <MechinaPendingBadge />}
    </Link>
  );
}

export default function AppNav() {
  const { pathname } = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { role, internalUser } = useRoleContext();
  const canUseGlobalSearch = role !== "OPERATIONS";
  const alertCounts = useAlertCounts();
  const pendingWorkRequests = usePendingWorkScheduleRequests(role);

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const handler = (e) => {
      if (canUseGlobalSearch && (e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canUseGlobalSearch]);

  const closeDrawer = () => setDrawerOpen(false);

  // Cerrar sesión — borra la sesión y redirige al login para poder cambiar de cuenta
  const handleLogout = async () => {
    await base44.auth.logout();
  };

  const allowedKeys = role ? (ROLE_NAV_LINKS[role] || []) : [];
  const showAdmin = allowedKeys.includes("admin");
  const showUserManagement = role === "SUPER_ADMIN";

  // Primary links: main daily-use modules kept in the top bar
  const PRIMARY_KEYS = ["dashboard", "quotes", "approved-groups", "calendar", "allocation", "common-spaces", "mechina-spaces", "meeting-summaries", "my-shifts"];
  const primaryLinks = ALL_LINKS.filter(l => PRIMARY_KEYS.includes(l.key) && allowedKeys.includes(l.key));

  // Ops dropdown: housekeeping, kitchen, maintenance, work schedule
  const OPS_KEYS = ["housekeeping", "kitchen", "maintenance", "work-schedule", "cleaning-hours"];
  const opsLinks = ALL_LINKS.filter(l => OPS_KEYS.includes(l.key) && allowedKeys.includes(l.key));

  // Admin dropdown items (not from ALL_LINKS — separate)
  const adminDropdownItems = [];
  if (role === "SUPER_ADMIN") adminDropdownItems.push({ key: "analytics", to: "/analytics", label: "BI / אנליטיקה", icon: BarChart3 });
  if (showUserManagement) adminDropdownItems.push({ key: "admin-users", to: "/admin/users", label: "משתמשים", icon: Users });
  if (showAdmin) adminDropdownItems.push({ key: "admin", to: "/admin", label: "ניהול מערכת", icon: ShieldAlert });

  const userName = internalUser?.name || "";
  const roleLabel = ROLE_LABELS[role] || role || "";

  // Per-item alert count helper
  const getCount = (key) => alertCounts[LINK_ALERT_MODULE[key]] || 0;

  // Maintenance open issues badge
  const { data: maintenanceIssues = [] } = useQuery({
    queryKey: ["maintenanceIssuesOpen"],
    queryFn: () => base44.entities.MaintenanceIssue.filter(
      { status: { $in: ["OPEN", "IN_PROGRESS", "WAITING_PARTS"] } },
      "-created_date",
      500
    ),
    staleTime: 60_000,
    enabled: allowedKeys.includes("maintenance"),
  });
  const maintenanceOpenCount = maintenanceIssues.length;
  const maintenanceUrgent = maintenanceIssues.some(i => i.priority === "URGENT");

  // Ops badge counts — include maintenance count + module alert counts
  const opsBadgeMap = Object.fromEntries(opsLinks.map(l => [
    l.key,
    l.key === "maintenance" ? maintenanceOpenCount : l.key === "work-schedule" ? pendingWorkRequests : getCount(l.key)
  ]));
  // Admin badge map — no alerts currently but structure is ready
  const adminBadgeMap = {};

  return (
    <>
      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* ── Desktop header ─────────────────────────────────────────────── */}
      <header className="app-navigation hidden sm:block bg-white border-b border-slate-200 sticky top-0 z-40" dir="rtl">
        <div className="max-w-screen-xl mx-auto px-4 lg:px-6 flex items-center h-14 gap-1">

          {/* Brand */}
          <span className="text-xs font-bold text-slate-300 tracking-widest uppercase select-none ml-3 shrink-0">
            הדור הבא
          </span>

          <div className="w-px h-5 bg-slate-200 mx-1 shrink-0" />

          {/* Primary nav pills */}
          <nav className="flex items-center gap-0.5 flex-nowrap">
            {primaryLinks.map(link => (
              <NavPill
                key={link.key}
                {...link}
                pathname={pathname}
                alertCount={getCount(link.key)}
                role={role}
              />
            ))}

            {/* Ops dropdown — only if has items */}
            {opsLinks.length > 0 && (
              <NavDropdown
                label="תפעול"
                icon={Wrench}
                items={opsLinks}
                pathname={pathname}
                alertCounts={opsBadgeMap}
                urgentKeys={maintenanceUrgent ? ["maintenance"] : []}
              />
            )}

            {/* Admin dropdown — only if has items */}
            {adminDropdownItems.length > 0 && (
              <NavDropdown
                label="ניהול"
                icon={ShieldAlert}
                items={adminDropdownItems}
                pathname={pathname}
                alertCounts={adminBadgeMap}
              />
            )}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Right side: search + user */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Quick search pill */}
            <button
              onClick={() => setSearchOpen(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 border border-slate-200 rounded-full bg-slate-50 hover:bg-slate-100 hover:text-slate-600 hover:border-slate-300 transition-all duration-150 ${canUseGlobalSearch ? "" : "hidden"}`}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden lg:inline">חיפוש מהיר</span>
              <kbd className="hidden lg:inline text-[10px] bg-slate-200 text-slate-400 rounded px-1.5 py-0.5 font-mono leading-none">⌘K</kbd>
            </button>

            <div className="w-px h-5 bg-slate-200 shrink-0" />

            {/* User info — initials avatar + role */}
            {role && (
              <div className="flex items-center gap-1.5">
                {userName && (
                  <span
                    title={userName}
                    className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10 text-primary text-[11px] font-bold select-none shrink-0"
                  >
                    {getInitials(userName)}
                  </span>
                )}
                <span className="text-[11px] font-semibold text-primary bg-primary/8 rounded-full px-2 py-0.5 whitespace-nowrap">
                  {roleLabel}
                </span>
              </div>
            )}

            {/* Lock */}
            <button
              onClick={() => { revokeAccess(); window.location.reload(); }}
              title="נעילת מערכת"
              className="flex items-center justify-center w-7 h-7 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
            </button>

            {/* Logout */}
            <button
              onClick={handleLogout}
              title="התנתקות"
              className="flex items-center justify-center w-7 h-7 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── Mobile top bar ──────────────────────────────────────────────── */}
      <div className="app-navigation sm:hidden sticky top-0 z-40 bg-white border-b border-slate-200" dir="rtl">
        <div className="flex items-center justify-between px-2 h-14">
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center justify-center w-12 h-12 rounded-xl text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition-colors"
            aria-label="פתח תפריט"
          >
            <Menu className="w-5 h-5" />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className={`flex-1 mx-2 items-center gap-2 px-3 py-2 text-xs text-slate-400 border border-slate-200 rounded-full bg-slate-50 ${canUseGlobalSearch ? "flex" : "hidden"}`}
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span>חיפוש מהיר...</span>
          </button>
          <button
            onClick={() => { revokeAccess(); window.location.reload(); }}
            className="flex items-center justify-center w-12 h-12 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            aria-label="נעילה"
          >
            <Lock className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ───────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="sm:hidden fixed inset-0 z-50 flex" dir="rtl">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeDrawer} />
          <div className="relative mr-auto w-72 max-w-[85vw] h-full bg-white shadow-2xl flex flex-col">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 h-14 border-b border-slate-100 shrink-0">
              <div>
                <p className="text-sm font-bold text-slate-800">תפריט ראשי</p>
                {role && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {userName}{userName ? " · " : ""}{roleLabel}
                  </p>
                )}
              </div>
              <button
                onClick={closeDrawer}
                className="flex items-center justify-center w-10 h-10 rounded-xl text-slate-400 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nav links */}
            <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
              {primaryLinks.map(link => (
                <DrawerLink
                  key={link.key}
                  {...link}
                  pathname={pathname}
                  onClick={closeDrawer}
                  alertCount={getCount(link.key)}
                  role={role}
                />
              ))}
              {opsLinks.length > 0 && <div className="px-4 pt-3 pb-1 text-[11px] font-bold text-slate-400">תפעול</div>}
              {opsLinks.map(link => (
                <DrawerLink
                  key={link.key}
                  {...link}
                  pathname={pathname}
                  onClick={closeDrawer}
                  alertCount={link.key === "maintenance" ? maintenanceOpenCount : link.key === "work-schedule" ? pendingWorkRequests : getCount(link.key)}
                  urgent={link.key === "maintenance" && maintenanceUrgent}
                  amber={link.key === "work-schedule"}
                />
              ))}
            </div>

            {/* Admin + lock */}
            {(adminDropdownItems.length > 0) && (
              <div className="shrink-0 p-3 border-t border-slate-100 space-y-0.5">
                {adminDropdownItems.map(item => (
                  <DrawerLink
                    key={item.key}
                    to={item.to}
                    label={item.label}
                    icon={item.icon}
                    pathname={pathname}
                    onClick={closeDrawer}
                    alertCount={0}
                  />
                ))}
              </div>
            )}

            <div className="shrink-0 px-3 pb-3 space-y-0.5">
              <button
                onClick={() => { revokeAccess(); window.location.reload(); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <Lock className="w-4 h-4" />
                נעילת מערכת
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                התנתקות
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}