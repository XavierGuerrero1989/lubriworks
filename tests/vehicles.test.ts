import { describe, it, expect } from "vitest";
import { demoAccess, demoState } from "../shared/demo";
import { execute } from "../shared/engine";
import {
  monthlyUsage,
  projectState,
  schemas,
  today,
  type State,
} from "../shared/model";
const owner = demoAccess.member;
const run = (
  s: State,
  c: Record<string, unknown>,
  id: string = crypto.randomUUID(),
) => execute(s, owner, c as any, id);
const correction = {
  action: "vehicle.correctReading",
  id: "v2",
  odometer: 42000,
  date: today(),
  reason: "Lectura transcripta incorrectamente",
};
describe("vehicle file and audited readings", () => {
  it("stores confirmed technical data and keeps internal notes out of the client projection", () => {
    const s = demoState(),
      v = s.vehicles[1];
    const next = run(s, {
      action: "save",
      collection: "vehicles",
      id: v.id,
      data: {
        ...v,
        oilSpecification: "5W-30 · norma confirmada",
        oilCapacity: 4.25,
        compatibleFilters: "Aceite: código confirmado",
        technicalNotes: "Hallazgo interno",
      },
    });
    expect(next.vehicles[1].oilCapacity).toBe(4.25);
    expect(next.vehicleReadings).toEqual([]);
    const client = projectState(next, {
      ...owner,
      role: "customer",
      customerId: "c2",
    });
    expect(client.vehicles[0].technicalNotes).toBe("");
    expect(client.vehicleReadings).toEqual([]);
    expect(client.vehicleRecommendations).toEqual([]);
    expect(() => schemas.vehicles.parse({ ...v, oilCapacity: -1 })).toThrow();
    const compatible = run(next, {
      action: "save",
      collection: "vehicles",
      id: v.id,
      data: v,
    });
    expect(compatible.vehicles[1].technicalNotes).toBe("Hallazgo interno");
  });
  it("preserves extinguisher reminders on technical edits and replaces legacy reminders only when the expiration changes", () => {
    const s = demoState(),
      v = s.vehicles[1];
    const unchanged = run(s, {
      action: "save",
      collection: "vehicles",
      id: v.id,
      data: { ...v, technicalNotes: "Nota", oilCapacity: null },
    });
    expect(
      unchanged.reminders.filter(
        (r) => r.vehicleId === v.id && r.source === "extinguisher",
      ),
    ).toEqual(
      s.reminders.filter(
        (r) => r.vehicleId === v.id && r.source === "extinguisher",
      ),
    );
    expect(unchanged.vehicles[1].oilCapacity).toBeNull();
    const changed = run(unchanged, {
      action: "save",
      collection: "vehicles",
      id: v.id,
      data: { ...unchanged.vehicles[1], extinguisherDue: "2027-01-01" },
    });
    expect(
      changed.reminders.filter(
        (r) => r.vehicleId === v.id && r.source === "extinguisher",
      ),
    ).toHaveLength(1);
    expect(
      changed.reminders.find(
        (r) => r.vehicleId === v.id && r.source === "extinguisher",
      )?.dueDate,
    ).toBe("2027-01-01");
  });
  it("allows managers to correct readings, records old values and resets the estimate baseline", () => {
    const s = demoState();
    s.vehicles[1].previousOdometer = 40000;
    s.vehicles[1].previousReadingDate = "2026-01-01";
    const next = run(s, correction, "correct");
    expect(next.vehicles[1].odometer).toBe(42000);
    expect(next.vehicles[1].previousOdometer).toBeNull();
    expect(monthlyUsage(next.vehicles[1]).source).toBe("age");
    expect(next.vehicleReadings[0]).toMatchObject({
      id: "correct",
      vehicleId: "v2",
      beforeOdometer: 46200,
      odometer: 42000,
      source: "correction",
      reason: correction.reason,
      by: owner.uid,
      actorName: owner.name,
    });
    expect(s.vehicles[1].odometer).toBe(46200);
    expect(() =>
      execute(s, { ...owner, role: "manager" }, correction, "manager"),
    ).not.toThrow();
  });
  it("denies unauthorized, reasonless, unchanged, invalid and cross-company corrections", () => {
    for (const role of ["technician", "cashier", "customer"] as const)
      expect(() =>
        execute(
          demoState(),
          { ...owner, role, customerId: "c2" },
          correction,
          "deny",
        ),
      ).toThrow();
    expect(() => run(demoState(), { ...correction, reason: "  " })).toThrow();
    expect(() =>
      run(demoState(), { ...correction, date: "2099-01-01" }),
    ).toThrow("futura");
    expect(() =>
      run(demoState(), { ...correction, date: "2020-01-01" }),
    ).toThrow("año");
    expect(() => run(demoState(), { ...correction, odometer: -1 })).toThrow();
    expect(() => run(demoState(), { ...correction, id: "foreign" })).toThrow(
      "empresa",
    );
    const v = demoState().vehicles[1];
    expect(() =>
      run(demoState(), {
        ...correction,
        odometer: v.odometer,
        date: v.readingDate,
      }),
    ).toThrow("cambiar");
  });
  it("blocks contradictions with open visits and prevents lowering through ordinary reading or save", () => {
    expect(() =>
      run(demoState(), { ...correction, id: "v1", odometer: 999999 }),
    ).toThrow("visita abierta");
    const s = demoState();
    s.orders[0].date = "2026-10-01";
    expect(() => run(s, { ...correction, id: "v1", odometer: 70000 })).toThrow(
      "visita abierta",
    );
    expect(() =>
      run(demoState(), {
        action: "reading",
        id: "v2",
        odometer: 10,
        date: today(),
      }),
    ).toThrow("disminuir");
    const v = demoState().vehicles[1];
    expect(() =>
      run(demoState(), {
        action: "save",
        collection: "vehicles",
        id: v.id,
        data: { ...v, odometer: 10 },
      }),
    ).toThrow("disminuir");
  });
  it("logs initial, ordinary and service readings without fabricating earlier history", () => {
    let s = demoState();
    s = run(
      s,
      {
        action: "save",
        collection: "vehicles",
        data: { ...s.vehicles[1], plate: "TEST001" },
      },
      "initial",
    );
    expect(s.vehicleReadings[0].source).toBe("initial");
    expect(s.vehicleReadings[0].beforeOdometer).toBeNull();
    s = run(
      s,
      { action: "reading", id: "v2", odometer: 47000, date: today() },
      "reading",
    );
    expect(s.vehicleReadings[1]).toMatchObject({
      source: "reading",
      beforeOdometer: 46200,
      odometer: 47000,
    });
    s = run(s, { action: "finishOrder", id: "ot1001" }, "finished");
    expect(s.vehicleReadings.at(-1)).toMatchObject({
      source: "service",
      orderId: "ot1001",
      vehicleId: "v1",
    });
  });
  it("separates customer recommendations from internal notes and audits their resolution", () => {
    let s = run(
      demoState(),
      {
        action: "vehicle.recommendation.add",
        id: "v2",
        text: "Revisar filtro en la próxima visita",
      },
      "recommend",
    );
    expect(s.vehicleRecommendations[0].status).toBe("pending");
    expect(s.vehicles[1].technicalNotes).toBeUndefined();
    expect(() =>
      run(s, {
        action: "vehicle.recommendation.resolve",
        id: "v1",
        recommendationId: "recommend",
        resolution: "Realizado",
      }),
    ).toThrow("encontrada");
    s = run(s, {
      action: "vehicle.recommendation.resolve",
      id: "v2",
      recommendationId: "recommend",
      resolution: "Filtro cambiado",
    });
    expect(s.vehicleRecommendations[0]).toMatchObject({
      status: "resolved",
      resolution: "Filtro cambiado",
      resolvedBy: owner.uid,
    });
    expect(() =>
      run(s, {
        action: "vehicle.recommendation.resolve",
        id: "v2",
        recommendationId: "recommend",
        resolution: "Otra vez",
      }),
    ).toThrow("resuelta");
    expect(() =>
      execute(
        demoState(),
        { ...owner, role: "cashier" },
        { action: "vehicle.recommendation.add", id: "v2", text: "Revisar" },
        "cash",
      ),
    ).toThrow("rol");
    expect(() =>
      execute(
        demoState(),
        { ...owner, role: "customer", customerId: "c2" },
        { action: "vehicle.recommendation.add", id: "v2", text: "Revisar" },
        "client",
      ),
    ).toThrow("exclusiva");
  });
  it("keeps Auth email stable while allowing contact profile edits", () => {
    const s = demoState(),
      c = s.customers[0];
    expect(() =>
      run(s, {
        action: "save",
        collection: "customers",
        id: c.id,
        data: { ...c, email: "different@example.com" },
      }),
    ).toThrow("cuenta");
    const next = run(s, {
      action: "save",
      collection: "customers",
      id: c.id,
      data: { ...c, phone: "12345" },
    });
    expect(next.customers[0].phone).toBe("12345");
  });
});
