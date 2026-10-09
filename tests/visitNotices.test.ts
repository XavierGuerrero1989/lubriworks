import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import { execute } from "../shared/engine";
import { visitNotices, visitObsolete } from "../shared/visitNotices";
import {
  defaultNotificationSettings,
  preferencesSchema,
  noticeAccess,
} from "../shared/notifications";
import type { State } from "../shared/model";
const cmd = (
  s: State,
  data: Record<string, unknown>,
  id: string = crypto.randomUUID(),
) => execute(s, demoAccess.member, data as any, id);
const create = () =>
  cmd(
    demoState(),
    {
      action: "order.create",
      vehicleId: "v2",
      branchId: "main",
      serviceIds: ["s2"],
      odometer: 46200,
    },
    "visit-order",
  );
describe("event notices in the visit circuit", () => {
  it("creates one confirmed notice and does not repeat it for an unrelated edit", () => {
    const before = demoState();
    const a = before.appointments[1];
    const after = cmd(before, {
      action: "save",
      collection: "appointments",
      id: a.id,
      data: { ...a, status: "confirmed" },
    });
    const notice = after.notifications.find(
      (n) => n.event === "appointment-confirmed",
    )!;
    expect(notice.customerId).toBe(a.customerId);
    expect(notice.branchId).toBe("main");
    expect(notice.body).toContain(a.time);
    expect(notice.body).not.toContain("statusReason");
    const unchanged = cmd(after, {
      action: "save",
      collection: "appointments",
      id: a.id,
      data: { ...after.appointments[1], reason: "Cambio de filtro" },
    });
    expect(
      unchanged.notifications.filter(
        (n) => n.event === "appointment-confirmed",
      ),
    ).toHaveLength(1);
  });
  it("reprograms, supersedes the prior date and keeps cancellation reasons internal", () => {
    const before = demoState();
    const after = structuredClone(before);
    after.appointments[0].time = "08:00";
    const notices = visitNotices(before, after, "move", "2026-10-09T13:00:00Z");
    expect(notices[0].event).toBe("appointment-rescheduled");
    expect(visitObsolete(notices[0], after, after.appointments[0].date)).toBe(
      "",
    );
    after.appointments[0].status = "cancelled";
    after.appointments[0].statusReason = "Comentario interno";
    const cancelled = visitNotices(
      before,
      after,
      "cancel",
      "2026-10-09T13:00:00Z",
    );
    expect(cancelled[0].event).toBe("appointment-cancelled");
    expect(cancelled[0].body).not.toContain("Comentario interno");
    expect(visitObsolete(notices[0], after)).toContain("cerrado");
    after.appointments[0].status = "confirmed";
    expect(visitObsolete(cancelled[0], after)).toContain("cancelado");
  });
  it("does not notify a confirmation produced by receiving a requested appointment", () => {
    const before = demoState();
    const after = cmd(before, {
      action: "order.create",
      vehicleId: "v2",
      branchId: "main",
      serviceIds: ["s2"],
      odometer: 46200,
      appointmentId: "a2",
    });
    expect(
      after.notifications
        .filter((n) => n.origin === "operational")
        .map((n) => n.event),
    ).toEqual(["quote-pending"]);
  });
  it("records pending quotes by revision and suppresses decided or revised versions", () => {
    const s = create(),
      n = s.notifications.find((n) => n.event === "quote-pending")!;
    expect(n.orderId).toBe("visit-order");
    expect(visitObsolete(n, s)).toBe("");
    const revised = cmd(s, {
      action: "order.quote",
      id: "visit-order",
      serviceIds: ["s2"],
      extraItems: [],
      extraLabor: 500,
    });
    expect(
      revised.notifications.filter((n) => n.event === "quote-pending"),
    ).toHaveLength(2);
    expect(visitObsolete(n, revised)).toContain("cambió");
    const approved = cmd(revised, {
      action: "order.decision",
      id: "visit-order",
      decision: "approved",
      method: "presencial",
      note: "Autorizado",
    });
    expect(visitObsolete(revised.notifications.at(-1)!, approved)).toContain(
      "resolvió",
    );
  });
  it("queues an additional once and suppresses it after a decision", () => {
    let s = create();
    s = cmd(s, {
      action: "order.decision",
      id: "visit-order",
      decision: "approved",
      method: "presencial",
      note: "Autorizado",
    });
    s = cmd(
      s,
      {
        action: "order.addition",
        id: "visit-order",
        title: "Revisión adicional",
        items: [],
        labor: 1500,
      },
      "addition-test",
    );
    const n = s.notifications.find((n) => n.event === "addition-pending")!;
    expect(n.additionId).toBe("addition-test");
    expect(visitObsolete(n, s)).toBe("");
    s = cmd(s, {
      action: "order.additionDecision",
      id: "visit-order",
      additionId: "addition-test",
      decision: "rejected",
      method: "telefono",
      note: "No desea realizarlo",
    });
    expect(visitObsolete(n, s)).toContain("resolvió");
  });
  it("notifies ready at finish; payment does not duplicate and delivery suppresses the old push", () => {
    let s = create();
    s = cmd(s, {
      action: "order.decision",
      id: "visit-order",
      decision: "approved",
      method: "presencial",
      note: "Autorizado",
    });
    s = cmd(s, { action: "startOrder", id: "visit-order" });
    s = cmd(s, {
      action: "order.consumption",
      id: "visit-order",
      items: [{ productId: "p4", quantity: 1 }],
      note: "Consumo confirmado",
    });
    s = cmd(s, { action: "finishOrder", id: "visit-order" }, "finished-visit");
    const n = s.notifications.find((n) => n.event === "vehicle-ready")!;
    expect(n.body).toContain("Total del trabajo");
    expect(visitObsolete(n, s)).toBe("");
    s = cmd(s, {
      action: "chargeOrder",
      id: "visit-order",
      method: "cash",
      discount: 0,
    });
    expect(
      s.notifications.filter((n) => n.event === "vehicle-ready"),
    ).toHaveLength(1);
    expect(visitObsolete(n, s)).toBe("");
    s = cmd(s, { action: "deliverOrder", id: "visit-order" });
    expect(visitObsolete(n, s)).toContain("entregada");
  });
  it("keeps old rules and preferences compatible while separating visit push from maintenance", () => {
    expect(defaultNotificationSettings().visitEnabled).toBe(true);
    expect(
      preferencesSchema.parse({ pushEnabled: true, messages: false }).visit,
    ).toBe(true);
    expect(
      preferencesSchema.parse({ pushEnabled: true, visit: false }).maintenance,
    ).toBe(true);
  });
});

it("opens push links only for an already authorized customer tenant", () => {
  const a = structuredClone(demoAccess);
  a.member.role = "customer";
  a.member.customerId = "c1";
  const b = structuredClone(a);
  b.tenant.id = "second";
  expect(noticeAccess([a, b], "?portal=notifications&tenant=second")).toBe(b);
  expect(
    noticeAccess([a], "?portal=notifications&tenant=foreign"),
  ).toBeUndefined();
  expect(
    noticeAccess(
      [demoAccess],
      "?portal=notifications&tenant=" + demoAccess.tenant.id,
    ),
  ).toBeUndefined();
  b.member.active = false;
  expect(
    noticeAccess([b], "?portal=notifications&tenant=second"),
  ).toBeUndefined();
});
