/**
 * RouteGuard — wraps a page route and blocks access based on auth + role.
 * Flow: loading → not authenticated (show login) → role check → allow
 */
import { useRoleContext } from "@/lib/RoleContext";
import { useAuth } from "@/lib/AuthContext";
import { canAccessRoute } from "@/lib/roles";
import { isLogisticsManager } from "@/lib/logisticsAssistantConfig";
import { useLocation } from "react-router-dom";
import { ShieldOff, LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

export default function RouteGuard({ children }) {
  const { role, isLoadingRole, roleError } = useRoleContext();
  const { isAuthenticated, isLoadingAuth, user } = useAuth();
  const { pathname } = useLocation();

  // 1. Still loading auth or role
  if (isLoadingAuth || isLoadingRole) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 2. Not authenticated — show login screen
  if (!isAuthenticated || !user?.email) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-5 max-w-sm">
          <div className="flex justify-center">
            <div className="bg-primary/10 rounded-full p-4">
              <LogIn className="w-8 h-8 text-primary" />
            </div>
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-foreground">כניסה למערכת</h1>
            <p className="text-muted-foreground text-sm">יש להתחבר עם משתמש מורשה כדי להמשיך</p>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => base44.auth.redirectToLogin(window.location.href)}
          >
            <LogIn className="w-4 h-4" />
            התחבר למערכת
          </Button>
          <p className="text-xs text-muted-foreground font-mono">
            מצב: לא מחובר
          </p>
        </div>
      </div>
    );
  }

  // 3. Authenticated but inactive user
  if (roleError === "inactive") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3 max-w-sm">
          <ShieldOff className="w-12 h-12 text-amber-500 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">המשתמש אינו פעיל</h1>
          <p className="text-muted-foreground text-sm">חשבונך הושבת. פנה למנהל המערכת.</p>
          <p className="text-xs text-muted-foreground font-mono">{user.email}</p>
        </div>
      </div>
    );
  }

  // 3.5 Technical failure loading the role — show retry instead of a false "no permission"
  if (roleError === "load_failed") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3 max-w-sm">
          <Loader2 className="w-10 h-10 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold text-foreground">שגיאה זמנית בטעינת ההרשאות</h1>
          <p className="text-muted-foreground text-sm">לא הצלחנו לאמת את ההרשאות שלך. נסה שוב.</p>
          <Button onClick={() => window.location.reload()} className="gap-2">
            נסה שוב
          </Button>
          <p className="text-xs text-muted-foreground font-mono">{user.email}</p>
        </div>
      </div>
    );
  }

  // 3.8 Private logistics assistant — authorization is the exact authenticated email only.
  if (pathname.startsWith("/logistics-assistant")) {
    return isLogisticsManager(user.email) ? children : (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3 max-w-sm">
          <ShieldOff className="w-12 h-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold text-foreground">אין הרשאה לצפייה בדף זה</h1>
        </div>
      </div>
    );
  }

  // 4. Authenticated but not found in InternalUser
  if (roleError === "not_found" || !role) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3 max-w-sm">
          <ShieldOff className="w-12 h-12 text-destructive mx-auto" />
          <h1 className="text-xl font-bold text-foreground">אין לך הרשאה למערכת</h1>
          <p className="text-muted-foreground text-sm">
            המשתמש שלך אינו רשום במערכת. פנה למנהל לקבלת גישה.
          </p>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-2 font-mono">
            מחובר כ: {user.email}
          </p>
        </div>
      </div>
    );
  }

  // 5. Authenticated + has role, but can't access this route
  if (!canAccessRoute(role, pathname)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3 max-w-sm">
          <ShieldOff className="w-12 h-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-bold text-foreground">אין הרשאה לצפייה בדף זה</h1>
          <p className="text-muted-foreground text-sm">אין לך הרשאה לגשת לדף זה עם התפקיד הנוכחי שלך.</p>
        </div>
      </div>
    );
  }

  return children;
}