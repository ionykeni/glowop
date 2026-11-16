// In-memory stand-in for the Base44 server client (SIMULATED identities, no network, no real data).
// Any write throws, so a test fails if a read endpoint ever tries to modify data.
const matches = (row, query) => Object.entries(query || {}).every(([key, cond]) =>
  cond && typeof cond === "object" && Array.isArray(cond.$in) ? cond.$in.includes(row[key]) : row[key] === cond);

export function mockBase44({ email, data }) {
  const calls = [];
  const entity = (name) => ({
    list: async (_sort, limit) => (data[name] || []).slice(0, limit || 1000),
    filter: async (query, sort, limit) => {
      calls.push({ name, query });
      let rows = (data[name] || []).filter((r) => matches(r, query));
      if (sort === "date") rows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
      return rows.slice(0, limit || 1000);
    },
    get: async (id) => {
      const row = (data[name] || []).find((r) => r.id === id);
      if (!row) throw Object.assign(new Error("not found"), { status: 404 });
      return row;
    },
    create: async () => { throw new Error(`write attempted on ${name}`); },
    update: async () => { throw new Error(`write attempted on ${name}`); },
    delete: async () => { throw new Error(`write attempted on ${name}`); },
  });
  return {
    calls,
    auth: { me: async () => (email ? { email } : Promise.reject(Object.assign(new Error("unauth"), { status: 401 }))) },
    asServiceRole: { entities: new Proxy({}, { get: (_t, name) => entity(name) }) },
  };
}