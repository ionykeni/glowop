import React from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

export default function OperationMessage({ message, onClose }) {
  if (!message) return null;
  const ok = message.type === "ok";
  return (
    <div className={`border rounded-lg p-3 text-sm flex items-start gap-2 ${ok ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
      {ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
      <div className="flex-1 space-y-1">
        <div>{message.text}</div>
        {message.warning && <div className="text-yellow-800">{message.warning}</div>}
        {message.blockers?.length > 0 && <ul className="list-disc pr-4">{message.blockers.map((b, i) => <li key={i}>{typeof b === "string" ? b : (b.reasons || []).join(" · ")}</li>)}</ul>}
      </div>
      <button onClick={onClose} className="opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
    </div>
  );
}