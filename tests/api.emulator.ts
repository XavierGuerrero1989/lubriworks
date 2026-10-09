import { availableStock, reservedStock } from "../shared/inventory";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { admin } from "../server/firebase";
import handler from "../server/rpc";
import cron from "../server/reminders";
import { loadCommandState, PAGE_SIZE } from "../server/store";
import { demoState } from "../shared/demo";
import { today } from "../shared/model";
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
    expect(scoped.orders.map((order) => order.id).sort()).toEqual([
      "ot1001",
      "ot1002",
    ]);
    expect(
      scoped.orders.every((order) =>
        ["received", "working"].includes(order.status),
      ),
    ).toBe(true);
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
  it("receives a turn atomically, starts work and delivers only after payment", async () => {
    const { db } = admin();
    const seed = demoState();
    const vehicle = (await db.doc("tenants/alpha/vehicles/v1").get()).data()!;
    await db
      .doc("tenants/alpha/vehicles/v-dashboard")
      .set({ ...vehicle, id: "v-dashboard", plate: "DASH001" });
    const appointmentId = "dashboard-turn";
    await db.doc("tenants/alpha/appointments/" + appointmentId).set({
      ...seed.appointments[0],
      id: appointmentId,
      vehicleId: "v-dashboard",
      customerId: "c1",
      branchId: "main",
      status: "confirmed",
    });
    const data = {
      ...seed.orders[0],
      status: "received",
      vehicleId: "v-dashboard",
      customerId: "c1",
      branchId: "main",
      odometer: vehicle.odometer,
      appointmentId,
    };
    const operations = [crypto.randomUUID(), crypto.randomUUID()];
    const receipts = await Promise.all(
      operations.map((operation) =>
        call(
          ownerToken,
          "command",
          { action: "save", collection: "orders", data },
          "alpha",
          operation,
        ),
      ),
    );
    expect(receipts.map((r) => r.status).sort()).toEqual([200, 400]);
    const id = operations[receipts.findIndex((r) => r.status === 200)];
    expect(
      (await db.doc("tenants/alpha/appointments/" + appointmentId).get()).data()
        ?.orderId,
    ).toBe(id);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "startOrder", id },
          "beta",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          clientToken,
          "command",
          { action: "startOrder", id },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "order.decision",
            id,
            decision: "approved",
            method: "presencial",
            note: "Cliente autoriza",
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "startOrder", id },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    expect(
      (await db.doc("tenants/alpha/orders/" + id).get()).data()?.startedAt,
    ).toBeTruthy();
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "deliverOrder", id },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    const visit = (await db.doc("tenants/alpha/orders/" + id).get()).data()!;
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "order.consumption",
            id,
            items: visit.items,
            note: "Insumos comprobados",
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "finishOrder", id },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    const cash = await db
      .collection("tenants/alpha/cash")
      .where("branchId", "==", "main")
      .where("closedAt", "==", null)
      .get();
    if (cash.empty)
      expect(
        (
          await call(
            ownerToken,
            "command",
            { action: "openCash", branchId: "main", opening: 0 },
            "alpha",
            crypto.randomUUID(),
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "chargeOrder", id, method: "cash" },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    const deliveryOperation = crypto.randomUUID();
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "deliverOrder", id },
          "alpha",
          deliveryOperation,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "deliverOrder", id },
          "alpha",
          deliveryOperation,
        )
      ).data.replayed,
    ).toBe(true);
    expect(
      (await db.doc("tenants/alpha/appointments/" + appointmentId).get()).data()
        ?.status,
    ).toBe("completed");
    expect(
      (await db.doc("tenants/alpha/orders/" + id).get()).data()?.deliveredBy,
    ).toBe("owner");
  });
  it("reserves overlapping intervals atomically, permits capacity, and persists rescheduling and absence", async () => {
    const { db } = admin();
    const date = "2030-03-20";
    await db
      .doc("tenants/alpha/branches/agenda-test")
      .set({ name: "Agenda", address: "", appointmentCapacity: 1 });
    const data = (vehicleId: string, customerId: string, extra = {}) => ({
      vehicleId,
      customerId,
      branchId: "agenda-test",
      date,
      time: "09:00",
      reason: "Service",
      technician: "",
      durationMinutes: 60,
      station: 0,
      status: "confirmed",
      ...extra,
    });
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const raced = await Promise.all(
      [data("v1", "c1"), data("v2", "c2")].map((d, i) =>
        call(
          ownerToken,
          "command",
          { action: "save", collection: "appointments", data: d },
          "alpha",
          ids[i],
        ),
      ),
    );
    expect(raced.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner = raced.findIndex((r) => r.status === 200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "save",
            collection: "branches",
            id: "agenda-test",
            data: { name: "Agenda", address: "", appointmentCapacity: 2 },
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    const loserData = winner === 0 ? data("v2", "c2") : data("v1", "c1");
    const secondId = crypto.randomUUID();
    expect(
      (
        await call(
          ownerToken,
          "command",
          { action: "save", collection: "appointments", data: loserData },
          "alpha",
          secondId,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "save",
            collection: "branches",
            id: "agenda-test",
            data: { name: "Agenda", address: "", appointmentCapacity: 1 },
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "save",
            collection: "appointments",
            id: secondId,
            data: { ...loserData, time: "10:00" },
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    const moveId = crypto.randomUUID();
    const move = {
      action: "save",
      collection: "appointments",
      id: secondId,
      data: {
        ...loserData,
        time: "10:00",
        rescheduleReason: "Cliente reprogramó",
        reschedules: [],
      },
    };
    expect(
      (await call(ownerToken, "command", move, "alpha", moveId)).status,
    ).toBe(200);
    expect(
      (await call(ownerToken, "command", move, "alpha", moveId)).data.replayed,
    ).toBe(true);
    const moved = (
      await db.doc("tenants/alpha/appointments/" + secondId).get()
    ).data()!;
    expect(moved.reschedules).toHaveLength(1);
    expect(moved.reschedules[0].by).toBe("owner");
    expect(moved.reschedules[0].fromTime).toBe("09:00");
    expect(moved.reschedules[0].toTime).toBe("10:00");
    expect(
      (
        await call(
          clientToken,
          "command",
          {
            action: "save",
            collection: "appointments",
            id: secondId,
            data: moved,
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    const pastId = "agenda-absence";
    await db
      .doc("tenants/alpha/appointments/" + pastId)
      .set(data("v1", "c1", { date: "2020-01-01", time: "08:00" }));
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "save",
            collection: "appointments",
            id: pastId,
            data: data("v1", "c1", {
              date: "2020-01-01",
              time: "08:00",
              status: "no_show",
              statusReason: "No se presentó",
            }),
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    expect(
      (await db.doc("tenants/alpha/appointments/" + pastId).get()).data()
        ?.statusReason,
    ).toBe("No se presentó");
  });
  it("handles multi-service authorization, actual stock, separate payment and linked delivery through the real API", async () => {
    const { db } = admin(),
      seed = demoState();
    await db.doc("tenants/alpha/vehicles/v-orders").set({
      ...seed.vehicles[0],
      id: "v-orders",
      plate: "LW999ZZ",
      odometer: 50000,
      readingDate: new Date().toISOString().slice(0, 10),
    });
    for (const [id, unit, price, cost] of [
      ["orders-oil", "litro", 100, 60],
      ["orders-filter", "unidad", 200, 100],
    ] as const)
      await db.doc("tenants/alpha/products/" + id).set({
        name: id,
        sku: id,
        unit,
        price,
        cost,
        stock: 100,
        minStock: 1,
        branchId: "main",
      });
    for (const [id, productId, quantity] of [
      ["orders-service", "orders-oil", 4],
      ["orders-air", "orders-filter", 1],
    ] as const)
      await db.doc("tenants/alpha/services/" + id).set({
        name: id,
        labor: 1000,
        intervalKm: 10000,
        intervalMonths: 12,
        items: [{ productId, quantity }],
      });
    await db.doc("tenants/alpha/appointments/a-orders").set({
      ...seed.appointments[0],
      id: "a-orders",
      vehicleId: "v-orders",
      customerId: "c1",
      branchId: "main",
      status: "confirmed",
    });
    const payload = {
      action: "order.create",
      vehicleId: "v-orders",
      branchId: "main",
      appointmentId: "a-orders",
      serviceIds: ["orders-service", "orders-air"],
      odometer: 50000,
      technician: "Técnico demo",
    };
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const race = await Promise.all(
      ids.map((id) => call(ownerToken, "command", payload, "alpha", id)),
    );
    expect(race.map((r) => r.status).sort()).toEqual([200, 400]);
    const id = ids[race.findIndex((r) => r.status === 200)];
    const command = (
      p: Record<string, unknown>,
      operation = crypto.randomUUID(),
    ) => call(ownerToken, "command", { id, ...p }, "alpha", operation);
    expect((await command({ action: "startOrder" })).status).toBe(400);
    expect((await command({ action: "finishOrder" })).status).toBe(400);
    expect(
      (
        await command({
          action: "order.decision",
          decision: "approved",
          method: "presencial",
          note: "Cliente autoriza los dos servicios",
        })
      ).status,
    ).toBe(200);
    expect((await command({ action: "startOrder" })).status).toBe(200);
    const additionId = crypto.randomUUID();
    expect(
      (
        await command(
          {
            action: "order.addition",
            title: "Propuesta adicional",
            items: [{ productId: "orders-oil", quantity: 1 }],
            labor: 0,
          },
          additionId,
        )
      ).status,
    ).toBe(200);
    expect(
      (await command({ action: "order.consumption", items: [] })).status,
    ).toBe(400);
    expect(
      (
        await command({
          action: "order.additionDecision",
          additionId,
          decision: "rejected",
          method: "telefono",
          note: "Cliente no lo requiere",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await command({
          action: "order.consumption",
          items: [{ productId: "orders-oil", quantity: 5 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await command({
          action: "order.consumption",
          items: [
            { productId: "orders-oil", quantity: 3.25 },
            { productId: "orders-filter", quantity: 1 },
          ],
          note: "Consumos medidos",
        })
      ).status,
    ).toBe(200);
    const finishId = crypto.randomUUID();
    const finish = await Promise.all([
      command({ action: "finishOrder" }, finishId),
      command({ action: "finishOrder" }, finishId),
    ]);
    expect(finish.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (await db.doc("tenants/alpha/products/orders-oil").get()).data()?.stock,
    ).toBe(96.75);
    expect(
      (
        await db
          .collection("tenants/alpha/reminders")
          .where("vehicleId", "==", "v-orders")
          .get()
      ).size,
    ).toBe(2);
    expect((await command({ action: "deliverOrder" })).status).toBe(400);
    const open = await db
      .collection("tenants/alpha/cash")
      .where("branchId", "==", "main")
      .where("closedAt", "==", null)
      .get();
    if (open.empty)
      expect(
        (await command({ action: "openCash", branchId: "main", opening: 0 }))
          .status,
      ).toBe(200);
    expect(
      (await command({ action: "chargeOrder", method: "cash" })).status,
    ).toBe(200);
    const order = (await db.doc("tenants/alpha/orders/" + id).get()).data()!;
    expect(order.workStatus).toBe("ready");
    expect(order.paymentStatus).toBe("paid");
    const sale = (
      await db
        .collection("tenants/alpha/sales")
        .where("orderId", "==", id)
        .get()
    ).docs[0].data();
    expect(sale.total).toBe(2525);
    expect(sale.cost).toBe(295);
    expect((await command({ action: "deliverOrder" })).status).toBe(200);
    expect(
      (await db.doc("tenants/alpha/appointments/a-orders").get()).data()
        ?.status,
    ).toBe("completed");
    expect(
      (await db.doc("tenants/alpha/orders/" + id).get()).data()?.workStatus,
    ).toBe("delivered");
  });
  it("keeps order photos private, validates content and deduplicates uploads", async () => {
    const { db } = admin();
    const seed = demoState(),
      id = "photo-order";
    await db.doc("tenants/alpha/orders/" + id).set({
      ...seed.orders[0],
      id,
      customerId: "c1",
      status: "received",
      workStatus: "received",
    });
    const base64 = Buffer.from([255, 216, 255, 217]).toString("base64"),
      operation = crypto.randomUUID();
    const payload = {
      orderId: id,
      base64,
      phase: "arrival",
      caption: "Guardabarros al ingresar",
    };
    const upload = await Promise.all([
      call(ownerToken, "order.photo.upload", payload, "alpha", operation),
      call(ownerToken, "order.photo.upload", payload, "alpha", operation),
    ]);
    expect(upload.map((r) => r.status)).toEqual([200, 200]);
    expect(upload.some((r) => r.data.replayed)).toBe(true);
    expect(
      (await db.doc("tenants/alpha/orders/" + id).get()).data()?.photos,
    ).toHaveLength(1);
    const read = await call(ownerToken, "order.photo.read", {
      orderId: id,
      photoId: operation,
    });
    expect(read.data.dataUrl).toBe("data:image/jpeg;base64," + base64);
    expect(
      (
        await call(clientToken, "order.photo.read", {
          orderId: id,
          photoId: operation,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "order.photo.read",
          { orderId: id, photoId: operation },
          "beta",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(ownerToken, "order.photo.read", {
          orderId: "ot1001",
          photoId: operation,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "order.photo.upload",
          {
            ...payload,
            base64: Buffer.from("<html>invalid</html>").toString("base64"),
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "order.photo.upload",
          { ...payload, base64: "A".repeat(240004) },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          clientToken,
          "order.photo.upload",
          payload,
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    const projected = await call(clientToken, "snapshot");
    expect(
      projected.data.state.orders.find((o: any) => o.id === id).photos,
    ).toEqual([]);
    await db.doc("tenants/alpha/orders/" + id).update({
      deliveredAt: new Date().toISOString(),
      workStatus: "delivered",
    });
    expect(
      (
        await call(
          ownerToken,
          "order.photo.upload",
          payload,
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
  });
  it("persists audited vehicle corrections, technical fields and private recommendations", async () => {
    const { db } = admin(),
      seed = demoState(),
      vehicleId = "v-file";
    const v = {
      ...seed.vehicles[1],
      id: vehicleId,
      customerId: "c1",
      plate: "FILE001",
    };
    await db.doc("tenants/alpha/vehicles/" + vehicleId).set(v);
    const operation = crypto.randomUUID(),
      payload = {
        action: "vehicle.correctReading",
        id: vehicleId,
        odometer: 42000,
        date: today(),
        reason: "Error al transcribir el tablero",
      };
    const results = await Promise.all([
      call(ownerToken, "command", payload, "alpha", operation),
      call(ownerToken, "command", payload, "alpha", operation),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (
        await db
          .collection("tenants/alpha/vehicleReadings")
          .where("vehicleId", "==", vehicleId)
          .get()
      ).size,
    ).toBe(1);
    expect(
      (await db.doc("tenants/alpha/vehicleReadings/" + operation).get()).data(),
    ).toMatchObject({
      beforeOdometer: 46200,
      odometer: 42000,
      source: "correction",
      reason: payload.reason,
      by: "owner",
    });
    for (const token of [clientToken, otherToken])
      expect(
        (
          await call(
            token,
            "command",
            { ...payload, odometer: 41000 },
            "alpha",
            crypto.randomUUID(),
          )
        ).status,
      ).toBe(400);
    expect(
      (await call(ownerToken, "command", payload, "beta", crypto.randomUUID()))
        .status,
    ).toBe(400);
    expect(
      (
        await call(
          ownerToken,
          "command",
          { ...payload, reason: "" },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    const saved = (
      await db.doc("tenants/alpha/vehicles/" + vehicleId).get()
    ).data()!;
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "save",
            collection: "vehicles",
            id: vehicleId,
            data: {
              ...saved,
              oilSpecification: "Norma confirmada",
              oilCapacity: 4.2,
              compatibleFilters: "Código confirmado",
              technicalNotes: "Nota interna",
            },
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    const recId = crypto.randomUUID();
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "vehicle.recommendation.add",
            id: vehicleId,
            text: "Revisar filtro en próxima visita",
          },
          "alpha",
          recId,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "vehicle.recommendation.resolve",
            id: vehicleId,
            recommendationId: recId,
            resolution: "Filtro cambiado",
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await db.doc("tenants/alpha/vehicleRecommendations/" + recId).get()
      ).data(),
    ).toMatchObject({
      status: "resolved",
      resolution: "Filtro cambiado",
      resolvedBy: "owner",
    });
    const client = await call(clientToken, "snapshot");
    expect(
      client.data.state.vehicles.find((r: any) => r.id === vehicleId)
        .technicalNotes,
    ).toBe("");
    expect(client.data.state.vehicleReadings).toEqual([]);
    expect(client.data.state.vehicleRecommendations).toEqual([]);
    expect(
      (await call(clientToken, "state.page", { collection: "vehicleReadings" }))
        .status,
    ).toBe(400);
    const staff = await call(ownerToken, "snapshot");
    expect(
      staff.data.state.vehicleReadings.some((r: any) => r.id === operation),
    ).toBe(true);
  });
  it("persists partial/composite payments once, prevents concurrent overpayment and audits reversals", async () => {
    const { db } = admin(),
      seed = demoState(),
      o = {
        ...seed.orders[0],
        id: "ot-billing",
        status: "ready",
        workStatus: "ready",
        paymentStatus: "unpaid",
      };
    await db.doc("tenants/alpha/orders/ot-billing").set(o);
    const command = (
      payload: Record<string, unknown>,
      operationId = crypto.randomUUID(),
      token = ownerToken,
      tenant = "alpha",
    ) => call(token, "command", payload, tenant, operationId);
    const firstId = crypto.randomUUID(),
      first = {
        action: "chargeOrder",
        id: o.id,
        payments: [
          { method: "cash", amount: 1000 },
          { method: "transfer", amount: 2000 },
        ],
      };
    const pair = await Promise.all([
      command(first, firstId),
      command(first, firstId),
    ]);
    expect(pair.map((r) => r.status)).toEqual([200, 200]);
    const sales = await db
      .collection("tenants/alpha/sales")
      .where("orderId", "==", o.id)
      .get();
    expect(sales.size).toBe(1);
    const sale = sales.docs[0],
      total = sale.data().total;
    expect(
      (
        await db
          .collection("tenants/alpha/payments")
          .where("saleId", "==", sale.id)
          .get()
      ).size,
    ).toBe(2);
    expect(
      (await db.doc(`tenants/alpha/orders/${o.id}`).get()).data()
        ?.paymentStatus,
    ).toBe("partial");
    expect((await command({ action: "deliverOrder", id: o.id })).status).toBe(
      400,
    );
    expect(
      (
        await command(
          {
            action: "sale.pay",
            id: sale.id,
            payments: [{ method: "cash", amount: 1 }],
          },
          crypto.randomUUID(),
          clientToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await command(
          {
            action: "sale.pay",
            id: sale.id,
            payments: [{ method: "cash", amount: 1 }],
          },
          crypto.randomUUID(),
          otherToken,
          "beta",
        )
      ).status,
    ).toBe(400);
    const concurrent = await Promise.all([
      command({
        action: "sale.pay",
        id: sale.id,
        payments: [{ method: "card", amount: total - 3000 }],
      }),
      command({
        action: "sale.pay",
        id: sale.id,
        payments: [{ method: "card", amount: total - 3000 }],
      }),
    ]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(
      (
        await db
          .collection("tenants/alpha/payments")
          .where("saleId", "==", sale.id)
          .get()
      ).size,
    ).toBe(3);
    const p = (
      await db
        .collection("tenants/alpha/payments")
        .where("saleId", "==", sale.id)
        .get()
    ).docs.find((d) => d.data().method === "cash")!;
    const reverseId = crypto.randomUUID(),
      reverse = {
        action: "payment.reverse",
        id: p.id,
        reason: "Corregir medio registrado",
      };
    expect((await command({ ...reverse, reason: "" })).status).toBe(400);
    const reversed = await Promise.all([
      command(reverse, reverseId),
      command(reverse, reverseId),
    ]);
    expect(reversed.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (
        await db
          .collection("tenants/alpha/payments")
          .where("reversesId", "==", p.id)
          .get()
      ).size,
    ).toBe(1);
    expect((await command(reverse)).status).toBe(400);
    expect(
      (await db.doc(`tenants/alpha/orders/${o.id}`).get()).data()
        ?.paymentStatus,
    ).toBe("partial");
    const snapshot = await call(clientToken, "snapshot");
    expect(snapshot.status).toBe(200);
    const customerPayments = snapshot.data.state.payments;
    expect(customerPayments.some((r: any) => r.saleId === sale.id)).toBe(true);
    expect(
      customerPayments.every(
        (r: any) =>
          r.customerId === "c1" && !r.reason && !r.reference && !r.actorName,
      ),
    ).toBe(true);
    expect(
      (
        await command({
          action: "sale.discount",
          id: sale.id,
          discount: 100,
          reason: "Promoción autorizada",
        })
      ).status,
    ).toBe(200);
    const p0 = seed.products[0],
      stock = (await db.doc(`tenants/alpha/products/${p0.id}`).get()).data()!
        .stock,
      counterId = crypto.randomUUID();
    const counter = {
      action: "sale",
      branchId: p0.branchId,
      customerId: "c1",
      vehicleId: "v1",
      items: [{ productId: p0.id, quantity: 1 }],
      payments: [],
    };
    expect((await command(counter, counterId)).status).toBe(200);
    expect((await command(counter, counterId)).status).toBe(200);
    expect(
      (await db.doc(`tenants/alpha/products/${p0.id}`).get()).data()?.stock,
    ).toBe(stock - 1);
    expect(
      (await db.doc(`tenants/alpha/sales/${counterId}`).get()).data()
        ?.vehicleId,
    ).toBe("v1");
    expect(
      (
        await command({
          action: "sale.pay",
          id: counterId,
          payments: [{ method: "cash", amount: 1000 }],
        })
      ).status,
    ).toBe(200);
    const active = (
      await db
        .collection("tenants/alpha/cash")
        .where("branchId", "==", p0.branchId)
        .get()
    ).docs.find((d) => !d.data().closedAt)!;
    const activeData = active.data(),
      cashPayments = (
        await db
          .collection("tenants/alpha/payments")
          .where("cashSessionId", "==", active.id)
          .get()
      ).docs.map((d) => d.data()),
      legacy = (
        await db
          .collection("tenants/alpha/sales")
          .where("branchId", "==", p0.branchId)
          .get()
      ).docs.map((d) => d.data());
    const expected =
      activeData.opening +
      cashPayments
        .filter((p) => p.method === "cash")
        .reduce((n, p) => n + (p.kind === "refund" ? -p.amount : p.amount), 0) +
      legacy
        .filter(
          (v) =>
            !v.billingVersion &&
            v.method === "cash" &&
            v.date >= activeData.openedAt,
        )
        .reduce((n, v) => n + v.total, 0);
    expect(
      (await command({ action: "closeCash", id: active.id, counted: expected }))
        .status,
    ).toBe(200);
    const closed = (await active.ref.get()).data();
    expect(closed?.expected).toBe(expected);
    const newCash = crypto.randomUUID();
    expect(
      (
        await command(
          { action: "openCash", branchId: p0.branchId, opening: 5000 },
          newCash,
        )
      ).status,
    ).toBe(200);
    const counterPayment = (
      await db
        .collection("tenants/alpha/payments")
        .where("saleId", "==", counterId)
        .get()
    ).docs[0];
    expect(
      (
        await command({
          action: "payment.reverse",
          id: counterPayment.id,
          reason: "Prueba devolución de efectivo",
        })
      ).status,
    ).toBe(200);
    expect((await active.ref.get()).data()).toEqual(closed);
    expect(
      (await command({ action: "closeCash", id: newCash, counted: 4000 }))
        .status,
    ).toBe(200);
    expect(
      (await db.doc(`tenants/alpha/cash/${newCash}`).get()).data()?.expected,
    ).toBe(4000);
  });
  it("serializes inventory reservations against approvals, counter sales and actual consumption", async () => {
    const { db } = admin(),
      seed = demoState(),
      command = (
        payload: Record<string, unknown>,
        operationId: string = crypto.randomUUID(),
        token = ownerToken,
        tenant = "alpha",
      ) => call(token, "command", payload, tenant, operationId);
    await db.doc("tenants/alpha/products/inv-oil").set({
      ...seed.products[0],
      id: "inv-oil",
      sku: "INV-OIL",
      stock: 5,
      price: 1000,
      cost: 500,
      location: "Tanque de prueba",
      compatibility: "Norma demo confirmada",
    });
    await db.doc("tenants/alpha/services/inv-service").set({
      ...seed.services[0],
      id: "inv-service",
      items: [{ productId: "inv-oil", quantity: 4.5 }],
    });
    for (const id of ["inv-v1", "inv-v2"])
      await db.doc(`tenants/alpha/vehicles/${id}`).set({
        ...seed.vehicles[1],
        id,
        customerId: "c1",
        plate: id.toUpperCase(),
      });
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (let i = 0; i < 2; i++)
      expect(
        (
          await command(
            {
              action: "order.create",
              vehicleId: `inv-v${i + 1}`,
              branchId: "main",
              serviceIds: ["inv-service"],
              odometer: 46200,
            },
            ids[i],
          )
        ).status,
      ).toBe(200);
    const approve = (id: string) => ({
      action: "order.decision",
      id,
      decision: "approved",
      method: "presencial",
      note: "Cliente autoriza servicio de prueba",
    });
    const pair = await Promise.all(ids.map((id) => command(approve(id))));
    expect(pair.map((r) => r.status).sort()).toEqual([200, 400]);
    const winner = ids[pair.findIndex((r) => r.status === 200)],
      loser = ids[pair.findIndex((r) => r.status === 400)];
    expect(
      (await db.doc("tenants/alpha/products/inv-oil").get()).data()?.stock,
    ).toBe(5);
    expect(
      (await db.doc(`tenants/alpha/orders/${loser}`).get()).data()?.approval,
    ).toBe("pending");
    const snapshot = await call(ownerToken, "snapshot");
    const local = snapshot.data.state,
      prod = local.products.find((p: any) => p.id === "inv-oil");
    expect(reservedStock(local, "inv-oil")).toBe(4.5);
    expect(availableStock(local, prod)).toBe(0.5);
    expect(
      (await command(approve(loser), crypto.randomUUID(), clientToken)).status,
    ).toBe(400);
    const sale = {
      action: "sale",
      branchId: "main",
      items: [{ productId: "inv-oil", quantity: 1 }],
      method: "cash",
    };
    const cashId = crypto.randomUUID();
    expect(
      (
        await command(
          { action: "openCash", branchId: "main", opening: 0 },
          cashId,
        )
      ).status,
    ).toBe(200);
    expect((await command(sale)).status).toBe(400);
    expect(
      (
        await command({
          ...sale,
          items: [{ productId: "inv-oil", quantity: 0.5 }],
        })
      ).status,
    ).toBe(200);
    const additionId = crypto.randomUUID();
    expect(
      (
        await command(
          {
            action: "order.addition",
            id: winner,
            title: "Más aceite",
            items: [{ productId: "inv-oil", quantity: 0.5 }],
          },
          additionId,
        )
      ).status,
    ).toBe(200);
    const decideExtra = {
      action: "order.additionDecision",
      id: winner,
      additionId,
      decision: "approved",
      method: "presencial",
      note: "Cliente acepta adicional",
    };
    expect((await command(decideExtra)).status).toBe(400);
    expect(
      (
        await command({
          action: "order.additionDecision",
          id: winner,
          additionId,
          decision: "rejected",
          method: "presencial",
          note: "No requiere adicional",
        })
      ).status,
    ).toBe(200);
    expect((await command({ action: "startOrder", id: winner })).status).toBe(
      200,
    );
    expect(
      (
        await command({
          action: "order.consumption",
          id: winner,
          items: [{ productId: "inv-oil", quantity: 3.25 }],
        })
      ).status,
    ).toBe(200);
    const finishId = crypto.randomUUID(),
      finished = await Promise.all([
        command({ action: "finishOrder", id: winner }, finishId),
        command({ action: "finishOrder", id: winner }, finishId),
      ]);
    expect(finished.map((r) => r.status)).toEqual([200, 200]);
    expect(
      (await db.doc("tenants/alpha/products/inv-oil").get()).data()?.stock,
    ).toBe(1.25);
    const after = await call(ownerToken, "snapshot");
    expect(reservedStock(after.data.state, "inv-oil")).toBe(0);
    expect(
      (
        await command({
          action: "adjustStock",
          id: "inv-oil",
          quantity: 5,
          reason: "Reposición de prueba",
        })
      ).status,
    ).toBe(200);
    expect((await command(approve(loser))).status).toBe(200);
    const cancelledId = crypto.randomUUID();
    expect(
      (
        await command(
          {
            action: "order.cancel",
            id: loser,
            reason: "Cliente cancela turno",
          },
          cancelledId,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await command(
          {
            action: "order.cancel",
            id: loser,
            reason: "Cliente cancela turno",
          },
          cancelledId,
        )
      ).status,
    ).toBe(200);
    const released = await call(ownerToken, "snapshot");
    expect(reservedStock(released.data.state, "inv-oil")).toBe(0);
    expect(
      (await db.doc("tenants/alpha/products/inv-oil").get()).data()?.stock,
    ).toBe(6.25);
    expect(
      (
        await command(
          {
            action: "adjustStock",
            id: "inv-oil",
            quantity: 1,
            reason: "Prueba ajena",
          },
          crypto.randomUUID(),
          otherToken,
          "beta",
        )
      ).status,
    ).toBe(400);
    const client = await call(clientToken, "snapshot");
    expect(client.data.state.products).toEqual([]);
    expect(client.data.state.movements).toEqual([]);
  });
  it("receives purchases partially, prevents concurrent overdelivery and preserves cancelled balances", async () => {
    const { db } = admin();
    const product = db.doc("tenants/alpha/products/proc-filter");
    await product.set({
      name: "Filtro recepción",
      sku: "PROC-FILTER",
      unit: "unidad",
      price: 300,
      cost: 100,
      stock: 0,
      minStock: 2,
      branchId: "main",
    });
    const command = (
      payload: Record<string, unknown>,
      operationId = crypto.randomUUID(),
      token = ownerToken,
      tenant = "alpha",
    ) => call(token, "command", payload, tenant, operationId);
    const buy = crypto.randomUUID();
    const created = await command(
      {
        action: "save",
        collection: "purchases",
        data: {
          supplierId: "sup1",
          branchId: "main",
          date: today(),
          expectedDate: today(),
          reference: "Pedido 7",
          notes: "Entrega en dos tandas",
          items: [{ productId: "proc-filter", quantity: 5, cost: 100 }],
        },
      },
      buy,
    );
    expect(created.status, JSON.stringify(created.data)).toBe(200);
    const receipt = {
      action: "receivePurchase",
      id: buy,
      items: [{ productId: "proc-filter", quantity: 3, cost: 110 }],
      reference: "Remito A",
      note: "Primera entrega",
    };
    const concurrent = await Promise.all([command(receipt), command(receipt)]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 400]);
    let purchase = (
      await db.doc(`tenants/alpha/purchases/${buy}`).get()
    ).data()!;
    expect(purchase.status).toBe("partial");
    expect(purchase.receipts).toHaveLength(1);
    expect((await product.get()).data()?.stock).toBe(3);
    expect(
      (await command(receipt, crypto.randomUUID(), clientToken)).status,
    ).toBe(400);
    expect(
      (await command(receipt, crypto.randomUUID(), otherToken, "beta")).status,
    ).toBe(400);
    const id = crypto.randomUUID(),
      last = {
        action: "receivePurchase",
        id: buy,
        items: [{ productId: "proc-filter", quantity: 2, cost: 125 }],
        reference: "Remito B",
      };
    const retries = await Promise.all([command(last, id), command(last, id)]);
    expect(retries.map((r) => r.status)).toEqual([200, 200]);
    expect(retries.some((r) => r.data.replayed)).toBe(true);
    purchase = (await db.doc(`tenants/alpha/purchases/${buy}`).get()).data()!;
    expect(purchase.status).toBe("received");
    expect(purchase.receipts).toHaveLength(2);
    expect(purchase.items[0].cost).toBe(100);
    expect((await product.get()).data()).toMatchObject({ stock: 5, cost: 125 });
    expect((await command(last)).status).toBe(400);
    const second = crypto.randomUUID();
    expect(
      (
        await command(
          {
            action: "save",
            collection: "purchases",
            data: {
              supplierId: "sup1",
              branchId: "main",
              date: today(),
              items: [{ productId: "proc-filter", quantity: 4, cost: 130 }],
            },
          },
          second,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await command({
          action: "receivePurchase",
          id: second,
          items: [{ productId: "proc-filter", quantity: 1, cost: 130 }],
        })
      ).status,
    ).toBe(200);
    const cancelId = crypto.randomUUID(),
      cancel = {
        action: "purchase.cancel",
        id: second,
        reason: "Proveedor cancela el saldo",
      };
    expect((await command(cancel, cancelId)).status).toBe(200);
    expect((await command(cancel, cancelId)).data.replayed).toBe(true);
    expect((await product.get()).data()?.stock).toBe(6);
    expect(
      (await db.doc(`tenants/alpha/purchases/${second}`).get()).data(),
    ).toMatchObject({
      status: "cancelled",
      cancelReason: "Proveedor cancela el saldo",
    });
    expect(
      (await command({ action: "receivePurchase", id: second })).status,
    ).toBe(400);
    const movements = await db
      .collection("tenants/alpha/movements")
      .where("productId", "==", "proc-filter")
      .get();
    expect(movements.size).toBe(3);
    expect(
      movements.docs.every(
        (d) =>
          d.data().purchaseId && d.data().receiptId && d.data().by === "owner",
      ),
    ).toBe(true);
    const client = await call(clientToken, "snapshot");
    expect(client.data.state.purchases).toEqual([]);
  });
  it("persists staff-only appointment input forecasts with tenant isolation and rejects forged customer plans", async () => {
    const { db } = admin();
    const id = "proc-turn";
    await db.doc(`tenants/alpha/appointments/${id}`).set({
      customerId: "c1",
      vehicleId: "v1",
      branchId: "main",
      date: today(),
      time: "23:00",
      reason: "Prueba de previsión",
      status: "confirmed",
      technician: "",
    });
    const plan = {
      action: "purchase.plan",
      id,
      items: [{ productId: "proc-filter", quantity: 2 }],
    };
    const operation = crypto.randomUUID();
    expect(
      (await call(ownerToken, "command", plan, "alpha", operation)).status,
    ).toBe(200);
    expect(
      (await call(ownerToken, "command", plan, "alpha", operation)).data
        .replayed,
    ).toBe(true);
    expect(
      (await db.doc(`tenants/alpha/appointments/${id}`).get()).data(),
    ).toMatchObject({ plannedItems: plan.items, planUpdatedBy: "owner" });
    expect(
      (await db.doc("tenants/alpha/products/proc-filter").get()).data()?.stock,
    ).toBe(6);
    expect(
      (await call(clientToken, "command", plan, "alpha", crypto.randomUUID()))
        .status,
    ).toBe(400);
    expect(
      (await call(otherToken, "command", plan, "beta", crypto.randomUUID()))
        .status,
    ).toBe(400);
    const customer = await call(clientToken, "snapshot");
    expect(
      customer.data.state.appointments.find((a: any) => a.id === id)
        .plannedItems,
    ).toBeUndefined();
    const future = new Date(today() + "T12:00:00Z");
    future.setUTCDate(future.getUTCDate() + 30);
    const requestId = crypto.randomUUID();
    expect(
      (
        await call(
          clientToken,
          "command",
          {
            action: "requestAppointment",
            vehicleId: "v1",
            branchId: "main",
            date: future.toISOString().slice(0, 10),
            time: "12:00",
            reason: "Cambio de aceite",
            plannedItems: [{ productId: "proc-filter", quantity: 99 }],
            planUpdatedBy: "owner",
          },
          "alpha",
          requestId,
        )
      ).status,
    ).toBe(200);
    expect(
      (await db.doc(`tenants/alpha/appointments/${requestId}`).get()).data()
        ?.plannedItems,
    ).toBeUndefined();
  });
  it("persists service variants and protects existing quotes after catalog deactivation", async () => {
    const { db } = admin();
    const original = (await db.doc("tenants/alpha/vehicles/v1").get()).data()!;
    await db
      .doc("tenants/alpha/vehicles/catalog-v")
      .set({ ...original, plate: "CAT123" });
    await db
      .doc("tenants/alpha/vehicles/catalog-v2")
      .set({ ...original, plate: "CAT124" });
    const sid = crypto.randomUUID(),
      data = {
        name: "Control general",
        variant: "Premium",
        category: "Controles",
        description: "Revisión preventiva",
        durationMinutes: 30,
        branchId: "main",
        active: true,
        labor: 2000,
        intervalKm: 5000,
        intervalMonths: 6,
        items: [],
      };
    const command = (
      payload: Record<string, unknown>,
      operation: string = crypto.randomUUID(),
      token = ownerToken,
      tenant = "alpha",
    ) => call(token, "command", payload, tenant, operation);
    expect(
      (await command({ action: "save", collection: "services", data }, sid))
        .status,
    ).toBe(200);
    const oid = crypto.randomUUID();
    expect(
      (
        await command(
          {
            action: "order.create",
            vehicleId: "catalog-v",
            branchId: "main",
            serviceIds: [sid],
            odometer: original.odometer,
          },
          oid,
        )
      ).status,
    ).toBe(200);
    const before = (await db.doc(`tenants/alpha/orders/${oid}`).get()).data()!;
    expect(before.serviceSnapshots[0]).toMatchObject({
      name: "Control general · Premium",
      durationMinutes: 30,
      intervalKm: 5000,
      intervalMonths: 6,
      labor: 2000,
    });
    expect(
      (
        await command({
          action: "save",
          collection: "services",
          id: sid,
          data: { ...data, active: false, labor: 9000, intervalKm: 1000 },
        })
      ).status,
    ).toBe(200);
    expect((await db.doc(`tenants/alpha/orders/${oid}`).get()).data()).toEqual(
      before,
    );
    const denied = await command({
      action: "order.create",
      vehicleId: "catalog-v2",
      branchId: "main",
      serviceIds: [sid],
      odometer: original.odometer,
    });
    expect(denied.status).toBe(400);
    expect(denied.data.error).toContain("inactivo");
    expect(
      (
        await command({
          action: "order.decision",
          id: oid,
          decision: "approved",
          method: "presencial",
          note: "Autoriza presupuesto original",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await command(
          { action: "save", collection: "services", id: sid, data },
          crypto.randomUUID(),
          clientToken,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await command(
          { action: "save", collection: "services", id: sid, data },
          crypto.randomUUID(),
          otherToken,
          "beta",
        )
      ).status,
    ).toBe(400);
  });
});

it("publishes transactional visit notices and attempts immediate push through the authenticated API without replay duplicates", async () => {
  const { vi } = await import("vitest"),
    webpush = (await import("web-push")).default;
  const { db } = admin(),
    root = db.doc("tenants/alpha"),
    seed = demoState();
  const previous = {
    public: process.env.VAPID_PUBLIC_KEY,
    private: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  };
  process.env.VAPID_PUBLIC_KEY = "test";
  process.env.VAPID_PRIVATE_KEY = "test";
  process.env.VAPID_SUBJECT = "mailto:test@example.test";
  const config = vi
    .spyOn(webpush, "setVapidDetails")
    .mockImplementation(() => {});
  const send = vi
    .spyOn(webpush, "sendNotification")
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  try {
    await root
      .collection("vehicles")
      .doc("visit-api-vehicle")
      .set({ ...seed.vehicles[0], id: "visit-api-vehicle", plate: "LW910AA" });
    await root
      .collection("customers")
      .doc("c1")
      .set(
        { pushEnabled: true, notificationPreferences: { visit: true } },
        { merge: true },
      );
    await root
      .collection("subscriptions")
      .doc("visit-api-device")
      .set({
        uid: "client",
        customerId: "c1",
        subscription: { endpoint: "https://fcm.googleapis.com/test" },
      });
    const data = {
      customerId: "c1",
      vehicleId: "visit-api-vehicle",
      branchId: "main",
      date: "2098-10-01",
      time: "08:00",
      reason: "Filtro",
      status: "confirmed",
    };
    await root
      .collection("appointments")
      .doc("visit-api-turn")
      .set({ ...data, id: "visit-api-turn", status: "requested" });
    const op = crypto.randomUUID();
    const first = await call(
      ownerToken,
      "command",
      {
        action: "save",
        collection: "appointments",
        id: "visit-api-turn",
        data,
      },
      "alpha",
      op,
    );
    expect(first.status, JSON.stringify(first.data)).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).not.toContain("LW910AA");
    expect(send.mock.calls[0][1]).toContain("Aviso de tu visita");
    const notice = await root
      .collection("notifications")
      .doc(op + "-visit-0")
      .get();
    expect(notice.data()?.event).toBe("appointment-confirmed");
    expect(notice.data()?.pushStatus).toBe("sent");
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "save",
            collection: "appointments",
            id: "visit-api-turn",
            data,
          },
          "alpha",
          op,
        )
      ).data.replayed,
    ).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const move = crypto.randomUUID();
    expect(
      (
        await call(
          ownerToken,
          "command",
          {
            action: "save",
            collection: "appointments",
            id: "visit-api-turn",
            data: {
              ...data,
              time: "09:00",
              rescheduleReason: "Cliente solicitó",
            },
          },
          "alpha",
          move,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await root
          .collection("notifications")
          .doc(move + "-visit-0")
          .get()
      ).data()?.event,
    ).toBe("appointment-rescheduled");
    expect(send).toHaveBeenCalledTimes(2);
    expect(
      (
        await call(
          otherToken,
          "command",
          {
            action: "save",
            collection: "appointments",
            id: "visit-api-turn",
            data,
          },
          "alpha",
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(400);
    expect(send).toHaveBeenCalledTimes(2);
  } finally {
    send.mockRestore();
    config.mockRestore();
    await root.collection("subscriptions").doc("visit-api-device").delete();
    for (const [key, value] of Object.entries({
      VAPID_PUBLIC_KEY: previous.public,
      VAPID_PRIVATE_KEY: previous.private,
      VAPID_SUBJECT: previous.subject,
    }))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
