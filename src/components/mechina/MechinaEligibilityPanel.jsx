import MechinaEligibilityControl from '@/components/mechina/MechinaEligibilityControl';

export default function MechinaEligibilityPanel({ spaces, onChanged }) {
  return <section className="space-y-3 rounded-xl border border-border bg-card p-4">
    <h2 className="text-base font-semibold">בקשות מכינה — ניהול הרשאת בקשות</h2>
    <p className="text-sm text-muted-foreground">הגדרה קבועה לבקשות מכינה חדשות בלבד, ללא קשר לתאריך. חסימה דוחה גם בקשות ממתינות; הזמנות מאושרות אינן משתנות.</p>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{spaces.map(space => <MechinaEligibilityControl key={space.id} space={space} onChanged={onChanged} />)}</div>
  </section>;
}