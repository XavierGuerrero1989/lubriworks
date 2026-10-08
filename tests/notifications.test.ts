import { describe, it, expect } from "vitest";
import {
  defaultNotificationSettings,
  reminderStage,
  renderNotice,
  notificationSettingsSchema,
} from "../shared/notifications";
import { demoState } from "../shared/demo";
import { execute } from "../shared/engine";
const s = demoState(),
  v = s.vehicles[0];
describe("notification rules", () => {
  it("uses configurable date and km anticipation", () => {
    const r = { ...s.reminders[0], dueDate: "2026-11-01", dueKm: null };
    expect(
      reminderStage(
        r,
        v,
        { ...defaultNotificationSettings(), daysBefore: 5 },
        "2026-10-20",
      ).soon,
    ).toBe(false);
    expect(
      reminderStage(
        r,
        v,
        { ...defaultNotificationSettings(), daysBefore: 15 },
        "2026-10-20",
      ).soon,
    ).toBe(true);
    expect(
      reminderStage(
        { ...r, dueDate: "", dueKm: v.odometer + 100 },
        v,
        defaultNotificationSettings(),
        v.readingDate,
      ).soon,
    ).toBe(true);
  });
  it("disables an entire rule or a category", () => {
    const r = {
      ...s.reminders[0],
      id: "fire-v1",
      source: "extinguisher",
      dueDate: "2020-01-01",
      dueKm: null,
    };
    expect(
      reminderStage(r, v, {
        ...defaultNotificationSettings(),
        extinguisher: false,
      }).soon,
    ).toBe(false);
    expect(
      reminderStage(r, v, { ...defaultNotificationSettings(), enabled: false })
        .soon,
    ).toBe(false);
  });
  it("renders only supported placeholders and validates configuration", () => {
    expect(
      renderNotice(defaultNotificationSettings(), "Aceite", true),
    ).toContain("Aceite: vencido");
    expect(() => notificationSettingsSchema.parse({ repeats: 99 })).toThrow();
  });
  it("keeps customer notification preferences when staff edits the profile", () => {
    s.customers[0].notificationPreferences = {
      maintenance: false,
      extinguisher: true,
      messages: false,
    };
    const member = {
      uid: "owner",
      tenantId: "alpha",
      role: "owner" as const,
      active: true,
      name: "Owner",
      email: "o@test.local",
      customerId: null,
    };
    const result = execute(
      s,
      member,
      {
        action: "save",
        collection: "customers",
        id: s.customers[0].id,
        data: { ...s.customers[0], notificationPreferences: undefined },
      },
      "save-prefs",
    );
    expect(result.customers[0].notificationPreferences?.maintenance).toBe(
      false,
    );
  });
});
