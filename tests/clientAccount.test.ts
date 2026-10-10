import { describe, it, expect } from "vitest";
import { demoState, demoAccess } from "../shared/demo";
import { execute } from "../shared/engine";
import {
  accountPreferences,
  customerNotices,
  noticeDestination,
} from "../shared/clientAccount";
import type { Notice } from "../shared/model";
const client = {
  ...demoAccess.member,
  role: "customer" as const,
  customerId: "c1",
};
const notice = (id: string, extra: Partial<Notice> = {}): Notice => ({
  id,
  customerId: "c1",
  vehicleId: "v1",
  title: "Revisión de aceite",
  body: "Recordatorio",
  date: "2026-10-10T01:30:00Z",
  read: false,
  ...extra,
});
describe("customer account and inbox", () => {
  it("requires an active customer and never returns another customer's notices", () => {
    const s = demoState();
    s.notifications = [notice("mine"), notice("foreign", { customerId: "c2" })];
    expect(customerNotices(s, client).map((n) => n.id)).toEqual(["mine"]);
    expect(customerNotices(s, demoAccess.member)).toEqual([]);
    expect(customerNotices(s, { ...client, active: false })).toEqual([]);
    expect(customerNotices(s, { ...client, customerId: "missing" })).toEqual(
      [],
    );
  });
  it("filters by local Argentina day, vehicle, category, read state and accented search", () => {
    const s = demoState();
    s.notifications = [
      notice("mine", { category: "maintenance" }),
      notice("other", { read: true, category: "messages" }),
    ];
    const filter = {
      from: "2026-10-09",
      to: "2026-10-09",
      vehicle: "v1",
      category: "maintenance",
      status: "unread",
      search: "revision",
    };
    expect(customerNotices(s, client, filter).map((n) => n.id)).toEqual([
      "mine",
    ]);
    expect(
      customerNotices(s, client, { ...filter, from: "2026-10-10" }),
    ).toEqual([]);
    expect(customerNotices(s, client, { ...filter, vehicle: "v2" })).toEqual(
      [],
    );
    expect(
      customerNotices(s, client, { status: "read" }).map((n) => n.id),
    ).toEqual(["other"]);
  });
  it("does not truncate a large inbox and leaves source records unchanged", () => {
    const s = demoState();
    s.notifications = Array.from({ length: 2105 }, (_, i) => notice("n" + i));
    const before = structuredClone(s);
    expect(customerNotices(s, client)).toHaveLength(2105);
    expect(s).toEqual(before);
  });
  it("routes operational notices to visits or turns, reminders to maintenance and manual messages nowhere", () => {
    expect(noticeDestination(notice("manual"))).toBe("none");
    expect(noticeDestination(notice("old", { reminderId: "r1" }))).toBe(
      "maintenance",
    );
    expect(
      noticeDestination(notice("fire", { category: "extinguisher" })),
    ).toBe("maintenance");
    expect(
      noticeDestination(
        notice("visit", { origin: "operational", orderId: "ot1001" }),
      ),
    ).toBe("visit");
    expect(noticeDestination(notice("turn", { category: "visit" }))).toBe(
      "appointments",
    );
  });
  it("preserves category selections when push is disabled and restricts profile edits to the owner's fields", () => {
    const s = demoState(),
      before = structuredClone(s);
    const out = execute(
      s,
      client,
      {
        action: "profile",
        data: {
          name: "Cliente actualizado",
          phone: "123",
          pushEnabled: false,
          notificationPreferences: {
            visit: false,
            maintenance: true,
            extinguisher: false,
            messages: true,
          },
          email: "forged@test.local",
          notes: "forged",
        },
      },
      "account-profile",
    );
    expect(accountPreferences(out, client)).toEqual({
      pushEnabled: false,
      visit: false,
      maintenance: true,
      extinguisher: false,
      messages: true,
    });
    expect(out.customers[0].email).toBe(before.customers[0].email);
    expect(out.customers[0].notes).toBe(before.customers[0].notes);
    expect(out.customers[1]).toEqual(before.customers[1]);
  });
  it("marks only chosen owned notices and never changes visits or reminders", () => {
    const s = demoState();
    s.notifications = [notice("a"), notice("b")];
    const out = execute(
      s,
      client,
      { action: "readNotices", ids: ["a", "a"] },
      "read-account",
    );
    expect(out.notifications.map((n) => n.read)).toEqual([true, false]);
    expect(out.orders).toEqual(s.orders);
    expect(out.reminders).toEqual(s.reminders);
    expect(s.notifications[0].read).toBe(false);
  });
  it("rejects foreign/missing notices atomically, staff, inactive users and invalid batches", () => {
    const s = demoState();
    s.notifications = [notice("a"), notice("foreign", { customerId: "c2" })];
    for (const ids of [
      ["a", "foreign"],
      ["a", "missing"],
      [],
      Array(101).fill("a"),
    ])
      expect(() =>
        execute(s, client, { action: "readNotices", ids }, "bad-account"),
      ).toThrow();
    expect(() =>
      execute(
        s,
        demoAccess.member,
        { action: "readNotices", ids: ["a"] },
        "staff-account",
      ),
    ).toThrow();
    expect(() =>
      execute(
        s,
        { ...client, active: false },
        { action: "readNotices", ids: ["a"] },
        "inactive-account",
      ),
    ).toThrow();
    expect(s.notifications.every((n) => !n.read)).toBe(true);
  });
});
