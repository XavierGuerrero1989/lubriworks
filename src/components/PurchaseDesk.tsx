import { useState } from "react";
import { round, today, type State, type Entity } from "../../shared/model";
import {
  pendingQuantity,
  receivedQuantity,
  replenishment,
  type Purchase,
} from "../../shared/purchases";
import type { Command } from "../../shared/engine";
import {
  FormDialog,
  Section,
  SearchBox,
  Badge,
  money,
  number,
  fmtDate,
  exportCsv,
  type Dialog,
} from "./ui";
import "./purchases.css";
const labels = {
  draft: "Pendiente",
  partial: "Recepción parcial",
  received: "Recibida",
  cancelled: "Saldo cancelado",
};
export function PurchaseDesk({
  s,
  branch,
  run,
  onEdit,
  onSupplier,
  onNew,
}: {
  s: State;
  branch: string;
  run: (c: Command) => Promise<void>;
  onEdit: (p: Purchase) => void;
  onSupplier: (p?: Entity<"suppliers">) => void;
  onNew: (initial?: Record<string, unknown>) => void;
}) {
  const [view, setView] = useState("purchases"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [focus, setFocus] = useState(""),
    [supplier, setSupplier] = useState(""),
    [days, setDays] = useState(7),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const branchName = (id: string) =>
    s.branches.find((b) => b.id === id)?.name ?? id;
  const supplierName = (id: string) =>
    s.suppliers.find((v) => v.id === id)?.name ?? id;
  const productName = (id: string) =>
    s.products.find((p) => p.id === id)?.name ?? id;
  const scoped = s.purchases.filter(
    (p) => branch === "all" || p.branchId === branch,
  );
  const rows = scoped
    .filter(
      (p) =>
        (!supplier || p.supplierId === supplier) &&
        (filter === "all" ||
          (filter === "open"
            ? ["draft", "partial"].includes(p.status)
            : p.status === filter)) &&
        normalize(
          `${p.id} ${supplierName(p.supplierId)} ${p.reference ?? ""} ${p.items.map((i) => productName(i.productId)).join(" ")}`,
        ).includes(normalize(search)),
    )
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const selected = scoped.find((p) => p.id === focus);
  const endDate = new Date(today() + "T12:00:00Z");
  endDate.setUTCDate(endDate.getUTCDate() + days - 1);
  const end = endDate.toISOString().slice(0, 10),
    plan = replenishment(s, branch, end),
    needed = plan.rows.filter((r) => r.suggested > 0);
  const unit = (pid: string) =>
    s.products.find((p) => p.id === pid)?.unit === "litro" ? "L" : "u.";
  const receive = (p: Purchase) => {
    const pending = p.items.filter((i) => pendingQuantity(p, i.productId) > 0);
    setDialog({
      title: `Recibir mercadería · ${p.id}`,
      description:
        "Ingresá sólo lo que llegó. Las cantidades en cero quedan pendientes. El costo real actualiza el costo del producto; la cotización original se conserva.",
      submitLabel: "Registrar recepción",
      fields: [
        ...pending.flatMap((i, index) => [
          {
            key: `q${index}`,
            label: `${productName(i.productId)} · cantidad recibida (${unit(i.productId)})`,
            type: "number",
            value: 0,
            min: 0,
            max: pendingQuantity(p, i.productId),
            step: unit(i.productId) === "L" ? "0.01" : "1",
            hint: `Pendiente: ${number(pendingQuantity(p, i.productId))} ${unit(i.productId)}`,
          },
          {
            key: `c${index}`,
            label: `${productName(i.productId)} · costo unitario real`,
            type: "number",
            value: i.cost,
            min: 0,
            step: "0.01",
          },
        ]),
        {
          key: "reference",
          label: "Remito / factura",
          required: false,
          maxLength: 200,
        },
        {
          key: "note",
          label: "Observaciones de recepción",
          type: "textarea",
          required: false,
          maxLength: 1000,
        },
      ],
      submit: async (data) => {
        await run({
          action: "receivePurchase",
          id: p.id,
          items: pending
            .map((i, index) => ({
              productId: i.productId,
              quantity: data[`q${index}`],
              cost: data[`c${index}`],
            }))
            .filter((i) => i.quantity > 0),
          reference: data.reference,
          note: data.note,
        });
      },
    });
  };
  const cancel = (p: Purchase) =>
    setDialog({
      title: "Cancelar saldo pendiente",
      description:
        "La mercadería ya recibida y sus movimientos se conservan. Se cancela únicamente lo que falta entregar.",
      fields: [
        {
          key: "reason",
          label: "Motivo",
          type: "textarea",
          minLength: 5,
          maxLength: 1000,
        },
      ],
      submitLabel: "Cancelar saldo",
      submit: async (data) => {
        await run({ action: "purchase.cancel", id: p.id, reason: data.reason });
      },
    });
  const planTurn = (a: State["appointments"][number]) =>
    setDialog({
      title: `Prever insumos · ${s.vehicles.find((v) => v.id === a.vehicleId)?.plate ?? a.id}`,
      description: `${fmtDate(a.date)} ${a.time} · ${a.reason}. Esta previsión orienta compras: no reserva ni descuenta stock, ni modifica el presupuesto de la futura orden.`,
      fields: [
        {
          key: "items",
          label: "Insumos previstos",
          type: "lines",
          required: false,
          value: a.plannedItems ?? [],
          options: s.products
            .filter((p) => p.branchId === a.branchId)
            .map((p) => ({ value: p.id, label: `${p.name} · ${unit(p.id)}` })),
        },
      ],
      submit: async (data) => {
        await run({ action: "purchase.plan", id: a.id, items: data.items });
      },
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compras y proveedores</h1>
          <p>
            Recepciones parciales y reposición por disponibilidad y turnos
            previstos.
          </p>
        </div>
        <div className="row-actions">
          <button className="button secondary" onClick={() => onSupplier()}>
            Proveedor
          </button>
          <button className="button primary" onClick={() => onNew()}>
            Nueva compra
          </button>
        </div>
      </div>
      <div className="purchase-summary">
        <span>
          Compras abiertas
          <strong>
            {
              scoped.filter((p) => ["draft", "partial"].includes(p.status))
                .length
            }
          </strong>
        </span>
        <span>
          Con entrega parcial
          <strong>{scoped.filter((p) => p.status === "partial").length}</strong>
        </span>
        <span>
          Entrega demorada
          <strong>
            {
              scoped.filter(
                (p) =>
                  ["draft", "partial"].includes(p.status) &&
                  p.expectedDate &&
                  p.expectedDate < today(),
              ).length
            }
          </strong>
        </span>
      </div>
      <div className="segmented">
        {[
          ["purchases", "Compras"],
          ["planning", "Reposición"],
          ["suppliers", "Proveedores"],
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
      {view === "suppliers" ? (
        <Section title="Tus proveedores">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar proveedor o contacto…"
          />
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Proveedor</th>
                  <th>Contacto</th>
                  <th>Compras / abiertas</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.suppliers
                  .filter((p) =>
                    normalize(`${p.name} ${p.email} ${p.phone}`).includes(
                      normalize(search),
                    ),
                  )
                  .map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                      </td>
                      <td>
                        {p.email || "Sin correo"}
                        <small>{p.phone || "Sin teléfono"}</small>
                      </td>
                      <td>
                        {scoped.filter((b) => b.supplierId === p.id).length} /{" "}
                        {
                          scoped.filter(
                            (b) =>
                              b.supplierId === p.id &&
                              ["draft", "partial"].includes(b.status),
                          ).length
                        }
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="text-button"
                            onClick={() => onSupplier(p)}
                          >
                            Editar
                          </button>
                          <button
                            className="text-button"
                            onClick={() => {
                              setSupplier(p.id);
                              setSearch("");
                              setFilter("all");
                              setView("purchases");
                            }}
                          >
                            Ver compras
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!s.suppliers.length && (
            <p>Cargá el primer proveedor para preparar compras.</p>
          )}
        </Section>
      ) : view === "planning" ? (
        <>
          <div className="toolbar">
            <label>
              Horizonte de reposición{" "}
              <select
                aria-label="Horizonte de reposición"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>7 días</option>
                <option value={14}>14 días</option>
                <option value={30}>30 días</option>
              </select>
            </label>
            <button
              className="button secondary"
              onClick={() =>
                exportCsv(
                  "reposicion",
                  plan.rows.map((r) => ({
                    Producto: r.product.name,
                    Sucursal: branchName(r.product.branchId),
                    Disponible: r.available,
                    Minimo: r.product.minStock,
                    Turnos: r.demand,
                    Pendiente: r.incoming,
                    EntregasPrevistas: r.datedIncoming,
                    Sugerido: r.suggested,
                    PrimeraNecesidad: r.firstNeed,
                  })),
                )
              }
            >
              Exportar reposición
            </button>
          </div>
          <p className="purchase-note">
            Del {fmtDate(today())} al {fmtDate(end)}. La sugerencia cubre el
            mínimo y los insumos previstos de turnos solicitados/confirmados,
            descontando las reservas actuales y las compras con entrega prevista
            a tiempo. Una entrega prevista es una estimación: no agrega stock
            real. Compras sin fecha o demoradas no se descuentan. Las
            previsiones son por día, sin asegurar una entrega antes de la hora
            del turno.
          </p>
          <Section
            title="Productos a reponer"
            subtitle={`${needed.length} productos · ${plan.unplanned.length} turnos sin insumos previstos`}
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Producto / sucursal</th>
                    <th>Disponible</th>
                    <th>Mínimo</th>
                    <th>Turnos previstos</th>
                    <th>Por recibir / dentro del período</th>
                    <th>Sugerido</th>
                    <th>Primera necesidad</th>
                  </tr>
                </thead>
                <tbody>
                  {needed.map((r) => (
                    <tr key={r.product.id}>
                      <td>
                        <strong>{r.product.name}</strong>
                        <small>{branchName(r.product.branchId)}</small>
                      </td>
                      <td>
                        {number(r.available)} {unit(r.product.id)}
                      </td>
                      <td>{number(r.product.minStock)}</td>
                      <td>{number(r.demand)}</td>
                      <td>
                        {number(r.incoming)} / {number(r.datedIncoming)}
                      </td>
                      <td>
                        <strong>
                          {number(r.suggested)} {unit(r.product.id)}
                        </strong>
                      </td>
                      <td>{fmtDate(r.firstNeed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!needed.length && (
              <p>
                No hay faltantes proyectados con la información cargada. Revisá
                los turnos sin previsión.
              </p>
            )}
            <div className="row-actions">
              {s.branches
                .filter((b) => branch === "all" || b.id === branch)
                .map((b) => {
                  const items = needed
                    .filter((r) => r.product.branchId === b.id)
                    .map((r) => ({
                      productId: r.product.id,
                      quantity: r.suggested,
                      cost: r.product.cost,
                    }));
                  return items.length ? (
                    <button
                      className="button secondary"
                      key={b.id}
                      onClick={() => onNew({ branchId: b.id, items })}
                    >
                      Preparar compra · {b.name}
                    </button>
                  ) : null;
                })}
            </div>
          </Section>
          <Section
            title="Insumos de próximos turnos"
            subtitle="Se cargan según el trabajo y la ficha técnica. No se deducen del motivo del turno."
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Turno / vehículo</th>
                    <th>Sucursal / motivo</th>
                    <th>Previsión</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plan.appointments
                    .slice()
                    .sort((a, b) =>
                      (a.date + a.time).localeCompare(b.date + b.time),
                    )
                    .map((a) => (
                      <tr key={a.id}>
                        <td>
                          {fmtDate(a.date)} {a.time}
                          <small>
                            {
                              s.vehicles.find((v) => v.id === a.vehicleId)
                                ?.plate
                            }
                          </small>
                        </td>
                        <td>
                          {branchName(a.branchId)}
                          <small>{a.reason}</small>
                        </td>
                        <td>
                          {a.plannedItems?.length
                            ? a.plannedItems
                                .map(
                                  (i) =>
                                    `${productName(i.productId)}: ${number(i.quantity)} ${unit(i.productId)}`,
                                )
                                .join(" · ")
                            : "Sin prever"}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => planTurn(a)}
                          >
                            Prever insumos
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!plan.appointments.length && (
              <p>No hay turnos pendientes de recepción en este período.</p>
            )}
          </Section>
        </>
      ) : (
        <>
          <div className="toolbar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="Buscar proveedor, producto, compra o comprobante…"
            />
            <select
              aria-label="Filtrar compras"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">Todas las compras</option>
              <option value="open">Abiertas</option>
              {Object.entries(labels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar proveedor"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              <option value="">Todos los proveedores</option>
              {s.suppliers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <Section
            title="Órdenes de compra"
            action={
              <button
                className="button secondary small"
                onClick={() =>
                  exportCsv(
                    "compras",
                    rows.map((p) => ({
                      Compra: p.id,
                      Fecha: p.date,
                      Proveedor: supplierName(p.supplierId),
                      Sucursal: branchName(p.branchId),
                      Esperada: p.expectedDate ?? "",
                      Referencia: p.reference ?? "",
                      Estado: labels[p.status],
                      Cotizado: round(
                        p.items.reduce((n, i) => n + i.quantity * i.cost, 0),
                      ),
                      Recibido: p.receipts?.length
                        ? round(
                            p.receipts
                              .flatMap((r) => r.items)
                              .reduce((n, i) => n + i.quantity * i.cost, 0),
                          )
                        : "Sin historial detallado",
                    })),
                  )
                }
              >
                Exportar
              </button>
            }
          >
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha / compra</th>
                    <th>Proveedor / referencia</th>
                    <th>Sucursal</th>
                    <th>Cotizado</th>
                    <th>Entrega prevista</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {fmtDate(p.date)}
                        <small>{p.id}</small>
                      </td>
                      <td>
                        {supplierName(p.supplierId)}
                        <small>{p.reference}</small>
                      </td>
                      <td>{branchName(p.branchId)}</td>
                      <td>
                        {money(
                          p.items.reduce((n, i) => n + i.quantity * i.cost, 0),
                        )}
                      </td>
                      <td>
                        {p.expectedDate ? fmtDate(p.expectedDate) : "Sin fecha"}
                        {["draft", "partial"].includes(p.status) &&
                          p.expectedDate &&
                          p.expectedDate < today() && (
                            <small>Entrega demorada</small>
                          )}
                      </td>
                      <td>
                        <Badge
                          value={p.status === "partial" ? "warning" : p.status}
                        >
                          {labels[p.status]}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setFocus(p.id)}
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <p>No hay compras para estos filtros.</p>}
          </Section>
          {selected && (
            <Section
              title={`Compra · ${selected.id}`}
              subtitle={`${supplierName(selected.supplierId)} · ${branchName(selected.branchId)}`}
              action={
                <button className="text-button" onClick={() => setFocus("")}>
                  Cerrar detalle
                </button>
              }
            >
              <div className="purchase-detail">
                <p>{selected.notes || "Sin observaciones de compra."}</p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Pedido</th>
                        <th>Recibido</th>
                        <th>Pendiente</th>
                        <th>Costo cotizado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((i) => (
                        <tr key={i.productId}>
                          <td>{productName(i.productId)}</td>
                          <td>
                            {number(i.quantity)} {unit(i.productId)}
                          </td>
                          <td>
                            {number(receivedQuantity(selected, i.productId))}
                          </td>
                          <td>
                            {selected.status === "cancelled"
                              ? "Saldo cancelado"
                              : number(pendingQuantity(selected, i.productId))}
                          </td>
                          <td>{money(i.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row-actions">
                  {selected.status === "draft" &&
                    !selected.receipts?.length && (
                      <button
                        className="button secondary"
                        onClick={() => onEdit(selected)}
                      >
                        Editar compra
                      </button>
                    )}
                  {["draft", "partial"].includes(selected.status) && (
                    <>
                      <button
                        className="button primary"
                        onClick={() => receive(selected)}
                      >
                        Recibir mercadería
                      </button>
                      <button
                        className="button secondary"
                        onClick={() => cancel(selected)}
                      >
                        Cancelar saldo pendiente
                      </button>
                    </>
                  )}
                </div>
                {selected.cancelReason && (
                  <p>
                    Saldo cancelado: {selected.cancelReason} ·{" "}
                    {fmtDate(selected.cancelledAt ?? "")}
                  </p>
                )}
                <h3>Historial de recepciones</h3>
                {selected.receipts?.length ? (
                  selected.receipts
                    .slice()
                    .reverse()
                    .map((r) => (
                      <div className="purchase-receipt" key={r.id}>
                        <strong>
                          {fmtDate(r.at)} ·{" "}
                          {r.actorName || "Responsable registrado"}
                        </strong>
                        <p>
                          {r.reference || "Sin remito / factura"}
                          {r.note ? ` · ${r.note}` : ""}
                        </p>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Producto</th>
                                <th>Recibido</th>
                                <th>Costo real</th>
                                <th>Importe</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.items.map((i) => (
                                <tr key={i.productId}>
                                  <td>{productName(i.productId)}</td>
                                  <td>
                                    {number(i.quantity)} {unit(i.productId)}
                                  </td>
                                  <td>{money(i.cost)}</td>
                                  <td>{money(i.quantity * i.cost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p>
                          Total de recepción:{" "}
                          {money(
                            r.items.reduce(
                              (n, i) => n + i.quantity * i.cost,
                              0,
                            ),
                          )}
                        </p>
                      </div>
                    ))
                ) : (
                  <p>
                    {selected.status === "received"
                      ? "Compra anterior recibida completa, sin historial detallado de recepciones."
                      : "Todavía no se recibió mercadería."}
                  </p>
                )}
              </div>
            </Section>
          )}
        </>
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
