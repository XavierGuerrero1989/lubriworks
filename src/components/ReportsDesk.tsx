import { useMemo, useState } from "react";
import { today, type State, type Sale } from "../../shared/model";
import {
  reports,
  periodBefore,
  reportDay,
  saleTotalAt,
  type timeSummary,
} from "../../shared/reports";
import { paymentValue } from "../../shared/billing";
import { Section, money, number, fmtDate, exportCsv, labels } from "./ui";
import "./reports.css";
export function ReportsDesk({
  s,
  branch,
  onOrder,
  onReceipt,
}: {
  s: State;
  branch: string;
  onOrder: (id: string) => void;
  onReceipt: (sale: Sale) => void;
}) {
  const [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today()),
    [view, setView] = useState("overview");
  const data = useMemo(() => {
    try {
      const r = reports(s, branch, from, to);
      const period = periodBefore(from, to);
      return {
        r,
        previous: reports(s, branch, period.from, period.to),
        period,
        error: "",
      };
    } catch {
      return {
        error:
          "Ingresá un período válido: Desde no puede ser posterior a Hasta.",
      };
    }
  }, [s, branch, from, to]);
  const r = data.r,
    previous = data.previous;
  const maxServiceCount =
    r?.services.reduce((n, v) => Math.max(n, v.count), 1) ?? 1;
  const customer = (id: string | null) =>
    s.customers.find((c) => c.id === id)?.name || "Consumidor sin ficha";
  const branchName = (id: string) =>
    s.branches.find((b) => b.id === id)?.name ?? id;
  const change = (value: number, base: number) =>
    base
      ? `${value >= base ? "+" : ""}${number(((value - base) / Math.abs(base)) * 100)}%`
      : "Sin base comparable";
  const preset = (days: number) => {
    const d = new Date(today() + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - days + 1);
    setFrom(d.toISOString().slice(0, 10));
    setTo(today());
  };
  const time = (v: ReturnType<typeof timeSummary>) =>
    v.average === null
      ? "Sin horarios registrados"
      : `${number(v.average)} min · ${v.samples} muestras`;
  const exportOverview = () => {
    if (!r || !previous) return;
    exportCsv("indicadores", [
      {
        Desde: from,
        Hasta: to,
        Sucursal: branch === "all" ? "Todas" : branchName(branch),
        Ventas: r.total,
        Operaciones: r.periodSales.length,
        CobrosNetos: r.collected,
        MargenBruto: r.margin,
        Ticket: r.ticket,
        SaldoAlCierre: r.debtTotal,
        Recibidos: r.received.length,
        Finalizados: r.finished.length,
        Entregados: r.delivered.length,
        ClientesAtendidos: r.customers,
        ClientesConVisitaAnterior: r.returning,
        EsperaMin: r.waiting.average ?? "",
        MuestrasEspera: r.waiting.samples,
        TrabajoMin: r.work.average ?? "",
        MuestrasTrabajo: r.work.samples,
        EntregaMin: r.delivery.average ?? "",
        MuestrasEntrega: r.delivery.samples,
        PermanenciaMin: r.stay.average ?? "",
        MuestrasPermanencia: r.stay.samples,
      },
    ]);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Reportes</h1>
          <p>Resultados y tiempos del lubricentro, por período y sucursal.</p>
        </div>
        <button
          className="button secondary"
          disabled={!r}
          onClick={exportOverview}
        >
          Exportar indicadores
        </button>
      </div>
      <div className="toolbar">
        <label>
          Desde{" "}
          <input
            type="date"
            aria-label="Reportes desde"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          Hasta{" "}
          <input
            type="date"
            aria-label="Reportes hasta"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <div className="row-actions">
          <button className="button secondary small" onClick={() => preset(7)}>
            7 días
          </button>
          <button className="button secondary small" onClick={() => preset(30)}>
            30 días
          </button>
          <button
            className="button secondary small"
            onClick={() => {
              setFrom(today().slice(0, 7) + "-01");
              setTo(today());
            }}
          >
            Este mes
          </button>
        </div>
      </div>
      {!r || !previous ? (
        <p role="alert">{data.error}</p>
      ) : (
        <>
          <p className="report-note">
            Fechas en horario de Argentina. Comparación con{" "}
            {fmtDate(data.period!.from)} al {fmtDate(data.period!.to)}. Ventas
            por fecha de registro; cobros y reversiones por fecha del
            movimiento. Saldo calculado al cierre del último día seleccionado.
          </p>
          <div className="report-kpis">
            {[
              [
                "Ventas registradas",
                money(r.total),
                `${r.periodSales.length} operaciones · ${change(r.total, previous.total)}`,
              ],
              [
                "Cobros netos",
                money(r.collected),
                `Incluye deudas anteriores y reversiones · ${change(r.collected, previous.collected)}`,
              ],
              [
                "Margen bruto",
                money(r.margin),
                "Ventas menos costo registrado de insumos; antes de gastos y costo laboral",
              ],
              [
                "Ticket promedio",
                money(r.ticket),
                "Por venta registrada, incluso con cobro parcial",
              ],
              [
                "Saldo al cierre",
                money(r.debtTotal),
                `${r.debt.length} ventas con saldo, incluidas anteriores al período`,
              ],
              [
                "Servicios finalizados",
                String(r.finished.length),
                `${r.delivered.length} entregas registradas · ${change(r.finished.length, previous.finished.length)}`,
              ],
            ].map(([label, value, detail]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <div className="segmented">
            {[
              ["overview", "Resultados"],
              ["operations", "Atención"],
              ["customers", "Clientes y turnos"],
              ["sales", "Ventas y saldos"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={view === id ? "active" : ""}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "overview" ? (
            <>
              <Section
                title="Resultados por sucursal"
                action={
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportCsv(
                        "sucursales",
                        r.branches.map((b) => ({
                          Sucursal: b.name,
                          Ventas: b.total,
                          Operaciones: b.sales,
                          Cobros: b.collected,
                          Finalizados: b.finished,
                          Entregas: b.delivered,
                        })),
                      )
                    }
                  >
                    Exportar sucursales
                  </button>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Sucursal</th>
                        <th>Ventas</th>
                        <th>Operaciones</th>
                        <th>Cobros netos</th>
                        <th>Finalizados</th>
                        <th>Entregas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.branches.map((b) => (
                        <tr key={b.id}>
                          <td>{b.name}</td>
                          <td>{money(b.total)}</td>
                          <td>{b.sales}</td>
                          <td>{money(b.collected)}</td>
                          <td>{b.finished}</td>
                          <td>{b.delivered}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <Section
                title={
                  r.trendMonthly ? "Evolución mensual" : "Evolución diaria"
                }
                subtitle="Días o meses con actividad registrada; venta y cobro se muestran por separado."
                action={
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportCsv(
                        "evolucion",
                        r.trend.map((b) => ({
                          Periodo: b.date,
                          Ventas: b.total,
                          Operaciones: b.sales,
                          Cobros: b.collected,
                          Finalizados: b.finished,
                        })),
                      )
                    }
                  >
                    Exportar evolución
                  </button>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th>Ventas</th>
                        <th>Cobros netos</th>
                        <th>Operaciones</th>
                        <th>Finalizados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.trend.map((b) => (
                        <tr key={b.date}>
                          <td>{r.trendMonthly ? b.date : fmtDate(b.date)}</td>
                          <td>{money(b.total)}</td>
                          <td>{money(b.collected)}</td>
                          <td>{b.sales}</td>
                          <td>{b.finished}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!r.trend.length && (
                  <p className="report-note">Sin actividad en este período.</p>
                )}
              </Section>
              <div className="dashboard-bottom">
                <Section
                  title="Servicios más realizados"
                  subtitle="Cuenta todos los servicios de órdenes finalizadas, incluso variantes inactivas."
                  action={
                    <button
                      className="button secondary small"
                      onClick={() =>
                        exportCsv(
                          "servicios-realizados",
                          r.services.map((v) => ({
                            Servicio: v.name,
                            Finalizados: v.count,
                          })),
                        )
                      }
                    >
                      Exportar
                    </button>
                  }
                >
                  <div className="bars">
                    {r.services.map((v) => (
                      <div className="bar-item" key={v.id}>
                        <div>
                          <span>{v.name}</span>
                          <strong>{v.count}</strong>
                        </div>
                        <div className="bar-track">
                          <i
                            style={{
                              width: `${(v.count / maxServiceCount) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                    {!r.services.length && <p>No hay servicios finalizados.</p>}
                  </div>
                </Section>
                <Section
                  title="Medios de cobro"
                  subtitle="Cobros menos reversiones del período."
                >
                  <div className="bars">
                    {Object.entries(r.methods).map(([method, value]) => (
                      <div className="payment-row" key={method}>
                        <span>{labels[method]}</span>
                        <strong>{money(value)}</strong>
                      </div>
                    ))}
                    {r.unclassifiedLegacy !== 0 && (
                      <p>
                        Combinados históricos sin detalle:{" "}
                        {money(r.unclassifiedLegacy)}
                      </p>
                    )}
                  </div>
                </Section>
              </div>
            </>
          ) : view === "operations" ? (
            <>
              <div className="report-times">
                {[
                  ["Espera antes de comenzar", r.waiting],
                  ["Tiempo de trabajo", r.work],
                  ["Espera de entrega", r.delivery],
                  ["Permanencia total", r.stay],
                ].map(([label, metric]) => {
                  const v = metric as ReturnType<typeof timeSummary>;
                  return (
                    <div key={String(label)}>
                      <strong>{String(label)}</strong>
                      <p>{time(v)}</p>
                      <small>
                        Mediana:{" "}
                        {v.median === null
                          ? "Sin datos"
                          : `${number(v.median)} min`}
                      </small>
                    </div>
                  );
                })}
              </div>
              <p className="report-note">
                Espera y trabajo: órdenes finalizadas en el período. Entrega y
                permanencia: vehículos entregados en el período. No se inventan
                horarios de registros anteriores ni se usan trabajos abiertos
                para medir duración final.
              </p>
              <Section
                title="Trabajo por técnico"
                subtitle="Órdenes finalizadas y tiempo registrado; no es una evaluación de calidad."
                action={
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportCsv(
                        "tecnicos",
                        r.technicians.map((t) => ({
                          Tecnico: t.name,
                          Finalizados: t.count,
                          PromedioMin: t.work.average ?? "",
                          MedianaMin: t.work.median ?? "",
                          Muestras: t.work.samples,
                        })),
                      )
                    }
                  >
                    Exportar técnicos
                  </button>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Técnico</th>
                        <th>Finalizados</th>
                        <th>Promedio de trabajo</th>
                        <th>Mediana</th>
                        <th>Con horarios</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.technicians.map((t) => (
                        <tr key={t.name}>
                          <td>{t.name}</td>
                          <td>{t.count}</td>
                          <td>
                            {t.work.average === null
                              ? "Sin datos"
                              : `${number(t.work.average)} min`}
                          </td>
                          <td>
                            {t.work.median === null
                              ? "Sin datos"
                              : `${number(t.work.median)} min`}
                          </td>
                          <td>{t.work.samples}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <Section
                title="Órdenes finalizadas"
                subtitle={`${r.legacyFinished} registros anteriores usan la fecha de la orden; sus horarios no se estiman.`}
                action={
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportCsv(
                        "atencion",
                        r.finished.map((o) => ({
                          Orden: o.id,
                          Cliente: customer(o.customerId),
                          Patente:
                            s.vehicles.find((v) => v.id === o.vehicleId)
                              ?.plate ?? "",
                          Sucursal: branchName(o.branchId),
                          Tecnico: o.technician,
                          Recepcion: o.receivedAt ?? "",
                          Inicio: o.startedAt ?? "",
                          Fin: o.finishedAt ?? "",
                          Entrega: o.deliveredAt ?? "",
                          FechaHistorica: !o.finishedAt ? o.date : "",
                        })),
                      )
                    }
                  >
                    Exportar atención
                  </button>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente / vehículo</th>
                        <th>Sucursal / técnico</th>
                        <th>Finalización</th>
                        <th>Entrega</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {r.finished.map((o) => (
                        <tr key={o.id}>
                          <td>
                            {customer(o.customerId)}
                            <small>
                              {
                                s.vehicles.find((v) => v.id === o.vehicleId)
                                  ?.plate
                              }
                            </small>
                          </td>
                          <td>
                            {branchName(o.branchId)}
                            <small>{o.technician || "Sin asignar"}</small>
                          </td>
                          <td>
                            {fmtDate(reportDay(o.finishedAt) || o.date)}
                            {!o.finishedAt && (
                              <small>Fecha histórica de orden</small>
                            )}
                          </td>
                          <td>
                            {o.deliveredAt
                              ? fmtDate(reportDay(o.deliveredAt))
                              : "Sin entrega registrada"}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => onOrder(o.id)}
                            >
                              Ver orden
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          ) : view === "customers" ? (
            <>
              <div className="report-times">
                <div>
                  <strong>Clientes atendidos</strong>
                  <p>{r.customers}</p>
                  <small>Clientes únicos con una orden finalizada</small>
                </div>
                <div>
                  <strong>Ya habían venido</strong>
                  <p>
                    {r.returning}
                    {r.customers
                      ? ` · ${number((r.returning / r.customers) * 100)}%`
                      : ""}
                  </p>
                  <small>
                    Con visita finalizada antes del período en la empresa
                  </small>
                </div>
                <div>
                  <strong>Autorizaciones</strong>
                  <p>
                    {r.approved} aprobadas · {r.rejected} rechazadas
                  </p>
                  <small>
                    Estado actual de presupuestos de órdenes recibidas en el
                    período; sin inferir aprobaciones antiguas
                  </small>
                </div>
              </div>
              <Section
                title="Turnos del período"
                subtitle="Estado actual de turnos según fecha agendada. Los pendientes no se convierten automáticamente en ausencias."
              >
                <div className="report-content">
                  <p>
                    {r.appointments} turnos · {r.attended} recibidos ·{" "}
                    {r.absence} ausencias registradas · {r.cancelled} cancelados
                    · {r.pendingAppointments} pendientes de recepción
                  </p>
                  <p>
                    Asistencia entre recibidos y ausencias:{" "}
                    {r.attended + r.absence
                      ? `${number((r.attended / (r.attended + r.absence)) * 100)}%`
                      : "Sin resultados registrados"}
                  </p>
                </div>
              </Section>
            </>
          ) : (
            <>
              <Section
                title="Ventas del período"
                subtitle="Totales y descuentos al cierre del período; el comprobante abre los valores actuales."
                action={
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportCsv(
                        "ventas-reporte",
                        r.periodSales.map((v) => ({
                          Venta: v.id,
                          Fecha: reportDay(v.date),
                          Sucursal: branchName(v.branchId),
                          Cliente: customer(v.customerId),
                          TotalAlCierre: saleTotalAt(v, to),
                          Costo: v.cost,
                          Margen: saleTotalAt(v, to) - v.cost,
                          Origen: v.orderId ? "Servicio" : "Mostrador",
                        })),
                      )
                    }
                  >
                    Exportar ventas
                  </button>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha / cliente</th>
                        <th>Sucursal / origen</th>
                        <th>Venta al cierre</th>
                        <th>Costo registrado</th>
                        <th>Margen bruto</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {r.periodSales.map((v) => (
                        <tr key={v.id}>
                          <td>
                            {fmtDate(reportDay(v.date))}
                            <small>{customer(v.customerId)}</small>
                          </td>
                          <td>
                            {branchName(v.branchId)}
                            <small>
                              {v.orderId ? "Servicio" : "Mostrador"}
                            </small>
                          </td>
                          <td>{money(saleTotalAt(v, to))}</td>
                          <td>{money(v.cost)}</td>
                          <td>{money(saleTotalAt(v, to) - v.cost)}</td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => onReceipt(v)}
                            >
                              Comprobante actual
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <Section
                title="Ventas con saldo al cierre"
                subtitle="Incluye ventas anteriores al período. Un pago posterior puede haber cancelado el saldo hoy."
                action={
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportCsv(
                        "saldos-al-cierre",
                        r.debt.map((v) => ({
                          Venta: v.sale.id,
                          Fecha: reportDay(v.sale.date),
                          Cliente: customer(v.sale.customerId),
                          Sucursal: branchName(v.sale.branchId),
                          Total: v.total,
                          CobradoAlCierre: v.paid,
                          SaldoAlCierre: v.balance,
                        })),
                      )
                    }
                  >
                    Exportar saldos
                  </button>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente / venta</th>
                        <th>Sucursal</th>
                        <th>Total al cierre</th>
                        <th>Cobrado al cierre</th>
                        <th>Saldo al cierre</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.debt.map((v) => (
                        <tr key={v.sale.id}>
                          <td>
                            {customer(v.sale.customerId)}
                            <small>{v.sale.id}</small>
                          </td>
                          <td>{branchName(v.sale.branchId)}</td>
                          <td>{money(v.total)}</td>
                          <td>{money(v.paid)}</td>
                          <td>{money(v.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!r.debt.length && (
                  <p className="report-note">
                    No hay ventas con saldo al cierre seleccionado.
                  </p>
                )}
              </Section>
              <Section
                title="Movimientos de cobro"
                subtitle={`${r.legacyCollections} ventas anteriores se consideran cobradas en su fecha, sin inventar pagos individuales.`}
                action={
                  <button
                    className="button secondary small"
                    onClick={() =>
                      exportCsv(
                        "movimientos-cobro",
                        r.ledger.map((p) => ({
                          Movimiento: p.id,
                          Venta: p.saleId,
                          Fecha: reportDay(p.date),
                          Sucursal: branchName(p.branchId),
                          Medio: labels[p.method],
                          Tipo: p.kind === "refund" ? "Reversión" : "Cobro",
                          Importe: paymentValue(p),
                          Responsable: p.actorName,
                          Referencia: p.reference,
                        })),
                      )
                    }
                  >
                    Exportar cobros
                  </button>
                }
              >
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha / venta</th>
                        <th>Medio</th>
                        <th>Tipo</th>
                        <th>Importe</th>
                        <th>Responsable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.ledger.map((p) => (
                        <tr key={p.id}>
                          <td>
                            {fmtDate(reportDay(p.date))}
                            <small>{p.saleId}</small>
                          </td>
                          <td>{labels[p.method]}</td>
                          <td>{p.kind === "refund" ? "Reversión" : "Cobro"}</td>
                          <td>{money(paymentValue(p))}</td>
                          <td>{p.actorName || "Responsable registrado"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}
