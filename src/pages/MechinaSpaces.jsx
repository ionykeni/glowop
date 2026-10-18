import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useRoleContext } from "@/lib/RoleContext";
import { Building2, ChevronRight, ChevronLeft, CalendarDays, Plus, ListChecks, CheckCircle, XCircle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import MechinaBookingRequestModal from "@/components/mechina/MechinaBookingRequestModal";
import MechinaSpaceAvailability from "@/components/mechina/MechinaSpaceAvailability";
import MechinaDecisionModal from "@/components/mechina/MechinaDecisionModal";
import SpaceDeactivationDialog from "@/components/mechina/SpaceDeactivationDialog";
import { filterRelevantMechinaAssignments } from "@/lib/mechinaGroups";
import { isBlockVisibleOnCalendarDate } from "@/lib/activitySpaceBlocks";
import PortalTabs from "@/components/mechina/sleeping-report/PortalTabs";
import SleepingReportTab from "@/components/mechina/sleeping-report/SleepingReportTab";
import AdminSleepingReports from "@/components/mechina/sleeping-report/AdminSleepingReports";

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "OPERATIONS"];
const SPACE_ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN"];

const STATUS_LABELS = {
  PENDING:                { label: "ממתין לאישור",    cls: "bg-amber-50 text-amber-700 border-amber-200" },
  APPROVED:               { label: "מאושר",            cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  REJECTED:               { label: "נדחה",             cls: "bg-red-50 text-red-700 border-red-200" },
  CANCELLED:              { label: "בוטל",             cls: "bg-slate-50 text-slate-500 border-slate-200" },
  CHANGE_REQUESTED:       { label: "נדרש שינוי",      cls: "bg-violet-50 text-violet-700 border-violet-200" },
  CANCELLATION_REQUESTED: { label: "בקשת ביטול",      cls: "bg-orange-50 text-orange-700 border-orange-200" },
};

function todayStr() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date()); }
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}
function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
}

function StatusBadge({ status }) {
  const cfg = STATUS_LABELS[status] || { label: status, cls: "bg-slate-50 text-slate-500 border-slate-200" };
  return <span className={`text-xs font-semibold border rounded-full px-2.5 py-0.5 ${cfg.cls}`}>{cfg.label}</span>;
}

function DateNav({ selectedDate, onDateChange }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onDateChange(addDays(selectedDate, -1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors">
        <ChevronRight className="w-4 h-4" />
      </button>
      <div className="flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-slate-400" />
        <input type="date" value={selectedDate} onChange={e => onDateChange(e.target.value)}
          className="text-sm font-medium text-slate-800 border-0 bg-transparent focus:outline-none cursor-pointer" />
        <span className="text-sm text-slate-500 hidden sm:inline">{formatDate(selectedDate)}</span>
      </div>
      <button onClick={() => onDateChange(addDays(selectedDate, 1))} className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors">
        <ChevronLeft className="w-4 h-4" />
      </button>
      {selectedDate !== todayStr() && (
        <button onClick={() => onDateChange(todayStr())} className="text-xs text-primary border border-primary/30 rounded-full px-2.5 py-0.5 hover:bg-primary/5 transition-colors">
          היום
        </button>
      )}
    </div>
  );
}

// ── Shared action modal for cancel/request-cancel ───────────────────────────
function ActionConfirmModal({ title, description, reasonLabel, onConfirm, onClose, confirmLabel, confirmClass }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-800">{title}</h3>
        <p className="text-sm text-slate-600">{description}</p>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">{reasonLabel}</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="..." rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>חזור</Button>
          <Button className={`flex-1 ${confirmClass}`} onClick={() => onConfirm(reason)}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

// ── Resolve cancellation modal (admin) ─────────────────────────────────────
function ResolveCancellationModal({ request, onClose, onResolved }) {
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handle = async (decision) => {
    setSaving(true);
    const res = await base44.functions.invoke("resolveMechinaCancellationRequest", {
      request_id: request.id, decision, admin_notes: adminNotes.trim() || undefined,
    });
    setSaving(false);
    if (res.data?.success) {
      toast.success(decision === "APPROVE_CANCELLATION" ? "בקשת הביטול אושרה" : "בקשת הביטול נדחתה");
      onResolved();
    } else {
      toast.error(res.data?.error || "שגיאה — נסה שוב");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 p-6 space-y-4">
        <h3 className="text-base font-semibold text-slate-800">טיפול בבקשת ביטול</h3>
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 space-y-1 text-sm">
          <p className="font-semibold text-slate-800">{request.activity_title}</p>
          <p className="text-slate-500">{request.space_name} · {request.date} · {request.start_time}–{request.end_time}</p>
          <p className="text-slate-400">{request.requested_by_name || request.requested_by_email}</p>
          {request.admin_notes && <p className="text-orange-700 mt-1">סיבה: {request.admin_notes}</p>}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-slate-500">הערת מנהל (אופציונלי)</label>
          <textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={2}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>חזור</Button>
          <Button className="flex-1 border-red-300 text-red-600 hover:bg-red-50" variant="outline" onClick={() => handle("REJECT_CANCELLATION")} disabled={saving}>
            <XCircle className="w-3.5 h-3.5 mr-1" /> דחה ביטול
          </Button>
          <Button className="flex-1 bg-slate-700 hover:bg-slate-800" onClick={() => handle("APPROVE_CANCELLATION")} disabled={saving}>
            <CheckCircle className="w-3.5 h-3.5 mr-1" /> אשר ביטול
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MechinaSpaces() {
  const { role, internalUser } = useRoleContext();
  const isAdmin = ADMIN_ROLES.includes(role);
  const canManageAvailability = SPACE_ADMIN_ROLES.includes(role);
  const isMechinaUser = role === "MECHINA_USER";

  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [spaces, setSpaces] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activeBookings, setActiveBookings] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [spaceBlocks, setSpaceBlocks] = useState([]);
  const [myRequests, setMyRequests] = useState([]);          // admin: PENDING list; mechina: own requests
  const [approvedRequests, setApprovedRequests] = useState([]);
  const [cancellationRequests, setCancellationRequests] = useState([]); // admin: CANCELLATION_REQUESTED
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [preselectedSpaceId, setPreselectedSpaceId] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [decisionModal, setDecisionModal] = useState(null);  // { mode: "approve"|"reject", request }
  const [actionModal, setActionModal] = useState(null);      // { type: "cancel"|"request_cancel", request }
  const [resolveCancellationModal, setResolveCancellationModal] = useState(null); // request
  const [togglingSpaceId, setTogglingSpaceId] = useState("");
  const [deactivationSpace, setDeactivationSpace] = useState(null);
  const [portalTab, setPortalTab] = useState("spaces");

  const groupMap = Object.fromEntries(groups.map(g => [g.id, g]));
  // Only assignments pointing to real, relevant groups are selectable (old/cancelled/deleted groups excluded)
  const activeAssignments = groups.length > 0 ? filterRelevantMechinaAssignments(assignments, groupMap) : [];
  const assignment = activeAssignments.find(a => a.id === selectedAssignmentId) || activeAssignments[0];
  const mechinaGroupId = assignment?.group_id || "";

  useEffect(() => {
    if (activeAssignments.length > 0 && !activeAssignments.some(a => a.id === selectedAssignmentId)) {
      setSelectedAssignmentId(activeAssignments[0].id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, groups]);

  useEffect(() => { base44.entities.ActivitySpace.list().then(setSpaces); }, []);
  useEffect(() => { base44.entities.Group.list("-created_date", 500).then(setGroups); }, []);

  useEffect(() => {
    if (!isMechinaUser || !internalUser?.email) return;
    base44.entities.MechinaGroupAssignment.filter({ user_email: internalUser.email, is_active: true }).then(setAssignments);
  }, [isMechinaUser, internalUser?.email]);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    Promise.all([
      base44.entities.GroupScheduleItem.filter({ date: selectedDate, status: "ACTIVE" }),
      base44.entities.CommonSpaceBookingRequest.filter({ date: selectedDate, status: "PENDING" }),
      base44.entities.ActivitySpaceBlock.filter({ status: "ACTIVE" }),
    ]).then(([bookings, requests, blocks]) => {
      setActiveBookings(bookings.filter(b => b.activity_space_id));
      setPendingRequests(requests);
      setSpaceBlocks(blocks.filter(block => isBlockVisibleOnCalendarDate(block, selectedDate)));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [selectedDate]);

  useEffect(() => {
    if (!isMechinaUser || !mechinaGroupId) return;
    base44.entities.CommonSpaceBookingRequest.filter({ mechina_group_id: mechinaGroupId })
      .then(reqs => setMyRequests(sortChron(reqs)));
  }, [isMechinaUser, mechinaGroupId]);

  useEffect(() => {
    if (!isAdmin) return;
    reloadAdminData();
  }, [isAdmin]);

  const sortChron = arr => [...arr].sort((a, b) => {
    const da = `${a.date || ""}T${a.start_time || ""}`;
    const db = `${b.date || ""}T${b.start_time || ""}`;
    return da.localeCompare(db);
  });

  const reloadAdminData = async () => {
    const [bookings, pending, allPending, approved, cancellationReqs] = await Promise.all([
      base44.entities.GroupScheduleItem.filter({ date: selectedDate, status: "ACTIVE" }),
      base44.entities.CommonSpaceBookingRequest.filter({ date: selectedDate, status: "PENDING" }),
      base44.entities.CommonSpaceBookingRequest.filter({ status: "PENDING" }),
      base44.entities.CommonSpaceBookingRequest.filter({ status: "APPROVED" }),
      base44.entities.CommonSpaceBookingRequest.filter({ status: "CANCELLATION_REQUESTED" }),
    ]);
    setActiveBookings(bookings.filter(b => b.activity_space_id));
    setPendingRequests(pending);
    setMyRequests(sortChron(allPending));
    setApprovedRequests(sortChron(approved));
    setCancellationRequests(sortChron(cancellationReqs));
  };

  const reloadMechinaData = async () => {
    const [bookings, pending, requests] = await Promise.all([
      base44.entities.GroupScheduleItem.filter({ date: selectedDate, status: "ACTIVE" }),
      base44.entities.CommonSpaceBookingRequest.filter({ date: selectedDate, status: "PENDING" }),
      base44.entities.CommonSpaceBookingRequest.filter({ mechina_group_id: mechinaGroupId }),
    ]);
    setActiveBookings(bookings.filter(b => b.activity_space_id));
    setPendingRequests(pending);
    setMyRequests(sortChron(requests));
  };

  const handleDecision = async (adminNotes) => {
    const { mode, request } = decisionModal;
    const fnName = mode === "approve" ? "approveMechinaBookingRequest" : "rejectMechinaBookingRequest";
    const res = await base44.functions.invoke(fnName, { request_id: request.id, admin_notes: adminNotes });
    setDecisionModal(null);
    if (res.data?.success) {
      toast.success(mode === "approve" ? "הבקשה אושרה" : "הבקשה נדחתה");
      await reloadAdminData();
    } else {
      toast.error(res.data?.error || "שגיאה — נסה שוב");
    }
  };

  // Called from ActionConfirmModal for both cancel + request_cancel
  const handleActionConfirm = async (reason) => {
    const { request } = actionModal;
    const isDirectCancel = ["PENDING", "CHANGE_REQUESTED"].includes(request.status);
    setActionModal(null);

    const res = await base44.functions.invoke("requestOrCancelMechinaBooking", {
      request_id: request.id,
      reason: reason.trim() || undefined,
    });

    if (res.data?.success) {
      if (isDirectCancel) {
        toast.success("הבקשה בוטלה");
      } else {
        toast.success("בקשת הביטול נשלחה למנהל");
      }
      if (isAdmin) await reloadAdminData();
      else await reloadMechinaData();
    } else {
      toast.error(res.data?.error || "שגיאה — נסה שוב");
    }
  };

  const handleToggleAvailability = async (space, applicableBlocks) => {
    if (applicableBlocks.length === 0) {
      setDeactivationSpace(space);
      return;
    }
    setTogglingSpaceId(space.id);
    try {
      await Promise.all(applicableBlocks.map(block => base44.functions.invoke("manageActivitySpaceBlock", {
        action: "cancel",
        id: block.id,
        resolution_notes: "הופעל מחדש ממסך בקשות מרחבים",
      })));
      setSpaceBlocks(current => current.filter(block => !applicableBlocks.some(item => item.id === block.id)));
      toast.success("המרחב הופעל מחדש");
    } catch (error) {
      toast.error(error?.message || "הפעלת המרחב נכשלה");
    } finally {
      setTogglingSpaceId("");
    }
  };

  const handleDeactivateSpace = async ({ start_date, end_date }) => {
    const space = deactivationSpace;
    const block = {
      activity_space_id: space.id,
      start_date,
      end_date: end_date || null,
      start_time: "00:00",
      end_time: end_date ? "23:59" : null,
      is_open_ended: !end_date,
      reason_type: "TEMPORARILY_CLOSED",
      reason_notes: "הושבת ממסך בקשות מרחבים",
    };
    setTogglingSpaceId(space.id);
    try {
      const preview = (await base44.functions.invoke("manageActivitySpaceBlock", { action: "preview", block })).data;
      const hasApprovedRequest = preview.conflicts?.some(item => item.type === "BOOKING_REQUEST" && item.request_status === "APPROVED");
      if (hasApprovedRequest && !window.confirm("למרחב זה קיימות בקשות עתידיות מאושרות. להשבית את המרחב לבקשות חדשות בכל זאת?")) return;
      if (!hasApprovedRequest && preview.conflicts?.length && !window.confirm("קיימות פעילויות בטווח החסימה. להשבית את המרחב לבקשות חדשות בכל זאת?")) return;
      const saved = (await base44.functions.invoke("manageActivitySpaceBlock", {
        action: "save",
        block,
        confirm_conflicts: !!preview.conflicts?.length,
      })).data;
      if (!saved.success) throw new Error(saved.error || "השבתת המרחב נכשלה");
      setSpaceBlocks(current => [...current, saved.block]);
      setDeactivationSpace(null);
      toast.success(end_date ? "המרחב הושבת לטווח שנבחר" : "המרחב הושבת עד להודעה חדשה");
    } catch (error) {
      toast.error(error?.message || "השבתת המרחב נכשלה");
    } finally {
      setTogglingSpaceId("");
    }
  };

  const handleRequestNew = (spaceId = "") => { setPreselectedSpaceId(spaceId); setModalOpen(true); };

  const handleSubmitted = () => {
    if (isAdmin) reloadAdminData();
    else reloadMechinaData();
  };

  if (!isAdmin && !isMechinaUser) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" dir="rtl">
        <div className="text-center space-y-2">
          <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-slate-500 font-medium">אין הרשאה לצפות בדף זה</p>
        </div>
      </div>
    );
  }

  const SPACE_SORT_ORDER = [
    "bunker_1", "bunker_2", "bunker_3", "bunker_4",
    "bunker_6", "bunker_7", "bunker_8",
    "ohel_moed", "outdoor_deck_lawn", "dining_hall",
    "rehavei_habayit",
    "boulder_1", "boulder_2", "boulder_3", "boulder_4",
    "boulder_5", "boulder_6", "boulder_7", "boulder_8",
  ];
  // Spaces never lent to Mechinot — excluded from Mechina selectable spaces only.
  // (ActivitySpace records, general activity scheduling, calendars and reports are unaffected.)
  const MECHINA_EXCLUDED_CODES = ["bunker_5", "dining_hall"];
  const mechinaSpaces = spaces
    .filter(s => !MECHINA_EXCLUDED_CODES.includes(s.code))
    .sort((a, b) => {
      const ai = SPACE_SORT_ORDER.indexOf(a.code);
      const bi = SPACE_SORT_ORDER.indexOf(b.code);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  const bookableSpaces = mechinaSpaces;

  // ── MECHINA USER VIEW ────────────────────────────────────────────────────
  if (isMechinaUser) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8" dir="rtl">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="space-y-0.5">
            <h1 className="text-2xl font-heading font-semibold text-slate-800">בקשות מרחבים</h1>
            {activeAssignments.length === 0 && (
              <p className="text-sm text-amber-600">לא נמצאה מכינה מקושרת לחשבון זה. פנה למנהל המערכת.</p>
            )}
            {activeAssignments.length === 1 && (
              <p className="text-sm text-slate-500">מכינה: <span className="font-semibold text-slate-700">{assignment.group_name || mechinaGroupId}</span></p>
            )}
            {activeAssignments.length > 1 && (
              <div className="flex items-center gap-2 mt-1">
                <label className="text-sm text-slate-500">בחר מכינה:</label>
                <select value={selectedAssignmentId} onChange={e => setSelectedAssignmentId(e.target.value)}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-primary">
                  {activeAssignments.map(a => <option key={a.id} value={a.id}>{a.group_name || a.group_id}</option>)}
                </select>
              </div>
            )}
          </div>
          {mechinaGroupId && portalTab === "spaces" && (
            <Button onClick={() => handleRequestNew()} className="gap-1.5">
              <Plus className="w-4 h-4" /> בקשה חדשה
            </Button>
          )}
        </div>

        <PortalTabs value={portalTab} onChange={setPortalTab} />

        {portalTab === "sleeping" ? <SleepingReportTab groupId={mechinaGroupId} /> : (<>
        <DateNav selectedDate={selectedDate} onDateChange={setSelectedDate} />

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-slate-700">זמינות מרחבים — {formatDate(selectedDate)}</h2>
          {loading ? (
            <div className="text-center py-10 text-slate-400 text-sm">טוען...</div>
          ) : (
            <MechinaSpaceAvailability spaces={bookableSpaces} activeBookings={activeBookings}
              pendingRequests={pendingRequests} blocks={spaceBlocks} selectedDate={selectedDate} isAdmin={false} allowCreateRequest={true} onRequestNew={handleRequestNew} groupMap={groupMap} />
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-slate-500" />
            <h2 className="text-base font-semibold text-slate-700">הבקשות שלי</h2>
          </div>
          {myRequests.length === 0 ? (
            <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center bg-white">
              <p className="text-sm text-slate-400">לא שלחת בקשות עדיין</p>
            </div>
          ) : (
            <div className="space-y-2">
              {myRequests.map(req => (
                <div key={req.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 space-y-0.5 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{req.activity_title}</p>
                    <p className="text-xs text-slate-500">{req.space_name} · {req.date} · {req.start_time}–{req.end_time}</p>
                    {(req.status === "REJECTED" || req.status === "CHANGE_REQUESTED") && req.admin_notes && (
                      <p className="text-xs text-slate-600 mt-1 bg-slate-50 rounded px-2 py-1">{req.admin_notes}</p>
                    )}
                    {req.status === "CANCELLATION_REQUESTED" && (
                      <p className="text-xs text-orange-600 mt-0.5">בקשת הביטול נשלחה ומחכה לאישור מנהל</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <StatusBadge status={req.status} />
                    {(req.status === "PENDING" || req.status === "CHANGE_REQUESTED") && (
                      <Button size="sm" variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-50 gap-1"
                        onClick={() => setActionModal({ type: "cancel", request: req })}>
                        <Ban className="w-3.5 h-3.5" /> בטל בקשה
                      </Button>
                    )}
                    {req.status === "APPROVED" && (
                      <Button size="sm" variant="outline" className="border-orange-300 text-orange-600 hover:bg-orange-50 gap-1"
                        onClick={() => setActionModal({ type: "request_cancel", request: req })}>
                        <Ban className="w-3.5 h-3.5" /> בקש ביטול
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        </>)}

        {actionModal && (
          <ActionConfirmModal
            title={actionModal.type === "cancel" ? "ביטול בקשה" : "בקשת ביטול להזמנה מאושרת"}
            description={actionModal.type === "cancel"
              ? `האם לבטל את הבקשה עבור "${actionModal.request.activity_title}"?`
              : `שליחת בקשת ביטול עבור "${actionModal.request.activity_title}" — המנהל יאשר או ידחה.`}
            reasonLabel={actionModal.type === "cancel" ? "סיבת ביטול (אופציונלי)" : "סיבת הביטול (אופציונלי)"}
            confirmLabel={actionModal.type === "cancel" ? "אשר ביטול" : "שלח בקשת ביטול"}
            confirmClass={actionModal.type === "cancel" ? "bg-slate-700 hover:bg-slate-800" : "bg-orange-600 hover:bg-orange-700"}
            onConfirm={handleActionConfirm}
            onClose={() => setActionModal(null)}
          />
        )}

        {modalOpen && mechinaGroupId && (
          <MechinaBookingRequestModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmitted={handleSubmitted}
            spaces={bookableSpaces} defaultDate={selectedDate} defaultSpaceId={preselectedSpaceId} mechinaGroupId={mechinaGroupId} />
        )}
      </div>
    );
  }

  // ── ADMIN / OPERATIONS VIEW ──────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8" dir="rtl">
      <div className="space-y-0.5">
        <h1 className="text-2xl font-heading font-semibold text-slate-800">ניהול בקשות מרחבים</h1>
        <p className="text-sm text-slate-500">פורטל מכינות — ניהול בקשות הזמנת מרחבי פעילות</p>
      </div>

      <PortalTabs value={portalTab} onChange={setPortalTab} />

      {portalTab === "sleeping" ? <AdminSleepingReports /> : (<>
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 space-y-1">
          <p className="text-xs text-slate-500">ממתינות לאישור</p>
          <p className="text-2xl font-bold text-amber-600">{myRequests.length}</p>
        </div>
        <div className="bg-white border border-orange-200 rounded-xl px-5 py-4 space-y-1">
          <p className="text-xs text-slate-500">בקשות ביטול</p>
          <p className="text-2xl font-bold text-orange-600">{cancellationRequests.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 space-y-1">
          <p className="text-xs text-slate-500">מאושרות</p>
          <p className="text-2xl font-bold text-emerald-600">{approvedRequests.length}</p>
        </div>
      </div>

      {/* Date navigator + availability */}
      <section className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-base font-semibold text-slate-700">זמינות מרחבים</h2>
          <DateNav selectedDate={selectedDate} onDateChange={setSelectedDate} />
        </div>
        {loading ? (
          <div className="text-center py-10 text-slate-400 text-sm">טוען...</div>
        ) : (
          <MechinaSpaceAvailability spaces={mechinaSpaces} activeBookings={activeBookings}
            pendingRequests={pendingRequests} blocks={spaceBlocks} selectedDate={selectedDate} isAdmin={true} allowCreateRequest={false} onRequestNew={handleRequestNew} groupMap={groupMap}
            canManageAvailability={canManageAvailability} onToggleAvailability={handleToggleAvailability} togglingSpaceId={togglingSpaceId} />
        )}
      </section>

      {/* Pending requests */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-700">בקשות ממתינות לאישור</h2>
          {myRequests.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-red-500 text-white text-xs font-bold px-1.5 leading-none">
              {myRequests.length}
            </span>
          )}
        </div>
        {myRequests.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl p-8 text-center bg-white">
            <ListChecks className="w-7 h-7 text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-400">אין בקשות ממתינות כרגע</p>
          </div>
        ) : (
          <div className="space-y-2">
            {myRequests.map(req => (
              <div key={req.id} className="bg-white border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 space-y-0.5 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{req.activity_title}</p>
                  <p className="text-xs text-slate-500">{req.space_name} · {req.date} · {req.start_time}–{req.end_time}</p>
                  <p className="text-xs text-slate-400">{req.requested_by_name || req.requested_by_email}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <StatusBadge status={req.status} />
                  <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 gap-1"
                    onClick={() => setDecisionModal({ mode: "reject", request: req })}>
                    <XCircle className="w-3.5 h-3.5" /> דחה
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-50 gap-1"
                    onClick={() => setActionModal({ type: "cancel", request: req })}>
                    <Ban className="w-3.5 h-3.5" /> בטל
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Cancellation requests */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-slate-700">בקשות ביטול ממתינות</h2>
          {cancellationRequests.length > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-orange-500 text-white text-xs font-bold px-1.5 leading-none">
              {cancellationRequests.length}
            </span>
          )}
        </div>
        {cancellationRequests.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center bg-white">
            <p className="text-sm text-slate-400">אין בקשות ביטול ממתינות</p>
          </div>
        ) : (
          <div className="space-y-2">
            {cancellationRequests.map(req => (
              <div key={req.id} className="bg-white border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 space-y-0.5 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{req.activity_title}</p>
                  <p className="text-xs text-slate-500">{req.space_name} · {req.date} · {req.start_time}–{req.end_time}</p>
                  <p className="text-xs text-slate-400">{req.requested_by_name || req.requested_by_email}</p>
                  {req.admin_notes && <p className="text-xs text-orange-700 mt-0.5">סיבה: {req.admin_notes}</p>}
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <StatusBadge status={req.status} />
                  <Button size="sm" className="bg-slate-700 hover:bg-slate-800 gap-1"
                    onClick={() => setResolveCancellationModal(req)}>
                    טיפול בבקשה
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Approved requests */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold text-slate-700">בקשות מאושרות</h2>
        {approvedRequests.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-xl p-6 text-center bg-white">
            <p className="text-sm text-slate-400">אין בקשות מאושרות כרגע</p>
          </div>
        ) : (
          <div className="space-y-2">
            {approvedRequests.map(req => (
              <div key={req.id} className="bg-white border border-emerald-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 space-y-0.5 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{req.activity_title}</p>
                  <p className="text-xs text-slate-500">{req.space_name} · {req.date} · {req.start_time}–{req.end_time}</p>
                  <p className="text-xs text-slate-400">{req.requested_by_name || req.requested_by_email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={req.status} />
                  <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50 gap-1"
                    onClick={() => setDecisionModal({ mode: "reject", request: req })}>
                    <XCircle className="w-3.5 h-3.5" /> דחה
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-300 text-slate-600 hover:bg-slate-50 gap-1"
                    onClick={() => setActionModal({ type: "cancel", request: req })}>
                    <Ban className="w-3.5 h-3.5" /> בטל הזמנה
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      </>)}

      {/* Action confirm modal (admin cancel) */}
      {actionModal && (
        <ActionConfirmModal
          title="ביטול בקשה"
          description={`האם לבטל את הבקשה עבור "${actionModal.request.activity_title}"?`}
          reasonLabel="סיבת ביטול (אופציונלי)"
          confirmLabel="אשר ביטול"
          confirmClass="bg-slate-700 hover:bg-slate-800"
          onConfirm={handleActionConfirm}
          onClose={() => setActionModal(null)}
        />
      )}

      {/* Resolve cancellation modal */}
      {resolveCancellationModal && (
        <ResolveCancellationModal
          request={resolveCancellationModal}
          onClose={() => setResolveCancellationModal(null)}
          onResolved={async () => { setResolveCancellationModal(null); await reloadAdminData(); }}
        />
      )}

      {/* Approve/reject decision modal */}
      {decisionModal && (
        <MechinaDecisionModal open={!!decisionModal} onClose={() => setDecisionModal(null)}
          onConfirm={handleDecision} mode={decisionModal.mode} request={decisionModal.request} />
      )}

      {modalOpen && (
        <MechinaBookingRequestModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmitted={handleSubmitted}
          spaces={bookableSpaces} defaultDate={selectedDate} defaultSpaceId={preselectedSpaceId} mechinaGroupId="" />
      )}
      <SpaceDeactivationDialog
        space={deactivationSpace}
        defaultStartDate={todayStr()}
        saving={!!togglingSpaceId}
        onClose={() => setDeactivationSpace(null)}
        onSubmit={handleDeactivateSpace}
      />
    </div>
  );
}