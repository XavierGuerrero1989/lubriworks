import { useState } from "react";
import type { State } from "../../shared/model";
import {
  availableStock,
  reservedStock,
  reservations,
  stockStatus,
  type Product,
} from "../../shared/inventory";
import {
  SearchBox,
  Section,
  Badge,
  money,
  number,
  fmtDate,
  exportCsv,
} from "./ui";
import "./inventory.css";
const statusLabels = {
  ok: "Disponible",
  low: "Bajo mínimo",
  empty: "Sin disponible",
  shortage: "Reserva con faltante",
};
export function StockDesk({
  s,
  branch,
  manager,
  onEdit,
  onAdjust,
  onOrder,
  onPurchase,
}: {
  s: State;
  branch: string;
  manager: boolean;
  onEdit: (p?: Product) => void;
  onAdjust: (p: Product) => void;
  onOrder: (id: string) => void;
  onPurchase: () => void;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [focused, setFocused] = useState(""),
    [view, setView] = useState("products");
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const branchName = (id: string) =>
      s.branches.find((b) => b.id === id)?.name ?? id,
    unit = (p: Product) => (p.unit === "litro" ? "L" : "u.");
  const products = s.products.filter(
      (p) => branch === "all" || p.branchId === branch,
    ),
    rows = products.filter(
      (p) =>
        normalize(
          `${p.name} ${p.sku} ${p.location ?? ""} ${p.compatibility ?? ""}`,
        ).includes(normalize(search)) &&
        (filter === "all" ||
          (filter === "reserved"
            ? reservedStock(s, p.id) > 0
            : filter === "alerts"
              ? stockStatus(s, p) !== "ok"
              : stockStatus(s, p) === filter)),
    );
  const product = products.find((p) => p.id === focused),
    holds = product ? reservations(s, product.id) : [];
  const moves = s.movements
    .filter(
      (m) =>
        (branch === "all" || m.branchId === branch) &&
        (!focused || m.productId === focused) &&
        normalize(
          `${s.products.find((p) => p.id === m.productId)?.name} ${m.reason} ${m.actorName ?? ""}`,
        ).includes(normalize(search)),
    )
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Productos y stock</h1>
          <p>
            Stock físico, reservas de trabajo y disponibilidad por sucursal.
          </p>
        </div>
        {manager && (
          <button className="button primary" onClick={() => onEdit()}>
            Nuevo producto
          </button>
        )}
      </div>
      <div className="inventory-summary">
        <span>
          Productos con reserva
          <strong>
            {products.filter((p) => reservedStock(s, p.id) > 0).length}
          </strong>
        </span>
        <span>
          Sin disponible o con faltante
          <strong>
            {products.filter((p) => availableStock(s, p) <= 0).length}
          </strong>
        </span>
        <span>
          Alertas de reposición
          <strong>
            {products.filter((p) => stockStatus(s, p) !== "ok").length}
          </strong>
        </span>
      </div>
      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar producto, código, ubicación o compatibilidad…"
        />
        <select
          aria-label="Filtrar inventario"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setView("products");
          }}
        >
          <option value="all">Todos los productos</option>
          <option value="alerts">Con alertas</option>
          <option value="reserved">Con reservas</option>
          <option value="low">Bajo mínimo</option>
          <option value="empty">Sin disponible</option>
          <option value="shortage">Reservas con faltante</option>
        </select>
        {manager && (
          <button
            className="button secondary"
            onClick={() =>
              setView(view === "movements" ? "products" : "movements")
            }
          >
            {view === "movements" ? "Ver productos" : "Movimientos"}
          </button>
        )}
      </div>
      <p className="inventory-explanation">
        Físico: existencias registradas. Reservado: insumos autorizados para
        órdenes abiertas. Disponible: físico menos reservado. Los consumos
        reales se descuentan al finalizar.
      </p>
      <Section
        title={
          view === "movements" ? "Movimientos de inventario" : "Inventario"
        }
        action={
          <button
            className="button secondary small"
            onClick={() =>
              view === "movements"
                ? exportCsv(
                    "lubriworks-movimientos.csv",
                    moves.map((m) => ({
                      Fecha: m.date,
                      Producto: s.products.find((p) => p.id === m.productId)
                        ?.name,
                      Sucursal: branchName(m.branchId),
                      Cantidad: m.quantity,
                      Motivo: m.reason,
                      Responsable: m.actorName ?? "Registro anterior",
                      Orden: m.orderId ?? "",
                    })),
                  )
                : exportCsv(
                    "lubriworks-stock.csv",
                    rows.map((p) => ({
                      Producto: p.name,
                      SKU: p.sku,
                      Sucursal: branchName(p.branchId),
                      Unidad: p.unit,
                      Ubicacion: p.location ?? "",
                      Compatibilidad: p.compatibility ?? "",
                      Fisico: p.stock,
                      Reservado: reservedStock(s, p.id),
                      Disponible: availableStock(s, p),
                      Minimo: p.minStock,
                      Estado: statusLabels[stockStatus(s, p)],
                    })),
                  )
            }
          >
            Exportar
          </button>
        }
      >
        {view === "movements" ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto / sucursal</th>
                  <th>Cantidad</th>
                  <th>Motivo / responsable</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{fmtDate(m.date)}</td>
                    <td>
                      {s.products.find((p) => p.id === m.productId)?.name}
                      <small>{branchName(m.branchId)}</small>
                    </td>
                    <td>
                      {m.quantity > 0 ? "+" : ""}
                      {number(m.quantity)}
                    </td>
                    <td>
                      {m.reason}
                      <small>
                        {m.actorName ?? "Registro anterior sin responsable"}
                      </small>
                    </td>
                    <td>
                      {m.orderId && (
                        <button
                          className="text-button"
                          onClick={() => onOrder(m.orderId!)}
                        >
                          Ver orden
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Sucursal / ubicación</th>
                  <th>Físico</th>
                  <th>Reservado</th>
                  <th>Disponible</th>
                  <th>Mínimo</th>
                  <th>Precio</th>
                  {manager && <th>Costo</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>{p.sku}</small>
                    </td>
                    <td>
                      {branchName(p.branchId)}
                      <small>{p.location || "Sin ubicación"}</small>
                    </td>
                    <td>
                      {number(p.stock)} {unit(p)}
                    </td>
                    <td>
                      {number(reservedStock(s, p.id))} {unit(p)}
                    </td>
                    <td>
                      <Badge
                        value={stockStatus(s, p) === "ok" ? "ok" : "warning"}
                      >
                        {number(availableStock(s, p))} {unit(p)}
                      </Badge>
                      <small>{statusLabels[stockStatus(s, p)]}</small>
                    </td>
                    <td>{number(p.minStock)}</td>
                    <td>{money(p.price)}</td>
                    {manager && <td>{money(p.cost)}</td>}
                    <td>
                      <div className="row-actions">
                        <button
                          className="text-button"
                          onClick={() => {
                            setFocused(p.id);
                            setView("products");
                          }}
                        >
                          Detalle / reservas
                        </button>
                        {manager && (
                          <>
                            <button
                              className="text-button"
                              onClick={() => onEdit(p)}
                            >
                              Editar
                            </button>
                            <button
                              className="text-button"
                              onClick={() => onAdjust(p)}
                            >
                              Ajustar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!(view === "movements" ? moves : rows).length && (
          <p className="inventory-explanation">
            No hay registros para esta selección.
          </p>
        )}
      </Section>
      {product && (
        <Section
          title={`Detalle de inventario · ${product.name}`}
          subtitle={`${product.sku} · ${branchName(product.branchId)}`}
          action={
            <button className="text-button" onClick={() => setFocused("")}>
              Cerrar detalle
            </button>
          }
        >
          <div className="inventory-detail">
            <div className="inventory-summary">
              <span>
                Físico
                <strong>
                  {number(product.stock)} {unit(product)}
                </strong>
              </span>
              <span>
                Reservado
                <strong>
                  {number(reservedStock(s, product.id))} {unit(product)}
                </strong>
              </span>
              <span>
                Disponible
                <strong>
                  {number(availableStock(s, product))} {unit(product)}
                </strong>
              </span>
            </div>
            <dl>
              <dt>Ubicación</dt>
              <dd>{product.location || "Sin ubicación registrada"}</dd>
              <dt>Compatibilidades confirmadas</dt>
              <dd>
                {product.compatibility || "Sin compatibilidades registradas"}
              </dd>
            </dl>
            <p className="muted">
              La compatibilidad se carga manualmente según ficha técnica o
              catálogo del fabricante; no se infiere automáticamente.
            </p>
            {stockStatus(s, product) !== "ok" && (
              <p className="warning-box">
                {availableStock(s, product) < 0
                  ? `Faltan ${number(-availableStock(s, product))} ${unit(product)} para cubrir las reservas actuales.`
                  : availableStock(s, product) === 0
                    ? "Todo el stock está reservado o no hay existencias."
                    : "El disponible está en el mínimo de reposición o por debajo."}{" "}
                {manager && (
                  <button className="text-button" onClick={onPurchase}>
                    Ir a compras
                  </button>
                )}
              </p>
            )}
            <h3>Órdenes que reservan este producto</h3>
            {holds.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente / vehículo</th>
                      <th>Orden</th>
                      <th>Reservado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {holds.map((r) => (
                      <tr key={r.orderId}>
                        <td>
                          {s.customers.find((c) => c.id === r.customerId)
                            ?.name ?? "Cliente"}
                          <small>
                            {s.vehicles.find((v) => v.id === r.vehicleId)
                              ?.plate ?? "Vehículo"}
                          </small>
                        </td>
                        <td>
                          {r.orderId}
                          {r.legacy && <small>Trabajo anterior en curso</small>}
                        </td>
                        <td>
                          {number(r.quantity)} {unit(product)}
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => onOrder(r.orderId)}
                          >
                            Ver orden
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Este producto no tiene reservas.</p>
            )}
            <p className="muted">
              Las reservas conservan las cantidades autorizadas hasta finalizar,
              aunque se confirme un consumo menor. Al cancelar o finalizar se
              liberan automáticamente. Los trabajos anteriores que ya estaban en
              atención también protegen sus insumos.
            </p>
          </div>
        </Section>
      )}
    </>
  );
}
