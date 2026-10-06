import { z } from "zod";
export const key = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,128}$/, "Identificador inválido");
export const roles = [
  "owner",
  "manager",
  "technician",
  "cashier",
  "customer",
] as const;
export type Role = (typeof roles)[number];
export const roleLabels: Record<Role, string> = {
  owner: "Administrador",
  manager: "Encargado",
  technician: "Técnico",
  cashier: "Caja",
  customer: "Cliente",
};
export type Tenant = {
  id: string;
  name: string;
  active: boolean;
  schemaVersion: 1;
  createdAt: string;
};
export type Member = {
  uid: string;
  tenantId: string;
  role: Role;
  active: boolean;
  name: string;
  email: string;
  customerId: string | null;
};
export type Access = { tenant: Tenant; member: Member };
const name = z.string().trim().min(1, "Completá el nombre").max(120);
const text = z.string().trim().max(1000).default("");
const money = z.number().finite().min(0).max(1e10);
const km = z.number().int().min(0).max(5e6);
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Fecha inválida",
  );
const optionalDate = z.union([date, z.literal("")]).default("");
export const schemas = {
  branches: z.object({ name, address: text }),
  customers: z.object({
    name,
    email: z.string().email(),
    phone: z.string().max(40).default(""),
    notes: text,
    pushEnabled: z.boolean().default(true),
  }),
  vehicles: z.object({
    customerId: key,
    plate: z
      .string()
      .trim()
      .min(4)
      .max(12)
      .transform((v) => v.toUpperCase().replace(/\s/g, "")),
    brand: name,
    model: name,
    firstRegistration: date,
    odometer: km,
    readingDate: date,
    previousOdometer: km.nullable().default(null),
    previousReadingDate: optionalDate,
    extinguisherDue: optionalDate,
  }),
  products: z.object({
    name,
    sku: z.string().trim().min(1).max(60),
    unit: z.enum(["unidad", "litro"]),
    price: money,
    cost: money,
    minStock: z.number().min(0).max(1e6),
    branchId: key,
    stock: z.number().min(0).max(1e6),
  }),
  suppliers: z.object({
    name,
    email: z.union([z.string().email(), z.literal("")]).default(""),
    phone: z.string().max(40).default(""),
  }),
  services: z.object({
    name,
    labor: money,
    intervalKm: z.number().int().min(0).max(100000),
    intervalMonths: z.number().int().min(0).max(120),
    items: z
      .array(
        z.object({ productId: key, quantity: z.number().positive().max(1000) }),
      )
      .max(30)
      .default([]),
  }),
  appointments: z.object({
    customerId: key,
    vehicleId: key,
    branchId: key,
    date: date,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    reason: name,
    status: z.enum(["requested", "confirmed", "completed", "cancelled"]),
    technician: z.string().max(120).default(""),
  }),
  orders: z.object({
    customerId: key,
    vehicleId: key,
    branchId: key,
    serviceId: key,
    odometer: km,
    date: date,
    technician: z.string().max(120).default(""),
    notes: text,
    checklist: z.array(z.string().max(80)).max(20).default([]),
    status: z
      .enum(["received", "working", "ready", "paid"])
      .default("received"),
    serviceName: z.string().max(120).default(""),
    items: z
      .array(
        z.object({
          productId: key,
          name: z.string().max(120).default(""),
          quantity: z.number().positive().max(1000),
          price: money,
          cost: money,
        }),
      )
      .max(30),
    labor: money,
    intervalKm: z.number().int().min(0).max(100000),
    intervalMonths: z.number().int().min(0).max(120),
  }),
  purchases: z.object({
    supplierId: key,
    branchId: key,
    date: date,
    items: z
      .array(
        z.object({
          productId: key,
          quantity: z.number().positive().max(1e6),
          cost: money,
        }),
      )
      .min(1)
      .max(50),
    status: z.enum(["draft", "received"]).default("draft"),
  }),
};
export type Collection = keyof typeof schemas;
export type Entity<T extends Collection> = z.infer<(typeof schemas)[T]> & {
  id: string;
};
export type Vehicle = Entity<"vehicles">;
export type Reminder = {
  id: string;
  customerId: string;
  vehicleId: string;
  title: string;
  dueDate: string;
  dueKm: number | null;
  status: "active" | "done";
  source: string;
};
export type Sale = {
  id: string;
  customerId: string | null;
  branchId: string;
  orderId: string | null;
  date: string;
  total: number;
  cost: number;
  method: "cash" | "transfer" | "card";
  items: { name: string; quantity: number; price: number }[];
};
export type CashSession = {
  id: string;
  branchId: string;
  openedAt: string;
  closedAt: string | null;
  opening: number;
  counted: number | null;
  expected: number | null;
  uid: string;
};
export type Movement = {
  id: string;
  productId: string;
  branchId: string;
  quantity: number;
  reason: string;
  date: string;
};
export type Notice = {
  id: string;
  customerId: string;
  vehicleId: string;
  title: string;
  body: string;
  date: string;
  read: boolean;
};
export type State = { [K in Collection]: Entity<K>[] } & {
  reminders: Reminder[];
  sales: Sale[];
  cash: CashSession[];
  movements: Movement[];
  notifications: Notice[];
};
export const collections = [
  "branches",
  "customers",
  "vehicles",
  "products",
  "suppliers",
  "services",
  "appointments",
  "orders",
  "purchases",
  "reminders",
  "sales",
  "cash",
  "movements",
  "notifications",
] as const;
export type StateCollection = (typeof collections)[number];
export function emptyState(): State {
  return Object.fromEntries(
    collections.map((k) => [k, []]),
  ) as unknown as State;
}
export function assertAccess(
  tenant: Tenant | null,
  member: Member | null,
  uid: string,
  tenantId: string,
): Access {
  key.parse(tenantId);
  key.parse(uid);
  if (
    !tenant ||
    tenant.id !== tenantId ||
    tenant.schemaVersion !== 1 ||
    !tenant.active ||
    !member ||
    !member.active ||
    member.uid !== uid ||
    member.tenantId !== tenantId ||
    !roles.includes(member.role) ||
    (member.role === "customer" && !member.customerId)
  )
    throw new Error("Acceso denegado: empresa o membresía inactiva.");
  return { tenant, member };
}
export const canManage = (r: Role) => r === "owner" || r === "manager";
export const canCharge = (r: Role) => canManage(r) || r === "cashier";
export function visibleCollections(role: Role): StateCollection[] {
  if (role === "customer")
    return [
      "branches",
      "customers",
      "vehicles",
      "orders",
      "appointments",
      "reminders",
      "notifications",
      "sales",
    ];
  if (role === "technician")
    return [
      "branches",
      "customers",
      "vehicles",
      "orders",
      "appointments",
      "reminders",
      "services",
      "products",
    ];
  if (role === "cashier")
    return [
      "branches",
      "customers",
      "vehicles",
      "orders",
      "appointments",
      "services",
      "products",
      "sales",
      "cash",
      "reminders",
    ];
  return [...collections];
}
export function projectState(state: State, member: Member): State {
  const out = emptyState();
  for (const collection of visibleCollections(member.role)) {
    let rows: unknown[] = state[collection];
    if (member.role === "customer" && collection !== "branches")
      rows = rows.filter((r) =>
        collection === "customers"
          ? (r as any).id === member.customerId
          : (r as any).customerId === member.customerId,
      );
    (out as any)[collection] = structuredClone(rows);
  }
  if (member.role === "customer") {
    out.customers = out.customers.map((c) => ({ ...c, notes: "" }));
    out.orders = out.orders.map((o) => ({
      ...o,
      notes: "",
      items: o.items.map((i) => ({ ...i, cost: 0 })),
    }));
    out.sales = out.sales.map((s) => ({ ...s, cost: 0 }));
  }
  if (!canManage(member.role)) {
    out.products = out.products.map((p) => ({ ...p, cost: 0 }));
    out.orders = out.orders.map((o) => ({
      ...o,
      items: o.items.map((i) => ({ ...i, cost: 0 })),
    }));
    out.sales = out.sales.map((v) => ({ ...v, cost: 0 }));
  }
  return out;
}
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const round = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;
export function monthlyUsage(v: Vehicle): {
  km: number;
  source: "visits" | "age";
} {
  const end = Date.parse(v.readingDate);
  if (v.previousReadingDate && v.previousOdometer !== null) {
    const days = (end - Date.parse(v.previousReadingDate)) / 864e5;
    if (days >= 7 && v.odometer >= v.previousOdometer)
      return {
        km: Math.round(((v.odometer - v.previousOdometer) / days) * 30.4375),
        source: "visits",
      };
  }
  const months = (end - Date.parse(v.firstRegistration)) / 864e5 / 30.4375;
  return {
    km: months > 0 ? Math.round(v.odometer / Math.max(months, 1)) : 0,
    source: "age",
  };
}
export function estimatedKm(v: Vehicle, asOf = today()): number {
  return Math.round(
    v.odometer +
      (Math.max(0, (Date.parse(asOf) - Date.parse(v.readingDate)) / 864e5) /
        30.4375) *
        monthlyUsage(v).km,
  );
}
export function addMonths(value: string, months: number): string {
  const d = new Date(value + "T12:00:00Z"),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const max = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, max));
  return d.toISOString().slice(0, 10);
}
export function dueInfo(reminder: Reminder, vehicle: Vehicle, asOf = today()) {
  const usage = monthlyUsage(vehicle).km,
    remaining =
      reminder.dueKm === null
        ? null
        : reminder.dueKm - estimatedKm(vehicle, asOf);
  const kmDate =
    remaining !== null && usage > 0
      ? new Date(
          Date.parse(asOf) + (Math.max(0, remaining) / usage) * 30.4375 * 864e5,
        )
          .toISOString()
          .slice(0, 10)
      : "";
  const effective = [reminder.dueDate, kmDate].filter(Boolean).sort()[0] || "";
  const days = effective
    ? Math.ceil((Date.parse(effective) - Date.parse(asOf)) / 864e5)
    : null;
  const overdue =
    (days !== null && days < 0) || (remaining !== null && remaining <= 0);
  const soon =
    overdue ||
    (days !== null && days <= 15) ||
    (remaining !== null && remaining <= 500);
  return { effective, days, remaining, overdue, soon };
}
