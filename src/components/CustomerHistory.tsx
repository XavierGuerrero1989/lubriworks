import { useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardList, Printer, RefreshCw, X } from "lucide-react";
import type { Access, State, Sale } from "../../shared/model";
import type { Order } from "../../shared/orders";
import {
  historyStage,
  serviceDay,
  customerHistory,
  historyDetail,
} from "../../shared/clientHistory";
import { portalDateTime } from "../../shared/clientHome";
import { Badge, Empty, fmtDate, money, number, SearchBox } from "./ui";
import "./customer-history.css";
const stageLabel = {
  completed: "Servicio finalizado",
  active: "Visita en curso",
  cancelled: "Orden cancelada",
};
export function CustomerHistory({
  state: s,
  access,
  search,
  onSearch,
  onRefresh,
  onReceipt,
  onVisit,
  onMaintenance,
}: {
  state: State;
  access: Access;
  search: string;
  onSearch: (s: string) => void;
  onRefresh: () => Promise<void>;
  onReceipt: (s: Sale) => void;
  onVisit: () => void;
  onMaintenance: () => void;
}) {
  const [vehicle, setVehicle] = useState("all"),
    [stage, setStage] = useState("completed"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const invalid = !!from && !!to && from > to,
    rows = invalid
      ? []
      : customerHistory(s, access.member, { vehicle, stage, from, to, search });
  const o = selected
    ? customerHistory(s, access.member, { stage: "all" }).find(
        (o) => o.id === selected,
      )
    : undefined;
  const vehicleName = (o: Order) => {
    const v = s.vehicles.find((v) => v.id === o.vehicleId);
    return `${v?.plate ?? ""} · ${v?.brand ?? ""} ${v?.model ?? ""}`;
  };
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
  const receipt = (sale: Sale) => {
    setSelected(null);
    onReceipt(sale);
  };
  const detail = o ? historyDetail(s, o) : null;
  return (
    <div className="client-service-history">
      <div className="page-heading">
        <div>
          <h1>Historial de servicios</h1>
          <p>El cuidado de tus vehículos, visita por visita.</p>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} />
          Actualizar historial
        </button>
      </div>
      <div className="history-filters">
        <SearchBox
          value={search}
          onChange={onSearch}
          placeholder="Buscar patente, vehículo o servicio…"
        />
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
        <label>
          Estado
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="completed">Servicios finalizados</option>
            <option value="active">Visitas en curso</option>
            <option value="cancelled">Órdenes canceladas</option>
            <option value="all">Todas las visitas</option>
          </select>
        </label>
        <label>
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <button
          className="button secondary"
          onClick={() => {
            setVehicle("all");
            setStage("completed");
            setFrom("");
            setTo("");
            onSearch("");
          }}
        >
          Limpiar filtros
        </button>
      </div>
      {invalid && (
        <p role="alert">La fecha Desde debe ser anterior o igual a Hasta.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="history-count">
        {rows.length} {rows.length === 1 ? "visita" : "visitas"} · Los importes
        y el saldo reflejan el estado actual de cada operación.
      </p>
      {!rows.length && !invalid && (
        <Empty text="No hay servicios para estos filtros. Podés consultar las visitas en curso o elegir otro período." />
      )}
      <div className="history-cards">
        {rows.map((o) => {
          const d = historyDetail(s, o),
            status = historyStage(o);
          return (
            <article className="history-card" key={o.id}>
              <div className="history-card-heading">
                <ClipboardList size={23} />
                <Badge
                  value={
                    status === "completed"
                      ? "done"
                      : status === "cancelled"
                        ? "cancelled"
                        : "working"
                  }
                >
                  {stageLabel[status]}
                </Badge>
              </div>
              <span>
                {fmtDate(serviceDay(o))} · {number(o.odometer)} km
              </span>
              <h2>
                {o.serviceName ||
                  o.serviceSnapshots?.map((v) => v.name).join(" + ") ||
                  "Servicio registrado"}
              </h2>
              <strong>{vehicleName(o)}</strong>
              <p>
                {s.branches.find((b) => b.id === o.branchId)?.name ??
                  "Sucursal"}
              </p>
              {o.customerSummary && (
                <p className="history-public-note">{o.customerSummary}</p>
              )}
              {status !== "cancelled" && (
                <div className="history-amounts">
                  <div>
                    <small>
                      {d.sale
                        ? "Importe de la operación"
                        : d.complete
                          ? "Importe registrado"
                          : "Importe previsto"}
                    </small>
                    <strong>{money(d.total)}</strong>
                  </div>
                  {d.complete && (
                    <div>
                      <small>Saldo actual</small>
                      <strong>{money(d.balance)}</strong>
                    </div>
                  )}
                </div>
              )}
              <div className="history-actions">
                <button
                  className="button primary"
                  onClick={() => setSelected(o.id)}
                >
                  Ver detalle
                </button>
                {d.sale && (
                  <button
                    className="button secondary"
                    onClick={() => receipt(d.sale!)}
                  >
                    Comprobante
                  </button>
                )}
                {status === "active" && (
                  <button className="button secondary" onClick={onVisit}>
                    Ver mi visita
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {o &&
        detail &&
        createPortal(
          <div className="modal-backdrop">
            <section
              className="modal receipt customer-service-report"
              role="dialog"
              aria-modal="true"
              aria-labelledby="service-report-title"
            >
              <div className="receipt-actions">
                <button
                  className="button primary"
                  onClick={() => window.print()}
                >
                  <Printer size={16} />
                  Imprimir / guardar PDF
                </button>
                <button
                  className="icon-button"
                  aria-label="Cerrar detalle de servicio"
                  onClick={() => setSelected(null)}
                >
                  <X />
                </button>
              </div>
              <div className="receipt-body">
                <img src="/brand/logo.png" alt="LubriWorks" />
                <h1 id="service-report-title">Detalle de la visita</h1>
                <p>
                  {access.tenant.name} ·{" "}
                  {s.branches.find((b) => b.id === o.branchId)?.name}
                </p>
                <h2>{vehicleName(o)}</h2>
                <dl>
                  <dt>Orden</dt>
                  <dd>{o.id}</dd>
                  <dt>Ingreso</dt>
                  <dd>
                    {fmtDate(o.date)} · {number(o.odometer)} km
                  </dd>
                  <dt>Estado</dt>
                  <dd>{stageLabel[historyStage(o)]}</dd>
                  {o.finishedAt && (
                    <>
                      <dt>Trabajo finalizado</dt>
                      <dd>{portalDateTime(o.finishedAt)}</dd>
                    </>
                  )}
                  {o.deliveredAt && (
                    <>
                      <dt>Vehículo entregado</dt>
                      <dd>{portalDateTime(o.deliveredAt)}</dd>
                    </>
                  )}
                </dl>
                <h3>Servicios registrados</h3>
                <ul>
                  {(o.serviceSnapshots?.length
                    ? o.serviceSnapshots.map((v) => v.name)
                    : [o.serviceName || "Servicio registrado"]
                  ).map((name, i) => (
                    <li key={i}>{name}</li>
                  ))}
                </ul>
                {historyStage(o) === "cancelled" ? (
                  <p>
                    La orden fue cancelada. Este registro no acredita trabajos
                    realizados.
                  </p>
                ) : (
                  <>
                    <h3>
                      {detail.realConsumptions
                        ? "Insumos utilizados"
                        : "Insumos registrados en la orden"}
                    </h3>
                    {!detail.realConsumptions && (
                      <p>
                        {detail.complete
                          ? "Este registro no tiene confirmación de cantidades consumidas."
                          : "Son cantidades previstas; el trabajo todavía no finalizó."}
                      </p>
                    )}
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Insumo</th>
                            <th>Cantidad</th>
                            <th>Precio unitario</th>
                            <th>Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.items.map((i, n) => (
                            <tr key={n}>
                              <td>{i.name || "Insumo registrado"}</td>
                              <td>{number(i.quantity)}</td>
                              <td>{money(i.price)}</td>
                              <td>{money(i.price * i.quantity)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!detail.items.length && <p>Sin insumos registrados.</p>}
                    <p>
                      Mano de obra, incluidos adicionales autorizados:{" "}
                      <strong>{money(detail.labor)}</strong>
                    </p>
                    <p>
                      Importe técnico:{" "}
                      <strong>{money(detail.technicalTotal)}</strong>
                    </p>
                    {(o.additions?.length ?? 0) > 0 && (
                      <>
                        <h3>Trabajos adicionales</h3>
                        <ul>
                          {o.additions!.map((a) => (
                            <li key={a.id}>
                              {a.title} ·{" "}
                              {a.status === "approved"
                                ? "Autorizado"
                                : a.status === "rejected"
                                  ? "Rechazado"
                                  : "Pendiente de autorización"}
                            </li>
                          ))}
                        </ul>
                        <p>
                          Sólo los adicionales autorizados integran el importe.
                        </p>
                      </>
                    )}
                    <h3>Controles registrados</h3>
                    {o.checklist.length ? (
                      <ul>
                        {o.checklist.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No se registraron controles en esta orden.</p>
                    )}
                    {o.customerSummary && (
                      <>
                        <h3>Informe del lubricentro</h3>
                        <p className="history-public-note">
                          {o.customerSummary}
                        </p>
                      </>
                    )}
                    {o.customerRecommendations && (
                      <>
                        <h3>Recomendaciones del lubricentro</h3>
                        <p className="history-public-note">
                          {o.customerRecommendations}
                        </p>
                      </>
                    )}
                    {!o.customerSummary && !o.customerRecommendations && (
                      <p>
                        El lubricentro todavía no publicó un informe para esta
                        visita.
                      </p>
                    )}
                    {detail.complete && detail.nextCare.length > 0 && (
                      <>
                        <h3>Próximo cuidado indicado en esta visita</h3>
                        <ul>
                          {detail.nextCare.map((c, i) => (
                            <li key={i}>
                              {c.name}:{" "}
                              {c.km !== null ? `${number(c.km)} km` : ""}
                              {c.km !== null && c.date ? " o antes del " : ""}
                              {c.date ? fmtDate(c.date) : ""}
                              {c.km !== null && c.date
                                ? ", lo que ocurra primero."
                                : ""}
                            </li>
                          ))}
                        </ul>
                        <p>
                          Referencia histórica de esta visita. Consultá Próximos
                          mantenimientos para ver los avisos vigentes.
                        </p>
                      </>
                    )}
                    <div className="receipt-total">
                      <span>
                        {detail.sale
                          ? "Importe de la operación"
                          : detail.complete
                            ? "Importe registrado"
                            : "Importe previsto"}
                      </span>
                      <strong>{money(detail.total)}</strong>
                    </div>
                    {detail.sale && !!detail.sale.discount && (
                      <p>Descuento aplicado: {money(detail.sale.discount)}</p>
                    )}
                    {detail.complete && (
                      <>
                        <div className="receipt-total">
                          <span>Total cobrado</span>
                          <strong>{money(detail.paid)}</strong>
                        </div>
                        <div className="receipt-total">
                          <span>Saldo actual</span>
                          <strong>{money(detail.balance)}</strong>
                        </div>
                        {!detail.sale && o.status === "paid" && (
                          <p>
                            Registro anterior marcado como pagado; no tiene
                            comprobante asociado.
                          </p>
                        )}
                      </>
                    )}
                  </>
                )}
                <p>
                  Este detalle técnico no reemplaza el comprobante de la
                  operación.
                </p>
                <div className="history-actions receipt-actions">
                  {detail.sale && (
                    <button
                      className="button secondary"
                      onClick={() => receipt(detail.sale!)}
                    >
                      Ver comprobante
                    </button>
                  )}
                  {detail.complete && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setSelected(null);
                        onMaintenance();
                      }}
                    >
                      Ver mantenimientos vigentes
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}
