import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Car,
  Check,
  Clock,
  MapPin,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Access, State, Vehicle } from "../../shared/model";
import { estimatedKm, vehicleYear, monthlyUsage } from "../../shared/model";
import { orderTotal, quoteTotal, type Order } from "../../shared/orders";
import { orderBalance } from "../../shared/billing";
import {
  additionTotal,
  clientHome,
  lastVisitChange,
  portalDateTime,
  visitSummary,
} from "../../shared/clientHome";
import type { Command } from "../../shared/engine";
import { Badge, Empty, fmtDate, money, number } from "./ui";
import "./customer-home.css";
type Review = {
  order: Order;
  addition?: NonNullable<Order["additions"]>[number];
};
export function CustomerHome({
  state: s,
  access,
  run,
  onRefresh,
  onReading,
  onAppointment,
  onHistory,
  onMaintenance,
}: {
  state: State;
  access: Access;
  run: (c: Command) => Promise<void>;
  onRefresh: () => Promise<void>;
  onReading: (v: Vehicle) => void;
  onAppointment: (id?: string) => void;
  onHistory: (v: Vehicle) => void;
  onMaintenance: () => void;
}) {
  const [review, setReview] = useState<Review | null>(null),
    [consent, setConsent] = useState(false),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const home = clientHome(s, access.member, new Date().toISOString());
  const branch = (id: string) => s.branches.find((b) => b.id === id);
  const open = (order: Order, addition?: Review["addition"]) => {
    setReview(structuredClone({ order, addition }));
    setConsent(false);
    setNote("");
    setError("");
    setMessage("");
  };
  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      await onRefresh();
      setReview(null);
      setMessage("Estado actualizado.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const decide = async (decision: "approved" | "rejected") => {
    if (!review) return;
    setBusy(true);
    setError("");
    const { order, addition } = review;
    try {
      await run({
        action: addition ? "order.additionDecision" : "order.decision",
        id: order.id,
        ...(addition
          ? { additionId: addition.id, expectedCreatedAt: addition.createdAt }
          : {}),
        expectedRevision: order.quoteRevision ?? 1,
        expectedTotal: addition ? additionTotal(addition) : quoteTotal(order),
        decision,
        note,
      });
      setReview(null);
      setMessage(
        decision === "approved"
          ? "Autorización registrada. El lubricentro ya puede verla en tu orden."
          : "Rechazo registrado. El lubricentro revisará con vos cómo continuar.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const turnCard = (a: State["appointments"][number]) => (
    <div className="client-next-turn" key={a.id}>
      <div>
        <CalendarDays size={19} />
        <strong>
          {fmtDate(a.date)} · {a.time}
        </strong>
        <Badge value={a.status}>
          {a.status === "requested" ? "Por confirmar" : "Confirmado"}
        </Badge>
      </div>
      <p>
        {a.reason} · {branch(a.branchId)?.name ?? "Sucursal"}
      </p>
      {branch(a.branchId)?.address && (
        <small>
          <MapPin size={13} />
          {branch(a.branchId)?.address}
        </small>
      )}
    </div>
  );
  return (
    <div className="client-home">
      <div className="client-home-heading">
        <div>
          <span className="eyebrow">TU VEHÍCULO, BIEN ACOMPAÑADO</span>
          <h1>Hola, {access.member.name.split(" ")[0]}.</h1>
          <p>
            {home.visits.length
              ? "Tu visita, sus decisiones y el próximo cuidado, en un mismo lugar."
              : "Tus vehículos, próximos turnos y mantenimientos, siempre a mano."}
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          Actualizar estado
        </button>
      </div>
      {message && (
        <p className="client-feedback" role="status">
          {message}
        </p>
      )}
      {error && !review && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {home.visits.map((o) => {
        const v = home.vehicles.find((v) => v.id === o.vehicleId)!,
          summary = visitSummary(o),
          last = lastVisitChange(o),
          ready = ["ready", "paid"].includes(o.status),
          pending = o.additions?.filter((a) => a.status === "pending") ?? [];
        return (
          <article
            className="client-visit"
            key={o.id}
            aria-label={`Visita activa ${v.plate}`}
          >
            <div className="client-visit-top">
              <span className="eyebrow">TU VISITA EN CURSO</span>
              <span className="client-visit-state">{summary.label}</span>
            </div>
            <h2>
              {v.brand} {v.model}
              <span className="license-plate">{v.plate}</span>
            </h2>
            <p>{summary.description}</p>
            <small>
              {branch(o.branchId)?.name ?? "Lubricentro"} · Orden {o.id}
            </small>
            <ol className="client-progress" aria-label="Avance de la visita">
              {["Recibido", "En atención", "Trabajo listo", "Entregado"].map(
                (label, i) => {
                  const step = ready
                    ? 2
                    : o.startedAt || o.status === "working"
                      ? 1
                      : 0;
                  return (
                    <li
                      key={label}
                      className={i <= step ? "reached" : ""}
                      aria-current={i === step ? "step" : undefined}
                    >
                      <span>{i < step ? <Check size={13} /> : i + 1}</span>
                      {label}
                    </li>
                  );
                },
              )}
            </ol>
            <div className="client-visit-metrics">
              <div>
                <small>
                  <Clock size={14} />
                  Retiro
                </small>
                <strong>
                  {ready
                    ? "Coordiná el retiro"
                    : o.expectedReadyAt
                      ? portalDateTime(o.expectedReadyAt)
                      : "Horario por confirmar"}
                </strong>
                <small>
                  {ready
                    ? "El trabajo está finalizado."
                    : o.expectedReadyAt
                      ? Date.parse(o.expectedReadyAt) < Date.now()
                        ? "La estimación pasó. Consultá al lubricentro."
                        : "Estimación del lubricentro; puede cambiar."
                      : "El lubricentro puede cargar una estimación."}
                </small>
              </div>
              <div>
                <small>
                  {ready ? "Total del trabajo" : "Importe previsto"}
                </small>
                <strong>{money(orderTotal(o))}</strong>
                <small>
                  {ready
                    ? `Saldo pendiente: ${money(orderBalance(s, o))}`
                    : "Los adicionales pendientes se muestran aparte."}
                </small>
              </div>
              <div>
                <small>Último cambio registrado</small>
                <strong>{last ? portalDateTime(last) : fmtDate(o.date)}</strong>
                <small>
                  {last
                    ? "Seguimiento de tu visita."
                    : "Sin hora registrada en esta orden anterior."}
                </small>
              </div>
            </div>
            {o.approval === "pending" && (
              <div className="client-decision">
                <div>
                  <strong>
                    Presupuesto pendiente · {money(quoteTotal(o))}
                  </strong>
                  <p>{o.serviceName || "Servicio propuesto"}</p>
                </div>
                <button className="button primary" onClick={() => open(o)}>
                  Revisar presupuesto <ArrowRight size={15} />
                </button>
              </div>
            )}
            {pending.map((a) => (
              <div className="client-decision" key={a.id}>
                <div>
                  <strong>
                    {a.title} · {money(additionTotal(a))}
                  </strong>
                  <p>Trabajo adicional. Este importe aún no está autorizado.</p>
                </div>
                <button className="button primary" onClick={() => open(o, a)}>
                  Revisar adicional <ArrowRight size={15} />
                </button>
              </div>
            ))}
            {(o.approval === "approved" ||
              o.additions?.some((a) => a.status !== "pending")) && (
              <div className="client-decisions-resolved">
                {o.approval === "approved" && (
                  <span>
                    <ShieldCheck size={14} />
                    Presupuesto autorizado
                  </span>
                )}
                {o.additions
                  ?.filter((a) => a.status !== "pending")
                  .map((a) => (
                    <span key={a.id}>
                      {a.title}:{" "}
                      {a.status === "approved" ? "autorizado" : "rechazado"}
                    </span>
                  ))}
              </div>
            )}
            {branch(o.branchId)?.phone && (
              <a
                className="client-contact"
                href={`tel:${branch(o.branchId)!.phone!.replace(/[^+\d]/g, "")}`}
              >
                Contactar al lubricentro · {branch(o.branchId)?.phone}
              </a>
            )}
          </article>
        );
      })}
      {!home.visits.length && (
        <div className="client-between">
          <Car size={28} />
          <div>
            <strong>Tus próximos pasos</strong>
            <p>
              {home.appointments.length
                ? "Tenés un turno próximo. Sus datos están debajo."
                : "Cuando ingreses al local, el seguimiento de tu visita aparecerá primero aquí."}
            </p>
          </div>
          {home.vehicles.length > 0 && (
            <button className="button primary" onClick={() => onAppointment()}>
              Solicitar turno
            </button>
          )}
        </div>
      )}
      {home.appointments[0] && (
        <section className="client-next">
          <h2>Tu próximo turno</h2>
          {turnCard(home.appointments[0])}
        </section>
      )}
      <div className="client-vehicles-heading">
        <h2>Mis vehículos</h2>
        <span>
          {home.vehicles.length}{" "}
          {home.vehicles.length === 1 ? "vehículo" : "vehículos"}
        </span>
      </div>
      <div className="client-vehicles">
        {home.vehicles.map((v) => {
          const visit = home.visits.find((o) => o.vehicleId === v.id),
            next = home.reminders.find((x) => x.r.vehicleId === v.id),
            appointment = home.appointments.find((a) => a.vehicleId === v.id);
          return (
            <article className="panel client-vehicle" key={v.id}>
              <div className="client-vehicle-top">
                <i>
                  <Car size={24} />
                </i>
                <span className="license-plate">{v.plate}</span>
              </div>
              <h3>
                {v.brand} {v.model}
              </h3>
              <p>
                Año {vehicleYear(v)}
                {visit ? " · En el lubricentro" : ""}
              </p>
              <dl className="client-km">
                <div>
                  <dt>Última lectura real</dt>
                  <dd>
                    {number(v.odometer)} <span>km</span>
                  </dd>
                  <small>{fmtDate(v.readingDate)}</small>
                </div>
                <div>
                  <dt>Kilometraje estimado hoy</dt>
                  <dd>
                    {number(estimatedKm(v, home.day))} <span>km</span>
                  </dd>
                  <small>
                    Según{" "}
                    {monthlyUsage(v).source === "visits"
                      ? "lecturas recientes"
                      : "antigüedad y kilometraje"}
                  </small>
                </div>
              </dl>
              <p className="client-km-note">
                La estimación no reemplaza la lectura del tablero.
              </p>
              <div className="client-next-care">
                <strong>Próximo mantenimiento</strong>
                {next ? (
                  <>
                    <Badge
                      value={
                        next.info.overdue
                          ? "warning"
                          : next.info.soon
                            ? "soon"
                            : "ok"
                      }
                    >
                      {next.info.overdue
                        ? "Pendiente / estimado"
                        : next.info.soon
                          ? "Se acerca"
                          : "Programado"}
                    </Badge>
                    <h4>{next.r.title}</h4>
                    <p>
                      {[
                        next.r.dueKm !== null
                          ? `${number(next.r.dueKm)} km`
                          : "",
                        next.r.dueDate ? fmtDate(next.r.dueDate) : "",
                      ]
                        .filter(Boolean)
                        .join(" o antes del ")}
                      {next.r.dueKm !== null && next.r.dueDate
                        ? ", lo que ocurra primero"
                        : ""}
                      .
                    </p>
                    {next.info.remaining !== null && (
                      <small>
                        {next.info.remaining > 0
                          ? `Aproximadamente ${number(next.info.remaining)} km restantes.`
                          : "El objetivo de kilometraje ya se alcanzó según la estimación."}
                      </small>
                    )}
                    <button className="text-button" onClick={onMaintenance}>
                      Ver mantenimientos <ArrowRight size={14} />
                    </button>
                  </>
                ) : (
                  <p>
                    Sin próximo mantenimiento registrado. Consultá al
                    lubricentro cuándo corresponde volver.
                  </p>
                )}
              </div>
              {appointment && turnCard(appointment)}
              <div className="client-vehicle-actions">
                <button
                  className="button secondary"
                  onClick={() => onReading(v)}
                >
                  Actualizar km
                </button>
                <button
                  className="button secondary"
                  onClick={() => onHistory(v)}
                >
                  Ver historial
                </button>
                <button
                  className="button primary"
                  onClick={() => onAppointment(v.id)}
                >
                  Solicitar turno
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!home.vehicles.length && (
        <Empty text="Tu cuenta todavía no tiene vehículos asociados. Pedile al lubricentro que vincule tu vehículo a tu ficha." />
      )}
      {review && (
        <div className="modal-backdrop">
          <section
            className="modal client-quote"
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-quote-title"
          >
            <header>
              <div>
                <h2 id="client-quote-title">
                  {review.addition
                    ? "Revisar adicional"
                    : "Revisar presupuesto"}
                </h2>
                <p>
                  {review.addition?.title ||
                    review.order.serviceName ||
                    "Servicio propuesto"}{" "}
                  · Revisión {review.order.quoteRevision ?? 1}
                </p>
              </div>
              <button
                className="icon-button"
                disabled={busy}
                aria-label="Cerrar detalle"
                onClick={() => setReview(null)}
              >
                <X />
              </button>
            </header>
            <div className="client-quote-body">
              <p>
                Vehículo:{" "}
                <strong>
                  {
                    home.vehicles.find((v) => v.id === review.order.vehicleId)
                      ?.plate
                  }
                </strong>{" "}
                · {branch(review.order.branchId)?.name}
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Concepto</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(review.addition?.items ?? review.order.items).map(
                      (i, index) => (
                        <tr key={index}>
                          <td>{i.name || "Insumo"}</td>
                          <td>{number(i.quantity)}</td>
                          <td>{money(i.price)}</td>
                          <td>{money(i.quantity * i.price)}</td>
                        </tr>
                      ),
                    )}
                    <tr>
                      <td>Mano de obra</td>
                      <td>—</td>
                      <td>—</td>
                      <td>
                        {money(review.addition?.labor ?? review.order.labor)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="client-quote-total">
                <span>
                  {review.addition
                    ? "Importe del adicional"
                    : "Total del presupuesto"}
                </span>
                <strong>
                  {money(
                    review.addition
                      ? additionTotal(review.addition)
                      : quoteTotal(review.order),
                  )}
                </strong>
              </div>
              {review.addition && (
                <p>
                  Se suma al importe de la orden si lo aprobás. Rechazarlo no
                  cancela el trabajo anterior.
                </p>
              )}
              <label className="client-consent">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Revisé el detalle y autorizo este trabajo por el importe
                mostrado.
              </label>
              <label className="client-comment">
                Comentario opcional
                <textarea
                  maxLength={1000}
                  value={note}
                  disabled={busy}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <p className="client-quote-note">
                Tu decisión queda registrada en la orden. Si el presupuesto
                cambió, deberás actualizarlo y revisarlo de nuevo.
              </p>
            </div>
            <footer>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void refresh()}
              >
                Actualizar detalle
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void decide("rejected")}
              >
                Rechazar
              </button>
              <button
                className="button primary"
                disabled={busy || !consent}
                onClick={() => void decide("approved")}
              >
                {busy ? "Guardando…" : "Autorizar trabajo"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
