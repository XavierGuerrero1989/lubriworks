import { useState } from "react";
import { Bell, Megaphone, ShieldCheck } from "lucide-react";
import type { Access, State } from "../../shared/model";
import { clientNews } from "../../shared/clientNews";
import { localDay } from "../../shared/dashboard";
import type { Command } from "../../shared/engine";
import { Badge, fmtDate, number } from "./ui";
import "./customer-news.css";

export function CustomerNews({
  state,
  access,
  run,
  onMaintenance,
  onNotifications,
  onAppointment,
}: {
  state: State;
  access: Access;
  run: (command: Command) => Promise<void>;
  onMaintenance: () => void;
  onNotifications: () => void;
  onAppointment: (id?: string, reason?: string) => void;
}) {
  const data = clientNews(state, access.member, new Date().toISOString());
  const [expanded, setExpanded] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const unread = data.messages.filter((n) => !n.read).length;
  async function read(id: string) {
    setBusy(true);
    setError("");
    try {
      await run({ action: "readNotices", ids: [id] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="client-news" aria-labelledby="client-news-title">
      <div className="client-news-heading">
        <div>
          <span className="eyebrow">
            <Bell size={15} /> TU LUBRICENTRO TE ACOMPAÑA
          </span>
          <h2 id="client-news-title">Novedades</h2>
          <p>Próximos cuidados, avisos y promociones para vos.</p>
        </div>
        <button className="button secondary" onClick={onNotifications}>
          Ver notificaciones
          {unread
            ? ` · ${unread} mensaje${unread === 1 ? "" : "s"} sin leer`
            : ""}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="client-news-columns">
        <div className="client-news-column">
          <h3>
            <ShieldCheck size={18} /> Para tu vehículo
          </h3>
          {data.maintenance.slice(0, 2).map((i) => (
            <article className="client-news-card maintenance" key={i.id}>
              <div className="client-news-meta">
                <Badge
                  value={
                    i.level === "due" || i.level === "missing"
                      ? "overdue"
                      : i.level === "scheduled"
                        ? "ok"
                        : "soon"
                  }
                >
                  {i.level === "due"
                    ? "Corresponde atender"
                    : i.level === "missing"
                      ? "Sin matafuegos"
                      : i.level === "estimated"
                        ? "Objetivo estimado alcanzado"
                        : i.level === "soon"
                          ? "Se acerca"
                          : "Programado"}
                </Badge>
                <strong>{i.vehicle.plate}</strong>
              </div>
              <h4>{i.title}</h4>
              {i.reminder?.dueKm != null && (
                <p>
                  Próximo objetivo:{" "}
                  <strong>{number(i.reminder.dueKm)} km</strong>.
                </p>
              )}
              {i.reminder?.dueDate && (
                <p>
                  {i.category === "extinguisher"
                    ? "Vencimiento"
                    : "Fecha límite"}
                  : <strong>{fmtDate(i.reminder.dueDate)}</strong>.
                </p>
              )}
              {i.reminder?.dueKm != null && i.reminder.dueDate && (
                <small>Lo que ocurra primero.</small>
              )}
              {i.level === "missing" && (
                <p>
                  Coordiná con el local la compra o el registro del matafuegos.
                </p>
              )}
              {i.info && (
                <p className="client-news-caption">
                  {i.category === "service" && i.info.effective
                    ? `Atención estimada: ${fmtDate(i.info.effective)}. `
                    : ""}
                  El detalle distingue lectura real de estimación de uso.
                </p>
              )}
              <div className="client-news-actions">
                <button className="button secondary" onClick={onMaintenance}>
                  Ver detalle
                </button>
                <button
                  className="button primary"
                  onClick={() => onAppointment(i.vehicle.id, i.title)}
                >
                  Solicitar turno
                </button>
              </div>
            </article>
          ))}
          {!data.maintenance.length && (
            <p className="client-news-empty">
              No hay próximos cuidados registrados para mostrar. El lubricentro
              puede cargar los objetivos de tu vehículo.
            </p>
          )}
          <button className="text-button" onClick={onMaintenance}>
            Ver todos los mantenimientos
          </button>
        </div>
        <div className="client-news-column">
          <h3>
            <Megaphone size={18} /> Del lubricentro
          </h3>
          {data.messages.slice(0, 2).map((n) => (
            <article
              className={`client-news-card message ${n.read ? "" : "unread"}`}
              key={n.id}
            >
              <div className="client-news-meta">
                <Badge value={n.read ? "ok" : "soon"}>
                  {n.read ? "Leído" : "Nuevo"}
                </Badge>
                <small>{fmtDate(localDay(n.date))}</small>
              </div>
              <h4>{n.title}</h4>
              {n.vehicleId && (
                <small>
                  {
                    state.vehicles.find(
                      (v) =>
                        v.id === n.vehicleId &&
                        v.customerId === access.member.customerId,
                    )?.plate
                  }
                </small>
              )}
              <p
                className={`client-news-body ${expanded.includes(n.id) ? "expanded" : ""}`}
              >
                {n.body}
              </p>
              <div className="client-news-actions">
                <button
                  className="text-button"
                  aria-expanded={expanded.includes(n.id)}
                  onClick={() =>
                    setExpanded(
                      expanded.includes(n.id)
                        ? expanded.filter((id) => id !== n.id)
                        : [...expanded, n.id],
                    )
                  }
                >
                  {expanded.includes(n.id)
                    ? "Contraer mensaje"
                    : "Leer completo"}
                </button>
                {!n.read && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => void read(n.id)}
                  >
                    Marcar leído
                  </button>
                )}
              </div>
            </article>
          ))}
          {!data.messages.length && (
            <p className="client-news-empty">
              Acá vas a ver los mensajes, descuentos y promociones que te envíe
              tu lubricentro.
            </p>
          )}
          <button className="text-button" onClick={onNotifications}>
            Ver todos los mensajes en Notificaciones ({data.messages.length})
          </button>
          <p className="client-news-caption">
            Las condiciones y la vigencia de las promociones las indica el
            lubricentro en su mensaje.
          </p>
        </div>
      </div>
      <p className="client-news-caption">
        Mostramos los dos primeros cuidados y los dos mensajes más recientes.
        Los recordatorios se actualizan según tu vehículo; no dependés de tener
        push activado para verlos.
      </p>
    </section>
  );
}
