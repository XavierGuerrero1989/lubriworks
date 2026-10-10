import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import {
  clientMaintenance,
  maintenanceReading,
  filterMaintenance,
} from "../shared/clientMaintenance";
import type { Reminder } from "../shared/model";
const client = {
    ...demoAccess.member,
    role: "customer" as const,
    customerId: "c1",
  },
  now = "2026-10-09T15:00:00Z";
function fixture() {
  const s = demoState(),
    v = s.vehicles.find((v) => v.id === "v1")!;
  Object.assign(v, {
    odometer: 10000,
    readingDate: "2026-09-09",
    previousOdometer: 9000,
    previousReadingDate: "2026-08-09",
    hasExtinguisher: true,
    extinguisherDue: "2027-10-09",
  });
  s.reminders = [];
  return s;
}
const reminder = (id: string, extra: Partial<Reminder> = {}): Reminder => ({
  id,
  customerId: "c1",
  vehicleId: "v1",
  title: "Cambio de aceite",
  dueDate: "2027-10-09",
  dueKm: 20000,
  status: "active",
  source: "s1",
  ...extra,
});
describe("client maintenance", () => {
  it("requires active customer and matching vehicle AND reminder ownership", () => {
    const s = fixture();
    s.reminders = [
      reminder("mine"),
      reminder("foreign", { customerId: "c2" }),
      reminder("wrongvehicle", { vehicleId: "v2" }),
    ];
    expect(
      clientMaintenance(s, client, now)
        .items.filter((i) => i.category === "service")
        .map((i) => i.id),
    ).toEqual(["mine"]);
    expect(clientMaintenance(s, demoAccess.member, now).items).toEqual([]);
    expect(
      clientMaintenance(s, { ...client, active: false }, now).items,
    ).toEqual([]);
  });
  it("distinguishes actual due, estimated threshold, soon and scheduled and prioritizes them", () => {
    const s = fixture();
    s.reminders = [
      reminder("scheduled"),
      reminder("estimated", { dueKm: 10500 }),
      reminder("real", { dueKm: 10000 }),
      reminder("today", { dueDate: "2026-10-09", dueKm: null }),
      reminder("soon", { dueKm: 11400 }),
    ];
    const rows = clientMaintenance(s, client, now).items.filter(
      (i) => i.category === "service",
    );
    expect(rows.map((i) => i.level)).toEqual([
      "due",
      "due",
      "estimated",
      "soon",
      "scheduled",
    ]);
    expect(rows.find((i) => i.id === "estimated")!.actualRemaining).toBe(500);
  });
  it("uses Argentina day and handles zero usage without an invented kilometer date", () => {
    const s = fixture();
    Object.assign(s.vehicles[0], { odometer: 0, previousOdometer: 0 });
    s.reminders = [
      reminder("date", { dueDate: "2026-10-10", dueKm: null }),
      reminder("km", { dueDate: "", dueKm: 200 }),
    ];
    const data = clientMaintenance(s, client, "2026-10-10T01:30:00Z");
    expect(data.day).toBe("2026-10-09");
    expect(data.items.find((i) => i.id === "date")!.level).toBe("soon");
    expect(data.items.find((i) => i.id === "km")!.info!.effective).toBe("");
  });
  it("separates missing extinguisher, unknown data and legacy recorded expiration", () => {
    const s = fixture(),
      v = s.vehicles[0];
    v.hasExtinguisher = false;
    v.extinguisherDue = "";
    expect(clientMaintenance(s, client, now).items[0].level).toBe("missing");
    delete v.hasExtinguisher;
    expect(clientMaintenance(s, client, now).items[0].level).toBe("unknown");
    v.extinguisherDue = "2026-10-08";
    expect(clientMaintenance(s, client, now).items[0].level).toBe("due");
  });
  it("does not duplicate generated extinguisher notices or reopen resolved ones", () => {
    const s = fixture();
    s.reminders = [
      reminder("ext", { source: "extinguisher", dueKm: null, status: "done" }),
    ];
    const data = clientMaintenance(s, client, now);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].level).toBe("done");
  });
  it("filters category, urgency, owner vehicle, accented search and resolved history without truncation", () => {
    const s = fixture();
    s.reminders = Array.from({ length: 2105 }, (_, i) =>
      reminder("r" + i, { title: "Revisión de aceite", dueKm: 10000 }),
    );
    s.reminders.push(reminder("done", { status: "done" }));
    const rows = clientMaintenance(s, client, now).items,
      filter = {
        vehicle: "v1",
        category: "service",
        status: "attention",
        search: "revision",
        history: false,
      };
    expect(filterMaintenance(rows, filter)).toHaveLength(2105);
    expect(filterMaintenance(rows, { ...filter, vehicle: "v2" })).toEqual([]);
    expect(
      filterMaintenance(rows, {
        ...filter,
        search: "",
        status: "all",
        history: true,
      }).map((i) => i.id),
    ).toEqual(["done"]);
  });
  it("reports real/estimated readings, source and staleness without changing stored data", () => {
    const s = fixture(),
      v = s.vehicles[0],
      before = structuredClone(v),
      read = maintenanceReading(v, "2026-10-09");
    expect(read.real).toBe(10000);
    expect(read.estimated).toBeGreaterThan(read.real);
    expect(read.usage.source).toBe("visits");
    expect(read.stale).toBe(false);
    expect(maintenanceReading(v, "2027-01-09").stale).toBe(true);
    expect(v).toEqual(before);
    v.previousReadingDate = "";
    v.previousOdometer = null;
    expect(maintenanceReading(v, "2026-10-09").usage.source).toBe("age");
  });
});
