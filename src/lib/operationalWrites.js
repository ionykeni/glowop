import { base44 } from "@/api/base44Client";

// Operational record writes go through the guarded backend (Group cancellation fence + role checks).
// Same call shape as base44.entities.X.create/update/delete. Calls made in the same tick are sent as one request.
const MAX_BATCH = 100;
let queue = [];
let scheduled = false;

const toError = (message) => {
  const err = new Error(message || "השמירה נכשלה");
  err.response = { data: { error: err.message } };
  return err;
};

async function send(items) {
  try {
    const res = await base44.functions.invoke("writeOperationalRecord", { ops: items.map((i) => i.op) });
    const results = res.data?.results || [];
    items.forEach((item, idx) => {
      const r = results[idx];
      if (r?.ok) item.resolve(r.record ?? null);
      else item.reject(toError(r?.error || res.data?.error));
    });
  } catch (err) {
    items.forEach((item) => item.reject(err));
  }
}

function flush() {
  const batch = queue;
  queue = [];
  scheduled = false;
  for (let i = 0; i < batch.length; i += MAX_BATCH) send(batch.slice(i, i + MAX_BATCH));
}

function enqueue(op) {
  return new Promise((resolve, reject) => {
    queue.push({ op, resolve, reject });
    if (!scheduled) { scheduled = true; setTimeout(flush, 0); }
  });
}

const handle = (entity) => ({
  create: (data) => enqueue({ entity, action: "create", data }),
  update: (id, data) => enqueue({ entity, action: "update", id, data }),
  delete: (id) => enqueue({ entity, action: "delete", id }),
});

export const opWrite = {
  MealReservation: handle("MealReservation"),
  SleepingAllocation: handle("SleepingAllocation"),
  NeighborhoodReservation: handle("NeighborhoodReservation"),
  GroupScheduleItem: handle("GroupScheduleItem"),
  CoffeeCornerRequest: handle("CoffeeCornerRequest"),
  PrisaRequest: handle("PrisaRequest"),
  // Sets all active meals of the alert's Group to the Group's current total pax (server-derived).
  applyKitchenPaxAlert: (alertId) => enqueue({ entity: "MealReservation", action: "applyKitchenPaxAlert", alert_id: alertId }),
};