import { visitNotices } from "./visitNotices.js";
import { z } from "zod";
import { validateService, serviceAvailable, serviceLabel } from "./services.js";
import { purchaseOperations, validatePurchase } from "./purchases.js";
import {
  availableStock,
  assertReservation,
  reservedStock,
} from "./inventory.js";
import { billingOperations, cashExpected } from "./billing.js";
import {
  vehicleOperations,
  logReading,
  protectOpenReadings,
} from "./vehicles.js";
import { orderOperations } from "./orderOperations.js";
import {
  approvedLabor,
  billingItems,
  consumedItems,
  hasPendingAddition,
  orderEvent,
  workStage,
} from "./orders.js";
import { availability, agendaActive, duration } from "./agenda.js";
import { localDay } from "./dashboard.js";
import {
  permissionLabels,
  canCharge,
  canManage,
  date,
  key,
  round,
  schemas,
  today,
  vehicleYear,
  type Collection,
  type Entity,
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
  const permission = (p: import("./model.js").OperationPermission) =>
    requireThat(
      member.role === "owner" || member.permissions?.[p] !== false,
      "Tu acceso no tiene permiso para " +
        permissionLabels[p].toLowerCase() +
        ".",
    );
  if (
    [
      "chargeOrder",
      "sale",
      "sale.pay",
      "openCash",
      "closeCash",
      "payment.add",
      "payment.reverse",
    ].includes(cmd.action)
  )
    permission("charge");
  if (
    ["sale.discount", "payment.reverse"].includes(cmd.action) ||
    Number(cmd.discount ?? 0) > 0
  )
    permission("discounts");
  if (cmd.action === "vehicle.correctReading") permission("odometer");
  if (cmd.action === "deliverOrder") permission("delivery");
  if (
    ["order.create", "order.quote", "order.addition"].includes(cmd.action) &&
    cmd.labor !== undefined
  )
    permission("prices");
  if (
    cmd.action === "save" &&
    ["products", "services"].includes(String(cmd.collection))
  ) {
    const rows =
      cmd.collection === "products" ? original.products : original.services;
    const existing = rows.find((v) => v.id === cmd.id) as any;
    const values = cmd.data as any;
    if (
      !existing ||
      (cmd.collection === "products"
        ? values.price !== existing.price
        : values.labor !== existing.labor)
    )
      permission("prices");
  }
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
      if (sign < 0 && cmd.action !== "adjustStock")
        requireThat(
          availableStock(
            s,
            p,
            cmd.action === "finishOrder" ? String(cmd.id) : "",
          ) >= item.quantity,
          `Stock disponible insuficiente: ${p.name}. Hay insumos reservados para otras órdenes.`,
        );
      p.stock = round(p.stock + sign * item.quantity);
      s.movements.push({
        id: `${id}-${i}`,
        productId: p.id,
        branchId,
        quantity: sign * item.quantity,
        reason,
        date: now,
        by: member.uid,
        actorName: member.name,
        ...(cmd.action === "finishOrder" ? { orderId: String(cmd.id) } : {}),
        ...(cmd.action === "receivePurchase"
          ? { purchaseId: String(cmd.id), receiptId: id }
          : {}),
      });
    }
  };
  const complete = () => {
    s.notifications.push(...visitNotices(original, s, id, now));
    return s;
  };
  if (
    purchaseOperations(s, member, cmd, id, now, useStock) ||
    orderOperations(s, member, cmd, id, now) ||
    vehicleOperations(s, member, cmd, id, now) ||
    billingOperations(s, member, cmd, id, now, useStock)
  )
    return complete();
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
      requireThat(
        data.email === (existing as any).email,
        "El correo pertenece a su cuenta de acceso y no se modifica desde esta ficha.",
      );
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
        if (data.odometer !== v.odometer || data.readingDate !== v.readingDate)
          protectOpenReadings(s, v, data.odometer, data.readingDate);
        reading(v, data.odometer, data.readingDate);
        for (const field of [
          "oilSpecification",
          "oilCapacity",
          "compatibleFilters",
          "technicalNotes",
        ])
          if (
            !Object.hasOwn(cmd.data as object, field) &&
            (existing as any)[field] !== undefined
          )
            data[field] = (existing as any)[field];
        data.previousOdometer = v.previousOdometer;
        data.previousReadingDate = v.previousReadingDate;
      } else {
        data.previousOdometer = null;
        data.previousReadingDate = "";
      }
      if (
        !existing ||
        data.odometer !== (existing as Vehicle).odometer ||
        data.readingDate !== (existing as Vehicle).readingDate
      )
        logReading(
          s,
          { ...data, id: entityId } as Vehicle,
          existing as Vehicle | undefined,
          member,
          id,
          now,
          existing ? "reading" : "initial",
        );
      if (data.hasExtinguisher === false) data.extinguisherDue = "";
      const fireId = `fire-${entityId}`,
        hasReminder = s.reminders.some(
          (r) => r.vehicleId === entityId && r.source === "extinguisher",
        );
      if (
        !existing ||
        data.extinguisherDue !== (existing as Vehicle).extinguisherDue ||
        (data.extinguisherDue && !hasReminder) ||
        (!data.extinguisherDue && hasReminder)
      ) {
        s.reminders = s.reminders.filter(
          (r) => !(r.vehicleId === entityId && r.source === "extinguisher"),
        );
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
        const current = existing as Entity<"products">;
        requireThat(
          data.unit === current.unit ||
            (current.stock === 0 && reservedStock(s, current.id) === 0),
          "La unidad no se puede cambiar con stock o reservas existentes.",
        );
        for (const field of ["location", "compatibility"])
          if (
            !Object.hasOwn(cmd.data as object, field) &&
            (existing as any)[field] !== undefined
          )
            data[field] = (existing as any)[field];
        data.stock = current.stock;
      } else {
        requireThat(
          data.unit !== "unidad" || Number.isInteger(data.stock),
          "El stock inicial por unidad debe ser entero.",
        );
        requireThat(
          Math.abs(data.stock * 100 - Math.round(data.stock * 100)) < 0.00001,
          "El stock inicial admite hasta dos decimales.",
        );
        if (data.stock)
          s.movements.push({
            id,
            productId: entityId,
            branchId: data.branchId,
            quantity: data.stock,
            reason: "Stock inicial",
            date: now,
            by: member.uid,
            actorName: member.name,
          });
      }
    }
    if (collection === "services") {
      for (const field of [
        "variant",
        "category",
        "description",
        "durationMinutes",
        "branchId",
        "active",
      ])
        if (
          existing &&
          !Object.hasOwn(cmd.data as object, field) &&
          (existing as any)[field] !== undefined
        )
          data[field] = (existing as any)[field];
      validateService(s, { ...data, id: entityId });
    }
    if (collection === "branches") {
      for (const field of [
        "scheduleEnabled",
        "commercialName",
        "phone",
        "contactEmail",
        "hours",
        "closedDates",
        "technicians",
        "stations",
        "receptionChecklist",
        "deliveryChecklist",
      ])
        if (
          existing &&
          !Object.hasOwn(cmd.data as object, field) &&
          (existing as any)[field] !== undefined
        )
          data[field] = (existing as any)[field];
      data.appointmentCapacity ??= (existing as any)?.appointmentCapacity ?? 1;
      requireThat(
        new Set([
          ...(data.receptionChecklist ?? []),
          ...(data.deliveryChecklist ?? []),
        ]).size <= 20,
        "Usá hasta 20 controles distintos entre recepción y entrega.",
      );
      if (data.stations?.length)
        requireThat(
          data.stations.length === data.appointmentCapacity,
          "La cantidad de puestos debe coincidir con la capacidad.",
        );
      if (data.technicians)
        requireThat(
          new Set(data.technicians.map((v: string) => v.toLowerCase())).size ===
            data.technicians.length,
          "No repitas técnicos.",
        );
      const relevant = s.appointments.filter(
        (a) =>
          a.branchId === entityId && a.date >= localDay(now) && agendaActive(a),
      );
      const operational = (value: any) =>
        JSON.stringify({
          capacity: value?.appointmentCapacity ?? 1,
          hours: value?.hours,
          enabled: value?.scheduleEnabled,
          closed: value?.closedDates,
          technicians: value?.technicians,
        });
      for (const a of operational(data) !== operational(existing)
        ? relevant
        : []) {
        const problem = availability(
          { ...a, vehicleId: `capacity-${a.id}` },
          relevant.map((r) => ({
            ...r,
            technician: "",
            vehicleId: `capacity-${r.id}`,
          })),
          { ...data, id: entityId },
        );
        requireThat(
          !problem,
          `La configuración propuesta afecta turnos existentes. ${problem || ""}`,
        );
      }
    }
    if (collection === "appointments") {
      const old = existing as State["appointments"][number] | undefined;
      data.durationMinutes ??= old?.durationMinutes ?? 60;
      data.station ??= old?.station ?? 0;
      data.reschedules = old?.reschedules ?? [];
      delete data.plannedItems;
      delete data.planUpdatedAt;
      delete data.planUpdatedBy;
      if (old?.plannedItems && old.branchId === data.branchId) {
        data.plannedItems = old.plannedItems;
        if (old.planUpdatedAt) data.planUpdatedAt = old.planUpdatedAt;
        if (old.planUpdatedBy) data.planUpdatedBy = old.planUpdatedBy;
      }
      if (old?.orderId) {
        data.orderId = old.orderId;
        data.receivedAt = old.receivedAt;
        requireThat(
          data.vehicleId === old.vehicleId &&
            data.branchId === old.branchId &&
            data.date === old.date &&
            data.time === old.time &&
            data.durationMinutes === duration(old) &&
            data.station === (old.station ?? 0) &&
            data.status === old.status,
          "El turno ya recibido no puede reprogramarse, cancelarse ni marcarse ausente. Gestioná su orden.",
        );
      } else {
        delete data.orderId;
        delete data.receivedAt;
      }
      const moved =
        old &&
        (old.date !== data.date ||
          old.time !== data.time ||
          old.branchId !== data.branchId);
      if (moved) {
        requireThat(
          agendaActive(old) && agendaActive(data),
          "Reprogramá solamente turnos solicitados o confirmados.",
        );
        requireThat(
          !!data.rescheduleReason?.trim(),
          "Indicá el motivo de la reprogramación.",
        );
        data.reschedules = [
          ...data.reschedules,
          {
            at: now,
            by: member.uid,
            reason: data.rescheduleReason.trim(),
            fromDate: old.date,
            fromTime: old.time,
            fromBranchId: old.branchId,
            toDate: data.date,
            toTime: data.time,
            toBranchId: data.branchId,
          },
        ];
      }
      delete data.rescheduleReason;
      if (["cancelled", "no_show"].includes(data.status)) {
        requireThat(
          !!data.statusReason?.trim(),
          "Indicá el motivo de cancelación o ausencia.",
        );
        if (data.status === "no_show")
          requireThat(
            Date.parse(data.date + "T" + data.time + ":00-03:00") <=
              Date.parse(now),
            "No se puede marcar ausente antes del horario del turno.",
          );
      } else data.statusReason = "";
      const problem = availability(
        { ...data, id: entityId },
        s.appointments,
        find(s.branches, data.branchId, "Sucursal"),
      );
      requireThat(!problem, problem || "Turno no disponible.");
    }
    if (collection === "orders") {
      for (const field of [
        "receivedAt",
        "startedAt",
        "finishedAt",
        "deliveredAt",
        "deliveredBy",
        "appointmentId",
        "approval",
        "workStatus",
        "paymentStatus",
        "quoteRevision",
        "approvalHistory",
        "serviceSnapshots",
        "extraItems",
        "additions",
        "actualItems",
        "consumptionConfirmed",
        "consumptionNote",
        "recommendations",
        "photos",
        "events",
        "cancelledAt",
        "cancelReason",
      ]) {
        if (existing && (existing as any)[field] !== undefined)
          data[field] = (existing as any)[field];
        else if (field !== "appointmentId") delete data[field];
      }
      if (!existing) data.receivedAt = now;
      if (existing) {
        requireThat(
          data.vehicleId === (existing as any).vehicleId &&
            data.branchId === (existing as any).branchId &&
            data.serviceId === (existing as any).serviceId &&
            data.status === (existing as any).status,
          "La identidad, presupuesto y estado se gestionan desde la ficha de orden.",
        );
        requireThat(
          workStage(existing as any) !== "cancelled",
          "La orden está cancelada.",
        );
      } else {
        requireThat(
          data.status === "received",
          "Creá la orden recibida y registrá la autorización antes de comenzar.",
        );
        requireThat(
          !s.orders.some(
            (o) =>
              o.vehicleId === data.vehicleId &&
              (o.workStatus || o.status !== "paid") &&
              !["cancelled", "delivered"].includes(workStage(o)),
          ),
          "El vehículo ya tiene una orden abierta.",
        );
        data.approval = "pending";
        data.workStatus = "received";
        data.paymentStatus = "unpaid";
        data.quoteRevision = 1;
        data.consumptionConfirmed = false;
      }
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
      if (existing) {
        for (const field of [
          "serviceName",
          "labor",
          "items",
          "intervalKm",
          "intervalMonths",
        ])
          data[field] = (existing as any)[field];
      } else {
        const service = find(s.services, data.serviceId, "Servicio");
        requireThat(
          serviceAvailable(s, service, data.branchId),
          "Servicio inactivo o de otra sucursal.",
        );
        data.serviceName = serviceLabel(service);
        data.labor = service.labor;
        data.intervalKm = service.intervalKm;
        data.intervalMonths = service.intervalMonths;
        data.serviceSnapshots = [
          {
            serviceId: service.id,
            name: serviceLabel(service),
            labor: service.labor,
            intervalKm: service.intervalKm,
            intervalMonths: service.intervalMonths,
          },
        ];
        data.items = service.items.map((i) => {
          const p = find(s.products, i.productId, "Producto");
          requireThat(
            p.branchId === data.branchId,
            "El combo tiene productos de otra sucursal.",
          );
          return { ...i, name: p.name, price: p.price, cost: p.cost };
        });
        data.events = [
          {
            id,
            title: "Recepción y presupuesto",
            by: member.uid,
            at: now,
            note: "",
            actorName: member.name,
          },
        ];
      }
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
        data.status === "draft" &&
          (!existing || (existing as any).status === "draft") &&
          !(existing as any)?.receipts?.length,
        "Sólo se puede editar una compra sin recepciones ni cancelación.",
      );
      delete data.receipts;
      delete data.cancelledAt;
      delete data.cancelledBy;
      delete data.cancelReason;
      validatePurchase(s, data);
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
      o.status === "received" && !o.deliveredAt && workStage(o) !== "cancelled",
      "La orden no está pendiente de comenzar.",
    );
    requireThat(
      o.approval !== "pending" &&
        o.approval !== "rejected" &&
        !hasPendingAddition(o),
      "El presupuesto necesita aprobación antes de comenzar.",
    );
    const reception =
      s.branches.find((b) => b.id === o.branchId)?.receptionChecklist ?? [];
    requireThat(
      reception.every((c) => o.checklist.includes(c)),
      "Completá los controles obligatorios de recepción: " +
        reception.filter((c) => !o.checklist.includes(c)).join(", "),
    );
    o.status = "working";
    o.startedAt = now;
    o.workStatus = "working";
    assertReservation(s, o);
    orderEvent(o, id, "Trabajo iniciado", member.uid, now, "", member.name);
  } else if (cmd.action === "deliverOrder") {
    requireThat(cashier, "Tu rol no permite entregar vehículos.");
    const o = find(s.orders, cmd.id, "Orden");
    requireThat(
      o.status === "paid",
      "Cobrá la orden antes de entregar el vehículo.",
    );
    requireThat(!o.deliveredAt, "El vehículo ya fue entregado.");
    const delivery =
      s.branches.find((b) => b.id === o.branchId)?.deliveryChecklist ?? [];
    requireThat(
      delivery.every((c) => o.checklist.includes(c)),
      "Completá los controles obligatorios de entrega: " +
        delivery.filter((c) => !o.checklist.includes(c)).join(", "),
    );
    o.deliveredAt = now;
    o.deliveredBy = member.uid;
    o.workStatus = "delivered";
    orderEvent(o, id, "Vehículo entregado", member.uid, now, "", member.name);
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
    requireThat(
      workStage(o) !== "cancelled" &&
        o.approval !== "pending" &&
        o.approval !== "rejected" &&
        !hasPendingAddition(o),
      "Resolvé todas las autorizaciones antes de finalizar.",
    );
    requireThat(
      !o.workStatus || o.consumptionConfirmed,
      "Confirmá los consumos reales antes de finalizar.",
    );
    requireThat(
      !o.quoteRevision || !!o.startedAt,
      "Comenzá la atención antes de finalizar.",
    );
    const v = find(s.vehicles, o.vehicleId);
    const beforeReading = structuredClone(v);
    reading(v, o.odometer, o.date);
    logReading(s, v, beforeReading, member, id, now, "service", "", o.id);
    useStock(consumedItems(o), o.branchId, -1, `Servicio ${o.id}`);
    o.status = "ready";
    o.finishedAt = now;
    o.workStatus = "ready";
    o.paymentStatus = "unpaid";
    orderEvent(o, id, "Servicio finalizado", member.uid, now, "", member.name);
    const snapshots = o.serviceSnapshots ?? [
      {
        serviceId: o.serviceId,
        name: o.serviceName || find(s.services, o.serviceId).name,
        intervalKm: o.intervalKm,
        intervalMonths: o.intervalMonths,
      },
    ];
    for (const r of s.reminders)
      if (
        r.vehicleId === v.id &&
        snapshots.some((snapshot) => snapshot.serviceId === r.source)
      )
        r.status = "done";
    for (const [index, snapshot] of snapshots.entries())
      if (snapshot.intervalKm || snapshot.intervalMonths) {
        const d = new Date(o.date + "T12:00:00Z");
        const day = d.getUTCDate();
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() + snapshot.intervalMonths);
        d.setUTCDate(
          Math.min(
            day,
            new Date(
              Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
            ).getUTCDate(),
          ),
        );
        s.reminders.push({
          id: index ? `${id}-${index}` : id,
          vehicleId: v.id,
          customerId: v.customerId,
          title: snapshot.name,
          dueDate: snapshot.intervalMonths ? d.toISOString().slice(0, 10) : "",
          dueKm: snapshot.intervalKm ? o.odometer + snapshot.intervalKm : null,
          status: "active",
          source: snapshot.serviceId,
        });
      }
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
    c.expected = cashExpected(s, c);
    c.closedAt = now;
  } else if (cmd.action === "reading") {
    const v = ownVehicle(cmd.id),
      beforeReading = structuredClone(v);
    reading(
      v,
      z.number().int().min(0).max(5e6).parse(cmd.odometer),
      date.parse(cmd.date),
    );
    protectOpenReadings(s, v, v.odometer, v.readingDate);
    if (
      v.odometer !== beforeReading.odometer ||
      v.readingDate !== beforeReading.readingDate
    )
      logReading(s, v, beforeReading, member, id, now, "reading");
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
    // Portal requests do not assign staff, stations, lifecycle fields or history.
    data.durationMinutes = 60;
    data.station = 0;
    data.technician = "";
    delete data.orderId;
    delete data.receivedAt;
    delete data.plannedItems;
    delete data.planUpdatedAt;
    delete data.planUpdatedBy;
    delete data.reschedules;
    delete data.rescheduleReason;
    delete data.statusReason;
    const problem = availability(
      { ...data, id },
      s.appointments,
      find(s.branches, data.branchId, "Sucursal"),
    );
    requireThat(!problem, problem || "Turno no disponible.");
    s.appointments.push({ ...data, id, vehicleId: v.id });
  } else if (cmd.action === "readNotice") {
    const n = find(s.notifications, cmd.id);
    requireThat(
      role === "customer" && n.customerId === member.customerId,
      "Aviso ajeno.",
    );
    n.read = true;
  } else throw new Error("Acción desconocida.");
  return complete();
}
