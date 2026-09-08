import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import RoleGate from "@/components/RoleGate";

export default function QuoteDeleteButton({ quote, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    if (!window.confirm("האם למחוק את הצעת המחיר?\nלא ניתן לבטל פעולה זו.")) return;
    setDeleting(true);
    try {
      const response = await base44.functions.invoke("deleteQuote", { quote_id: quote.id });
      if (!response.data?.success) throw Object.assign(new Error(response.data?.message), { code: response.data?.error });
      toast.success("הצעת המחיר נמחקה בהצלחה");
      onDeleted?.(quote.id, response.data.group_id);
    } catch (error) {
      const code = error?.response?.data?.error || error?.code;
      toast.error(code === "BUSINESS_INTEGRITY_BLOCK"
        ? "לא ניתן למחוק הצעה שכבר יצרה פעילות תפעולית. המידע התפעולי נשמר ללא שינוי."
        : "מחיקת הצעת המחיר נכשלה");
    } finally {
      setDeleting(false);
    }
  };
  return <RoleGate permission="DELETE_QUOTE"><Button size="sm" variant="ghost" className="text-destructive" onClick={remove} disabled={deleting}><Trash2 className="w-3.5 h-3.5" />{deleting ? "מוחק..." : "מחיקה"}</Button></RoleGate>;
}