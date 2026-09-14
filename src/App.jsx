import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import AppNav from './components/AppNav';
import { Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { RoleProvider, useRoleContext } from '@/lib/RoleContext';
import RouteGuard from '@/components/RouteGuard';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
// Add page imports here
import Inventory from "./pages/Inventory";
import Groups from "./pages/Groups.jsx";
import GroupDetail from "./pages/GroupDetail";
import GuestForm from "./pages/GuestForm.jsx";
import ApprovedGroups from "./pages/ApprovedGroups.jsx";
import Admin from "./pages/Admin.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Calendar from "./pages/Calendar.jsx";
import Housekeeping from "./pages/Housekeeping.jsx";
import Kitchen from "./pages/Kitchen.jsx";
import Maintenance from "./pages/Maintenance.jsx";
import Allocation from "./pages/Allocation.jsx";
import KitchenReport from "./pages/KitchenReport.jsx";
import CleaningHours from "./pages/CleaningHours.jsx";
import CleaningReport from "./pages/CleaningReport.jsx";
import CommonSpaces from "./pages/CommonSpaces.jsx";
import OperationalSummaryPrint from "./pages/OperationalSummaryPrint.jsx";
import DailyOperationalPrint from "./pages/DailyOperationalPrint.jsx";
import UserManagement from "./pages/UserManagement.jsx";
import MechinaSpaces from "./pages/MechinaSpaces.jsx";
import MeetingSummaries from "./pages/MeetingSummaries.jsx";
import WorkSchedule from "./pages/WorkSchedule.jsx";
import MyShifts from "./pages/MyShifts.jsx";
import AnalyticsDashboard from "./pages/AnalyticsDashboard.jsx";
import Quotes from "./pages/Quotes.jsx";
import AuthenticatedSnapshotFallback from "@/components/snapshots/AuthenticatedSnapshotFallback";

// Landing page resolver — MAINTENANCE users go straight to the maintenance module,
// everyone else sees the Dashboard.
const HomeLanding = () => {
  const { role } = useRoleContext();
  if (role === "MAINTENANCE") return <Navigate to="/maintenance" replace />;
  return <Dashboard />;
};

const AuthenticatedApp = () => {
  const { isLoadingPublicSettings } = useAuth(); // Auth loading handled by RouteGuard

  // Loading app settings
  if (isLoadingPublicSettings) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Render app — RouteGuard handles auth check + login screen + role check
  return (
    <RoleProvider>
      <AuthenticatedSnapshotFallback />
      <AppNav />
      <Routes>
        <Route path="/" element={<RouteGuard><HomeLanding /></RouteGuard>} />
        <Route path="/inventory" element={<RouteGuard><Inventory /></RouteGuard>} />
        <Route path="/groups" element={<RouteGuard><Groups /></RouteGuard>} />
        <Route path="/quotes" element={<RouteGuard><Quotes /></RouteGuard>} />
        <Route path="/groups/:id" element={<RouteGuard><GroupDetail /></RouteGuard>} />
        <Route path="/groups/:id/operational-summary-print" element={<RouteGuard><OperationalSummaryPrint /></RouteGuard>} />
        <Route path="/daily-print" element={<RouteGuard><DailyOperationalPrint /></RouteGuard>} />
        <Route path="/approved-groups" element={<RouteGuard><ApprovedGroups /></RouteGuard>} />
        <Route path="/admin" element={<RouteGuard><Admin /></RouteGuard>} />
        <Route path="/admin/users" element={<RouteGuard><UserManagement /></RouteGuard>} />
        <Route path="/dashboard" element={<RouteGuard><Dashboard /></RouteGuard>} />
        <Route path="/calendar" element={<RouteGuard><Calendar /></RouteGuard>} />
        <Route path="/housekeeping" element={<RouteGuard><Housekeeping /></RouteGuard>} />
        <Route path="/kitchen" element={<RouteGuard><Kitchen /></RouteGuard>} />
        <Route path="/maintenance" element={<RouteGuard><Maintenance /></RouteGuard>} />
        <Route path="/allocation" element={<RouteGuard><Allocation /></RouteGuard>} />
        <Route path="/common-spaces" element={<RouteGuard><CommonSpaces /></RouteGuard>} />
        <Route path="/kitchen-report" element={<RouteGuard><KitchenReport /></RouteGuard>} />
        <Route path="/cleaning-hours" element={<RouteGuard><CleaningHours /></RouteGuard>} />
        <Route path="/cleaning-report" element={<RouteGuard><CleaningReport /></RouteGuard>} />
        <Route path="/mechina-spaces" element={<RouteGuard><MechinaSpaces /></RouteGuard>} />
        <Route path="/meeting-summaries" element={<RouteGuard><MeetingSummaries /></RouteGuard>} />
        <Route path="/work-schedule" element={<RouteGuard><WorkSchedule /></RouteGuard>} />
        <Route path="/my-shifts" element={<RouteGuard><MyShifts /></RouteGuard>} />
        <Route path="/analytics" element={<RouteGuard><AnalyticsDashboard /></RouteGuard>} />
        {/* Add your page Route elements here */}
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </RoleProvider>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <Routes>
            {/* Public route — no auth required */}
            <Route path="/guest-form" element={<GuestForm />} />
            {/* All other routes require auth */}
            <Route path="/*" element={<AuthenticatedApp />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App