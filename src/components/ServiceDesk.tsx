import { useState } from "react";
import { type State } from "../../shared/model";
import {
  serviceLabel,
  serviceBranch,
  type Service,
} from "../../shared/services";
import {
  SearchBox,
  money,
  number,
  exportCsv,
  FormDialog,
  type Dialog,
} from "./ui";
export function ServiceDesk({
  s,
  branch,
  manager,
  onEdit,
  onDuplicate,
  onToggle,
}: {
  s: State;
  branch: string;
  manager: boolean;
  onEdit: (v?: Service) => void;
  onDuplicate: (v: Service) => void;
  onToggle: (v: Service) => Promise<void>;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("active"),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const norm = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const rows = s.services.filter(
    (v) =>
      (branch === "all" ||
        !serviceBranch(s, v) ||
        serviceBranch(s, v) === branch) &&
      (status === "all" ||
        (status === "active" ? v.active !== false : v.active === false)) &&
      norm(
        `${serviceLabel(v)} ${v.category ?? ""} ${v.description ?? ""}`,
      ).includes(norm(search)),
  );
  const branchName = (v: Service) =>
    s.branches.find((b) => b.id === serviceBranch(s, v))?.name ||
    "Todas las sucursales";
  const total = (v: Service) =>
    v.labor +
    v.items.reduce(
      (n, i) =>
        n +
        i.quantity * (s.products.find((p) => p.id === i.productId)?.price ?? 0),
      0,
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Servicios y precios</h1>
          <p>Variantes, insumos, duración e intervalos por sucursal.</p>
        </div>
        {manager && (
          <button className="button primary" onClick={() => onEdit()}>
            Nuevo servicio
          </button>
        )}
      </div>
      <div className="toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Buscar servicio, variante o categoría…"
        />
        <select
          aria-label="Estado de servicios"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="active">Disponibles</option>
          <option value="inactive">Inactivos</option>
          <option value="all">Todos</option>
        </select>
        <button
          className="button secondary"
          onClick={() =>
            exportCsv(
              "servicios",
              rows.map((v) => ({
                Servicio: v.name,
                Variante: v.variant ?? "",
                Categoria: v.category ?? "",
                Sucursal: branchName(v),
                Activo: v.active !== false,
                ManoDeObra: v.labor,
                TotalActual: total(v),
                DuracionMinutos: v.durationMinutes ?? "",
                IntervaloKm: v.intervalKm,
                IntervaloMeses: v.intervalMonths,
              })),
            )
          }
        >
          Exportar
        </button>
      </div>
      <p className="muted">
        El precio actual suma mano de obra e insumos del catálogo. Cada
        presupuesto conserva los precios e intervalos que se cotizaron. El
        próximo mantenimiento vence por kilómetros o tiempo, lo que ocurra
        primero.
      </p>
      <div className="service-grid">
        {rows.map((v) => (
          <article className="panel service-card" key={v.id}>
            <small>
              {v.category || "Sin categoría"} · {branchName(v)}
              {v.active === false ? " · Inactivo" : ""}
            </small>
            <h2>{serviceLabel(v)}</h2>
            <p>{v.description || "Sin descripción de alcance."}</p>
            <ul>
              {v.items.map((i) => (
                <li key={i.productId}>
                  {s.products.find((p) => p.id === i.productId)?.name ??
                    "Producto no disponible"}
                  <strong>
                    × {number(i.quantity)}{" "}
                    {s.products.find((p) => p.id === i.productId)?.unit ===
                    "litro"
                      ? "L"
                      : "u."}
                  </strong>
                </li>
              ))}
            </ul>
            {!v.items.length && <p>Servicio de mano de obra sin insumos.</p>}
            <div className="service-total">
              <small>Total actual</small>
              <strong>{money(total(v))}</strong>
            </div>
            <p>Mano de obra: {money(v.labor)}</p>
            {manager && (
              <p>
                Costo actual de insumos:{" "}
                {money(
                  v.items.reduce(
                    (n, i) =>
                      n +
                      i.quantity *
                        (s.products.find((p) => p.id === i.productId)?.cost ??
                          0),
                    0,
                  ),
                )}
              </p>
            )}
            <p>
              Duración estimada:{" "}
              {v.durationMinutes ? `${v.durationMinutes} min` : "Sin definir"}
            </p>
            <div className="service-interval">
              {[
                v.intervalKm ? `${number(v.intervalKm)} km` : "",
                v.intervalMonths ? `${v.intervalMonths} meses` : "",
              ]
                .filter(Boolean)
                .join(" o ") || "Sin recordatorio automático"}
            </div>
            {manager && (
              <div className="row-actions">
                <button className="button secondary" onClick={() => onEdit(v)}>
                  Editar
                </button>
                <button className="text-button" onClick={() => onDuplicate(v)}>
                  Crear variante
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    setDialog({
                      title:
                        v.active === false
                          ? "Activar servicio"
                          : "Desactivar servicio",
                      description:
                        "Las órdenes y recordatorios existentes conservan sus datos. Este cambio afecta la selección para nuevos presupuestos.",
                      fields: [],
                      submitLabel:
                        v.active === false ? "Activar" : "Desactivar",
                      submit: async () => onToggle(v),
                    })
                  }
                >
                  {v.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {!rows.length && <p>No hay servicios para estos filtros.</p>}
      {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}
