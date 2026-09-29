import { useAuth } from "@/lib/AuthContext";
import LogisticsChatPage from "@/components/logistics/LogisticsChatPage";
import { isLogisticsManager } from "@/lib/logisticsAssistantConfig";

export default function LogisticsAssistant() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm" dir="rtl">
        טוען...
      </div>
    );
  }

  if (!isLogisticsManager(user.email)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center" dir="rtl">
        <p className="text-sm font-semibold text-slate-600">אין גישה</p>
        <p className="text-xs text-slate-400">דף זה אינו זמין עבור המשתמש שלך.</p>
      </div>
    );
  }

  return <LogisticsChatPage userEmail={user.email} />;
}