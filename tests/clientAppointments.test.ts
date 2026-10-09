import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import { execute } from "../shared/engine";
import {
  appointmentCalendar,
  clientAppointments,
  clientAppointmentEditable,
  clientAppointmentVersion,
} from "../shared/clientAppointments";
const now = "2026-10-09T15:00:00.000Z",
  client = {
    ...demoAccess.member,
    uid: "client",
    role: "customer" as const,
    customerId: "c1",
  };
function fixture() {
  const s = demoState();
  s.appointments = [
    {
      ...s.appointments[0],
      id: "turn",
      customerId: "c1",
      vehicleId: "v1",
      date: "2026-10-10",
      time: "10:00",
      status: "confirmed",
      technician: "Nicolás",
      station: 1,
      plannedItems: [{ productId: "p1", quantity: 1 }],
    },
  ];
  return s;
}
const command = (
  s: ReturnType<typeof demoState>,
  extra: Record<string, unknown> = {},
) => ({
  action: "clientAppointment.reschedule",
  id: "turn",
  expectedVersion: clientAppointmentVersion(s.appointments[0]),
  date: "2026-10-11",
  time: "11:00",
  branchId: "main",
  reason: "Necesito otro horario",
  ...extra,
});
describe("customer appointment management", () => {
  it("reprograms an owned future appointment as requested, releases assigned resources and preserves traceability", () => {
    const s = fixture();
    const after = execute(s, client, command(s), "move", now),
      a = after.appointments[0];
    expect(a).toMatchObject({
      status: "requested",
      date: "2026-10-11",
      time: "11:00",
      technician: "",
      station: 0,
    });
    expect(a.plannedItems).toBeUndefined();
    expect(a.reschedules?.[0]).toMatchObject({
      by: "client",
      fromDate: "2026-10-10",
      toDate: "2026-10-11",
    });
    expect(after.notifications.at(-1)).toMatchObject({
      event: "appointment-rescheduled",
      customerId: "c1",
    });
    expect(s.appointments[0].status).toBe("confirmed");
  });
  it("cancels with a reason and emits the existing transactional notice", () => {
    const s = fixture(),
      a = execute(
        s,
        client,
        command(s, { action: "clientAppointment.cancel" }),
        "cancel",
        now,
      );
    expect(a.appointments[0]).toMatchObject({
      status: "cancelled",
      statusReason: "Necesito otro horario",
    });
    expect(a.notifications.at(-1)?.event).toBe("appointment-cancelled");
  });
  it("rejects foreign, staff, stale, blank reason and forged lifecycle input", () => {
    const s = fixture();
    expect(() =>
      execute(s, { ...client, customerId: "c2" }, command(s), "id", now),
    ).toThrow("pertenece");
    expect(() => execute(s, demoAccess.member, command(s), "id", now)).toThrow(
      "exclusiva",
    );
    expect(() =>
      execute(s, client, command(s, { expectedVersion: "old" }), "id", now),
    ).toThrow("cambió");
    expect(() =>
      execute(s, client, command(s, { reason: "  " }), "id", now),
    ).toThrow();
    const after = execute(
      s,
      client,
      command(s, {
        status: "confirmed",
        customerId: "c2",
        orderId: "fake",
        technician: "Fake",
      }),
      "id",
      now,
    );
    expect(after.appointments[0]).toMatchObject({
      status: "requested",
      customerId: "c1",
      technician: "",
    });
    expect(after.appointments[0].orderId).toBeUndefined();
  });
  it("locks received, completed, cancelled, missed and past appointments including the same day", () => {
    for (const patch of [
      { orderId: "o" },
      { receivedAt: now },
      { status: "completed" as const },
      { status: "cancelled" as const },
      { status: "no_show" as const },
      { date: "2026-10-09", time: "11:59" },
    ]) {
      const s = fixture();
      Object.assign(s.appointments[0], patch);
      expect(clientAppointmentEditable(s.appointments[0], now)).toBe(false);
      expect(() => execute(s, client, command(s), "id", now)).toThrow(
        "recibido",
      );
    }
  });
  it("respects branch hours, closures, capacity and future time without losing the original on failure", () => {
    const s = fixture();
    s.branches[0].closedDates = ["2026-10-11"];
    expect(() => execute(s, client, command(s), "id", now)).toThrow("cerrada");
    delete s.branches[0].closedDates;
    s.appointments.push({
      ...s.appointments[0],
      id: "other",
      vehicleId: "v2",
      customerId: "c2",
      date: "2026-10-11",
      time: "11:00",
    });
    expect(() => execute(s, client, command(s), "id", now)).toThrow(
      "capacidad",
    );
    expect(() =>
      execute(
        s,
        client,
        command(s, { date: "2026-10-09", time: "12:00" }),
        "id",
        now,
      ),
    ).toThrow("futuras");
    expect(s.appointments[0].status).toBe("confirmed");
  });
  it("rejects stale decisions even when a reschedule returned to the original slot", () => {
    const s = fixture(),
      old = command(s);
    s.appointments[0].reschedules = [
      {
        at: now,
        by: "owner",
        reason: "cambio",
        fromDate: "2026-10-11",
        fromTime: "11:00",
        fromBranchId: "main",
        toDate: "2026-10-10",
        toTime: "10:00",
        toBranchId: "main",
      },
    ];
    expect(() => execute(s, client, old, "id", now)).toThrow("cambió");
  });
  it("groups only owned appointments, received visits and past dates as history", () => {
    const s = fixture();
    s.appointments.push(
      { ...s.appointments[0], id: "past", date: "2026-10-08" },
      { ...s.appointments[0], id: "received", orderId: "o" },
      {
        ...s.appointments[0],
        id: "foreign",
        customerId: "c2",
        vehicleId: "v2",
      },
    );
    const g = clientAppointments(s, client, now);
    expect(g.upcoming.map((a) => a.id)).toEqual(["turn"]);
    expect(g.history.map((a) => a.id)).toEqual(["received", "past"]);
    expect(clientAppointments(s, demoAccess.member, now).upcoming).toEqual([]);
  });
  it("creates calendar UTC dates from Argentina and escapes appointment content", () => {
    const a = fixture().appointments[0];
    a.reason = "Aceite, filtro; revisión\nExtra";
    const cal = appointmentCalendar(a, "AE123", "Central", "Calle 1", now);
    expect(cal).toContain("DTSTART:20261010T130000Z");
    expect(cal).toContain("DTEND:20261010T140000Z");
    expect(cal).toContain("Aceite\\, filtro\\; revisión\\nExtra");
    expect(cal).toContain("\r\nEND:VCALENDAR\r\n");
  });
  it("rejects new requests in a past same-day slot", () => {
    const s = fixture();
    expect(() =>
      execute(
        s,
        client,
        {
          action: "requestAppointment",
          vehicleId: "v1",
          branchId: "main",
          date: "2026-10-09",
          time: "11:59",
          reason: "service",
        },
        "id",
        now,
      ),
    ).toThrow("futuras");
  });
  it("folds long unicode calendar lines without splitting characters", () => {
    const a = fixture().appointments[0];
    a.reason = "Revisión ".repeat(30);
    const cal = appointmentCalendar(a, "AE123", "Central", "Calle 1", now);
    expect(
      cal
        .split("\r\n")
        .every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBe(true);
    expect(cal.replace(/\r\n /g, "")).toContain(a.reason);
  });
});
