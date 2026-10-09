import { useState } from "react";
import type { Entity, State } from "../../shared/model";
import { agendaActive, appointmentEnd, duration } from "../../shared/agenda";
import { localDay } from "../../shared/dashboard";
import { Badge, Empty, fmtDate, SearchBox, Section } from "./ui";
import "./agenda.css";
type Turn = Entity<"appointments">;
export function Agenda({
  state,
  branch,
  manager,
  onNew,
  onEdit,
  onReceive,
  onCapacity,
}: {
  state: State;
  branch: string;
  manager: boolean;
  onNew: (date: string) => void;
  onEdit: (a: Turn, initial?: Record<string, unknown>) => void;
  onReceive: (a: Turn) => void;
  onCapacity: (b: Entity<"branches">) => void;
}) {
  const [day, setDay] = useState(localDay(new Date().toISOString())),
    [view, setView] = useState("day"),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [technician, setTechnician] = useState("all");
  const vehicle = (id: string) => state.vehicles.find((v) => v.id === id);
  const client = (id: string) =>
    state.customers.find((c) => c.id === id)?.name || "—";
  const branchName = (id: string) =>
    state.branches.find((b) => b.id === id)?.name || "—";
  const endDate = new Date(day + "T12:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  const end = view === "week" ? endDate.toISOString().slice(0, 10) : day;
  const scoped = state.appointments.filter(
    (a) =>
      (branch === "all" || a.branchId === branch) &&
      a.date >= day &&
      a.date <= end,
  );
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const visible = scoped
    .filter(
      (a) =>
        (status === "all" || a.status === status) &&
        (technician === "all" || a.technician === technician) &&
        normalize(
          `${client(a.customerId)} ${vehicle(a.vehicleId)?.plate} ${a.reason} ${a.technician}`,
        ).includes(normalize(search)),
    )
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const move = (delta: number) => {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    setDay(d.toISOString().slice(0, 10));
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Agenda</h1>
          <p>
            Organizá llegadas, responsables y puestos sin superponer turnos.
          </p>
        </div>
        <button className="button primary" onClick={() => onNew(day)}>
          + Nuevo turno
        </button>
      </div>
      <div className="agenda-capacity">
        {state.branches
          .filter((b) => branch === "all" || b.id === branch)
          .map((b) => (
            <div key={b.id}>
              <strong>{b.name}</strong>
              <span>
                {b.appointmentCapacity ?? 1}{" "}
                {(b.appointmentCapacity ?? 1) === 1
                  ? "puesto de atención"
                  : "puestos de atención"}
              </span>
              {manager && (
                <button className="text-button" onClick={() => onCapacity(b)}>
                  Configurar capacidad
                </button>
              )}
            </div>
          ))}
        <p>
          Capacidad de atención simultánea. Los turnos solicitados también
          reservan espacio. Sin duración cargada se consideran 60 minutos.
        </p>
      </div>
      <div className="toolbar agenda-toolbar">
        <button
          className="button"
          aria-label="Periodo anterior"
          onClick={() => move(view === "week" ? -7 : -1)}
        >
          ←
        </button>
        <input
          type="date"
          aria-label="Fecha de agenda"
          value={day}
          required
          onChange={(e) => {
            if (e.target.value) setDay(e.target.value);
          }}
        />
        <button
          className="button"
          aria-label="Periodo siguiente"
          onClick={() => move(view === "week" ? 7 : 1)}
        >
          →
        </button>
        <button
          className="button"
          onClick={() => setDay(localDay(new Date().toISOString()))}
        >
          Hoy
        </button>
        <select
          aria-label="Vista de agenda"
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          <option value="day">Día</option>
          <option value="week">7 días</option>
        </select>
        <select
          aria-label="Estado de turno"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Todos los estados</option>
          <option value="requested">Solicitados</option>
          <option value="confirmed">Confirmados</option>
          <option value="completed">Completados</option>
          <option value="cancelled">Cancelados</option>
          <option value="no_show">Ausentes</option>
        </select>
        <select
          aria-label="Técnico de agenda"
          value={technician}
          onChange={(e) => setTechnician(e.target.value)}
        >
          <option value="all">Todos los técnicos</option>
          {[
            ...new Set(
              state.appointments
                .filter((a) => branch === "all" || a.branchId === branch)
                .map((a) => a.technician),
            ),
          ]
            .sort()
            .map((t) => (
              <option key={t} value={t}>
                {t || "Sin asignar"}
              </option>
            ))}
        </select>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Cliente, patente, motivo o técnico…"
        />
      </div>
      <div className="agenda-summary">
        <span>
          <strong>{scoped.length}</strong> turnos
        </span>
        <span>
          <strong>
            {scoped.filter((a) => a.status === "requested").length}
          </strong>{" "}
          por confirmar
        </span>
        <span>
          <strong>
            {scoped.filter((a) => agendaActive(a) && !a.orderId).length}
          </strong>{" "}
          por recibir
        </span>
        <span>
          <strong>{scoped.filter((a) => a.status === "no_show").length}</strong>{" "}
          ausentes
        </span>
      </div>
      <Section
        title={
          view === "day"
            ? `Turnos del ${fmtDate(day)}`
            : `Del ${fmtDate(day)} al ${fmtDate(end)}`
        }
        subtitle="La duración es una reserva prevista; el tiempo real se registra en la orden."
      >
        {visible.length ? (
          <div className="agenda-list">
            {visible.map((a) => (
              <article className="agenda-turn" key={a.id}>
                <div className="agenda-hour">
                  <strong>
                    {a.time}–{appointmentEnd(a)}
                  </strong>
                  <small>
                    {fmtDate(a.date)} · {duration(a)} min
                  </small>
                </div>
                <div className="agenda-vehicle">
                  <strong>
                    {vehicle(a.vehicleId)?.plate || "—"} ·{" "}
                    {client(a.customerId)}
                  </strong>
                  <p>{a.reason}</p>
                  <small>
                    {branchName(a.branchId)} ·{" "}
                    {a.technician || "Técnico sin asignar"} ·{" "}
                    {a.station
                      ? `Puesto ${a.station}${state.branches.find((b) => b.id === a.branchId)?.stations?.[a.station - 1] ? " · " + state.branches.find((b) => b.id === a.branchId)?.stations?.[a.station - 1] : ""}`
                      : "Puesto sin asignar"}
                  </small>
                  {a.statusReason && (
                    <p className="agenda-reason">Motivo: {a.statusReason}</p>
                  )}
                  {a.reschedules?.length ? (
                    <details>
                      <summary>
                        {a.reschedules.length} reprogramación(es)
                      </summary>
                      <ul>
                        {a.reschedules.map((r, i) => (
                          <li key={i}>
                            {fmtDate(r.fromDate)} {r.fromTime} (
                            {branchName(r.fromBranchId)}) → {fmtDate(r.toDate)}{" "}
                            {r.toTime} ({branchName(r.toBranchId)}). {r.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
                <div className="agenda-actions">
                  <Badge
                    value={a.orderId && agendaActive(a) ? "received" : a.status}
                  />
                  {agendaActive(a) && !a.orderId && (
                    <>
                      <button
                        className="button primary"
                        onClick={() => onReceive(a)}
                      >
                        Recibir cliente
                      </button>
                      <button
                        className="text-button"
                        onClick={() => onEdit(a, { rescheduleReason: "" })}
                      >
                        Reprogramar / editar
                      </button>
                      <button
                        className="text-button"
                        onClick={() =>
                          onEdit(a, { status: "cancelled", statusReason: "" })
                        }
                      >
                        Cancelar turno
                      </button>
                      {Date.parse(a.date + "T" + a.time + ":00-03:00") <=
                        Date.now() && (
                        <button
                          className="text-button"
                          onClick={() =>
                            onEdit(a, { status: "no_show", statusReason: "" })
                          }
                        >
                          Marcar ausente
                        </button>
                      )}
                    </>
                  )}
                  {a.orderId && (
                    <small>
                      Orden vinculada · gestioná la atención desde Inicio.
                    </small>
                  )}
                  {!agendaActive(a) && !a.orderId && (
                    <button className="text-button" onClick={() => onEdit(a)}>
                      Ver / editar
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty text="No hay turnos para esta fecha y filtros." />
        )}
      </Section>
    </>
  );
}
