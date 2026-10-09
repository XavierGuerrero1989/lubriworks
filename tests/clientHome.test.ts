import { describe, it, expect } from "vitest";
import { demoAccess, demoState } from "../shared/demo";
import { execute } from "../shared/engine";
import { projectState, type State } from "../shared/model";
import { quoteTotal } from "../shared/orders";
import { reservedStock } from "../shared/inventory";
import {
  additionTotal,
  clientHome,
  lastVisitChange,
  readyInput,
  readyTimestamp,
  visitSummary,
} from "../shared/clientHome";
const owner = demoAccess.member,
  client = {
    ...owner,
    uid: "client",
    role: "customer" as const,
    customerId: "c2",
  },
  now = "2026-10-09T15:00:00.000Z";
const staff = (
  s: State,
  c: Record<string, unknown>,
  id: string = crypto.randomUUID(),
) => execute(s, owner, c as any, id, now);
function pending() {
  return staff(
    demoState(),
    {
      action: "order.create",
      vehicleId: "v2",
      branchId: "main",
      serviceIds: ["s2"],
      odometer: 46200,
    },
    "portal-order",
  );
}
function decision(s: State, changes: Record<string, unknown> = {}) {
  const o = s.orders.at(-1)!;
  return execute(
    s,
    client,
    {
      action: "order.decision",
      id: o.id,
      expectedRevision: o.quoteRevision,
      expectedTotal: quoteTotal(o),
      decision: "approved",
      ...changes,
    },
    "decision",
    now,
  );
}
describe("client home and customer decisions", () => {
  it("shows only the active customer's vehicles and visits, with legacy paid records excluded", () => {
    const s = demoState();
    s.orders.push({ ...s.orders[0], id: "historical", status: "paid" });
    const view = clientHome(s, { ...client, customerId: "c1" }, now);
    expect(view.vehicles.map((v) => v.id)).toEqual(["v1"]);
    expect(view.visits.map((o) => o.id)).toEqual(["ot1001"]);
    expect(clientHome(s, { ...client, active: false }, now).visits).toEqual([]);
    expect(clientHome(s, owner, now).vehicles).toEqual([]);
    s.orders[0].status = "paid";
    s.orders[0].workStatus = "ready";
    expect(
      clientHome(s, { ...client, customerId: "c1" }, now).visits,
    ).toHaveLength(1);
    s.orders[0].deliveredAt = now;
    expect(
      clientHome(s, { ...client, customerId: "c1" }, now).visits,
    ).toHaveLength(0);
  });
  it("sorts future open appointments and excludes received, past, cancelled and completed turns", () => {
    const s = demoState(),
      a = { ...s.appointments[1], customerId: "c2", vehicleId: "v2" };
    s.appointments = [
      { ...a, id: "later", date: "2026-10-11", time: "09:00" },
      { ...a, id: "next", date: "2026-10-10", time: "10:00" },
      { ...a, id: "received", date: "2026-10-10", orderId: "order" },
      { ...a, id: "closed", date: "2026-10-10", status: "completed" },
      { ...a, id: "past", time: "10:00" },
    ];
    expect(clientHome(s, client, now).appointments.map((a) => a.id)).toEqual([
      "next",
      "later",
    ]);
  });
  it("registers a customer's authorization, reserves stock and records the real actor and portal method", () => {
    const s = decision(pending()),
      o = s.orders.at(-1)!;
    expect(o.approval).toBe("approved");
    expect(o.approvalHistory?.[0]).toMatchObject({
      method: "portal",
      by: client.uid,
    });
    expect(
      reservedStock(
        s,
        "p4",
      ),
    ).toBe(1);
    expect(lastVisitChange(o)).toBe(now);
    expect(() => decision(s)).toThrow("decisión");
  });
  it("rejects foreign orders, stale revisions, changed amounts and omitted version data", () => {
    const s = pending();
    expect(() =>
      execute(
        s,
        { ...client, customerId: "c1" },
        {
          action: "order.decision",
          id: "portal-order",
          expectedRevision: 1,
          expectedTotal: 30000,
          decision: "approved",
        },
        "foreign",
        now,
      ),
    ).toThrow("tu cuenta");
    expect(() => decision(s, { expectedRevision: 2 })).toThrow("cambió");
    expect(() => decision(s, { expectedTotal: 1 })).toThrow("importe");
    expect(() => decision(s, { expectedRevision: undefined })).toThrow();
    expect(s.orders.at(-1)?.approval).toBe("pending");
  });
  it("cannot start work, edit prices or set a retirement estimate from the customer role", () => {
    const s = pending();
    for (const action of [
      "order.create",
      "order.quote",
      "order.update",
      "order.consumption",
    ])
      expect(() =>
        execute(
          s,
          client,
          { action, id: "portal-order", data: { expectedReadyAt: now } },
          "forged",
          now,
        ),
      ).toThrow("exclusiva");
  });
  it("rejects the base quote without consuming or reserving inventory", () => {
    const original = pending(),
      s = decision(original, { decision: "rejected" });
    expect(s.orders.at(-1)?.approval).toBe("rejected");
    expect(s.products).toEqual(original.products);
    expect(
      reservedStock(
        s,
        "p4",
      ),
    ).toBe(0);
    expect(visitSummary(s.orders.at(-1)!).label).toContain("rechazado");
  });
  it("allows independent additional decisions and does not cancel the approved base", () => {
    let s = decision(pending());
    s = staff(
      s,
      {
        action: "order.addition",
        id: "portal-order",
        title: "Filtro adicional",
        labor: 1000,
        items: [{ productId: "p4", quantity: 1 }],
      },
      "additional",
    );
    const o = s.orders.at(-1)!,
      a = o.additions![0];
    const payload = {
      action: "order.additionDecision",
      id: o.id,
      additionId: a.id,
      expectedRevision: o.quoteRevision,
      expectedCreatedAt: a.createdAt,
      expectedTotal: additionTotal(a),
      decision: "rejected",
    };
    expect(() =>
      execute(
        s,
        client,
        { ...payload, expectedCreatedAt: "2026-10-09T12:00:00.000Z" },
        "stale",
        now,
      ),
    ).toThrow("cambió");
    const rejected = execute(
      s,
      client,
      payload,
      "reject-additional",
      now,
    ).orders.at(-1)!;
    expect(rejected.approval).toBe("approved");
    expect(rejected.additions![0]).toMatchObject({
      status: "rejected",
      method: "portal",
      decidedBy: "client",
    });
    const approved = execute(
      s,
      client,
      { ...payload, decision: "approved" },
      "approve-additional",
      now,
    );
    expect(approved.orders.at(-1)?.additions![0].status).toBe("approved");
    expect(
      reservedStock(
        approved,
        "p4",
      ),
    ).toBe(2);
  });
  it("masks internal inventory quantities on a failed client authorization", () => {
    const s = pending();
    s.products.find((p) => p.id === "p4")!.stock = 0;
    expect(() => decision(s)).toThrow("Contactá al lubricentro");
    expect(s.orders.at(-1)?.approval).toBe("pending");
  });
  it("publishes the explicit estimate but protects it against generic writes and preserves private notes", () => {
    let s = pending(),
      o = s.orders.at(-1)!;
    const data = {
      technician: o.technician,
      notes: "Comentario interno",
      checklist: [],
      recommendations: "Comentario técnico interno",
      expectedReadyAt: "2026-10-09T18:00:00.000Z",
    };
    s = staff(s, { action: "order.update", id: o.id, data });
    o = s.orders.at(-1)!;
    const view = projectState(s, client).orders.at(-1)!;
    expect(view.expectedReadyAt).toBe(data.expectedReadyAt);
    expect(view.notes).toBe("");
    expect(view.recommendations).toBe("");
    expect(view.items.every((i) => i.cost === 0)).toBe(true);
    expect(() =>
      staff(s, {
        action: "order.update",
        id: o.id,
        data: { ...data, expectedReadyAt: "2026-10-09T12:00:00.000Z" },
      }),
    ).toThrow("futura");
    const edited = staff(s, {
      action: "save",
      collection: "orders",
      id: o.id,
      data: {
        ...o,
        expectedReadyAt: null,
        publicUpdatedAt: "2025-01-01T00:00:00.000Z",
      },
    }).orders.at(-1)!;
    expect(edited.expectedReadyAt).toBe(data.expectedReadyAt);
    expect(edited.publicUpdatedAt).toBe(now);
    expect(readyInput(data.expectedReadyAt)).toBe("2026-10-09T15:00");
    expect(readyTimestamp("2026-10-09T15:00")).toBe(data.expectedReadyAt);
    expect(() => readyTimestamp("2026-02-30T15:00")).toThrow();
  });
});
