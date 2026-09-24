import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ChevronRight, Calendar, Users, Phone, Mail, Pencil, Plus, ClipboardList, Check, Printer, Link2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import GroupStatusBadge from "@/components/groups/GroupStatusBadge";
import GroupFormModal from "@/components/groups/GroupFormModal";

import GuestFormSubmissionModal from "@/components/groups/GuestFormSubmissionModal";
import SubmissionReviewModal from "@/components/groups/SubmissionReviewModal";
import OperationalProfileDisplay from "@/components/groups/OperationalProfileDisplay";
import OperationalHoldCard from "@/components/groups/OperationalHoldCard";
import SleepingRequirementsTab from "@/components/sleeping/SleepingRequirementsTab";
import ScheduleAndMealsTab from "@/components/schedule/ScheduleAndMealsTab";
import GroupLifecycleActions from "@/components/groups/GroupLifecycleActions";
import RoleGate from "@/components/RoleGate";
import ReviewAlertsBanner from "@/components/alerts/ReviewAlertsBanner";
import CoffeeAndPrisaTab from "@/components/coffee/CoffeeAndPrisaTab";
import PostStayTab from "@/components/post-stay/PostStayTab";
import MechinaUsersSection from "@/components/mechina/MechinaUsersSection";
import MealDateRangeWarning from "@/components/groups/MealDateRangeWarning";
import OperationalProfileAction from "@/components/groups/OperationalProfileAction";
import OperationalActivationAction from "@/components/groups/OperationalActivationAction";
import MultiPeriodActivationAction from "@/components/groups/MultiPeriodActivationAction";
import QuoteSyncButton from "@/components/quotes/QuoteSyncButton";
import MechinaMovementSummary from "@/components/groups/MechinaMovementSummary";
import ActiveStayPeriodsDialog from "@/components/groups/ActiveStayPeriodsDialog";
import { updateQuotePreparationCache, invalidateQuotePreparationCache } from "@/lib/quotePreparationCache";
import { useRoleContext } from "@/lib/RoleContext";

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { role } = useRoleContext();
  const isQuotesManager = role === "QUOTES_MANAGER";

  const [editGroup, setEditGroup] = useState(false);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [editSubmission, setEditSubmission] = useState(null);
  const [reviewSubmission, setReviewSubmission] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [editActivePeriods, setEditActivePeriods] = useState(false);

  const { data: group } = useQuery({
    queryKey: ["group", id],
    queryFn: () => base44.entities.Group.filter({ id }),
    select: (r) => r[0],
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["operationalProfile", id],
    queryFn: () => base44.entities.OperationalGroupProfile.filter({ group_id: id }),
    enabled: !!id,
  });
  const operationalProfile = profiles[0];

  const handleOperationalActivation = ({ quote, group: updatedGroup, profile }) => {
    updateQuotePreparationCache(queryClient, { quote, group: updatedGroup, profile });
    invalidateQuotePreparationCache(queryClient, id);
    requestAnimationFrame(() => document.getElementById("operational-profile")?.scrollIntoView({ behavior: "smooth" }));
  };

  const { data: quotes = [] } = useQuery({
    queryKey: ["quotes", id],
    queryFn: () => base44.entities.Quote.filter({ group_id: id }),
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ["submissions", id],
    queryFn: () => base44.entities.GuestFormSubmission.filter({ group_id: id }),
  });

  const refetch = () => {
    invalidateQuotePreparationCache(queryClient, id);
    queryClient.invalidateQueries({ queryKey: ["submissions", id] });
  };

  const activeQuote = quotes.find(q => q.status === "APPROVED") || quotes[0];


  // Regenerate + copy a new tokenized direct group link
  const [copiedDirectLink, setCopiedDirectLink] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);

  const { data: formLinks = [] } = useQuery({
    queryKey: ["formLinks", id],
    queryFn: () => base44.entities.GroupExternalFormLink.filter({ group_id: id }),
    enabled: !!id,
  });
  const lastActiveLink = formLinks.filter(l => l.status === 'ACTIVE').sort((a, b) => (b.created_date || '').localeCompare(a.created_date || ''))[0];

  const regenerateAndCopyLink = async () => {
    setGeneratingLink(true);
    try {
      const res = await base44.functions.invoke("regenerateGuestFormLink", { group_id: id });
      const { url } = res.data;
      await navigator.clipboard.writeText(url);
      setCopiedDirectLink(true);
      setTimeout(() => setCopiedDirectLink(false), 3000);
      toast.success("קישור חדש נוצר והועתק");
      queryClient.invalidateQueries({ queryKey: ["formLinks", id] });
    } catch (err) {
      toast.error(err?.response?.data?.error || "יצירת הקישור נכשלה");
    } finally {
      setGeneratingLink(false);
    }
  };



  if (!group) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const isPreparation = group.quote_preparation_flow === true && group.status !== "CONFIRMED";
  const canActivateOperationally = group.quote_preparation_flow === true && ["DRAFT", "PENDING_APPROVAL"].includes(group.status);
  const canActivateMultiPeriod = group.stay_mode === "MULTI_PERIOD" && group.status === "DRAFT" && group.operationally_active === false && group.quote_preparation_flow === false;
  const isActivatedMultiPeriod = group.stay_mode === "MULTI_PERIOD" && group.status === "CONFIRMED" && group.operationally_active === true;

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            <Link to="/groups" className="hover:text-foreground flex items-center gap-1">
              <ChevronRight className="w-4 h-4" /> קבוצות
            </Link>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold">{group.group_name}</h1>
                  <GroupStatusBadge status={group.status} />
                  {group.group_type === 'DAY_USE' ? (
                    <span className="text-xs bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded-full font-semibold">🎓 פעילות יום</span>
                  ) : (
                    <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full font-medium">🛏️ לינה</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                  {group.arrival_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {format(new Date(group.arrival_date), "dd/MM/yyyy")}
                      {group.arrival_time && <span className="text-emerald-600 font-medium">· {group.arrival_time}</span>}
                      {group.departure_date && ` — ${format(new Date(group.departure_date), "dd/MM/yyyy")}`}
                      {group.departure_time && <span className="text-orange-500 font-medium">· {group.departure_time}</span>}
                    </span>
                  )}
                  {group.total_pax && <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{group.total_pax} משתתפים</span>}
                  {group.contact_phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{group.contact_phone}</span>}
                  {group.contact_email && <span className="flex items-center gap-1 break-all"><Mail className="w-3.5 h-3.5" />{group.contact_email}</span>}
                </div>
              </div>
            </div>
            {/* Action buttons — stack on mobile */}
            <div className="flex flex-wrap gap-2">
              <RoleGate permission="GENERATE_REPORTS">
                <Button variant="outline" size="sm" onClick={() => window.open(`/groups/${id}/operational-summary-print`, "_blank")} className="gap-1 flex-shrink-0">
                  <Printer className="w-3.5 h-3.5" /> הפק סיכום קבוצה
                </Button>
              </RoleGate>
              <RoleGate permission="EDIT_GROUP">
                <Button variant="outline" size="sm" onClick={() => setEditGroup(true)} className="gap-1 flex-shrink-0">
                  <Pencil className="w-3.5 h-3.5" /> עריכה
                </Button>
              </RoleGate>
            </div>
          </div>
        </div>
      </div>

      {/* Review alerts for this group — grouped by source to avoid 3 duplicate cards */}
      {!isQuotesManager && <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4">
        <ReviewAlertsBanner groupId={id} grouped />
      </div>}

      {/* Tab navigation */}
      <div className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-0">
          {[
            { key: "overview", label: "סקירה כללית" },
            ...(!isQuotesManager && !isPreparation ? [
              { key: "schedule", label: "📅 לוח זמנים וארוחות" },
              { key: "coffee", label: "☕ קפה / פריסה" },
              { key: "sleeping", label: "🛏️ דרישות לינה" },
              { key: "post-stay", label: "📝 סיכום שהייה" },
            ] : []),
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {activeTab === "sleeping" && <SleepingRequirementsTab groupId={id} profile={operationalProfile} group={group} />}
        {activeTab === "post-stay" && <PostStayTab groupId={id} profile={operationalProfile} group={group} />}
        {activeTab === "coffee" && (
          <CoffeeAndPrisaTab
            groupId={id}
            profile={operationalProfile}
            group={group}
          />
        )}
        {activeTab === "schedule" && (
          <ScheduleAndMealsTab
            groupId={id}
            profile={operationalProfile}
            group={group}
            quotes={quotes}
            guestFormSubmission={submissions.find(s => s.status === "SUBMITTED" || s.status === "REVIEWED") || submissions[0] || null}
          />
        )}

        {activeTab === "overview" && <>

        {isPreparation && <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3"><div><p className="font-semibold text-violet-800">קבוצה בהכנה</p><p className="text-xs text-violet-600 mt-1">הקבוצה עדיין אינה פעילה במודולים התפעוליים.</p></div>{canActivateOperationally && <RoleGate roles={["SUPER_ADMIN", "ADMIN"]}><OperationalActivationAction groupId={id} onActivated={handleOperationalActivation} /></RoleGate>}</div>}
        {canActivateMultiPeriod && <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3"><div><p className="font-semibold text-blue-800">טיוטת מכינה רב־תקופתית</p><p className="text-xs text-blue-700 mt-1">המכינה אינה פעילה עדיין במודולים התפעוליים.</p></div><RoleGate roles={["SUPER_ADMIN", "ADMIN"]}><MultiPeriodActivationAction groupId={id} onActivated={refetch} /></RoleGate></div>}
        {isActivatedMultiPeriod && <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3"><div><p className="font-semibold text-amber-800">המכינה פעילה</p><p className="text-xs text-amber-700 mt-1">שינוי תקופות מתבצע במסלול מבוקר עם בדיקת השפעות ואישור מפורש.</p></div><RoleGate roles={["SUPER_ADMIN", "ADMIN"]}><Button variant="outline" size="sm" onClick={() => setEditActivePeriods(true)} className="flex-shrink-0">עריכת תקופות שהייה</Button></RoleGate></div>}

        {/* Meal date range warning — shown when active meals exist outside current stay */}
        <RoleGate permission="EDIT_GROUP">
          <MealDateRangeWarning group={group} />
        </RoleGate>

        {/* Mechina movement summary — MULTI_PERIOD groups only */}
        {group.stay_mode === "MULTI_PERIOD" && <MechinaMovementSummary groupId={id} />}

        {/* Summary Bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-bold">{group.total_pax || 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">משתתפים</p>
          </div>
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-bold">{operationalProfile ? "✓" : "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">פרופיל תפעולי</p>
          </div>
          <div className="bg-card border border-border rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-bold">{submissions.length}</p>
            <p className="text-xs text-muted-foreground mt-0.5">טפסי קבלה</p>
          </div>
        </div>

        {/* GuestFormSubmissions Section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2"><ClipboardList className="w-4 h-4" /> טפסי קבלה</h2>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Regenerate tokenized direct group link */}
              <RoleGate permission="CREATE_GUEST_LINK">
                <div className="flex flex-col items-end gap-0.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={regenerateAndCopyLink}
                    disabled={generatingLink}
                    className={`gap-1 transition-colors ${copiedDirectLink ? "border-green-400 text-green-600 bg-green-50" : "border-blue-300 text-blue-700 hover:bg-blue-50"}`}
                  >
                    {copiedDirectLink
                      ? <><Check className="w-3 h-3" /> הועתק!</>
                      : generatingLink
                        ? <><Link2 className="w-3 h-3" /> יוצר...</>
                        : <><Link2 className="w-3 h-3" /> חדש קישור טופס</>
                    }
                  </Button>
                  {lastActiveLink?.created_date && (
                    <span className="text-xs text-muted-foreground">
                      קישור אחרון: {format(new Date(lastActiveLink.created_date), "dd/MM/yyyy")}
                    </span>
                  )}
                </div>
              </RoleGate>
              <RoleGate permission="EDIT_GROUP">
                <Button size="sm" variant="outline" onClick={() => { setEditSubmission(null); setShowSubmissionForm(true); }} className="gap-1">
                  <Plus className="w-3.5 h-3.5" /> טופס חדש
                </Button>
              </RoleGate>
            </div>
          </div>
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">אין טפסי קבלה עדיין.</p>
          ) : (
            <div className="space-y-2">
              {submissions.map(s => (
                <div key={s.id} className="bg-card border border-border rounded-xl px-4 py-3 flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{s.contact_name || "ללא שם"}</span>
                      <span className={`text-xs px-2 py-0.5 rounded border ${s.status === "REVIEWED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : s.status === "SUBMITTED" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {s.status === "REVIEWED" ? "נבדק" : s.status === "SUBMITTED" ? "הוגש" : "ממתין"}
                      </span>
                    </div>
                    {s.total_pax && <p className="text-xs text-muted-foreground">{s.total_pax} משתתפים · {s.submitted_at ? format(new Date(s.submitted_at), "dd/MM/yyyy") : ""}</p>}
                  </div>
                  {!isQuotesManager && <Button size="sm" variant="outline" onClick={() => setReviewSubmission(s)} className="gap-1">
                    <Pencil className="w-3 h-3" /> צפייה / עריכה
                  </Button>}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Operational Profile */}
        <div id="operational-profile" className="space-y-3">
          {!isQuotesManager && group.status === "CONFIRMED" && operationalProfile && <div className="flex justify-end gap-2"><QuoteSyncButton quote={activeQuote} group={group} profile={operationalProfile} onSynced={refetch} /><OperationalProfileAction groupId={id} profile={operationalProfile} onOpen={() => document.getElementById("operational-profile")?.scrollIntoView({ behavior: "smooth" })} /></div>}
          <OperationalProfileDisplay groupId={id} group={group} provisional={isPreparation} />
        </div>

        {/* Operational Hold — admin debug card */}
        {!isQuotesManager && <OperationalHoldCard groupId={id} />}

        {/* Internal Notes */}
        {group.internal_notes && (
          <section className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">הערות פנימיות</p>
            <p className="text-sm text-amber-900">{group.internal_notes}</p>
          </section>
        )}

        {/* Mechina Users — admin only */}
        <RoleGate roles={["SUPER_ADMIN", "ADMIN", "OPERATIONS"]}>
          <MechinaUsersSection groupId={id} groupName={group.group_name} />
        </RoleGate>

        {/* Lifecycle Actions */}
        {!isQuotesManager && <GroupLifecycleActions
          group={group}
          onDeleted={() => navigate("/groups")}
          onUpdated={refetch}
        />}

        </>}
      </div>

      {/* Non-commercial modals */}
      <ActiveStayPeriodsDialog open={editActivePeriods} groupId={id} onClose={() => setEditActivePeriods(false)} onApplied={() => { refetch(); queryClient.invalidateQueries({ queryKey: ["groupStayPeriods"] }); queryClient.invalidateQueries({ queryKey: ["groups"] }); queryClient.invalidateQueries({ queryKey: ["sleepingSeriesValidation", id] }); queryClient.invalidateQueries({ queryKey: ["sleepingAllocations"] }); queryClient.invalidateQueries({ queryKey: ["mealReservations"] }); }} />
      {editGroup && <GroupFormModal group={group} initialProfileDiets={operationalProfile?.special_diets || null} onClose={() => setEditGroup(false)} onSaved={() => { refetch(); setEditGroup(false); }} />}
      {reviewSubmission && !showSubmissionForm && (
        <SubmissionReviewModal
          submission={reviewSubmission}
          quoteData={activeQuote}
          onClose={() => setReviewSubmission(null)}
          onEdit={() => { setEditSubmission(reviewSubmission); setShowSubmissionForm(true); setReviewSubmission(null); }}
          onSaved={() => { refetch(); setReviewSubmission(null); }}
        />
      )}
      {showSubmissionForm && (
        <GuestFormSubmissionModal
          submission={editSubmission}
          quoteId={activeQuote?.id || quotes[0]?.id}
          groupId={id}
          onClose={() => { setShowSubmissionForm(false); setEditSubmission(null); }}
          onSaved={() => { refetch(); setShowSubmissionForm(false); setEditSubmission(null); }}
        />
      )}
    </div>
  );
}