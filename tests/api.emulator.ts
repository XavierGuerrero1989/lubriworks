import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { admin } from "../server/firebase";
import handler from "../server/rpc";
import cron from "../server/reminders";
import { loadCommandState, PAGE_SIZE } from "../server/store";
import { demoState } from "../shared/demo";
process.env.FIREBASE_PROJECT_ID = "demo-lubriworks";
let server: Server,
  base = "",
  ownerToken = "",
  clientToken = "",
  otherToken = "",
  platformToken = "";
async function call(
  token: string,
  action: string,
  payload: Record<string, unknown> = {},
  tenantId = "alpha",
  operationId?: string,
) {
  const response = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload, tenantId, operationId }),
  });
  return { status: response.status, data: await response.json() };
}
beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error("Run only via Firebase emulators.");
  const { db, auth } = admin();
  async function user(uid: string) {
    try {
      await auth.deleteUser(uid);
    } catch {}
    await auth.createUser({
      uid,
      email: `${uid}@test.local`,
      password: "TestPassword123!",
      emailVerified: false,
    });
    const r = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `${uid}@test.local`,
          password: "TestPassword123!",
          returnSecureToken: true,
        }),
      },
    );
    return (await r.json()).idToken as string;
  }
  [ownerToken, clientToken, otherToken, platformToken] = await Promise.all([
    user("owner"),
    user("client"),
    user("other"),
    user("platform"),
  ]);
  await db.doc("platformAdmins/platform").set({ active: true });
  for (const tenantId of ["alpha", "beta"]) {
    await db.doc(`tenants/${tenantId}`).set({
      id: tenantId,
      name: tenantId,
      active: true,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
    });
    await db
      .doc(
        `tenants/${tenantId}/members/${tenantId === "alpha" ? "owner" : "other"}`,
      )
      .set({
        tenantId,
        uid: tenantId === "alpha" ? "owner" : "other",
        role: "owner",
        active: true,
        name: "Admin",
        email: "owner@test.local",
        customerId: null,
      });
    const seed = demoState();
    const batch = db.batch();
    for (const [col, rows] of Object.entries(seed))
      for (const row of rows)
        batch.set(db.doc(`tenants/${tenantId}/${col}/${row.id}`), row);
    await batch.commit();
  }
  await db.doc("tenants/alpha/members/client").set({
    tenantId: "alpha",
    uid: "client",
    role: "customer",
    active: true,
    name: "Client",
    email: "client@test.local",
    customerId: "c1",
  });
  await db.doc("userTenants/owner/tenants/alpha").set({ tenantId: "alpha" });
  // A forged index must not grant access.
  await db.doc("userTenants/owner/tenants/beta").set({ tenantId: "beta" });
  server = createServer((req, res) => {
    if (req.url === "/cron") void cron(req, res);
    else void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
describe("real API + Auth / Firestore emulators", () => {
  it("rejects a forged token", async () =>
    expect((await call("fake", "snapshot")).status).toBe(401));
  it("does not authorize from the userTenants index", async () => {
    const r = await call(ownerToken, "access");
    expect(r.status).toBe(200);
    expect(r.data.access.map((a: any) => a.tenant.id)).toEqual(["alpha"]);
  });
  it("rejects reads and writes into a different tenant", async () => {
    expect((await call(ownerToken, "snapshot", {}, "beta")).status).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "finishOrder", id: "ot1001" },
          "beta",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
  it("filters all customer data on the server", async () => {
    const r = await call(clientToken, "snapshot");
    expect(r.status).toBe(200);
    expect(r.data.state.vehicles.map((v: any) => v.id)).toEqual(["v1"]);
    expect(r.data.state.products).toEqual([]);
    expect(r.data.state.cash).toEqual([]);
    expect(r.data.state.customers[0].notes).toBe("");
  });
  it("rejects a client operation targeting another customer vehicle", async () => {
    const r = await call(
      clientToken,
      "command",
      {
        action: "reading",
        id: "v2",
        odometer: 999999,
        date: new Date().toISOString().slice(0, 10),
      },
      "alpha",
      crypto.randomUUID(),
    );
    expect(r.status).toBe(400);
  });
  it("denies member administration before looking up arbitrary emails", async () => {
    const r = await call(clientToken, "member.save", {
      email: "notfound@test.local",
      name: "Other",
      role: "owner",
      active: true,
      customerId: null,
    });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("Sólo el administrador");
  });
  it("cannot remove the last owner", async () => {
    const r = await call(ownerToken, "member.save", {
      email: "owner@test.local",
      name: "Owner",
      role: "technician",
      active: true,
      customerId: null,
    });
    expect(r.status).toBe(400);
    expect(r.data.error).toContain("conservar");
  });
  it("processes concurrent retries once and isolates another tenant", async () => {
    const id = crypto.randomUUID();
    const results = await Promise.all([
      call(
        ownerToken,
        "command",
        { action: "finishOrder", id: "ot1001" },
        "alpha",
        id,
      ),
      call(
        ownerToken,
        "command",
        { action: "finishOrder", id: "ot1001" },
        "alpha",
        id,
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.some((r) => r.data.replayed)).toBe(true);
    const { db } = admin();
    expect(
      (await db.doc("tenants/alpha/products/p1").get()).data()?.stock,
    ).toBe(80);
    expect((await db.doc("tenants/beta/products/p1").get()).data()?.stock).toBe(
      84.5,
    );
  });
  it("rejects reusing operation IDs for a different payload", async () => {
    const id = crypto.randomUUID();
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "chargeOrder", id: "ot1001", method: "cash" },
          "alpha",
          id,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "chargeOrder", id: "ot1001", method: "card" },
          "alpha",
          id,
        )
      ).status,
    ).toBe(400);
  });
  it("does not write arbitrary collections", async () => {
    const r = await call(
      ownerToken,
      "command",
      { action: "save", collection: "members", data: { role: "owner" } },
      "alpha",
      crypto.randomUUID(),
    );
    expect(r.status).toBe(400);
  });
  it("blocks untrusted push endpoints", async () => {
    const r = await call(clientToken, "push.subscribe", {
      endpoint: "https://127.0.0.1/internal",
      keys: { p256dh: "x".repeat(80), auth: "x".repeat(20) },
    });
    expect(r.status).toBe(400);
  });
  it("immediately enforces membership revocation", async () => {
    const { db } = admin();
    await db.doc("tenants/alpha/members/client").update({ active: false });
    expect((await call(clientToken, "snapshot")).status).toBe(400);
    await db.doc("tenants/alpha/members/client").update({ active: true });
  });
  it("immediately enforces tenant suspension", async () => {
    const { db } = admin();
    await db.doc("tenants/alpha").update({ active: false });
    expect((await call(ownerToken, "snapshot")).status).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "openCash", branchId: "north", opening: 0 },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    await db.doc("tenants/alpha").update({ active: true });
  });
  it("cron creates persistent notices once without configured push", async () => {
    process.env.CRON_SECRET = "test-secret-that-is-long-enough-123456789";
    delete process.env.VAPID_PRIVATE_KEY;
    const { db } = admin();
    // This test exercises notice idempotency independently of the new appointment pause rule.
    for (const id of ["alpha", "beta"])
      await db
        .doc(`tenants/${id}/settings/notifications`)
        .set({ pauseWithAppointment: false });
    const headers = { Authorization: `Bearer ${process.env.CRON_SECRET}` };
    const first = await fetch(base + "/cron", { headers });
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result.notices).toBeGreaterThan(0);
    expect(result.pushConfigured).toBe(false);
    const second = await fetch(base + "/cron", { headers });
    expect((await second.json()).notices).toBe(0);
    for (const id of ["alpha", "beta"])
      await db.doc(`tenants/${id}/settings/notifications`).delete();
  });
  it("cron rejects unauthenticated requests", async () =>
    expect((await fetch(base + "/cron")).status).toBe(401));
  it("denies platform actions to a tenant owner", async () =>
    expect((await call(ownerToken, "platform.list")).status).toBe(403));
  it("limits the platform directory to platform administrators", async () => {
    for (const action of [
      "platform.overview",
      "platform.team",
      "platform.member.save",
    ])
      expect((await call(ownerToken, action, { id: "alpha" })).status).toBe(
        403,
      );
  });
  it("returns real tenant metrics and grants no operational membership", async () => {
    const result = await call(platformToken, "platform.overview");
    expect(result.status).toBe(200);
    expect(result.data.totalTenants).toBe(2);
    expect(
      result.data.tenants.find((t: any) => t.id === "alpha").vehicles,
    ).toBe(demoState().vehicles.length);
    expect((await call(platformToken, "snapshot")).status).toBe(400);
  });
  it("lists only the selected company team", async () => {
    const result = await call(platformToken, "platform.team", { id: "beta" });
    expect(result.status).toBe(200);
    expect(result.data.members.every((m: any) => m.tenantId === "beta")).toBe(
      true,
    );
    expect(result.data.members.some((m: any) => m.uid === "client")).toBe(
      false,
    );
  });
  it("audits platform access changes without modifying other tenants", async () => {
    const result = await call(platformToken, "platform.member.save", {
      id: "alpha",
      email: "other@test.local",
      name: "Other",
      role: "technician",
      active: true,
      customerId: null,
    });
    expect(result.status).toBe(200);
    const { db } = admin();
    expect(
      (await db.doc("tenants/alpha/members/other").get()).data()?.role,
    ).toBe("technician");
    expect(
      (await db.doc("tenants/beta/members/other").get()).data()?.role,
    ).toBe("owner");
    expect((await db.doc("userTenants/other/tenants/alpha").get()).exists).toBe(
      true,
    );
    expect(
      (
        await db
          .collection("tenants/alpha/audit")
          .where("action", "==", "platform.member.save")
          .get()
      ).empty,
    ).toBe(false);
  });
  it("preserves the last administrator and rejects invalid client links", async () => {
    const payload = {
      id: "alpha",
      email: "owner@test.local",
      name: "Owner",
      role: "technician",
      active: true,
      customerId: null,
    };
    expect(
      (await call(platformToken, "platform.member.save", payload)).status,
    ).toBe(400);
    expect(
      (
        await call(platformToken, "platform.member.save", {
          ...payload,
          email: "other@test.local",
          role: "customer",
          customerId: "missing",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(platformToken, "platform.member.save", {
          ...payload,
          email: "other@test.local",
          expectedUid: "owner",
        })
      ).status,
    ).toBe(400);
  });
  it("enforces platform revocation on every endpoint", async () => {
    const { db } = admin();
    await db.doc("platformAdmins/platform").update({ active: false });
    try {
      for (const action of [
        "platform.overview",
        "platform.team",
        "platform.member.save",
      ])
        expect(
          (await call(platformToken, action, { id: "alpha" })).status,
        ).toBe(403);
    } finally {
      await db.doc("platformAdmins/platform").update({ active: true });
    }
  });
  it("creates a tenant for an enabled owner without email verification", async () => {
    const result = await call(platformToken, "platform.create", {
      id: "unverified-demo",
      name: "Unverified account demo",
      ownerEmail: "owner@test.local",
    });
    expect(result.status).toBe(200);
    const { db, auth } = admin();
    expect((await auth.getUser("owner")).emailVerified).toBe(false);
    expect(
      (await db.doc("tenants/unverified-demo/members/owner").get()).data()
        ?.role,
    ).toBe("owner");
    expect(
      (await call(ownerToken, "snapshot", {}, "unverified-demo")).status,
    ).toBe(200);
  });
  it("still rejects disabled accounts for tenant creation and member assignment", async () => {
    const { auth } = admin();
    await auth.createUser({
      uid: "disabled",
      email: "disabled@test.local",
      disabled: true,
      emailVerified: false,
    });
    expect(
      (
        await call(platformToken, "platform.create", {
          id: "disabled-demo",
          name: "Disabled account demo",
          ownerEmail: "disabled@test.local",
        })
      ).status,
    ).toBe(400);
    const payload = {
      email: "disabled@test.local",
      name: "Disabled user",
      role: "technician",
      active: true,
      customerId: null,
    };
    expect(
      (
        await call(platformToken, "platform.member.save", {
          ...payload,
          id: "alpha",
        })
      ).status,
    ).toBe(400);
    expect((await call(ownerToken, "member.save", payload)).status).toBe(400);
  });
  it("pages histories over 2000 rows and reports exact per-tenant counts", async () => {
    const { db } = admin(),
      seed = demoState(),
      id = "large-demo";
    await db.doc(`tenants/${id}`).set({
      id,
      name: "Large demo",
      active: true,
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
    });
    await db.doc(`tenants/${id}/members/owner`).set({
      uid: "owner",
      tenantId: id,
      role: "owner",
      active: true,
      name: "Owner",
      email: "owner@test.local",
      customerId: null,
    });
    const rows: { path: string; data: any }[] = [];
    for (const [c, items] of Object.entries(seed))
      for (const item of items)
        rows.push({ path: `tenants/${id}/${c}/${item.id}`, data: item });
    for (let i = 0; i < 2105; i++) {
      const k = `bulk-${String(i).padStart(5, "0")}`;
      rows.push({
        path: `tenants/${id}/customers/${k}`,
        data: { ...seed.customers[0], id: k },
      });
      rows.push({
        path: `tenants/${id}/vehicles/${k}`,
        data: { ...seed.vehicles[0], id: k, customerId: k, plate: `DEMO-${i}` },
      });
      rows.push({
        path: `tenants/${id}/orders/${k}`,
        data: {
          ...seed.orders[0],
          id: k,
          vehicleId: k,
          customerId: k,
          status: "paid",
        },
      });
      rows.push({
        path: `tenants/${id}/sales/${k}`,
        data: { ...seed.sales[0], id: k, customerId: k },
      });
    }
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      for (const row of rows.slice(i, i + 400))
        batch.set(db.doc(row.path), row.data);
      await batch.commit();
    }
    const first = await call(ownerToken, "snapshot", {}, id);
    expect(first.status).toBe(200);
    expect(first.data.state.customers).toHaveLength(PAGE_SIZE);
    const ids = new Set(first.data.state.customers.map((c: any) => c.id));
    let cursor = first.data.next.customers;
    while (cursor) {
      const page = await call(
        ownerToken,
        "state.page",
        { collection: "customers", cursor },
        id,
      );
      expect(page.status).toBe(200);
      for (const c of page.data.state.customers) ids.add(c.id);
      cursor = page.data.next.customers;
    }
    expect(ids.size).toBe(2108);
    const overview = await call(platformToken, "platform.overview");
    const tenant = overview.data.tenants.find((t: any) => t.id === id);
    expect(tenant).toMatchObject({
      customers: 2108,
      vehicles: 2108,
      orders: 2107,
      sales: 2107,
    });
    const directory = await call(platformToken, "platform.team", { id });
    expect(directory.status).toBe(200);
    expect(directory.data.customers).toHaveLength(2108);
    const ref = db.doc(`tenants/${id}/members/owner`),
      member = (await ref.get()).data() as any;
    const scoped = await db.runTransaction(
      (tx) =>
        loadCommandState(
          db,
          tx,
          id,
          member,
          { action: "finishOrder", id: "ot1001" },
          crypto.randomUUID(),
        ),
      { readOnly: true },
    );
    expect(scoped.orders).toHaveLength(1);
    expect(scoped.sales).toHaveLength(0);
    expect(scoped.vehicles).toHaveLength(1);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "finishOrder", id: "ot1001" },
          id,
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    expect(
      (await db.doc(`tenants/${id}/orders/ot1001`).get()).data()?.status,
    ).toBe("ready");
  }, 90000);
  it("checks tenancy, role projection and revocation on every history page", async () => {
    expect(
      (await call(ownerToken, "state.page", { collection: "vehicles" }, "beta"))
        .status,
    ).toBe(400);
    expect(
      (await call(clientToken, "state.page", { collection: "products" }))
        .status,
    ).toBe(400);
    const page = await call(clientToken, "state.page", {
      collection: "vehicles",
    });
    expect(page.status).toBe(200);
    expect(page.data.state.vehicles.map((v: any) => v.id)).toEqual(["v1"]);
    const { db } = admin();
    await db.doc("tenants/alpha/members/client").update({ active: false });
    try {
      expect(
        (await call(clientToken, "state.page", { collection: "vehicles" }))
          .status,
      ).toBe(400);
    } finally {
      await db.doc("tenants/alpha/members/client").update({ active: true });
    }
  });
  it("resumes a reminder scan inside a tenant with over 2000 active reminders", async () => {
    const { db } = admin();
    for (let i = 0; i < 2105; i += 400) {
      const batch = db.batch();
      for (let j = i; j < Math.min(i + 400, 2105); j++) {
        const id = `bulk-rem-${String(j).padStart(5, "0")}`;
        batch.set(db.doc(`tenants/large-demo/reminders/${id}`), {
          id,
          customerId: "c1",
          vehicleId: "missing",
          source: "test",
          title: "Test",
          dueDate: "2099-01-01",
          dueKm: null,
          status: "active",
        });
      }
      await batch.commit();
    }
    await db.doc("systemJobs/reminders").set({
      cursor: "beta",
      reminderTenant: "large-demo",
      reminderCursor: "bulk-rem-02099",
      leaseUntil: 0,
    });
    process.env.CRON_SECRET = "x".repeat(40);
    const response = await fetch(base.replace(/\/rpc$/, "/") + "/cron", {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.completed).toBe(true);
    const checkpoint = (await db.doc("systemJobs/reminders").get()).data();
    expect(checkpoint?.reminderCursor).toBe("");
    expect(checkpoint?.reminderTenant).toBe("");
  }, 60000);
});
