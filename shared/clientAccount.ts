import { preferencesSchema } from "./notifications.js";
import { localDay } from "./dashboard.js";
import type { Member, Notice, State } from "./model.js";
export function accountCustomer(s: State, m: Member) {
  return m.active && m.role === "customer"
    ? s.customers.find((c) => c.id === m.customerId)
    : undefined;
}
export function accountPreferences(s: State, m: Member) {
  const c = accountCustomer(s, m);
  return preferencesSchema.parse({
    ...c?.notificationPreferences,
    pushEnabled: c?.pushEnabled === true,
  });
}
export function noticeCategory(n: Notice) {
  return n.origin === "operational" || n.category === "visit"
    ? "visit"
    : n.category || (n.reminderId ? "maintenance" : "messages");
}
export function customerNotices(
  s: State,
  m: Member,
  filter: {
    search?: string;
    vehicle?: string;
    category?: string;
    status?: string;
    from?: string;
    to?: string;
  } = {},
) {
  if (
    !accountCustomer(s, m) ||
    (filter.from && filter.to && filter.from > filter.to)
  )
    return [];
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  return s.notifications
    .filter((n) => n.customerId === m.customerId)
    .filter((n) => {
      const v = s.vehicles.find(
          (v) => v.id === n.vehicleId && v.customerId === m.customerId,
        ),
        day = localDay(n.date);
      return (
        (!filter.vehicle ||
          filter.vehicle === "all" ||
          n.vehicleId === filter.vehicle) &&
        (!filter.category ||
          filter.category === "all" ||
          noticeCategory(n) === filter.category) &&
        (!filter.status ||
          filter.status === "all" ||
          (filter.status === "unread" ? !n.read : n.read)) &&
        (!filter.from || day >= filter.from) &&
        (!filter.to || day <= filter.to) &&
        norm(
          `${n.title} ${n.body} ${v?.plate ?? ""} ${v?.brand ?? ""} ${v?.model ?? ""}`,
        ).includes(norm(filter.search ?? ""))
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
export function noticeDestination(n: Notice) {
  return noticeCategory(n) === "visit"
    ? n.orderId
      ? "visit"
      : "appointments"
    : ["maintenance", "extinguisher"].includes(noticeCategory(n))
      ? "maintenance"
      : "none";
}
