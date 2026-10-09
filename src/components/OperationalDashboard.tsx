import { orderTotal } from "../../shared/orders";
import { useEffect, useState } from "react";
import {
  CalendarDays,
  Car,
  Clock,
  UserRound,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import {
  canCharge,
  type Access,
  type Entity,
  type State,
} from "../../shared/model";
import {
  operationalBoard,
  elapsedMinutes,
  dashboardStages,
  type DashboardStage,
  type DashboardOrder,
} from "../../shared/dashboard";
import { Badge, Empty, money } from "./ui";
import "./dashboard.css";
const stages: Record<DashboardStage, { title: string; description: string }> = {
  received: { title: "Recibidos", description: "Esperan comenzar" },
  working: { title: "En atención", description: "Trabajo en curso" },
  waiting: { title: "Esperando aprobación", description: "Decisión pendiente" },
  ready: { title: "Listos para cobrar", description: "Servicio finalizado" },
  delivery: {
    title: "Pendientes de entrega",
    description: "Cobrados, aún en el local",
  },
};
function elapsed(value: number | null) {
  return value === null
    ? "Sin hora registrada"
    : value < 60
      ? value + " min"
      : Math.floor(value / 60) + " h " + (value % 60) + " min";
}
export function OperationalDashboard({
  state,
  access,
  branch,
  onReceive,
  onManageAppointment,
  onEdit,
  onStart,
  onFinish,
  onCharge,
  onDeliver,
  onView,
}: {
  state: State;
  access: Access;
  branch: string;
  onReceive: (appointment: Entity<"appointments">) => void;
  onManageAppointment: (appointment: Entity<"appointments">) => void;
  onEdit: (order: DashboardOrder) => void;
  onStart: (id: string) => void;
  onFinish: (id: string) => void;
  onCharge: (id: string) => void;
  onDeliver: (id: string) => void;
  onView: (order: DashboardOrder) => void;
}) {
  const [now, setNow] = useState(() => new Date().toISOString()),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState<DashboardStage | "all">("all");
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(new Date().toISOString()),
      60000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const board = operationalBoard(state, branch, now),
    charge = canCharge(access.member.role),
    technician = access.member.role !== "cashier";
  const vehicle = (id: string) => state.vehicles.find((v) => v.id === id);
  const client = (id: string) =>
    state.customers.find((c) => c.id === id)?.name ?? "Cliente";
  const branchName = (id: string) =>
    state.branches.find((b) => b.id === id)?.name ?? "Sucursal";
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
  const matches = (...text: unknown[]) =>
    normalize(text.join(" ")).includes(normalize(query));
  return (
    <section
      className="operation-dashboard"
      aria-label="Tablero operativo del día"
    >
      <div className="operation-heading">
        <div>
          <span className="eyebrow">EN EL LOCAL, AHORA</span>
          <h2>De la llegada a la entrega</h2>
          <p>Turnos de hoy y visitas abiertas, incluso de días anteriores.</p>
        </div>
        <span className="operation-clock">
          <Clock size={16} />
          {new Date(now).toLocaleTimeString("es-AR", {
            timeZone: "America/Argentina/Buenos_Aires",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <div className="operation-counts">
        <div className="operation-count">
          <CalendarDays size={19} />
          <strong>{board.appointments.length}</strong>
          <span>Por llegar hoy</span>
        </div>
        {dashboardStages.map((stage) => (
          <button
            key={stage}
            className={
              "operation-count " + (filter === stage ? "selected" : "")
            }
            onClick={() => setFilter(filter === stage ? "all" : stage)}
            aria-pressed={filter === stage}
          >
            <Car size={19} />
            <strong>{board.groups[stage].length}</strong>
            <span>{stages[stage].title}</span>
          </button>
        ))}
      </div>
      <div className="toolbar operation-toolbar">
        <input
          aria-label="Buscar en el tablero"
          placeholder="Buscar patente, cliente o responsable…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Estado del tablero"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">Todos los estados</option>
          {dashboardStages.map((stage) => (
            <option key={stage} value={stage}>
              {stages[stage].title}
            </option>
          ))}
        </select>
      </div>
      {filter === "all" && (
        <section className="panel arrivals-panel">
          <header className="panel-head">
            <div>
              <h3>Próximas llegadas</h3>
              <p>Turnos pendientes de recepción, ordenados por horario.</p>
            </div>
            <CalendarDays size={22} />
          </header>
          <div className="arrivals-list">
            {board.appointments
              .filter((a) =>
                matches(
                  vehicle(a.vehicleId)?.plate,
                  client(a.customerId),
                  a.technician,
                  a.reason,
                ),
              )
              .map((a) => {
                const v = vehicle(a.vehicleId),
                  scheduled = board.day + "T" + a.time + ":00-03:00",
                  delay = elapsedMinutes(scheduled, now),
                  isLate = Date.parse(scheduled) < Date.parse(now);
                return (
                  <article className="arrival-row" key={a.id}>
                    <div className="arrival-time">
                      <strong>{a.time}</strong>
                      {isLate && (
                        <small>Horario pasado · {elapsed(delay)}</small>
                      )}
                    </div>
                    <div className="arrival-identity">
                      <strong>
                        {v?.plate ?? "Vehículo"} · {client(a.customerId)}
                      </strong>
                      <span>{a.reason}</span>
                      <small>
                        {branchName(a.branchId)} ·{" "}
                        {a.technician || "Sin responsable asignado"}
                      </small>
                    </div>
                    <Badge value={a.status} />
                    <div className="row-actions">
                      <button
                        className="button small primary"
                        onClick={() => onReceive(a)}
                      >
                        Recibir cliente <ArrowRight size={14} />
                      </button>
                      <button
                        className="text-button"
                        onClick={() => onManageAppointment(a)}
                      >
                        Gestionar turno
                      </button>
                    </div>
                  </article>
                );
              })}
            {!board.appointments.some((a) =>
              matches(
                vehicle(a.vehicleId)?.plate,
                client(a.customerId),
                a.technician,
                a.reason,
              ),
            ) && (
              <Empty
                text={
                  query
                    ? "No hay turnos que coincidan con la búsqueda."
                    : "No quedan turnos por recibir hoy."
                }
              />
            )}
          </div>
        </section>
      )}
      <div
        className={
          "workshop-board " + (filter !== "all" ? "single-column" : "")
        }
      >
        {dashboardStages
          .filter((stage) => filter === "all" || stage === filter)
          .map((stage) => (
            <section
              className={"workshop-column stage-" + stage}
              key={stage}
              aria-label={stages[stage].title}
            >
              <header>
                <h3>
                  {stages[stage].title}
                  <span>{board.groups[stage].length}</span>
                </h3>
                <p>{stages[stage].description}</p>
              </header>
              <div className="workshop-cards">
                {board.groups[stage]
                  .filter((o) =>
                    matches(
                      vehicle(o.vehicleId)?.plate,
                      client(o.customerId),
                      o.technician,
                      o.serviceName,
                    ),
                  )
                  .map((o) => {
                    const v = vehicle(o.vehicleId),
                      start =
                        stage === "received" || stage === "waiting"
                          ? o.receivedAt
                          : stage === "working"
                            ? o.startedAt
                            : o.finishedAt,
                      age = elapsedMinutes(start, now);
                    return (
                      <article className="workshop-card" key={o.id}>
                        <strong className="operation-plate">
                          {v?.plate ?? "Vehículo"}
                        </strong>
                        <h4>{client(o.customerId)}</h4>
                        <p>
                          {o.serviceName ||
                            state.services.find((s) => s.id === o.serviceId)
                              ?.name ||
                            "Servicio"}
                        </p>
                        <small>
                          {v?.brand} {v?.model}
                        </small>
                        <small>
                          {branchName(o.branchId)}
                          {o.date < board.day ? " · Ingreso anterior" : ""}
                        </small>
                        <div className="operation-person">
                          <UserRound size={15} />
                          {o.technician || "Sin responsable asignado"}
                        </div>
                        <div className="operation-elapsed">
                          <Clock size={15} />
                          <span>
                            {stage === "received" || stage === "waiting"
                              ? "Espera"
                              : stage === "working"
                                ? "En trabajo"
                                : "Listo hace"}
                            : {elapsed(age)}
                          </span>
                        </div>
                        <strong className="operation-total">
                          {money(orderTotal(o))}
                        </strong>
                        <div className="operation-actions">
                          {stage === "received" && technician && (
                            <button
                              className="button primary small"
                              onClick={() => onStart(o.id)}
                            >
                              Comenzar
                            </button>
                          )}
                          {stage === "working" && technician && (
                            <button
                              className="button primary small"
                              onClick={() => onFinish(o.id)}
                            >
                              {o.consumptionConfirmed
                                ? "Finalizar"
                                : "Revisar consumos"}
                            </button>
                          )}
                          {stage === "ready" && charge && (
                            <button
                              className="button primary small"
                              onClick={() => onCharge(o.id)}
                            >
                              Cobrar
                            </button>
                          )}
                          {stage === "delivery" && charge && (
                            <button
                              className="button primary small"
                              onClick={() => onDeliver(o.id)}
                            >
                              Entregar vehículo
                            </button>
                          )}
                          {["received", "working"].includes(stage) && (
                            <button
                              className="text-button"
                              onClick={() => onEdit(o)}
                            >
                              Editar / asignar
                            </button>
                          )}
                          {(stage === "waiting" ||
                            stage === "ready" ||
                            stage === "delivery") && (
                            <button
                              className="text-button"
                              onClick={() => onView(o)}
                            >
                              Ver orden
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                {!board.groups[stage].some((o) =>
                  matches(
                    vehicle(o.vehicleId)?.plate,
                    client(o.customerId),
                    o.technician,
                    o.serviceName,
                  ),
                ) && (
                  <p className="operation-empty">
                    {query ? "Sin coincidencias" : "Sin vehículos"}
                  </p>
                )}
              </div>
            </section>
          ))}
      </div>
      {!board.orders.length && (
        <div className="operation-clear">
          <CheckCircle2 size={20} />
          No hay vehículos pendientes en el taller.
        </div>
      )}
    </section>
  );
}
