import { it, expect } from "vitest";
import { findGuides, guides } from "../src/help/guides";
it("matches common questions and accents to the relevant instructions", () => {
  const allowed = [
    "customers",
    "services",
    "orders",
    "notifications",
    "settings",
  ];
  expect(
    findGuides("¿Cómo doy de alta un cliente?", "staff", allowed, "orders")[0]
      .id,
  ).toBe("staff-customer");
  expect(
    findGuides("¿Cuándo vuelve el auto?", "staff", allowed, "orders")[0].id,
  ).toBe("staff-interval");
  expect(
    findGuides(
      "cambiar mi contraseña",
      "customer",
      ["profile", "vehicles"],
      "vehicles",
    )[0].id,
  ).toBe("client-profile");
});
it("only exposes guides and destinations from the viewer's scope and permitted navigation", () => {
  const results = findGuides("", "staff", ["orders", "customers"], "orders");
  expect(
    results.every(
      (g) =>
        g.scope === "staff" && ["orders", "customers"].includes(g.destination),
    ),
  ).toBe(true);
  expect(results.some((g) => g.id === "staff-cash")).toBe(false);
  expect(
    findGuides("empresa", "customer", ["profile", "vehicles"], "profile"),
  ).toEqual([]);
});
it("offers contextual guides first and does not fabricate an answer to an unknown question", () => {
  expect(findGuides("", "staff", ["orders", "customers"], "orders")[0].id).toBe(
    "staff-order",
  );
  expect(
    findGuides(
      "xyzxyz desconocidisimo",
      "customer",
      ["profile", "vehicles"],
      "vehicles",
    ),
  ).toEqual([]);
});
it("provides actionable instructions and valid destinations for all supported portals", () => {
  const destinations = {
    staff: [
      "dashboard",
      "customers",
      "orders",
      "appointments",
      "services",
      "products",
      "purchases",
      "sales",
      "notifications",
      "settings",
      "reports",
    ],
    customer: ["vehicles", "history", "reminders", "notifications", "profile"],
    platform: ["overview", "tenants", "support", "audit", "help"],
  };
  for (const g of guides) {
    expect(destinations[g.scope]).toContain(g.destination);
    expect(g.steps.length).toBeGreaterThan(1);
  }
});

it("recognizes plural expressions in common queries", () => {
  expect(findGuides("usuarios", "staff", ["settings"], "settings")[0].id).toBe(
    "staff-settings",
  );
});
