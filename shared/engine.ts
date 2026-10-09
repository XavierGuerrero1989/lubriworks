import { z } from "zod";
import {
  canCharge,
  canManage,
  date,
  key,
  round,
  schemas,
  today,
  vehicleYear,
  type Collection,
  type Member,
  type State,
  type Vehicle,
} from "./model.js";
export type Command = { action: string; [key: string]: unknown };
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const find = <T extends { id: string }>(
  rows: T[],
  id: unknown,
  label = "Registro",
) => {
  const row = rows.find((r) => r.id === id);
  requireThat(row, `${label} no encontrado en esta empresa.`);
  return row;
};
function reading(v: Vehicle, odometer: number, readingDate: string) {
  requireThat(odometer >= v.odometer, "El kilometraje no puede disminuir.");
  requireThat(
    readingDate >= v.readingDate && readingDate <= today(),
    "La fecha de lectura debe ser posterior a la última y no futura.",
  );
  if (
    readingDate > v.readingDate &&
    (!v.previousReadingDate ||
      (Date.parse(readingDate) - Date.parse(v.readingDate)) / 864e5 >= 7)
  ) {
    v.previousOdometer = v.odometer;
    v.previousReadingDate = v.readingDate;
  }
  v.odometer = odometer;
  v.readingDate = readingDate;
}
export function execute(
  original: State,
  member: Member,
  cmd: Command,
  operationId: string,
  now = new Date().toISOString(),
): State {
  requireThat(member.active, "Membresía inactiva.");
  key.parse(operationId);
  const s = structuredClone(original),
    id = operationId,
    role = member.role;
  const manager = canManage(role),
    cashier = canCharge(role),
    staff = role !== "customer";
  const ownVehicle = (vehicleId: unknown) => {
    const v = find(s.vehicles, vehicleId, "Vehículo");
    requireThat(staff || v.customerId === member.customerId, "Vehículo ajeno.");
    return v;
  };
  const useStock = (
    items: { productId: string; quantity: number }[],
    branchId: string,
    sign: number,
    reason: string,
  ) => {
    for (const [i, item] of items.entries()) {
      const p = find(s.products, item.productId, "Producto");
      requireThat(
        p.branchId === branchId,
        "El producto pertenece a otra sucursal.",
      );
      requireThat(
        p.unit !== "unidad" || Number.isInteger(item.quantity),
        "Los productos por unidad requieren cantidades enteras.",
      );
      requireThat(
        Math.abs(item.quantity * 100 - Math.round(item.quantity * 100)) <
          0.00001,
        "Usá hasta dos decimales para litros.",
      );
      requireThat(
        sign > 0 || p.stock >= item.quantity,
        `Stock insuficiente: ${p.name}.`,
      );
      p.stock = round(p.stock + sign * item.quantity);
      s.movements.push({
        id: `${id}-${i}`,
        productId: p.id,
        branchId,
        quantity: sign * item.quantity,
        reason,
        date: now,
      });
    }
  };
  if (cmd.action === "save") {
    const collection = z
      .enum(Object.keys(schemas) as [Collection, ...Collection[]])
      .parse(cmd.collection);
    requireThat(
      manager ||
        ((role === "cashier" || role === "technician") &&
          ["customers", "vehicles", "appointments", "orders"].includes(
            collection,
          )),
      "Tu rol no permite modificar este módulo.",
    );
    const entityId = cmd.id ? key.parse(cmd.id) : id;
    const existing = (s[collection] as { id: string }[]).find(
      (r) => r.id === entityId,
    );
    requireThat(!cmd.id || existing, "Registro inexistente.");
    const data = schemas[collection].parse(cmd.data) as any;
    if (data.customerId) find(s.customers, data.customerId, "Cliente");
    if (data.vehicleId) {
      const v = find(s.vehicles, data.vehicleId, "Vehículo");
      requireThat(
        v.customerId === data.customerId,
        "El vehículo no pertenece al cliente.",
      );
    }
    if (data.branchId) find(s.branches, data.branchId, "Sucursal");
    if (collection === "customers" && existing) {
      if ((existing as any).notificationPreferences)
        data.notificationPreferences = (
          existing as any
        ).notificationPreferences;
    }
    if (collection === "customers" && existing && !manager) {
      data.notes = (existing as any).notes;
    }
    if (collection === "vehicles") {
      requireThat(
        vehicleYear(data) <= Number(data.readingDate.slice(0, 4)) &&
          data.readingDate <= today(),
        "Revisá el año del vehículo y la fecha de lectura.",
      );
      requireThat(
        !s.vehicles.some((v) => v.plate === data.plate && v.id !== entityId),
        "Ya existe un vehículo con esa patente.",
      );
      if (existing) {
        requireThat(
          data.customerId === (existing as any).customerId,
          "No se puede transferir la titularidad desde este formulario.",
        );
        const v = structuredClone(existing) as Vehicle;
        reading(v, data.odometer, data.readingDate);
        data.previousOdometer = v.previousOdometer;
        data.previousReadingDate = v.previousReadingDate;
      } else {
        data.previousOdometer = null;
        data.previousReadingDate = "";
      }
      if (data.hasExtinguisher === false) data.extinguisherDue = "";
      const fireId = `fire-${entityId}`;
      s.reminders = s.reminders.filter((r) => r.id !== fireId);
      if (data.extinguisherDue)
        s.reminders.push({
          id: fireId,
          vehicleId: entityId,
          customerId: data.customerId,
          title: "Renovación de matafuegos",
          dueDate: data.extinguisherDue,
          dueKm: null,
          status: "active",
          source: "extinguisher",
        });
    }
    if (collection === "products") {
      requireThat(
        data.unit !== "unidad" ||
          Number.isInteger(existing ? (existing as any).stock : data.stock),
        "Los productos por unidad requieren stock entero.",
      );
      requireThat(
        !s.products.some(
          (p) =>
            p.sku === data.sku &&
            p.branchId === data.branchId &&
            p.id !== entityId,
        ),
        "Ese código ya existe en la sucursal.",
      );
      if (existing) {
        requireThat(
          data.branchId === (existing as any).branchId,
          "No se puede mover un producto entre sucursales.",
        );
        data.stock = (existing as any).stock;
      } else if (data.stock)
        s.movements.push({
          id,
          productId: entityId,
          branchId: data.branchId,
          quantity: data.stock,
          reason: "Stock inicial",
          date: now,
        });
    }
    if (collection === "services")
      for (const item of data.items) {
        const p = find(s.products, item.productId, "Producto del combo");
        requireThat(
          p.unit !== "unidad" || Number.isInteger(item.quantity),
          "Los productos por unidad requieren cantidades enteras.",
        );
      }
    if (collection === "appointments") {
      if (existing && (existing as any).orderId) {
        data.orderId = (existing as any).orderId;
        data.receivedAt = (existing as any).receivedAt;
        requireThat(
          data.vehicleId === (existing as any).vehicleId &&
            data.branchId === (existing as any).branchId,
          "El turno recibido conserva vehículo y sucursal.",
        );
      } else {
        delete data.orderId;
        delete data.receivedAt;
      }
    }
    if (collection === "appointments")
      requireThat(
        !s.appointments.some(
          (a) =>
            a.id !== entityId &&
            a.branchId === data.branchId &&
            a.date === data.date &&
            a.time === data.time &&
            !["cancelled", "completed"].includes(a.status) &&
            !["cancelled", "completed"].includes(data.status),
        ),
        "Ese horario ya está reservado en la sucursal.",
      );
    if (collection === "orders") {
      for (const field of [
        "receivedAt",
        "startedAt",
        "finishedAt",
        "deliveredAt",
        "deliveredBy",
        "appointmentId",
        "approval",
      ]) {
        if (existing && (existing as any)[field] !== undefined)
          data[field] = (existing as any)[field];
        else if (field !== "appointmentId") delete data[field];
      }
      if (!existing) data.receivedAt = now;
      if (data.status === "working") data.startedAt ??= now;
      if (data.appointmentId) {
        const appointment = find(s.appointments, data.appointmentId, "Turno");
        requireThat(
          appointment.vehicleId === data.vehicleId &&
            appointment.branchId === data.branchId &&
            appointment.customerId === data.customerId,
          "El turno no coincide con el vehículo, cliente o sucursal.",
        );
        requireThat(
          !appointment.orderId || appointment.orderId === entityId,
          "Este turno ya fue recibido.",
        );
        requireThat(
          existing || ["requested", "confirmed"].includes(appointment.status),
          "El turno no está disponible para recepción.",
        );
        appointment.orderId = entityId;
        appointment.receivedAt ??= now;
        if (appointment.status === "requested")
          appointment.status = "confirmed";
      }
      requireThat(
        !(existing as any)?.status ||
          !["ready", "paid"].includes((existing as any).status),
        "La orden ya cerrada no se puede editar.",
      );
      requireThat(
        ["received", "working"].includes(data.status),
        "Usá Finalizar servicio para cerrar la orden.",
      );
      const service = find(s.services, data.serviceId, "Servicio");
      data.serviceName = service.name;
      data.labor = service.labor;
      data.intervalKm = service.intervalKm;
      data.intervalMonths = service.intervalMonths;
      data.items = service.items.map((i) => {
        const p = find(s.products, i.productId, "Producto");
        requireThat(
          p.branchId === data.branchId,
          "El combo tiene productos de otra sucursal.",
        );
        return { ...i, name: p.name, price: p.price, cost: p.cost };
      });
      requireThat(
        data.date <= today(),
        "La orden no puede tener fecha futura.",
      );
      const v = find(s.vehicles, data.vehicleId);
      requireThat(
        data.odometer >= v.odometer,
        "El kilometraje no puede disminuir.",
      );
    }
    if (collection === "purchases") {
      find(s.suppliers, data.supplierId, "Proveedor");
      requireThat(
        data.status === "draft" && (existing as any)?.status !== "received",
        "La compra recibida es inmutable.",
      );
      for (const i of data.items) {
        const p = find(s.products, i.productId);
        requireThat(p.branchId === data.branchId, "Producto de otra sucursal.");
      }
    }
    const rows = s[collection] as any[];
    const index = rows.findIndex((r) => r.id === entityId);
    const entity = { ...data, id: entityId };
    if (index < 0) rows.push(entity);
    else rows[index] = entity;
  } else if (cmd.action === "startOrder") {
    requireThat(
      staff && role !== "cashier",
      "Tu rol no permite comenzar servicios.",
    );
    const o = find(s.orders, cmd.id, "Orden");
    requireThat(
      o.status === "received" && !o.deliveredAt,
      "La orden no está pendiente de comenzar.",
    );
    requireThat(
      o.approval !== "pending" && o.approval !== "rejected",
      "El presupuesto necesita aprobación antes de comenzar.",
    );
    o.status = "working";
    o.startedAt = now;
  } else if (cmd.action === "deliverOrder") {
    requireThat(cashier, "Tu rol no permite entregar vehículos.");
    const o = find(s.orders, cmd.id, "Orden");
    requireThat(
      o.status === "paid",
      "Cobrá la orden antes de entregar el vehículo.",
    );
    requireThat(!o.deliveredAt, "El vehículo ya fue entregado.");
    o.deliveredAt = now;
    o.deliveredBy = member.uid;
    if (o.appointmentId)
      find(s.appointments, o.appointmentId, "Turno").status = "completed";
  } else if (cmd.action === "finishOrder") {
    requireThat(
      staff && role !== "cashier",
      "Tu rol no permite finalizar servicios.",
    );
    const o = find(s.orders, cmd.id, "Orden");
    requireThat(
      ["received", "working"].includes(o.status),
      "La orden ya fue finalizada.",
    );
    const v = find(s.vehicles, o.vehicleId);
    reading(v, o.odometer, o.date);
    useStock(o.items, o.branchId, -1, `Servicio ${o.id}`);
    o.status = "ready";
    o.finishedAt = now;
    for (const r of s.reminders)
      if (r.vehicleId === v.id && r.source === o.serviceId) r.status = "done";
    if (o.intervalKm || o.intervalMonths) {
      const d = new Date(o.date + "T12:00:00Z");
      const day = d.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + o.intervalMonths);
      d.setUTCDate(
        Math.min(
          day,
          new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        ),
      );
      s.reminders.push({
        id,
        vehicleId: v.id,
        customerId: v.customerId,
        title: find(s.services, o.serviceId).name,
        dueDate: o.intervalMonths ? d.toISOString().slice(0, 10) : "",
        dueKm: o.intervalKm ? o.odometer + o.intervalKm : null,
        status: "active",
        source: o.serviceId,
      });
    }
  } else if (cmd.action === "chargeOrder" || cmd.action === "sale") {
    requireThat(cashier, "Tu rol no permite cobrar.");
    const method = z.enum(["cash", "transfer", "card"]).parse(cmd.method);
    let branchId: string,
      customerId: string | null = null,
      orderId: string | null = null,
      total = 0,
      cost = 0,
      items: { name: string; quantity: number; price: number }[] = [];
    if (cmd.action === "chargeOrder") {
      const o = find(s.orders, cmd.id, "Orden");
      requireThat(
        o.status === "ready",
        "La orden debe estar finalizada y sin cobrar.",
      );
      branchId = o.branchId;
      customerId = o.customerId;
      orderId = o.id;
      items = o.items.map((i) => ({
        name: find(s.products, i.productId).name,
        quantity: i.quantity,
        price: i.price,
      }));
      items.push({ name: "Mano de obra", quantity: 1, price: o.labor });
      total = round(items.reduce((n, i) => n + i.quantity * i.price, 0));
      cost = round(o.items.reduce((n, i) => n + i.quantity * i.cost, 0));
      o.status = "paid";
    } else {
      branchId = key.parse(cmd.branchId);
      find(s.branches, branchId);
      const lines = z
        .array(
          z.object({
            productId: key,
            quantity: z.number().positive().max(1000),
          }),
        )
        .min(1)
        .max(30)
        .parse(cmd.items);
      for (const i of lines) {
        const p = find(s.products, i.productId);
        items.push({ name: p.name, quantity: i.quantity, price: p.price });
        total += i.quantity * p.price;
        cost += i.quantity * p.cost;
      }
      total = round(total);
      cost = round(cost);
      useStock(lines, branchId, -1, "Venta directa");
    }
    requireThat(
      s.cash.some((c) => c.branchId === branchId && !c.closedAt),
      "Abrí la caja de esta sucursal antes de cobrar.",
    );
    s.sales.push({
      id,
      branchId,
      customerId,
      orderId,
      date: now,
      total,
      cost,
      method,
      items,
    });
  } else if (cmd.action === "receivePurchase") {
    requireThat(manager, "Sólo administración puede recibir compras.");
    const p = find(s.purchases, cmd.id, "Compra");
    requireThat(p.status === "draft", "La compra ya fue recibida.");
    useStock(p.items, p.branchId, 1, `Compra ${p.id}`);
    for (const line of p.items)
      find(s.products, line.productId).cost = line.cost;
    p.status = "received";
  } else if (cmd.action === "adjustStock") {
    requireThat(manager, "Sólo administración puede ajustar stock.");
    const p = find(s.products, cmd.id);
    const quantity = z
      .number()
      .finite()
      .min(-1e6)
      .max(1e6)
      .refine((n) => n !== 0)
      .parse(cmd.quantity);
    const reason = z.string().trim().min(5).max(200).parse(cmd.reason);
    requireThat(p.stock + quantity >= 0, "El ajuste dejaría stock negativo.");
    useStock(
      [{ productId: p.id, quantity: Math.abs(quantity) }],
      p.branchId,
      quantity > 0 ? 1 : -1,
      reason,
    );
  } else if (cmd.action === "openCash") {
    requireThat(cashier, "Tu rol no permite operar caja.");
    const branchId = key.parse(cmd.branchId);
    find(s.branches, branchId);
    requireThat(
      !s.cash.some((c) => c.branchId === branchId && !c.closedAt),
      "La caja ya está abierta.",
    );
    s.cash.push({
      id,
      branchId,
      openedAt: now,
      closedAt: null,
      opening: z.number().min(0).max(1e10).parse(cmd.opening),
      counted: null,
      expected: null,
      uid: member.uid,
    });
  } else if (cmd.action === "closeCash") {
    requireThat(cashier, "Tu rol no permite operar caja.");
    const c = find(s.cash, cmd.id);
    requireThat(!c.closedAt, "La caja ya está cerrada.");
    c.counted = z.number().min(0).max(1e10).parse(cmd.counted);
    c.expected = round(
      c.opening +
        s.sales
          .filter(
            (a) =>
              a.branchId === c.branchId &&
              a.date >= c.openedAt &&
              a.method === "cash",
          )
          .reduce((n, a) => n + a.total, 0),
    );
    c.closedAt = now;
  } else if (cmd.action === "reading") {
    const v = ownVehicle(cmd.id);
    reading(
      v,
      z.number().int().min(0).max(5e6).parse(cmd.odometer),
      date.parse(cmd.date),
    );
  } else if (cmd.action === "profile") {
    requireThat(role === "customer", "Acción exclusiva del portal.");
    const c = find(s.customers, member.customerId);
    const data = schemas.customers
      .pick({ name: true, phone: true, pushEnabled: true })
      .parse(cmd.data);
    Object.assign(c, data);
  } else if (cmd.action === "requestAppointment") {
    requireThat(role === "customer", "Acción exclusiva del portal.");
    const v = ownVehicle(cmd.vehicleId);
    const data = schemas.appointments.parse({
      ...cmd,
      customerId: member.customerId,
      status: "requested",
    });
    find(s.branches, data.branchId);
    requireThat(data.date >= today(), "Elegí una fecha futura.");
    requireThat(
      !s.appointments.some(
        (a) =>
          a.branchId === data.branchId &&
          a.date === data.date &&
          a.time === data.time &&
          !["cancelled", "completed"].includes(a.status),
      ),
      "Ese horario ya está reservado.",
    );
    s.appointments.push({ ...data, id, vehicleId: v.id });
  } else if (cmd.action === "readNotice") {
    const n = find(s.notifications, cmd.id);
    requireThat(
      role === "customer" && n.customerId === member.customerId,
      "Aviso ajeno.",
    );
    n.read = true;
  } else throw new Error("Acción desconocida.");
  return s;
}
