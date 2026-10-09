import { useState } from "react";
import { CalendarDays, Download, MapPin, Plus, RefreshCw } from "lucide-react";
import type { Access, State } from "../../shared/model";
import type { Command } from "../../shared/engine";
import {
  appointmentCalendar,
  clientAppointments,
  clientAppointmentEditable,
  clientAppointmentVersion,
} from "../../shared/clientAppointments";
import { localDay } from "../../shared/dashboard";
import { Badge, Empty, fmtDate } from "./ui";
import "./customer-appointments.css";
type Turn = State["appointments"][number];
export function CustomerAppointments({
  state: s,
  access,
  run,
  onRefresh,
  onNew,
  onVisit,
}: {
  state: State;
  access: Access;
  run: (cmd: Command) => Promise<void>;
  onRefresh: () => Promise<void>;
  onNew: () => void;
  onVisit: () => void;
}) {
  const [view, setView] = useState("upcoming"),
    [vehicle, setVehicle] = useState("all"),
    [edit, setEdit] = useState<{ a: Turn; cancel: boolean } | null>(null),
    [branch, setBranch] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const now = new Date().toISOString(),
    groups = clientAppointments(s, access.member, now);
  const rows = (view === "upcoming" ? groups.upcoming : groups.history).filter(
    (a) => vehicle === "all" || a.vehicleId === vehicle,
  );
  const open = (a: Turn, cancel: boolean) => {
    setEdit({ a: structuredClone(a), cancel });
    setBranch(a.branchId);
    setReason("");
    setError("");
    setMessage("");
  };
  const refresh = async () => {
    setBusy(true);
    try {
      await onRefresh();
      setEdit(null);
      setError("");
      setMessage("Turnos actualizados.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const fields = new FormData(e.currentTarget as HTMLFormElement);
    setBusy(true);
    setError("");
    try {
      await run({
        action: edit.cancel
          ? "clientAppointment.cancel"
          : "clientAppointment.reschedule",
        id: edit.a.id,
        expectedVersion: clientAppointmentVersion(edit.a),
        date: fields.get("date"),
        time: fields.get("time"),
        branchId: branch,
        reason,
      });
      setEdit(null);
      setMessage(
        edit.cancel
          ? "Turno cancelado. El horario quedó liberado."
          : "Nueva fecha solicitada. Esperá la confirmación del lubricentro.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const calendar = (a: Turn) => {
    const b = s.branches.find((b) => b.id === a.branchId),
      v = s.vehicles.find((v) => v.id === a.vehicleId);
    const url = URL.createObjectURL(
      new Blob(
        [
          appointmentCalendar(
            a,
            v?.plate ?? "",
            b?.name ?? "",
            b?.address ?? "",
            now,
          ),
        ],
        { type: "text/calendar;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `turno-${a.date}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const selected = s.branches.find((b) => b.id === branch);
  return (
    <div className="customer-turns">
      <div className="page-heading">
        <div>
          <h1>Mis turnos</h1>
          <p>Organizá tu próxima visita y consultá las anteriores.</p>
        </div>
        <button className="button primary" onClick={onNew}>
          <Plus size={17} />
          Solicitar turno
        </button>
      </div>
      <div className="turn-filters">
        <div className="turn-tabs" role="group" aria-label="Mostrar turnos">
          <button
            className={`button ${view === "upcoming" ? "primary" : "secondary"}`}
            onClick={() => setView("upcoming")}
          >
            Próximos ({groups.upcoming.length})
          </button>
          <button
            className={`button ${view === "history" ? "primary" : "secondary"}`}
            onClick={() => setView("history")}
          >
            Historial ({groups.history.length})
          </button>
        </div>
        <label>
          Vehículo
          <select value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
            <option value="all">Todos mis vehículos</option>
            {s.vehicles
              .filter((v) => v.customerId === access.member.customerId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plate} · {v.brand} {v.model}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          Actualizar turnos
        </button>
      </div>
      {message && (
        <p className="client-feedback" role="status">
          {message}
        </p>
      )}
      {error && !edit && <p role="alert">{error}</p>}
      {view === "upcoming" && (
        <p className="turn-hint">
          Una solicitud todavía no está confirmada. Antes de venir, verificá que
          el turno diga “Confirmado”. Si cambiás la fecha, el lubricentro deberá
          confirmarla nuevamente.
        </p>
      )}
      {!rows.length && (
        <Empty
          text={
            view === "upcoming"
              ? "No tenés próximos turnos para esta selección. Podés solicitar una nueva visita."
              : "No hay turnos anteriores para esta selección."
          }
        />
      )}
      <div className="customer-turn-grid">
        {rows.map((a) => {
          const b = s.branches.find((b) => b.id === a.branchId),
            v = s.vehicles.find((v) => v.id === a.vehicleId),
            received = !!(a.orderId || a.receivedAt),
            past =
              !received &&
              ["requested", "confirmed"].includes(a.status) &&
              !clientAppointmentEditable(a, now);
          return (
            <article className="customer-turn-card" key={a.id}>
              <div className="turn-card-top">
                <CalendarDays size={23} />
                <Badge value={a.status}>
                  {received &&
                  a.status !== "completed" &&
                  a.status !== "cancelled"
                    ? "En el lubricentro"
                    : a.status === "requested"
                      ? "Por confirmar"
                      : a.status === "no_show"
                        ? "No asistió"
                        : a.status === "completed"
                          ? "Visita finalizada"
                          : a.status === "cancelled"
                            ? "Cancelado"
                            : "Confirmado"}
                </Badge>
              </div>
              <h2>
                {fmtDate(a.date)} · {a.time}
              </h2>
              <strong>
                {v?.plate} · {v?.brand} {v?.model}
              </strong>
              <p>{a.reason}</p>
              <div className="turn-location">
                <MapPin size={17} />
                <div>
                  <strong>{b?.name ?? "Sucursal"}</strong>
                  {b?.address && <p>{b.address}</p>}
                </div>
              </div>
              {a.statusReason && <p>Motivo: {a.statusReason}</p>}
              {a.reschedules?.length ? (
                <details>
                  <summary>Cambios de fecha ({a.reschedules.length})</summary>
                  {a.reschedules.map((r, i) => (
                    <p key={i}>
                      {fmtDate(r.fromDate)} {r.fromTime} → {fmtDate(r.toDate)}{" "}
                      {r.toTime}
                      <br />
                      {r.reason}
                    </p>
                  ))}
                </details>
              ) : null}
              {past && (
                <p className="turn-hint">
                  El horario ya pasó. Contactá al lubricentro para coordinar
                  cómo continuar.
                </p>
              )}
              {received &&
                a.status !== "completed" &&
                a.status !== "cancelled" && (
                  <button className="button primary" onClick={onVisit}>
                    Ver mi visita
                  </button>
                )}
              <div className="turn-actions">
                {b?.address && (
                  <a
                    className="button secondary"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Cómo llegar
                  </a>
                )}
                {b?.phone && (
                  <a
                    className="button secondary"
                    href={`tel:${b.phone.replace(/[^+\d]/g, "")}`}
                  >
                    Contactar
                  </a>
                )}
                {a.status === "confirmed" &&
                  !received &&
                  clientAppointmentEditable(a, now) && (
                    <button
                      className="button secondary"
                      onClick={() => calendar(a)}
                    >
                      <Download size={15} />
                      Agregar al calendario
                    </button>
                  )}
                {clientAppointmentEditable(a, now) && (
                  <>
                    <button
                      className="button secondary"
                      onClick={() => open(a, false)}
                    >
                      Cambiar fecha
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => open(a, true)}
                    >
                      Cancelar turno
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {edit && (
        <div className="modal-backdrop">
          <form
            className="modal turn-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="turn-title"
            onSubmit={save}
          >
            <div className="modal-heading">
              <div>
                <h2 id="turn-title">
                  {edit.cancel ? "Cancelar turno" : "Solicitar cambio de fecha"}
                </h2>
                <p>
                  {fmtDate(edit.a.date)} · {edit.a.time} ·{" "}
                  {s.vehicles.find((v) => v.id === edit.a.vehicleId)?.plate}
                </p>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEdit(null)}
                aria-label="Cerrar detalle"
              >
                ×
              </button>
            </div>
            {edit.cancel ? (
              <p>
                Se liberará este horario. Podés solicitar otro turno cuando lo
                necesites.
              </p>
            ) : (
              <>
                <p>
                  La fecha nueva quedará pendiente de confirmación. El horario
                  anterior se liberará al guardar.
                </p>
                <div className="turn-form-fields">
                  <label>
                    Sucursal
                    <select
                      required
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                    >
                      {s.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Fecha preferida
                    <input
                      required
                      type="date"
                      min={localDay(now)}
                      name="date"
                      defaultValue={edit.a.date}
                    />
                  </label>
                  <label>
                    Horario preferido
                    <input
                      required
                      type="time"
                      name="time"
                      defaultValue={edit.a.time}
                    />
                  </label>
                </div>
                {selected?.hours?.length &&
                  selected.scheduleEnabled !== false && (
                    <p className="turn-hint">
                      Horarios de {selected.name}:{" "}
                      {selected.hours.map((h, i) => (
                        <span key={i}>
                          {
                            ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][
                              h.day
                            ]
                          }{" "}
                          {h.open}–{h.close}
                          {i < selected.hours!.length - 1 ? " · " : ""}
                        </span>
                      ))}
                    </p>
                  )}
              </>
            )}
            <label>
              Motivo {edit.cancel ? "de cancelación" : "del cambio"}
              <textarea
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert">
                {error}{" "}
                <button
                  className="button secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void refresh()}
                >
                  Actualizar detalle
                </button>
              </p>
            )}
            <div className="turn-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                Volver
              </button>
              <button className="button primary" disabled={busy}>
                {busy
                  ? "Guardando…"
                  : edit.cancel
                    ? "Confirmar cancelación"
                    : "Solicitar cambio"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
