// Response helpers shared by the activity-day backend functions (templates, planner, execution).
export const json = (body, status = 200) => Response.json(body, { status });
export const fail = (status, error, extra = {}) => json({ success: false, error, ...extra }, status);
// Write responses and reads differ in timestamp precision/suffix; compare at millisecond precision.
export const sameStamp = (a, b) => String(a || '').replace(/Z$/, '').slice(0, 23) === String(b || '').replace(/Z$/, '').slice(0, 23);