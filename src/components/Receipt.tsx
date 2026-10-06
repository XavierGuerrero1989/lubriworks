import { Printer, X } from "lucide-react";
import type { Sale } from "../../shared/model";
import { fmtDate, money, number, labels } from "./ui";
export function Receipt({
  sale,
  company,
  client,
  onClose,
}: {
  sale: Sale;
  company: string;
  client: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal receipt"
        role="dialog"
        aria-modal="true"
        aria-label="Comprobante de operación"
      >
        <div className="receipt-actions">
          <button className="button primary" onClick={() => window.print()}>
            <Printer size={17} />
            Imprimir / guardar PDF
          </button>
          <button
            className="icon-button"
            aria-label="Cerrar comprobante"
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        <div className="receipt-body">
          <img src="/brand/logo.png" alt="LubriWorks" />
          <h1>{company}</h1>
          <p>Comprobante de operación · No válido como factura fiscal</p>
          <dl>
            <dt>Número</dt>
            <dd>{sale.id}</dd>
            <dt>Fecha</dt>
            <dd>{fmtDate(sale.date)}</dd>
            <dt>Cliente</dt>
            <dd>{client}</dd>
            <dt>Medio de pago</dt>
            <dd>{labels[sale.method]}</dd>
          </dl>
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
              {sale.items.map((i, index) => (
                <tr key={index}>
                  <td>{i.name}</td>
                  <td>{number(i.quantity)}</td>
                  <td>{money(i.price)}</td>
                  <td>{money(i.quantity * i.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="receipt-total">
            <span>Total abonado</span>
            <strong>{money(sale.total)}</strong>
          </div>
          <p>Gracias por confiar el cuidado de tu vehículo a {company}.</p>
        </div>
      </section>
    </div>
  );
}
