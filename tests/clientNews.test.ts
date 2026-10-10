import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import { clientNews } from "../shared/clientNews";
import { customerNotices } from "../shared/clientAccount";
import { execute } from "../shared/engine";
const customer = {
    ...demoAccess.member,
    role: "customer" as const,
    customerId: "c1",
  },
  now = "2026-10-09T15:00:00Z";
describe("customer home news", () => {
  it("requires an active linked customer", () => {
    const state = demoState();
    for (const m of [
      demoAccess.member,
      { ...customer, active: false },
      { ...customer, customerId: "missing" },
    ])
      expect(clientNews(state, m, now)).toEqual({
        maintenance: [],
        messages: [],
      });
  });
  it("shows current own goals without reopening resolved reminders or duplicating sent reminders", () => {
    const state = demoState();
    let data = clientNews(state, customer, now);
    expect(data.maintenance.find((i) => i.id === "r1")).toBeDefined();
    expect(data.maintenance.every((i) => i.vehicle.customerId === "c1")).toBe(
      true,
    );
    expect(data.messages).toEqual([]);
    state.reminders.find((r) => r.id === "r1")!.status = "done";
    data = clientNews(state, customer, now);
    expect(data.maintenance.find((i) => i.id === "r1")).toBeUndefined();
    expect(data.messages).toEqual([]);
  });
  it("prioritizes missing or expired extinguisher and retains scheduled service goals", () => {
    const state = demoState();
    state.vehicles[0].hasExtinguisher = false;
    state.vehicles[0].extinguisherDue = "";
    expect(
      clientNews(state, customer, now).maintenance.some(
        (i) => i.level === "missing",
      ),
    ).toBe(true);
    state.vehicles[0].hasExtinguisher = true;
    state.vehicles[0].extinguisherDue = "2026-10-08";
    const data = clientNews(state, customer, now);
    expect(data.maintenance[0].category).toBe("extinguisher");
    expect(data.maintenance[0].level).toBe("due");
    expect(data.maintenance.some((i) => i.category === "service")).toBe(true);
  });
  it("shows promotions received by the customer newest first, preserving text and read messages", () => {
    const state = demoState();
    const message = {
      id: "promo",
      customerId: "c1",
      vehicleId: "",
      title: "15% en filtros",
      body: "Hasta el viernes. Consultá condiciones.",
      date: now,
      category: "messages" as const,
      origin: "manual" as const,
      read: false,
    };
    state.notifications = [
      message,
      { ...message, id: "older", date: "2026-10-01T15:00:00Z", read: true },
      { ...message, id: "foreign", customerId: "c2" },
      { ...message, id: "visit", origin: "operational", category: "visit" },
    ];
    const data = clientNews(state, customer, now);
    expect(data.messages.map((n) => n.id)).toEqual(["promo", "older"]);
    expect(data.messages[0].body).toBe(message.body);
    const after = execute(
      state,
      customer,
      { action: "readNotices", ids: ["promo"] },
      "read-promo",
    );
    expect(clientNews(after, customer, now).messages[0].read).toBe(true);
    expect(after.reminders).toEqual(state.reminders);
  });
  it("hides withdrawn promotions from news while preserving inbox and read state, and supports restoring", () => {
    const state = demoState();
    state.notifications = [
      {
        id: "withdrawn",
        customerId: "c1",
        vehicleId: "",
        title: "Promo",
        body: "Condiciones",
        date: now,
        read: false,
        category: "messages",
        newsHiddenAt: now,
      },
    ];
    expect(clientNews(state, customer, now).messages).toEqual([]);
    expect(customerNotices(state, customer)).toHaveLength(1);
    expect(state.notifications[0].read).toBe(false);
    delete state.notifications[0].newsHiddenAt;
    expect(clientNews(state, customer, now).messages.map((n) => n.id)).toEqual([
      "withdrawn",
    ]);
  });
  it("does not cap stored news or mutate the source while preparing the preview", () => {
    const state = demoState();
    state.notifications = Array.from({ length: 2105 }, (_, i) => ({
      id: "m" + i,
      customerId: "c1",
      vehicleId: "",
      title: "Promo",
      body: "Condiciones",
      date: now,
      read: false,
      category: "messages" as const,
    }));
    const before = structuredClone(state);
    expect(clientNews(state, customer, now).messages).toHaveLength(2105);
    expect(state).toEqual(before);
  });
});
