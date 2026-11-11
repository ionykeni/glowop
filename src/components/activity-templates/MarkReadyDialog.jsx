import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function MarkReadyDialog({ open, onOpenChange, stationCount, onConfirm }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl" className="activity-day-ui activity-day-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-right">לסמן את הגרסה כמוכנה?</AlertDialogTitle>
          <AlertDialogDescription className="text-right space-y-2">
            <span className="block">אישרתי שהתבנית כוללת את כל {stationCount} התחנות של התוכנית ושהפרטים נבדקו.</span>
            <span className="block">לאחר הסימון לא ניתן לשנות גרסה זו. שינויים עתידיים ייצרו גרסה חדשה.</span>
            <span className="block font-medium">הפעולה אינה יוצרת הזמנות או פעילויות.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>שמור וסמן כמוכנה</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}