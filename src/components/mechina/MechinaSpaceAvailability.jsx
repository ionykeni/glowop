/**
 * MechinaSpaceAvailability
 * Visual daily availability grid for common spaces.
 *
 * Time axis implementation:
 * - The time labels are NOT a grid column.
 * - They are a position:sticky overlay INSIDE the overflow-x-auto container,
 *   pinned to the right edge of the visible viewport via `right: 0`.
 * - This means: no matter how far the user scrolls horizontally,
 *   the hour labels remain visible at the right edge of the scroll container.
 * - The spaces grid has padding-right equal to the axis width so the
 *   rightmost space column is never hidden under the labels.
 */

import { BLOCK_REASON_LABELS, blockAppliesOnDate } from "@/lib/activitySpaceBlocks";
import AdminSpaceStatusControl from "@/components/mechina/AdminSpaceStatusControl";

const HOUR_START   = 6;
const HOUR_END     = 23;
const HOURS        = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const TOTAL_HEIGHT = 680; // px — total grid body height
const AXIS_WIDTH   = 52;  // px — floating time axis width
const COL_WIDTH    = 140; // px — each space column width
const HEADER_H     = 40;  // px — space name header height

// ── Deterministic color palette ───────────────────────────────────────────────
const COLOR_PALETTE = [
  { bg: "#dbeafe", border: "#3b82f6", text: "#1e3a8a" },
  { bg: "#dcfce7", border: "#22c55e", text: "#14532d" },
  { bg: "#fce7f3", border: "#ec4899", text: "#831843" },
  { bg: "#ede9fe", border: "#8b5cf6", text: "#3b0764" },
  { bg: "#ffedd5", border: "#f97316", text: "#7c2d12" },
  { bg: "#cffafe", border: "#06b6d4", text: "#164e63" },
  { bg: "#fef9c3", border: "#eab308", text: "#713f12" },
  { bg: "#fce4ec", border: "#e91e63", text: "#880e4f" },
  { bg: "#e8f5e9", border: "#4caf50", text: "#1b5e20" },
  { bg: "#ede7f6", border: "#673ab7", text: "#311b92" },
  { bg: "#e3f2fd", border: "#1565c0", text: "#0d47a1" },
  { bg: "#fff3e0", border: "#ef6c00", text: "#bf360c" },
];

function hashGroupId(id) {
  if (!id) return 0;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % COLOR_PALETTE.length;
}

export function getMechinaColor(group_id) {
  return COLOR_PALETTE[hashGroupId(group_id)];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function pct(hour) {
  return ((hour - HOUR_START) / (HOUR_END + 1 - HOUR_START)) * 100;
}

function blockStyle(startTime, endTime) {
  const gridStart = HOUR_START * 60;
  const total     = (HOUR_END + 1 - HOUR_START) * 60;
  const s = toMinutes(startTime) - gridStart;
  const e = toMinutes(endTime)   - gridStart;
  return {
    top:    `${Math.max(0, (s / total) * 100)}%`,
    height: `${Math.max(2, ((e - s) / total) * 100)}%`,
  };
}

// ── TimeBlock ─────────────────────────────────────────────────────────────────
function TimeBlock({ groupId, groupName, startTime, endTime, statusLabel, title }) {
  const color = getMechinaColor(groupId);
  return (
    <div
      className="absolute right-0 left-0 mx-0.5 rounded overflow-hidden flex flex-col justify-start px-1.5 py-1 cursor-default"
      style={{
        ...blockStyle(startTime, endTime),
        position: "absolute",
        zIndex: 2,
        backgroundColor: color.bg,
        borderLeft: `3px solid ${color.border}`,
        color: color.text,
      }}
      title={title}
    >
      {groupName && <span className="text-[10px] font-bold leading-tight truncate">{groupName}</span>}
      <span className="text-[9px] leading-tight opacity-80 font-medium">{startTime}–{endTime}</span>
      <span className="text-[9px] leading-tight font-semibold mt-0.5 truncate" style={{ color: color.border }}>
        {statusLabel}
      </span>
    </div>
  );
}

function SpaceBlockTime({ block, selectedDate }) {
  const startTime = block.is_open_ended && block.start_date < selectedDate ? "06:00" : block.start_time;
  const endTime = block.is_open_ended ? "24:00" : block.end_time;
  return <div className="absolute right-0 left-0 mx-0.5 rounded px-1.5 py-1 overflow-hidden bg-amber-100 border-l-4 border-amber-600 text-amber-900" style={{ ...blockStyle(startTime, endTime), zIndex: 5 }} title={block.reason_notes || BLOCK_REASON_LABELS[block.reason_type]}><span className="text-[10px] font-bold block truncate">לא זמין — {BLOCK_REASON_LABELS[block.reason_type] || block.reason_type}</span><span className="text-[9px] font-medium">{block.is_open_ended ? (block.start_date === selectedDate ? `${block.start_time} → עד תיקון` : "כל היום — חסום עד תיקון") : `${block.start_time}–${block.end_time}`}</span></div>;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MechinaSpaceAvailability({
  spaces, activeBookings, pendingRequests, blocks = [], selectedDate,
  isAdmin, onRequestNew, allowCreateRequest,
  canManageAvailability = false, onToggleAvailability, togglingSpaceId,
  groupMap = {},
}) {
  const gridWidth = COL_WIDTH * spaces.length;
  const headerHeight = canManageAvailability ? 108 : isAdmin ? HEADER_H : 62;

  // Legend: groups visible on this date
  const legendGroups = (() => {
    const seen = new Map();
    activeBookings.forEach(b => {
      if (b.group_id && !seen.has(b.group_id))
        seen.set(b.group_id, groupMap[b.group_id]?.group_name || b.group_id);
    });
    pendingRequests.forEach(r => {
      const gid = r.mechina_group_id || r.group_id;
      if (gid && !seen.has(gid))
        seen.set(gid, groupMap[gid]?.group_name || r.requested_by_name || gid);
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  })();

  return (
    <div>
      {/*
        ── Scroll container ─────────────────────────────────────────────────────
        overflow-x: auto  → horizontal scroll lives here
        position: relative → so the sticky child is pinned inside THIS box
      */}
      <div
        className="border border-slate-200 rounded-xl bg-white"
        style={{ overflowX: "auto", position: "relative" }}
      >
        {/*
          ── Floating time axis ──────────────────────────────────────────────────
          position: sticky + right: 0 means: this element sticks to the RIGHT
          edge of the VISIBLE scroll container viewport, regardless of how far
          the user has scrolled horizontally.

          It is NOT part of the spaces grid — it is an absolutely-positioned
          overlay on top of the grid, anchored to the scroll viewport.

          pointer-events: none so clicks pass through to booking blocks below.
        */}
        <div
          style={{
            position: "sticky",
            right: 0,
            top: 0,
            width: AXIS_WIDTH,
            height: headerHeight + TOTAL_HEIGHT,
            zIndex: 20,
            float: "right",           // keeps it in flow so the grid doesn't overlap
            backgroundColor: "rgba(255,255,255,0.92)",
            borderLeft: "1px solid #e2e8f0",
            pointerEvents: "none",
            flexShrink: 0,
          }}
        >
          {/* Header placeholder — aligns with space name headers */}
          <div style={{ height: headerHeight, borderBottom: "1px solid #e2e8f0", background: "rgba(248,250,252,0.95)" }} />

          {/* Hour labels */}
          <div style={{ position: "relative", height: TOTAL_HEIGHT }}>
            {HOURS.map(h => (
              <div
                key={h}
                style={{
                  position: "absolute",
                  top: `${pct(h)}%`,
                  transform: "translateY(-50%)",
                  width: "100%",
                  textAlign: "center",
                  fontSize: 10,
                  color: "#94a3b8",
                  fontWeight: 500,
                  lineHeight: 1,
                }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
        </div>

        {/*
          ── Spaces grid ─────────────────────────────────────────────────────────
          The grid has padding-right = AXIS_WIDTH so the last column is never
          hidden under the floating time axis.
        */}
        <div
          style={{
            width: gridWidth,
            minWidth: gridWidth,
            paddingRight: AXIS_WIDTH,
            boxSizing: "content-box",
          }}
        >
          {/* Space name headers */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${spaces.length}, ${COL_WIDTH}px)` }}>
            {spaces.map(space => (
              <div
                key={space.id}
                style={{ height: headerHeight }}
                className="flex flex-col items-center justify-center px-1 border-b border-r border-slate-200 bg-slate-50"
              >
                <p className="text-xs font-semibold text-slate-700 text-center leading-tight">{space.name}</p>
                {space.capacity && <p className="text-[10px] text-slate-400">{space.capacity} איש</p>}
                {!isAdmin && <p className="text-[10px] text-muted-foreground">בקשות מכינה — {space.mechina_requests_effective_enabled === true ? 'פעיל' : 'חסום'}</p>}
                {canManageAvailability && (() => {
                  const applicableBlocks = blocks.filter(block => block.activity_space_id === space.id && blockAppliesOnDate(block, selectedDate));
                  return <AdminSpaceStatusControl
                    space={space}
                    active={applicableBlocks.length === 0}
                    saving={togglingSpaceId === space.id}
                    onToggle={() => onToggleAvailability(space, applicableBlocks)}
                  />;
                })()}
              </div>
            ))}
          </div>

          {/* Space columns body */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${spaces.length}, ${COL_WIDTH}px)` }}>
            {spaces.map(space => {
              const spaceBookings = activeBookings.filter(b => b.activity_space_id === space.id);
              const spacePending  = pendingRequests.filter(r => r.space_id === space.id);
              const spaceBlocks = blocks.filter(b => b.activity_space_id === space.id);

              return (
                <div
                  key={space.id}
                  className="relative border-r border-slate-200 bg-white overflow-hidden"
                  style={{ height: TOTAL_HEIGHT }}
                >
                  {/* Hour grid lines — faint horizontal rules */}
                  {HOURS.map(h => (
                    <div
                      key={h}
                      className="absolute w-full"
                      style={{
                        top: `${pct(h)}%`,
                        borderTop: h % 2 === 0 ? "1px solid #e2e8f0" : "1px solid #f1f5f9",
                      }}
                    />
                  ))}

                  {/* Physical space blocks — never group activities */}
                  {spaceBlocks.map(block => <SpaceBlockTime key={block.id} block={block} selectedDate={selectedDate} />)}

                  {/* ACTIVE bookings */}
                  {spaceBookings.map(b => (
                    <TimeBlock
                      key={b.id}
                      groupId={b.group_id}
                      groupName={groupMap[b.group_id]?.group_name || (isAdmin ? b.activity_name : null)}
                      startTime={b.start_time}
                      endTime={b.end_time}
                      statusLabel="תפוס"
                      title={isAdmin ? `${b.activity_name} (${b.start_time}–${b.end_time})` : "תפוס"}
                    />
                  ))}

                  {/* PENDING requests */}
                  {spacePending.map(r => {
                    const gid = r.mechina_group_id || r.group_id;
                    return (
                      <TimeBlock
                        key={r.id}
                        groupId={gid}
                        groupName={groupMap[gid]?.group_name || r.requested_by_name || null}
                        startTime={r.start_time}
                        endTime={r.end_time}
                        statusLabel="ממתין לאישור"
                        title={isAdmin ? `${r.activity_title} — ${r.requested_by_name || r.requested_by_email} (${r.start_time}–${r.end_time})` : "ממתין לאישור"}
                      />
                    );
                  })}

                  {/* New request button */}
                  {allowCreateRequest && (
                    <button
                      disabled={space.mechina_requests_effective_enabled !== true || space.is_bookable === false}
                      title={space.mechina_requests_effective_enabled !== true ? 'המרחב חסום לבקשות מכינה חדשות' : space.is_bookable === false ? 'המרחב אינו זמין להזמנה כללית' : ''}
                      onClick={() => onRequestNew(space.id)}
                      className="absolute bottom-2 left-0 right-0 mx-auto w-fit text-[10px] text-primary border border-primary/30 rounded-full px-2 py-0.5 bg-white hover:bg-primary/5 transition-colors"
                      style={{ zIndex: 10, pointerEvents: "auto" }}
                    >
                      {space.mechina_requests_effective_enabled !== true ? 'חסום לבקשות מכינה' : space.is_bookable === false ? 'לא זמין להזמנה' : '+ בקשה'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 px-1">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-3 h-3 rounded inline-block bg-white border-2 border-slate-200" /> פנוי
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-3 h-3 rounded inline-block" style={{ background: "#fef3c7", border: "2px solid #f59e0b" }} /> ממתין לאישור
        </span>
        <span className="flex items-center gap-1.5 text-xs text-amber-800">
          <span className="w-3 h-3 rounded inline-block bg-amber-100 border-2 border-amber-600" /> חסימת מרחב
        </span>
        {legendGroups.length > 0 && (
          <>
            <span className="text-xs text-slate-300 select-none">|</span>
            {legendGroups.map(({ id, name }) => {
              const c = getMechinaColor(id);
              return (
                <span key={id} className="flex items-center gap-1.5 text-xs" style={{ color: c.text }}>
                  <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: c.bg, border: `2px solid ${c.border}` }} />
                  {name}
                </span>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}