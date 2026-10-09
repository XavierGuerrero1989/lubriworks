import { paymentLabel } from "../../shared/billing";
import { useState } from "react";
import {
  canManage,
  dueInfo,
  estimatedKm,
  monthlyUsage,
  today,
  vehicleYear,
  type Access,
  type State,
  type Vehicle,
} from "../../shared/model";
import { orderTotal, workStage, type Order } from "../../shared/orders";
import type { Command } from "../../shared/engine";
import {
  Badge,
  Empty,
  FormDialog,
  SearchBox,
  Section,
  fmtDate,
  money,
  number,
  type Dialog,
} from "./ui";
import "./customers.css";
type Props = {
  state: State;
  access: Access;
  run: (c: Command) => Promise<void>;
  onNewCustomer: () => void;
  onVehicle: (v?: Vehicle, customerId?: string) => void;
  onCustomer: (c: State["customers"][number]) => void;
  onReading: (v: Vehicle) => void;
  onOrder: (o: Order) => void;
  onNewOrder: (v: Vehicle) => void;
  onAppointment: (v: Vehicle) => void;
  onAgenda: () => void;
  focusVehicleId: string;
  onSelection: (id: string) => void;
};
const normal = (s: string) =>
  s
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f\s-]/g, "");
const stamp = (s: string) =>
  new Date(s).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
const readingLabels = {
  initial: "Alta del vehículo",
  reading: "Lectura real",
  service: "Servicio finalizado",
  correction: "Corrección autorizada",
};
export function CustomerDesk({
  state: s,
  access,
  run,
  onNewCustomer,
  onVehicle,
  onCustomer,
  onReading,
  onOrder,
  onNewOrder,
  onAppointment,
  onAgenda,
  focusVehicleId,
  onSelection,
}: Props) {
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState("vehicles"),
    [customerId, setCustomerId] = useState(
      s.vehicles.find((v) => v.id === focusVehicleId)?.customerId || "",
    ),
    [vehicleId, setVehicleId] = useState(focusVehicleId),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const manager = canManage(access.member.role),
    technical = access.member.role !== "cashier";
  const owner = (id: string) => s.customers.find((c) => c.id === id),
    branch = (id: string) => s.branches.find((b) => b.id === id)?.name || "—";
  const vehicles = s.vehicles.filter((v) =>
    normal(
      `${v.plate} ${v.brand} ${v.model} ${owner(v.customerId)?.name} ${owner(v.customerId)?.email} ${owner(v.customerId)?.phone}`,
    ).includes(normal(query)),
  );
  const clients = s.customers.filter((c) =>
    normal(
      `${c.name} ${c.email} ${c.phone} ${s.vehicles
        .filter((v) => v.customerId === c.id)
        .map((v) => `${v.plate} ${v.brand} ${v.model}`)
        .join(" ")}`,
    ).includes(normal(query)),
  );
  const c =
    owner(customerId) ||
    (mode === "vehicles" ? owner(vehicles[0]?.customerId) : clients[0]);
  const owned = c ? s.vehicles.filter((v) => v.customerId === c.id) : [];
  const v =
    owned.find((v) => v.id === vehicleId) ||
    (!vehicleId ? undefined : owned[0]);
  const selected =
    v || (!customerId && mode === "vehicles" ? vehicles[0] : undefined);
  const related = (vehicle: string, client: string) =>
    selected ? vehicle === selected.id : client === c?.id;
  const orders = s.orders
    .filter((o) => related(o.vehicleId, o.customerId))
    .sort((a, b) =>
      (b.receivedAt || b.date).localeCompare(a.receivedAt || a.date),
    );
  const active = orders.filter(
    (o) =>
      !["delivered", "cancelled"].includes(workStage(o)) &&
      (o.status !== "paid" ||
        o.workStatus ||
        o.receivedAt ||
        o.finishedAt ||
        o.date === today()),
  );
  const appointments = s.appointments
    .filter((a) => related(a.vehicleId, a.customerId))
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const upcoming = appointments
    .filter(
      (a) =>
        ["confirmed", "requested"].includes(a.status) &&
        !a.orderId &&
        a.date >= today(),
    )
    .slice()
    .reverse();
  const reminders = s.reminders.filter(
    (r) => r.status === "active" && related(r.vehicleId, r.customerId),
  );
  const recommendations = s.vehicleRecommendations
    .filter((r) => related(r.vehicleId, r.customerId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const history = s.vehicleReadings
    .filter((r) => related(r.vehicleId, r.customerId))
    .sort((a, b) => b.at.localeCompare(a.at));
  const latest = orders.find((o) => ["ready", "paid"].includes(o.status));
  const pickVehicle = (v: Vehicle) => {
    setCustomerId(v.customerId);
    setVehicleId(v.id);
    onSelection(v.id);
  };
  const pickCustomer = (id: string) => {
    setCustomerId(id);
    setVehicleId("");
    onSelection("");
  };
  const correct = () =>
    selected &&
    setDialog({
      title: `Corregir kilometraje · ${selected.plate}`,
      description:
        "Sólo administrador o encargado. Se conserva la lectura anterior y el motivo. La estimación de uso vuelve a basarse en el año hasta contar con nuevas lecturas comparables. No modifica las órdenes históricas ni los mantenimientos programados.",
      fields: [
        {
          key: "odometer",
          label: "Kilometraje correcto",
          type: "number",
          step: "1",
          min: 0,
          value: selected.odometer,
        },
        {
          key: "date",
          label: "Fecha de la lectura correcta",
          type: "date",
          value: selected.readingDate,
        },
        {
          key: "reason",
          label: "Motivo de la corrección",
          type: "textarea",
          maxLength: 1000,
        },
      ],
      submit: async (data) =>
        run({ action: "vehicle.correctReading", id: selected.id, ...data }),
    });
  const recommend = () =>
    selected &&
    setDialog({
      title: `Recomendación para el cliente · ${selected.plate}`,
      description:
        "Escribí algo claro para compartir con el cliente. Se guarda separado de las observaciones internas; la presentación en su portal se incorporará en la etapa del cliente.",
      fields: [
        {
          key: "text",
          label: "Recomendación",
          type: "textarea",
          maxLength: 1000,
        },
      ],
      submit: async (data) =>
        run({ action: "vehicle.recommendation.add", id: selected.id, ...data }),
    });
  const resolve = (r: State["vehicleRecommendations"][number]) =>
    setDialog({
      title: "Resolver recomendación",
      description: r.text,
      fields: [
        {
          key: "resolution",
          label: "Cómo se resolvió",
          type: "textarea",
          maxLength: 1000,
        },
      ],
      submit: async (data) =>
        run({
          action: "vehicle.recommendation.resolve",
          id: r.vehicleId,
          recommendationId: r.id,
          ...data,
        }),
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Clientes y vehículos</h1>
          <p>Cliente, ficha técnica y todas sus visitas en un mismo lugar.</p>
        </div>
        <div className="row-actions">
          {manager && (
            <button className="button primary" onClick={onNewCustomer}>
              + Cliente
            </button>
          )}
          <button
            className="button primary"
            onClick={() => onVehicle(undefined, c?.id)}
          >
            + Vehículo
          </button>
        </div>
      </div>
      <div className="toolbar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Buscar patente, cliente, teléfono o modelo…"
        />
        <div className="segmented">
          <button
            className={mode === "vehicles" ? "active" : ""}
            onClick={() => setMode("vehicles")}
          >
            Vehículos
          </button>
          <button
            className={mode === "clients" ? "active" : ""}
            onClick={() => setMode("clients")}
          >
            Clientes
          </button>
        </div>
      </div>
      <Section
        title={
          mode === "vehicles"
            ? `${vehicles.length} vehículos encontrados`
            : `${clients.length} clientes encontrados`
        }
      >
        <div className="customer-results">
          {mode === "vehicles"
            ? vehicles.map((v) => (
                <button
                  className={selected?.id === v.id ? "selected" : ""}
                  key={v.id}
                  onClick={() => pickVehicle(v)}
                >
                  <strong>
                    {v.plate} · {v.brand} {v.model}
                  </strong>
                  <span>{owner(v.customerId)?.name}</span>
                  <small>
                    {vehicleYear(v)} · {number(v.odometer)} km reales
                  </small>
                </button>
              ))
            : clients.map((c) => (
                <button
                  className={c.id === customerId ? "selected" : ""}
                  key={c.id}
                  onClick={() => pickCustomer(c.id)}
                >
                  <strong>{c.name}</strong>
                  <span>{c.email}</span>
                  <small>
                    {s.vehicles.filter((v) => v.customerId === c.id).length}{" "}
                    vehículos · {c.phone || "Sin teléfono"}
                  </small>
                </button>
              ))}
        </div>
        {!(mode === "vehicles" ? vehicles.length : clients.length) && (
          <Empty text="No encontramos coincidencias. Probá otra patente, nombre o teléfono." />
        )}
      </Section>
      {c && (
        <div className="customer-file">
          <section className="panel customer-profile">
            <div>
              <small>FICHA DE TODA LA EMPRESA</small>
              <h2>{c.name}</h2>
              <p>
                {c.email} · {c.phone || "Sin teléfono"}
              </p>
            </div>
            <div className="row-actions">
              <button className="button" onClick={() => onCustomer(c)}>
                Editar cliente
              </button>
              <button
                className="button"
                onClick={() => onVehicle(undefined, c.id)}
              >
                Agregar vehículo
              </button>
            </div>
            <label>
              Vehículo de la ficha
              <select
                aria-label="Vehículo de la ficha"
                value={selected?.id || ""}
                onChange={(e) => {
                  setCustomerId(c.id);
                  setVehicleId(e.target.value);
                  onSelection(e.target.value);
                }}
              >
                <option value="">Todos los vehículos del cliente</option>
                {owned.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} · {v.brand} {v.model}
                  </option>
                ))}
              </select>
            </label>
            <p className="customer-internal">
              <strong>Notas internas del cliente:</strong>{" "}
              {c.notes || "Sin notas internas"}
            </p>
          </section>
          <div className="customer-summary">
            <div>
              <small>Último servicio finalizado</small>
              <strong>{latest ? fmtDate(latest.date) : "Sin servicios"}</strong>
              <span>
                {latest?.serviceName || "Todavía no hay servicios finalizados."}
              </span>
            </div>
            <div>
              <small>Próximo turno</small>
              <strong>
                {upcoming[0]
                  ? `${fmtDate(upcoming[0].date)} · ${upcoming[0].time}`
                  : "Sin turno próximo"}
              </strong>
              <span>
                {upcoming[0]
                  ? branch(upcoming[0].branchId)
                  : "Podés reservar desde esta ficha."}
              </span>
            </div>
            <div>
              <small>Recomendaciones pendientes</small>
              <strong>
                {recommendations.filter((r) => r.status === "pending").length}
              </strong>
              <span>Separadas de las notas internas.</span>
            </div>
          </div>
          {selected && (
            <section className="panel customer-vehicle">
              <div>
                <h2>
                  {selected.plate} · {selected.brand} {selected.model}
                </h2>
                <p>
                  Año {vehicleYear(selected)} · Última lectura:{" "}
                  <strong>{number(selected.odometer)} km</strong> al{" "}
                  {fmtDate(selected.readingDate)}
                </p>
                <p>
                  Estimación de hoy: {number(estimatedKm(selected))} km · Uso
                  promedio: {number(monthlyUsage(selected).km)} km/mes (
                  {monthlyUsage(selected).source === "visits"
                    ? "entre lecturas reales"
                    : "aproximado según el año"}
                  ).
                </p>
              </div>
              <div className="row-actions">
                <button className="button" onClick={() => onVehicle(selected)}>
                  Editar vehículo / ficha técnica
                </button>
                <button className="button" onClick={() => onReading(selected)}>
                  Nueva lectura real
                </button>
                {manager && (
                  <button className="button" onClick={correct}>
                    Corregir kilometraje
                  </button>
                )}
                <button
                  className="button primary"
                  onClick={() => onNewOrder(selected)}
                >
                  Recibir sin turno
                </button>
                <button
                  className="button"
                  onClick={() => onAppointment(selected)}
                >
                  Agendar turno
                </button>
              </div>
              <dl className="customer-technical">
                <div>
                  <dt>Especificación del aceite</dt>
                  <dd>{selected.oilSpecification || "Sin registrar"}</dd>
                </div>
                <div>
                  <dt>Capacidad de aceite</dt>
                  <dd>
                    {selected.oilCapacity
                      ? `${number(selected.oilCapacity)} litros`
                      : "Sin registrar"}
                  </dd>
                </div>
                <div>
                  <dt>Filtros compatibles</dt>
                  <dd>{selected.compatibleFilters || "Sin registrar"}</dd>
                </div>
                <div>
                  <dt>Matafuegos</dt>
                  <dd>
                    {selected.hasExtinguisher === false
                      ? "No tiene"
                      : selected.extinguisherDue
                        ? `Vence ${fmtDate(selected.extinguisherDue)}${selected.extinguisherDue < today() ? " · Vencido" : ""}`
                        : "Sin información"}
                    {selected.wantsExtinguisher &&
                      " · Quiere comprar uno nuevo"}
                  </dd>
                </div>
              </dl>
              <p className="customer-internal">
                <strong>Observaciones técnicas internas:</strong>{" "}
                {selected.technicalNotes || "Sin observaciones técnicas"}
              </p>
            </section>
          )}
          {!owned.length && (
            <Empty text="Este cliente todavía no tiene vehículos. Agregá el primero para registrar sus visitas." />
          )}
          <Section
            title="Visita actual"
            subtitle="Órdenes abiertas de cualquiera de las sucursales."
          >
            <div className="customer-content">
              {active.length ? (
                active.map((o) => (
                  <article className="customer-row" key={o.id}>
                    <div>
                      <strong>
                        {s.vehicles.find((v) => v.id === o.vehicleId)?.plate} ·{" "}
                        {o.serviceName}
                      </strong>
                      <p>
                        {branch(o.branchId)} ·{" "}
                        {o.technician || "Sin técnico asignado"}
                      </p>
                      <Badge value={workStage(o)} />{" "}
                      <Badge value={paymentLabel(o)} />
                    </div>
                    <div>
                      <strong>{money(orderTotal(o))}</strong>
                      <button className="button" onClick={() => onOrder(o)}>
                        Abrir orden
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p>Sin visitas abiertas.</p>
              )}
            </div>
          </Section>
          <div className="customer-grid">
            <Section title="Próximos mantenimientos">
              <div className="customer-content">
                {reminders.length ? (
                  reminders.map((r) => {
                    const v = s.vehicles.find((v) => v.id === r.vehicleId);
                    if (!v) return null;
                    const info = dueInfo(r, v);
                    return (
                      <article className="customer-maintenance" key={r.id}>
                        <strong>
                          {r.title} · {v.plate}
                        </strong>
                        <p>
                          {r.dueKm !== null ? `${number(r.dueKm)} km` : ""}
                          {r.dueKm !== null && r.dueDate ? " o " : ""}
                          {r.dueDate ? `antes del ${fmtDate(r.dueDate)}` : ""}
                        </p>
                        <Badge
                          value={
                            info.overdue
                              ? "warning"
                              : info.soon
                                ? "warning"
                                : "ok"
                          }
                        >
                          {info.overdue
                            ? "Vencido / kilometraje estimado alcanzado"
                            : info.soon
                              ? "Próximo"
                              : "Programado"}
                        </Badge>
                        <p>
                          {info.remaining !== null
                            ? `${number(info.remaining)} km estimados restantes`
                            : "Vencimiento por fecha"}
                        </p>
                        <button
                          className="text-button"
                          onClick={() => onAppointment(v)}
                        >
                          Agendar mantenimiento
                        </button>
                      </article>
                    );
                  })
                ) : (
                  <p>No hay mantenimientos activos.</p>
                )}
              </div>
            </Section>
            <Section
              title="Recomendaciones para el cliente"
              subtitle="Información para compartir, separada de las notas internas."
              action={
                selected && technical ? (
                  <button className="text-button" onClick={recommend}>
                    + Recomendación
                  </button>
                ) : undefined
              }
            >
              <div className="customer-content">
                {recommendations.length ? (
                  recommendations.map((r) => (
                    <article className="customer-maintenance" key={r.id}>
                      <strong>
                        {s.vehicles.find((v) => v.id === r.vehicleId)?.plate}
                      </strong>
                      <Badge
                        value={r.status === "resolved" ? "done" : "warning"}
                      >
                        {r.status === "resolved" ? "Resuelta" : "Pendiente"}
                      </Badge>
                      <p>{r.text}</p>
                      <small>
                        {stamp(r.createdAt)} · {r.actorName}
                      </small>
                      {r.resolution && (
                        <p>
                          Resolución: {r.resolution} ·{" "}
                          {fmtDate(r.resolvedAt || "")}
                        </p>
                      )}
                      {r.status === "pending" && technical && (
                        <button
                          className="text-button"
                          onClick={() => resolve(r)}
                        >
                          Marcar resuelta
                        </button>
                      )}
                    </article>
                  ))
                ) : (
                  <p>
                    Sin recomendaciones registradas.
                    {!selected && " Elegí un vehículo para agregar una."}
                  </p>
                )}
                <small>
                  La presentación de estas recomendaciones en el portal se
                  incorporará en la etapa del cliente.
                </small>
              </div>
            </Section>
          </div>
          <Section
            title="Historial de visitas"
            subtitle="Trabajos, kilometraje e importes registrados; incluye las órdenes canceladas."
          >
            <div className="table-scroll">
              <table className="customer-history">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Vehículo / servicio</th>
                    <th>Km de ingreso</th>
                    <th>Trabajo / cobro</th>
                    <th>Importe</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td>{fmtDate(o.date)}</td>
                      <td>
                        <strong>
                          {s.vehicles.find((v) => v.id === o.vehicleId)?.plate}{" "}
                          · {o.serviceName}
                        </strong>
                        <small>{branch(o.branchId)}</small>
                      </td>
                      <td>{number(o.odometer)}</td>
                      <td>
                        <Badge value={workStage(o)} />{" "}
                        <Badge value={paymentLabel(o)} />
                      </td>
                      <td>{money(orderTotal(o))}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => onOrder(o)}
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!orders.length && (
              <Empty text="Todavía no hay visitas registradas." />
            )}
          </Section>
          <Section
            title="Turnos del cliente"
            action={
              <button className="text-button" onClick={onAgenda}>
                Abrir Agenda
              </button>
            }
          >
            <div className="customer-content">
              {appointments.length ? (
                appointments.map((a) => (
                  <article className="customer-row" key={a.id}>
                    <div>
                      <strong>
                        {fmtDate(a.date)} · {a.time} ·{" "}
                        {s.vehicles.find((v) => v.id === a.vehicleId)?.plate}
                      </strong>
                      <p>
                        {a.reason} · {branch(a.branchId)}
                      </p>
                      <Badge value={a.status} />
                      {a.orderId && <small>Vinculado a una visita</small>}
                    </div>
                    {a.orderId && s.orders.find((o) => o.id === a.orderId) && (
                      <button
                        className="button"
                        onClick={() =>
                          onOrder(s.orders.find((o) => o.id === a.orderId)!)
                        }
                      >
                        Ver orden
                      </button>
                    )}
                  </article>
                ))
              ) : (
                <p>Sin turnos registrados.</p>
              )}
            </div>
          </Section>
          <Section
            title="Lecturas y correcciones de kilometraje"
            subtitle="Cada corrección conserva la lectura anterior, fecha, responsable y motivo."
          >
            <div className="customer-content">
              {history.length ? (
                history.map((r) => (
                  <article className="customer-maintenance" key={r.id}>
                    <strong>
                      {readingLabels[r.source]} ·{" "}
                      {s.vehicles.find((v) => v.id === r.vehicleId)?.plate}
                    </strong>
                    <p>
                      {number(r.odometer)} km · Lectura del{" "}
                      {fmtDate(r.readingDate)}
                    </p>
                    {r.beforeOdometer !== null && (
                      <small>
                        Anterior: {number(r.beforeOdometer)} km ·{" "}
                        {fmtDate(r.beforeDate)}
                      </small>
                    )}
                    <small>
                      {stamp(r.at)} · {r.actorName}
                    </small>
                    {r.reason && <p>Motivo: {r.reason}</p>}
                  </article>
                ))
              ) : (
                <p>
                  Las lecturas anteriores al registro de historial se conservan
                  en el vehículo. Los nuevos cambios aparecerán acá.
                </p>
              )}
            </div>
          </Section>
        </div>
      )}
      {dialog && (
        <FormDialog
          key={dialog.title}
          dialog={dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
