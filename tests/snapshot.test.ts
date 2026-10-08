import { it, expect, vi, afterEach } from "vitest";
import { emptyState } from "../shared/model";
vi.mock("../src/lib/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => "mock-token" } },
}));
import { snapshot } from "../src/lib/api";
afterEach(() => vi.unstubAllGlobals());
const access = { member: { role: "owner", customerId: null } };
it("assembles every page without a 2000-record cut off", async () => {
  const rows = Array.from({ length: 2105 }, (_, i) => ({ id: `c${i}` }));
  const calls: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const req = JSON.parse(init.body);
      calls.push(req);
      const start = req.action === "snapshot" ? 0 : Number(req.payload.cursor);
      const state = emptyState();
      state.customers = rows.slice(start, start + 200) as any;
      const next =
        start + 200 < rows.length ? { customers: String(start + 200) } : {};
      return {
        ok: true,
        json: async () => ({ access, state, next, vapidPublicKey: "test" }),
      };
    }),
  );
  const result = await snapshot("tenant-alpha");
  expect(result.state.customers).toHaveLength(2105);
  expect(new Set(result.state.customers.map((c) => c.id)).size).toBe(2105);
  expect(calls).toHaveLength(11);
  expect(calls.every((c) => c.tenantId === "tenant-alpha")).toBe(true);
});
it("does not return a mixed snapshot when role changes between pages", async () => {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access: call++
          ? { member: { role: "customer", customerId: "c1" } }
          : access,
        state: emptyState(),
        next: { customers: "cursor" },
      }),
    })),
  );
  await expect(snapshot("tenant-alpha")).rejects.toThrow(
    "Tus permisos cambiaron",
  );
});
