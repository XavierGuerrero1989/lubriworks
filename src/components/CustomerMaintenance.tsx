import { useState } from "react";
import { CalendarDays, RefreshCw, Gauge, ShieldCheck } from "lucide-react";
import type { Access, State, Vehicle } from "../../shared/model";
import {
  clientMaintenance,
  filterMaintenance,
  maintenanceReading,
  type MaintenanceLevel,
} from "../../shared/clientMaintenance";
import { Badge, fmtDate, number, SearchBox } from "./ui";
import "./customer-maintenance.css";
const labels: Record<MaintenanceLevel, string> = {
  due: "Corresponde atender",
  estimated: "Objetivo estimado alcanzado",
  soon: "Se acerca",
  scheduled: "Programado",
  missing: "Sin matafuegos",
  unknown: "Datos por confirmar",
  done: "Resuelto",
};
export function CustomerMaintenance({
  state: s,
  access,
  onRefresh,
  onReading,
  onAppointment,
  onAppointments,
  onHistory,
}: {
  state: State;
  access: Access;
  onRefresh: () => Promise<void>;
  onReading: (v: Vehicle) => void;
  onAppointment: (id?: string, reason?: string) => void;
  onAppointments: () => void;
  onHistory: (v: Vehicle) => void;
}) {
  const [vehicle, setVehicle] = useState("all"),
    [category, setCategory] = useState("all"),
    [status, setStatus] = useState("all"),
    [search, setSearch] = useState(""),
    [history, setHistory] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const data = clientMaintenance(s, access.member, new Date().toISOString()),
    rows = filterMaintenance(data.items, {
      vehicle,
      category,
      status,
      search,
      history,
    });
  const active = data.items.filter((i) => i.level !== "done"),
    attention = active.filter((i) =>
      ["due", "estimated", "soon", "missing"].includes(i.level),
    ).length;
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="client-maintenance">
      <div className="page-heading">
        <div>
          <h1>Próximos mantenimientos</h1>
          <p>Qué necesita tu vehículo y cuándo conviene volver.</p>
        </div>
        <button className="button secondary" disabled={busy} onClick={refresh}>
          <RefreshCw size={16} />
          {busy ? "Actualizando…" : "Actualizar mantenimientos"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="maintenance-overview">
        <div>
          <strong>{attention}</strong>
          <span>
            {attention === 1
              ? " cuidado requiere atención"
              : " cuidados requieren atención"}
          </span>
        </div>
        <p>
          Si hay una fecha y un kilometraje, atendé lo que ocurra primero. Las
          estimaciones de uso no reemplazan la lectura del tablero.
        </p>
      </div>
      <div className="maintenance-tabs">
        <button
          className={`button ${!history ? "primary" : "secondary"}`}
          onClick={() => {
            setHistory(false);
            setStatus("all");
          }}
        >
          Pendientes ({active.length})
        </button>
        <button
          className={`button ${history ? "primary" : "secondary"}`}
          onClick={() => {
            setHistory(true);
            setStatus("all");
          }}
        >
          Resueltos ({data.items.length - active.length})
        </button>
      </div>
      <div className="maintenance-filters">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar vehículo o mantenimiento…"
        />
        <label>
          Vehículo
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="all">Todos mis vehículos</option>
            {data.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate} · {v.brand} {v.model}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">Todos los cuidados</option>
            <option value="service">Servicios</option>
            <option value="extinguisher">Matafuegos</option>
          </select>
        </label>
        {!history && (
          <label>
            Estado
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todos los estados</option>
              <option value="attention">Requieren atención</option>
              <option value="due">Corresponde atender</option>
              <option value="estimated">Objetivo estimado alcanzado</option>
              <option value="soon">Se acerca</option>
              <option value="missing">Sin matafuegos</option>
              <option value="scheduled">Programados</option>
              <option value="unknown">Datos por confirmar</option>
            </select>
          </label>
        )}
        <button
          className="button secondary"
          onClick={() => {
            setVehicle("all");
            setCategory("all");
            setStatus("all");
            setSearch("");
          }}
        >
          Limpiar filtros
        </button>
      </div>
      <p className="muted">
        {rows.length} {rows.length === 1 ? "cuidado" : "cuidados"}{" "}
        {history
          ? rows.length === 1
            ? "resuelto"
            : "resueltos"
          : rows.length === 1
            ? "pendiente"
            : "pendientes"}
      </p>
      <div className="maintenance-cards">
        {rows.map((i) => {
          const v = i.vehicle,
            r = i.reminder,
            reading = maintenanceReading(v, data.day),
            turn = data.appointments.find((a) => a.vehicleId === v.id),
            visit = data.visits.find((o) => o.vehicleId === v.id);
          return (
            <article className="panel maintenance-card" key={i.id}>
              <div className="maintenance-card-top">
                {i.category === "service" ? <Gauge /> : <ShieldCheck />}
                <Badge
                  value={
                    ["due", "missing", "estimated"].includes(i.level)
                      ? "warning"
                      : i.level === "soon"
                        ? "soon"
                        : i.level === "unknown"
                          ? "pending"
                          : "ok"
                  }
                >
                  {labels[i.level]}
                </Badge>
              </div>
              <h2>{i.title}</h2>
              <p className="maintenance-vehicle">
                <strong>{v.plate}</strong> · {v.brand} {v.model}
              </p>
              {r && (
                <>
                  <dl className="maintenance-targets">
                    {r.dueKm !== null && (
                      <div>
                        <dt>Objetivo de kilometraje</dt>
                        <dd>{number(r.dueKm)} km</dd>
                      </div>
                    )}
                    {r.dueDate && (
                      <div>
                        <dt>
                          {i.category === "extinguisher"
                            ? "Vencimiento registrado"
                            : "Fecha límite registrada"}
                        </dt>
                        <dd>{fmtDate(r.dueDate)}</dd>
                      </div>
                    )}
                  </dl>
                  {r.dueKm !== null && r.dueDate && (
                    <p>Lo que ocurra primero.</p>
                  )}
                </>
              )}
              {i.level === "due" && (
                <p>
                  {r?.dueDate && r.dueDate <= data.day
                    ? "La fecha registrada llegó o ya pasó."
                    : "La última lectura real alcanzó el kilometraje objetivo."}{" "}
                  Coordiná la atención con el lubricentro.
                </p>
              )}
              {i.level === "estimated" && (
                <p>
                  Según el uso promedio, podrías haber alcanzado el kilometraje
                  objetivo. Actualizá los km para confirmar tu situación.
                </p>
              )}
              {i.level === "missing" && (
                <p>
                  El lubricentro registró que este vehículo no tiene matafuegos.
                  {v.wantsExtinguisher
                    ? " También registró tu interés en comprar uno nuevo."
                    : ""}{" "}
                  Podés consultar por uno nuevo al solicitar turno.
                </p>
              )}
              {i.level === "unknown" && (
                <p>
                  Falta confirmar si tenés matafuegos o registrar su
                  vencimiento. Pedí al lubricentro que complete estos datos en
                  la ficha del vehículo.
                </p>
              )}
              {i.level === "done" && (
                <p>
                  El lubricentro marcó este aviso como resuelto. Consultá el
                  historial para ver los servicios realizados; este estado por
                  sí solo no es una constancia de trabajo.
                </p>
              )}
              {r?.dueKm !== null && r && (
                <div className="maintenance-reading">
                  <p>
                    <strong>
                      Última lectura real: {number(reading.real)} km
                    </strong>{" "}
                    · {fmtDate(v.readingDate)}
                  </p>
                  <p>
                    Estimación al {fmtDate(data.day)}:{" "}
                    {number(reading.estimated)} km.
                  </p>
                  <p>
                    {i.info!.remaining! > 0
                      ? `Aproximadamente ${number(i.info!.remaining!)} km restantes según tu uso.`
                      : "El objetivo estimado está alcanzado."}
                  </p>
                  {reading.stale && (
                    <p className="maintenance-caution">
                      La lectura tiene más de 90 días. Actualizala para mejorar
                      esta estimación.
                    </p>
                  )}
                  <details>
                    <summary>¿Cómo se calcula?</summary>
                    <p>
                      Uso promedio aproximado: {number(reading.usage.km)}{" "}
                      km/mes.{" "}
                      {reading.usage.source === "visits"
                        ? "Se calcula con dos lecturas reales registradas."
                        : "Se calcula con la antigüedad del vehículo y su kilometraje; es una referencia inicial aproximada."}
                    </p>
                    <p>La estimación puede variar si cambia tu uso.</p>
                  </details>
                </div>
              )}
              {i.info?.effective && i.level !== "done" && (
                <p className="maintenance-forecast">
                  <CalendarDays size={16} />{" "}
                  {r?.dueKm !== null
                    ? "Atención estimada"
                    : "Fecha de atención"}
                  : {fmtDate(i.info.effective)}
                  {r?.dueKm !== null ? " · orientativa" : ""}
                </p>
              )}
              {!history && turn && (
                <div className="maintenance-coordination">
                  <p>
                    Ya tenés un turno{" "}
                    {turn.status === "confirmed" ? "confirmado" : "solicitado"}{" "}
                    para este vehículo: {fmtDate(turn.date)} · {turn.time}.
                    Revisá si su motivo incluye este cuidado.
                  </p>
                  <button className="text-button" onClick={onAppointments}>
                    Ver mis turnos
                  </button>
                </div>
              )}
              {!history && visit && (
                <p>
                  Este vehículo tiene una visita abierta en el lubricentro.
                  Coordiná con el local si este cuidado está incluido.
                </p>
              )}
              <div className="maintenance-actions">
                {!history && (
                  <button
                    className="button primary"
                    onClick={() =>
                      onAppointment(
                        v.id,
                        i.category === "extinguisher" && i.level === "missing"
                          ? "Consulta por compra de matafuegos"
                          : i.title,
                      )
                    }
                  >
                    Solicitar turno
                  </button>
                )}
                {i.category === "service" && !history && (
                  <button
                    className="button secondary"
                    onClick={() => onReading(v)}
                  >
                    Actualizar km
                  </button>
                )}
                <button className="text-button" onClick={() => onHistory(v)}>
                  Ver historial
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <div className="empty">
          <CalendarDays size={32} />
          <h3>
            {history && !data.items.some((i) => i.level === "done")
              ? "Todavía no hay avisos resueltos."
              : "No hay cuidados que coincidan con estos filtros."}
          </h3>
          <p>
            {history
              ? "El lubricentro cierra los avisos al registrar el cuidado correspondiente."
              : "Probá limpiar los filtros o consultá al lubricentro cuándo corresponde el próximo cuidado."}
          </p>
        </div>
      )}
      <p className="maintenance-footnote">
        El lubricentro gestiona los objetivos de mantenimiento y los datos del
        matafuegos. Si un dato cambió, pedí que actualicen tu ficha. Las
        recomendaciones se ajustan al vehículo y al servicio indicado por el
        local.
      </p>
    </div>
  );
}
