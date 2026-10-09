import { createPortal } from "react-dom";
import {
  approvedItems,
  approvedLabor,
  quoteTotal,
  type Order,
} from "../../shared/orders";
import { fmtDate, money, number, labels } from "./ui";
export function OrderQuote({
  order,
  company,
  client,
  plate,
  onClose,
}: {
  order: Order;
  company: string;
  client: string;
  plate: string;
  onClose: () => void;
}) {
  return createPortal(
    <div className="modal-backdrop">
      <section
        className="modal receipt"
        role="dialog"
        aria-modal="true"
        aria-label="Presupuesto de servicio"
      >
        <div className="receipt-actions">
          <button className="button primary" onClick={() => window.print()}>
            Imprimir / guardar PDF
          </button>
          <button className="button" onClick={onClose}>
            Cerrar presupuesto
          </button>
        </div>
        <div className="receipt-body">
          <img src="/brand/logo.png" alt="LubriWorks" />
          <h1>{company}</h1>
          <p>Presupuesto de servicio · No válido como factura fiscal</p>
          <dl>
            <dt>Orden</dt>
            <dd>{order.id}</dd>
            <dt>Revisión</dt>
            <dd>{order.quoteRevision ?? 1}</dd>
            <dt>Cliente</dt>
            <dd>{client}</dd>
            <dt>Vehículo</dt>
            <dd>
              {plate} · {number(order.odometer)} km
            </dd>
            <dt>Ingreso</dt>
            <dd>{fmtDate(order.date)}</dd>
            <dt>Autorización</dt>
            <dd>{labels[order.approval ?? "legacy"]}</dd>
          </dl>
          <p>
            {order.serviceSnapshots?.map((s) => s.name).join(" + ") ||
              order.serviceName}
          </p>
          <table>
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Cantidad</th>
                <th>Precio unitario</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {approvedItems(order).map((i, n) => (
                <tr key={n}>
                  <td>{i.name}</td>
                  <td>{number(i.quantity)}</td>
                  <td>{money(i.price)}</td>
                  <td>{money(i.price * i.quantity)}</td>
                </tr>
              ))}
              <tr>
                <td>Mano de obra y adicionales autorizados</td>
                <td>1</td>
                <td>{money(approvedLabor(order))}</td>
                <td>{money(approvedLabor(order))}</td>
              </tr>
            </tbody>
          </table>
          <div className="receipt-total">
            <span>Total presupuestado</span>
            <strong>{money(quoteTotal(order))}</strong>
          </div>
          {order.additions
            ?.filter((a) => a.status === "pending")
            .map((a) => (
              <p key={a.id}>
                Propuesta pendiente (no incluida en el total): {a.title} ·{" "}
                {money(
                  a.labor +
                    a.items.reduce((n, i) => n + i.price * i.quantity, 0),
                )}
              </p>
            ))}
          <p>
            El importe final puede ser menor si se utilizan menos insumos. Los
            trabajos o cantidades que excedan este presupuesto requieren una
            nueva autorización.
          </p>
        </div>
      </section>
    </div>,
    document.body,
  );
}
