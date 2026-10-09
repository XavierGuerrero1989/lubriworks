import { describe, expect, it } from "vitest";
import { demoAccess, demoState } from "../shared/demo";
import { availability, availableTimes, appointmentEnd } from "../shared/agenda";
import { execute } from "../shared/engine";
import type { Entity } from "../shared/model";
const owner = demoAccess.member;
const now = "2026-10-09T15:00:00.000Z";
const branch = {
  id: "main",
  name: "Centro",
  address: "",
  appointmentCapacity: 2,
};
const turn = (
  changes: Partial<Entity<"appointments">> = {},
): Entity<"appointments"> => ({
  id: "a",
  customerId: "c1",
  vehicleId: "v1",
  branchId: "main",
  date: "2026-10-09",
  time: "09:00",
  durationMinutes: 60,
  station: 0,
  technician: "",
  reason: "Service",
  status: "confirmed",
  ...changes,
});
const save = (
  s: ReturnType<typeof demoState>,
  data: Entity<"appointments">,
  id?: string,
) =>
  execute(
    s,
    owner,
    { action: "save", collection: "appointments", id, data },
    "operation",
    now,
  );
describe("agenda availability and appointment lifecycle", () => {
  it("treats legacy turns as 60 minutes, rejects crossing midnight, and allows adjacent turns", () => {
    expect(appointmentEnd(turn({ durationMinutes: undefined }))).toBe("10:00");
    expect(availability(turn({ time: "23:30" }), [], branch)).toContain(
      "mismo día",
    );
    expect(
      availability(turn({ time: "10:00" }), [turn({ id: "b" })], branch),
    ).toBeNull();
  });
  it("checks capacity at each instant rather than counting all overlaps", () => {
    const short = [
      turn({ id: "b", vehicleId: "v2", durationMinutes: 30 }),
      turn({ id: "c", vehicleId: "v3", time: "09:30", durationMinutes: 30 }),
    ];
    expect(availability(turn(), short, branch)).toBeNull();
    expect(
      availability(
        turn(),
        [
          ...short,
          turn({
            id: "d",
            vehicleId: "v4",
            time: "09:15",
            durationMinutes: 30,
          }),
        ],
        branch,
      ),
    ).toContain("capacidad");
    expect(
      availability(turn(), short, {
        ...branch,
        appointmentCapacity: undefined,
      }),
    ).toContain("capacidad");
  });
  it("blocks a named station and a normalized technician even across branches, and a vehicle in another branch", () => {
    expect(
      availability(
        turn({ station: 1 }),
        [turn({ id: "b", vehicleId: "v2", station: 1 })],
        branch,
      ),
    ).toContain("puesto está ocupado");
    expect(availability(turn({ station: 3 }), [], branch)).toContain(
      "2 puestos",
    );
    expect(
      availability(
        turn({ technician: " NICOLÁS  Díaz " }),
        [
          turn({
            id: "b",
            branchId: "north",
            vehicleId: "v2",
            technician: "nicolas diaz",
          }),
        ],
        branch,
      ),
    ).toContain("técnico");
    expect(
      availability(turn(), [turn({ id: "b", branchId: "north" })], branch),
    ).toContain("vehículo");
  });
  it("does not reserve cancelled, absent, or completed turns and proposes valid alternatives", () => {
    for (const status of ["cancelled", "no_show", "completed"] as const)
      expect(
        availability(turn(), [turn({ id: "b", status })], branch),
      ).toBeNull();
    const other = turn({ id: "b", vehicleId: "v2", durationMinutes: 90 });
    expect(
      availableTimes(turn(), [other], { ...branch, appointmentCapacity: 1 })[0],
    ).toBe("10:30");
  });
  it("records rescheduling on the server, requires a reason, and ignores forged history", () => {
    const s = demoState();
    s.appointments = [turn()];
    expect(() => save(s, turn({ time: "11:00" }), "a")).toThrow("motivo");
    const moved = save(
      s,
      turn({
        time: "11:00",
        rescheduleReason: "Cliente pidió otra hora",
        reschedules: [],
      }),
      "a",
    );
    expect(moved.appointments[0].reschedules).toEqual([
      {
        at: now,
        by: owner.uid,
        reason: "Cliente pidió otra hora",
        fromDate: "2026-10-09",
        fromTime: "09:00",
        fromBranchId: "main",
        toDate: "2026-10-09",
        toTime: "11:00",
        toBranchId: "main",
      },
    ]);
    expect(moved.appointments[0].rescheduleReason).toBeUndefined();
    const confirm = save(
      moved,
      { ...moved.appointments[0], reschedules: [] },
      "a",
    );
    expect(confirm.appointments[0].reschedules).toHaveLength(1);
  });
  it("keeps long rescheduling reasons valid on subsequent edits", () => {
    const s = demoState();
    s.appointments = [turn()];
    const reason =
      "El cliente pidió otra fecha porque cambió su disponibilidad. ".repeat(5);
    const moved = save(
      s,
      turn({ time: "11:00", rescheduleReason: reason }),
      "a",
    );
    const again = save(
      moved,
      {
        ...moved.appointments[0],
        time: "12:00",
        rescheduleReason: "Nueva hora",
      },
      "a",
    );
    expect(again.appointments[0].reschedules).toHaveLength(2);
    expect(again.appointments[0].reschedules?.[0].reason).toBe(reason.trim());
  });
  it("requires reasons and rejects future absence or edits to a received turn", () => {
    const s = demoState();
    s.appointments = [turn()];
    expect(() => save(s, turn({ status: "cancelled" }), "a")).toThrow("motivo");
    expect(() =>
      save(
        s,
        turn({ time: "18:00", status: "no_show", statusReason: "No vino" }),
        "a",
      ),
    ).toThrow("Reprogramá");
    s.appointments = [turn({ time: "18:00" })];
    expect(() =>
      save(
        s,
        turn({ time: "18:00", status: "no_show", statusReason: "No vino" }),
        "a",
      ),
    ).toThrow("antes");
    s.appointments = [turn({ orderId: "visit", receivedAt: now })];
    expect(() =>
      save(s, turn({ time: "11:00", rescheduleReason: "Cambiar" }), "a"),
    ).toThrow("ya recibido");
    expect(() =>
      save(s, turn({ status: "cancelled", statusReason: "Cancelar" }), "a"),
    ).toThrow("ya recibido");
  });
  it("allows cancellation to release capacity and protects future reservations on capacity reduction", () => {
    const s = demoState();
    s.branches[0].appointmentCapacity = 2;
    s.appointments = [
      turn(),
      turn({ id: "b", vehicleId: "v2", customerId: "c2" }),
    ];
    expect(() =>
      execute(
        s,
        owner,
        {
          action: "save",
          collection: "branches",
          id: "main",
          data: { ...s.branches[0], appointmentCapacity: 1 },
        },
        "shrink",
        now,
      ),
    ).toThrow("afecta turnos");
    const cancelled = save(
      s,
      turn({ status: "cancelled", statusReason: "Cliente canceló" }),
      "a",
    );
    const reduced = execute(
      cancelled,
      owner,
      {
        action: "save",
        collection: "branches",
        id: "main",
        data: { ...s.branches[0], appointmentCapacity: 1 },
      },
      "shrink",
      now,
    );
    expect(reduced.branches[0].appointmentCapacity).toBe(1);
    const absent = save(
      s,
      turn({ status: "no_show", statusReason: "No se presentó" }),
      "a",
    );
    expect(absent.appointments[0].status).toBe("no_show");
  });
  it("enforces customer requests against occupied intervals and strips staff assignments", () => {
    const s = demoState();
    s.appointments = [turn()];
    const customer = { ...owner, role: "customer" as const, customerId: "c2" };
    const cmd = {
      action: "requestAppointment",
      vehicleId: "v2",
      branchId: "main",
      date: new Date().toISOString().slice(0, 10),
      time: "09:30",
      reason: "Service",
      durationMinutes: 5,
      station: 9,
      technician: "Inventado",
      orderId: "fake",
    };
    s.appointments[0].date = cmd.date;
    expect(() => execute(s, customer, cmd, "request", now)).toThrow(
      "capacidad",
    );
    const requested = execute(
      s,
      customer,
      { ...cmd, time: "10:00" },
      "request",
      now,
    ).appointments.at(-1)!;
    expect(requested.durationMinutes).toBe(60);
    expect(requested.station).toBe(0);
    expect(requested.technician).toBe("");
    expect(requested.orderId).toBeUndefined();
  });
});
