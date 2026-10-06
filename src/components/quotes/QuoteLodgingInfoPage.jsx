import { LegalFooter } from "./QuotePdfTemplate";

const HEADING_FONT = '"Kav16", "Arial Hebrew", Arial, sans-serif';
const BODY_FONT = '"SimplerPro", "Arial Hebrew", Arial, sans-serif';
const BLUE = "#1a56a0";

// Fixed lodging information (supplied text — do not rewrite). "h" = section heading.
const INFO = [
  ["p", "שלום רב,"],
  ["p", "נשמח לארח את סמינר התלמידים שלכם בבית הדור הבא!"],
  ["h", "אירוח ולינה במתחם"],
  ["p", "אוהלי צוות: ממוקמים בשכונה נפרדת ומבודדת בסמוך לחדר האוכל. האוהלים כוללים 3–4 מיטות ותאי שירותים ומקלחת צמודים. צוותי החינוך מקבלים מצעים מלאים, כולל שמיכה וכרית (ללא מגבות)."],
  ["p", "אוהלי תלמידים: כוללים 6–8 מיטות יחיד או קומתיים. כל ארבעה אוהלים מתוכננים כ\"שכונה\", שבמרכזה מעגל ישיבה עם מדורה אקולוגית ותאי שירותים צמודים. האוהלים כוללים מיטה ומזרן בלבד – על התלמידים להביא מצעים מלאים, שמיכה וכרית."],
  ["p", "מתחם השירותים והמקלחות המרכזי: ממוקם בסמוך לחדר האוכל וכולל 11 תאי מקלחת אישיים וננעלים לכל מגדר, וכן תא מקלחת נגיש לכל מגדר. בנוסף, קיימים תאי שירותים נוספים הפזורים ברחבי המתחם."],
  ["p", "המטבח הכשר שלנו מגיש שלוש ארוחות ביום: ארוחות בוקר וערב חלביות וארוחת צהריים בשרית חמה. אנו מספקים מענה מצוין לצמחונים, טבעונים ולנמנעים מגלוטן (שימו לב: המטבח אינו סטרילי לאלרגנים)."],
  ["p", "כדי לשמור על רמת השירות והכשרות, כלל הארוחות מסופקות באופן בלעדי על ידי המטבח שלנו. לא מתאפשרת הכנסת קייטרינג חיצוני או בישול עצמי במתחם."],
  ["h", "חללי פעילות ולמידה"],
  ["p", "בבית שש כיתות פעילות בגדלים שונים, המתאימות ל־25–55 משתתפים. החדרים מצוידים במקרן, מערכת סאונד ומסך."],
  ["p", "אוהל מועד: מתחם פעילות מרכזי המתאים לעד 120 משתתפים."],
  ["p", "הפעילות מותנית בתיאום מראש."],
  ["p", "נשמח לעמוד לרשותכם לכל שאלה ולתכנן יחד את הסמינר שלכם!"],
];

const headingStyle = { fontSize: 14, fontWeight: 700, fontFamily: HEADING_FONT, color: BLUE, borderBottom: `2px solid ${BLUE}`, paddingBottom: 4, marginTop: 14, marginBottom: 8, breakAfter: "avoid", pageBreakAfter: "avoid" };
const paraStyle = { margin: "0 0 8px 0", fontSize: 12, lineHeight: 1.7, fontFamily: BODY_FONT, color: "#1a1a1a" };

const pageStyle = {
  width: "210mm",
  minHeight: "297mm",
  padding: "14mm 16mm 36mm 16mm",
  boxSizing: "border-box",
  direction: "rtl",
  background: "#fff",
  position: "relative",
  pageBreakBefore: "always",
  breakBefore: "page",
  pageBreakAfter: "always",
  breakAfter: "page",
  fontFamily: BODY_FONT,
  color: "#1a1a1a",
};

/** Page 2 for LODGING Quotes: always starts on a new page; long notes flow onto following pages. */
export default function QuoteLodgingInfoPage({ clientNotes }) {
  return (
    <div style={pageStyle}>
      {INFO.map(([kind, text], i) => kind === "h"
        ? <div key={i} style={headingStyle}>{text}</div>
        : <p key={i} style={paraStyle}>{text}</p>)}
      {clientNotes?.trim() && <>
        <div style={headingStyle}>הערות</div>
        <div style={{ ...paraStyle, whiteSpace: "pre-wrap" }}>{clientNotes}</div>
      </>}
      <LegalFooter />
    </div>
  );
}