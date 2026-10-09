import { useState } from "react";
import type { State, Sale } from "../../shared/model";
import type { Command } from "../../shared/engine";
import {
  cashExpected,
  saleBalance,
  salePaid,
  orderBalance,
  paymentLabel,
  paymentValue,
} from "../../shared/billing";
import { orderTotal } from "../../shared/orders";
import {
  Badge,
  FormDialog,
  Section,
  SearchBox,
  money,
  labels,
  fmtDate,
  exportCsv,
  type Dialog,
} from "./ui";
import "./billing.css";
export function SalesDesk({
  s,
  branch,
  manager,
  execute,
  onCharge,
  onSalePay,
  onNewSale,
  onReceipt,
  onOrder,
}: {
  s: State;
  branch: string;
  manager: boolean;
  execute: (c: Command) => Promise<void>;
  onCharge: (id: string) => void;
  onSalePay: (id: string) => void;
  onNewSale: () => void;
  onReceipt: (s: Sale) => void;
  onOrder: (id: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [focused, setFocused] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const client = (id: string | null) =>
      s.customers.find((c) => c.id === id)?.name ?? "Consumidor sin ficha",
    vehicle = (id?: string | null) =>
      s.vehicles.find((v) => v.id === id)?.plate ?? "",
    branchName = (id: string) =>
      s.branches.find((b) => b.id === id)?.name ?? id;
  const scoped = (r: { branchId: string }) =>
    branch === "all" || r.branchId === branch;
  const sales = s.sales.filter(scoped),
    open = s.cash.filter((c) => scoped(c) && !c.closedAt),
    queue = s.orders.filter(
      (o) => scoped(o) && o.status === "ready" && orderBalance(s, o) > 0,
    );
  const rows = sales
    .filter(
      (v) =>
        (filter === "all" ||
          (filter === "pending"
            ? saleBalance(s, v) > 0
            : saleBalance(s, v) === 0)) &&
        `${client(v.customerId)} ${vehicle(v.vehicleId)} ${v.id} ${v.orderId ?? ""} ${v.items.map((i) => i.name).join(" ")}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const sale = sales.find((v) => v.id === focused),
    payments = sale
      ? s.payments
          .filter((p) => p.saleId === sale.id)
          .sort((a, b) => b.date.localeCompare(a.date))
      : [];
  const form = (title: string, fields: Dialog["fields"], c: Command) =>
    setDialog({
      title,
      fields,
      submit: async (data) => execute({ ...c, ...data }),
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Ventas y caja</h1>
          <p>Una venta, todos sus cobros y el saldo pendiente.</p>
        </div>
        <div className="row-actions">
          <button
            className="button secondary"
            onClick={() =>
              form(
                "Abrir caja",
                [
                  {
                    key: "branchId",
                    label: "Sucursal",
                    options: s.branches.map((b) => ({
                      value: b.id,
                      label: b.name,
                    })),
                    value: branch === "all" ? s.branches[0]?.id : branch,
                  },
                  {
                    key: "opening",
                    label: "Efectivo inicial",
                    type: "number",
                    value: 0,
                    min: 0,
                    max: 1e10,
                    step: "0.01",
                  },
                ],
                { action: "openCash" },
              )
            }
          >
            Abrir caja
          </button>
          <button className="button primary" onClick={onNewSale}>
            Nueva venta
          </button>
        </div>
      </div>
      <div className="billing-summary">
        <span>
          Órdenes listas para cobrar<strong>{queue.length}</strong>
        </span>
        <span>
          Saldo por cobrar
          <strong>
            {money(
              queue.reduce((n, o) => n + orderBalance(s, o), 0) +
                sales
                  .filter((v) => !v.orderId)
                  .reduce((n, v) => n + saleBalance(s, v), 0),
            )}
          </strong>
        </span>
        <span>
          Cajas abiertas<strong>{open.length}</strong>
        </span>
      </div>
      <Section
        title="Cola de cobro"
        subtitle="Servicios finalizados con saldo. La entrega requiere cobro completo."
      >
        {queue.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente / vehículo</th>
                  <th>Sucursal</th>
                  <th>Cobro</th>
                  <th>Total</th>
                  <th>Saldo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.map((o) => (
                  <tr key={o.id}>
                    <td>
                      {client(o.customerId)}
                      <small>{vehicle(o.vehicleId)}</small>
                    </td>
                    <td>
                      {branchName(o.branchId)}
                      {o.deliveredAt && <small>Entrega ya registrada</small>}
                    </td>
                    <td>
                      <Badge value={paymentLabel(o)} />
                    </td>
                    <td>
                      {money(
                        s.sales.find((v) => v.orderId === o.id)?.total ??
                          orderTotal(o),
                      )}
                    </td>
                    <td>{money(orderBalance(s, o))}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="button primary small"
                          onClick={() => onCharge(o.id)}
                        >
                          Cobrar saldo
                        </button>
                        <button
                          className="text-button"
                          onClick={() => onOrder(o.id)}
                        >
                          Ver orden
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            No hay órdenes con saldo pendiente en esta selección.
          </p>
        )}
      </Section>
      <div className="cash-grid">
        {open.map((c) => (
          <div className="panel cash-card" key={c.id}>
            <span className="badge ok">Caja abierta</span>
            <h2>{branchName(c.branchId)}</h2>
            <p>Efectivo esperado</p>
            <strong>{money(cashExpected(s, c))}</strong>
            <small>
              Apertura {money(c.opening)} · {fmtDate(c.openedAt)}
            </small>
            <button
              className="button secondary"
              onClick={() =>
                setDialog({
                  title: `Cerrar caja · ${branchName(c.branchId)}`,
                  description: `Efectivo esperado: ${money(cashExpected(s, c))}. Se incluyen cobros y reversiones de esta caja.`,
                  fields: [
                    {
                      key: "counted",
                      label: "Efectivo contado",
                      type: "number",
                      min: 0,
                      max: 1e10,
                      step: "0.01",
                      required: true,
                    },
                  ],
                  submit: async (data) =>
                    execute({ action: "closeCash", id: c.id, ...data }),
                })
              }
            >
              Cerrar caja
            </button>
          </div>
        ))}
      </div>
      {!open.length && (
        <p className="warning-box">
          Abrí la caja de la sucursal para registrar pagos o reversiones.
        </p>
      )}
      <Section
        title="Ventas y saldos"
        action={
          <button
            className="button secondary small"
            onClick={() =>
              exportCsv(
                "lubriworks-ventas.csv",
                rows.map((v) => ({
                  Fecha: v.date,
                  Cliente: client(v.customerId),
                  Vehiculo: vehicle(v.vehicleId),
                  Sucursal: branchName(v.branchId),
                  Subtotal: v.subtotal ?? v.total,
                  Descuento: v.discount ?? 0,
                  Total: v.total,
                  Cobrado: salePaid(s, v),
                  Saldo: saleBalance(s, v),
                })),
              )
            }
          >
            Exportar
          </button>
        }
      >
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar cliente, patente, venta o producto"
          />
          <select
            aria-label="Filtrar ventas por saldo"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todas las ventas</option>
            <option value="pending">Con saldo pendiente</option>
            <option value="paid">Cobradas</option>
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Cliente / concepto</th>
                <th>Total</th>
                <th>Cobrado</th>
                <th>Saldo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    {fmtDate(v.date)}
                    <small>{branchName(v.branchId)}</small>
                  </td>
                  <td>
                    {client(v.customerId)}
                    <small>
                      {vehicle(v.vehicleId)} ·{" "}
                      {v.orderId
                        ? "Orden de servicio"
                        : v.items.map((i) => i.name).join(", ")}
                    </small>
                  </td>
                  <td>{money(v.total)}</td>
                  <td>{money(salePaid(s, v))}</td>
                  <td>{money(saleBalance(s, v))}</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => setFocused(v.id)}
                    >
                      Ver venta y cobros
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="muted">No hay ventas para estos filtros.</p>
        )}
      </Section>
      {sale && (
        <Section
          title={`Detalle de venta · ${client(sale.customerId)}`}
          subtitle={`${sale.id} · ${vehicle(sale.vehicleId)} · ${branchName(sale.branchId)}`}
          action={
            <button className="text-button" onClick={() => setFocused("")}>
              Cerrar detalle
            </button>
          }
        >
          <div className="billing-detail">
            <div className="billing-summary">
              <span>
                Total<strong>{money(sale.total)}</strong>
              </span>
              <span>
                Cobrado<strong>{money(salePaid(s, sale))}</strong>
              </span>
              <span>
                Saldo<strong>{money(saleBalance(s, sale))}</strong>
              </span>
            </div>
            <div className="row-actions">
              {saleBalance(s, sale) > 0 && (
                <button
                  className="button primary"
                  onClick={() => onSalePay(sale.id)}
                >
                  Cobrar saldo
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => onReceipt(sale)}
              >
                Comprobante
              </button>
              {sale.orderId && (
                <button
                  className="button secondary"
                  onClick={() => onOrder(sale.orderId!)}
                >
                  Ver orden
                </button>
              )}
              {manager && sale.billingVersion && (
                <button
                  className="button secondary"
                  onClick={() =>
                    form(
                      "Ajustar descuento autorizado",
                      [
                        {
                          key: "discount",
                          label: "Descuento total ($)",
                          type: "number",
                          value: sale.discount ?? 0,
                          min: 0,
                          max: sale.subtotal ?? sale.total,
                          step: "0.01",
                          required: true,
                        },
                        {
                          key: "reason",
                          label: "Motivo",
                          type: "textarea",
                          minLength: 5,
                          maxLength: 500,
                          required: true,
                        },
                      ],
                      { action: "sale.discount", id: sale.id },
                    )
                  }
                >
                  Ajustar descuento
                </button>
              )}
            </div>
            <h3>Cobros y correcciones</h3>
            {!sale.billingVersion ? (
              <p>
                Venta anterior: cobro completo de {money(sale.total)} por{" "}
                {sale.method}. Se conserva el comprobante histórico.
              </p>
            ) : payments.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha / responsable</th>
                      <th>Movimiento</th>
                      <th>Medio</th>
                      <th>Importe</th>
                      <th>Referencia / motivo</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td>
                          {fmtDate(p.date)}
                          <small>
                            {new Date(p.date).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            · {p.actorName}
                          </small>
                        </td>
                        <td>
                          {p.kind === "refund" ? "Reversión" : "Cobro"}
                          {payments.some((r) => r.reversesId === p.id) && (
                            <small>Revertido</small>
                          )}
                        </td>
                        <td>
                          <Badge value={p.method} />
                        </td>
                        <td>{money(paymentValue(p))}</td>
                        <td>{p.reason || p.reference || "—"}</td>
                        <td>
                          {manager &&
                            p.kind === "receipt" &&
                            !payments.some((r) => r.reversesId === p.id) && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setDialog({
                                    title: "Revertir cobro",
                                    description: `Se registrará una devolución/corrección de ${money(p.amount)} por ${labels[p.method]} en la caja abierta y se reabrirá ese saldo. El pago original se conserva. Usá esta acción después de corregir o devolver el importe real.`,
                                    fields: [
                                      {
                                        key: "reason",
                                        label: "Motivo de la reversión",
                                        type: "textarea",
                                        required: true,
                                        minLength: 5,
                                        maxLength: 500,
                                      },
                                    ],
                                    submit: async (data) =>
                                      execute({
                                        action: "payment.reverse",
                                        id: p.id,
                                        ...data,
                                      }),
                                  })
                                }
                              >
                                Revertir con motivo
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Venta registrada sin cobros todavía.</p>
            )}
            {!!sale.adjustments?.length && (
              <>
                <h3>Descuentos autorizados</h3>
                {sale.adjustments.map((a) => (
                  <p key={a.id}>
                    {fmtDate(a.date)} · {a.actorName}: {money(a.beforeDiscount)}{" "}
                    → {money(a.discount)}
                    <small>{a.reason}</small>
                  </p>
                ))}
              </>
            )}
          </div>
        </Section>
      )}
      <Section title="Cierres de caja">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sucursal</th>
                <th>Cierre</th>
                <th>Esperado</th>
                <th>Contado</th>
                <th>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {s.cash
                .filter((c) => scoped(c) && c.closedAt)
                .slice()
                .reverse()
                .map((c) => (
                  <tr key={c.id}>
                    <td>{branchName(c.branchId)}</td>
                    <td>{fmtDate(c.closedAt!)}</td>
                    <td>{money(c.expected ?? 0)}</td>
                    <td>{money(c.counted ?? 0)}</td>
                    <td>{money((c.counted ?? 0) - (c.expected ?? 0))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>
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
