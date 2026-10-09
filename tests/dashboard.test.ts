import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import {
  operationalBoard,
  elapsedMinutes,
  localDay,
} from "../shared/dashboard";
import { execute } from "../shared/engine";
import { today } from "../shared/model";
const owner = demoAccess.member;
const now = today() + "T15:00:00.000Z";
function receive() {
  const state = demoState(),
    appointment = state.appointments[0],
    vehicle = state.vehicles.find((v) => v.id === appointment.vehicleId)!;
  return {
    state,
    appointment,
    data: {
      ...state.orders[0],
      vehicleId: vehicle.id,
      customerId: vehicle.customerId,
      branchId: appointment.branchId,
      appointmentId: appointment.id,
      status: "received",
      date: today(),
      odometer: vehicle.odometer,
    },
  };
}
describe("operational dashboard", () => {
  it("uses Argentina's day and does not fabricate elapsed time for historic records", () => {
    expect(localDay("2026-10-10T01:30:00Z")).toBe("2026-10-09");
    expect(elapsedMinutes(undefined, now)).toBeNull();
    expect(elapsedMinutes("bad", now)).toBeNull();
    expect(elapsedMinutes(today() + "T14:00:00Z", now)).toBe(60);
    expect(elapsedMinutes(today() + "T16:00:00Z", now)).toBe(0);
  });
  it("scopes arrivals and orders, keeps previous-day open visits, and excludes historical paid or delivered records", () => {
    const s = demoState(),
      base = s.orders[0];
    s.orders = [
      { ...base, id: "waiting", status: "received", approval: "pending" },
      { ...base, id: "old", date: "2020-01-01", status: "working" },
      { ...base, id: "ready", status: "ready" },
      { ...base, id: "paid-today", status: "paid", date: today() },
      { ...base, id: "paid-old", status: "paid", date: "2020-01-01" },
      { ...base, id: "delivered", status: "paid", deliveredAt: now },
    ];
    const board = operationalBoard(s, "all", now);
    expect(board.groups.waiting.map((o) => o.id)).toEqual(["waiting"]);
    expect(board.groups.working.map((o) => o.id)).toEqual(["old"]);
    expect(board.groups.delivery.map((o) => o.id)).toEqual(["paid-today"]);
    expect(board.orders.map((o) => o.id)).not.toContain("delivered");
    expect(operationalBoard(s, "missing", now).orders).toEqual([]);
    expect(operationalBoard(s, "missing", now).appointments).toEqual([]);
  });
  it("receives a turn once, hides it from arrivals, and completes it only on paid delivery", () => {
    const { state, appointment, data } = receive();
    const saved = execute(
      state,
      owner,
      { action: "save", collection: "orders", data },
      "visit",
      now,
    );
    expect(
      saved.appointments.find((a) => a.id === appointment.id)?.orderId,
    ).toBe("visit");
    expect(saved.orders.find((o) => o.id === "visit")?.receivedAt).toBe(now);
    expect(
      operationalBoard(saved, "all", now).appointments.some(
        (a) => a.id === appointment.id,
      ),
    ).toBe(false);
    expect(() =>
      execute(
        saved,
        owner,
        { action: "save", collection: "orders", data },
        "duplicate",
        now,
      ),
    ).toThrow("ya fue recibido");
    expect(() =>
      execute(
        saved,
        owner,
        { action: "deliverOrder", id: "visit" },
        "early",
        now,
      ),
    ).toThrow("Cobrá");
    const started = execute(
      saved,
      owner,
      { action: "startOrder", id: "visit" },
      "start",
      now,
    );
    expect(started.orders.find((o) => o.id === "visit")?.startedAt).toBe(now);
    const finished = execute(
      started,
      owner,
      { action: "finishOrder", id: "visit" },
      "finish",
      now,
    );
    expect(finished.orders.find((o) => o.id === "visit")?.finishedAt).toBe(now);
    const opened = finished;
    const paid = execute(
      opened,
      owner,
      { action: "chargeOrder", id: "visit", method: "cash" },
      "pay",
      now,
    );
    expect(
      paid.appointments.find((a) => a.id === appointment.id)?.status,
    ).not.toBe("completed");
    const delivered = execute(
      paid,
      owner,
      { action: "deliverOrder", id: "visit" },
      "deliver",
      now,
    );
    expect(delivered.orders.find((o) => o.id === "visit")?.deliveredBy).toBe(
      owner.uid,
    );
    expect(
      delivered.appointments.find((a) => a.id === appointment.id)?.status,
    ).toBe("completed");
    expect(
      operationalBoard(delivered, "all", now).orders.some(
        (o) => o.id === "visit",
      ),
    ).toBe(false);
    expect(() =>
      execute(
        delivered,
        owner,
        { action: "deliverOrder", id: "visit" },
        "again",
        now,
      ),
    ).toThrow("ya fue entregado");
  });
  it("rejects mismatched reception and forged delivery timestamps, and enforces roles", () => {
    const { state, data } = receive();
    expect(() =>
      execute(
        state,
        owner,
        {
          action: "save",
          collection: "orders",
          data: { ...data, vehicleId: "v2", customerId: "c2" },
        },
        "wrong",
        now,
      ),
    ).toThrow("no coincide");
    const saved = execute(
      state,
      owner,
      {
        action: "save",
        collection: "orders",
        data: {
          ...data,
          deliveredAt: now,
          startedAt: now,
          approval: "approved",
        },
      },
      "visit",
      now,
    );
    const o = saved.orders.find((o) => o.id === "visit")!;
    expect(o.deliveredAt).toBeUndefined();
    expect(o.startedAt).toBeUndefined();
    expect(o.approval).toBeUndefined();
    expect(() =>
      execute(
        saved,
        { ...owner, role: "cashier" },
        { action: "startOrder", id: o.id },
        "cash-start",
        now,
      ),
    ).toThrow("no permite");
    expect(() =>
      execute(
        saved,
        { ...owner, role: "customer", customerId: data.customerId },
        { action: "deliverOrder", id: o.id },
        "client-deliver",
        now,
      ),
    ).toThrow("no permite");
    expect(() =>
      execute(
        saved,
        { ...owner, role: "technician" },
        { action: "deliverOrder", id: o.id },
        "tech-deliver",
        now,
      ),
    ).toThrow("no permite");
  });
});
