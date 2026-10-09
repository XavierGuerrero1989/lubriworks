import { Printer, X } from "lucide-react";
import { salePaid, saleBalance, paymentValue } from "../../shared/billing";
import type { State, Sale } from "../../shared/model";
import { fmtDate, money, number, labels } from "./ui";
export function Receipt({
  sale,
  state,
  vehicle,
  company,
  client,
  onClose,
}: {
  sale: Sale;
  state: State;
  vehicle: string;
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
            {vehicle && (
              <>
                <dt>Vehículo</dt>
                <dd>{vehicle}</dd>
              </>
            )}
            <dt>Medio de pago</dt>
            <dd>{labels[sale.method]}</dd>
          </dl>
          <div className="table-scroll">
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
          </div>
          <div className="receipt-total">
            <span>Total de la venta</span>
            <strong>{money(sale.total)}</strong>
          </div>
          {!!sale.discount && (
            <p>
              Subtotal {money(sale.subtotal ?? sale.total)} · Descuento{" "}
              {money(sale.discount)}
            </p>
          )}
          <div className="receipt-total">
            <span>Total cobrado</span>
            <strong>{money(salePaid(state, sale))}</strong>
          </div>
          <div className="receipt-total">
            <span>Saldo pendiente</span>
            <strong>{money(saleBalance(state, sale))}</strong>
          </div>
          {sale.billingVersion && (
            <>
              <h3>Cobros y reversiones</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Medio</th>
                      <th>Movimiento</th>
                      <th>Importe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.payments
                      .filter((p) => p.saleId === sale.id)
                      .map((p) => (
                        <tr key={p.id}>
                          <td>{fmtDate(p.date)}</td>
                          <td>{labels[p.method]}</td>
                          <td>{p.kind === "refund" ? "Reversión" : "Cobro"}</td>
                          <td>{money(paymentValue(p))}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p>Gracias por confiar el cuidado de tu vehículo a {company}.</p>
        </div>
      </section>
    </div>
  );
}
