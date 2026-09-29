import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2, Wrench } from "lucide-react";

function statusIcon(status) {
  switch (status) {
    case "completed":
    case "success":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    case "failed":
    case "error":
      return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    case "pending":
    case "running":
    case "in_progress":
      return <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />;
    default:
      return <Loader2 className="w-3.5 h-3.5 text-slate-400" />;
  }
}

function statusLabel(status) {
  switch (status) {
    case "completed":
    case "success":
      return "הושלם";
    case "failed":
    case "error":
      return "שגיאה";
    case "pending":
      return "ממתין";
    case "running":
    case "in_progress":
      return "מבצע";
    default:
      return status || "";
  }
}

function toolDisplayName(name) {
  const map = {
    getLogisticsOperationalContext: "קריאת הקשר תפעולי",
  };
  return map[name] || name || "כלי";
}

function FunctionDisplay({ toolCall }) {
  const [expanded, setExpanded] = useState(false);
  const failed = ["failed", "error"].includes(toolCall?.status) || /error|failed/i.test(String(toolCall?.results || ""));
  const hide = toolCall?.display_projection?.hide_details && toolCall?.display_projection?.details_redacted;

  if (hide) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-400">
        {statusIcon(toolCall?.status)}
        <span>{toolCall?.display_projection?.active_label || toolCall?.display_projection?.label || toolDisplayName(toolCall?.name)}</span>
      </div>
    );
  }

  let parsedResults = toolCall?.results;
  try { parsedResults = JSON.parse(toolCall?.results); } catch { /* keep raw */ }

  return (
    <div className="mt-2 text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 transition-colors"
      >
        {statusIcon(toolCall?.status)}
        <span>{toolDisplayName(toolCall?.name)}</span>
        <span className={`text-[10px] ${failed ? "text-red-400" : "text-slate-400"}`}>· {statusLabel(toolCall?.status)}</span>
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 bg-slate-50 rounded-lg p-2 border border-slate-100">
          {toolCall?.arguments_string && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 mb-0.5">פרמטרים:</p>
              <pre className="text-[10px] text-slate-600 whitespace-pre-wrap break-words">{toolCall.arguments_string}</pre>
            </div>
          )}
          {parsedResults && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 mb-0.5">תוצאה:</p>
              <pre className="text-[10px] text-slate-600 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                {typeof parsedResults === "string" ? parsedResults : JSON.stringify(parsedResults, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";
  return (
    <div className={isUser ? "flex justify-end" : "flex justify-start"}>
      <div className={`max-w-[85%] ${isUser ? "" : "w-full"}`}>
        {message.content && (
          isUser ? (
            <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
              {message.content}
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm shadow-sm">
              <ReactMarkdown className="prose prose-sm prose-slate max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-sm">
                {message.content}
              </ReactMarkdown>
            </div>
          )
        )}
        {message.tool_calls?.map((toolCall, idx) => (
          <FunctionDisplay key={idx} toolCall={toolCall} />
        ))}
      </div>
    </div>
  );
}