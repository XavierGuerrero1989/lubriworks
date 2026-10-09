import { availableStock } from "../../shared/inventory";
import { useState } from "react";
import { X, Plus } from "lucide-react";
import { round, type State, type Sale } from "../../shared/model";
import { orderTotal } from "../../shared/orders";
import { saleBalance, paymentMethods } from "../../shared/billing";
import type { Command } from "../../shared/engine";
import { money, labels } from "./ui";
import "./billing.css";
export type Checkout =
  { orderId: string } | { saleId: string } | { branchId: string };
export function BillingDialog({
  target,
  s,
  manager,
  execute,
  onClose,
}: {
  target: Checkout;
  s: State;
  manager: boolean;
  execute: (c: Command) => Promise<void>;
  onClose: () => void;
}) {
  const order =
    "orderId" in target
      ? s.orders.find((o) => o.id === target.orderId)
      : undefined;
  const existing: Sale | undefined =
    "saleId" in target
      ? s.sales.find((v) => v.id === target.saleId)
      : order
        ? s.sales.find((v) => v.orderId === order.id)
        : undefined;
  const direct = "branchId" in target;
  const [branchId, setBranch] = useState(
      direct ? target.branchId : (existing?.branchId ?? order?.branchId ?? ""),
    ),
    [customerId, setCustomer] = useState(""),
    [vehicleId, setVehicle] = useState(""),
    [lines, setLines] = useState<{ productId: string; quantity: number }[]>([
      { productId: "", quantity: 1 },
    ]),
    [discount, setDiscount] = useState(0),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const subtotal = direct
    ? round(
        lines.reduce(
          (n, i) =>
            n +
            i.quantity *
              (s.products.find((p) => p.id === i.productId)?.price ?? 0),
          0,
        ),
      )
    : (existing?.subtotal ?? (order ? orderTotal(order) : 0));
  const balance = existing
    ? saleBalance(s, existing)
    : round(subtotal - discount);
  const [amounts, setAmounts] = useState<Record<string, string>>({
    cash: direct
      ? ""
      : String(
          existing ? saleBalance(s, existing) : order ? orderTotal(order) : 0,
        ),
    transfer: "",
    card: "",
  });
  const paid = round(
      paymentMethods.reduce((n, m) => n + Number(amounts[m] || 0), 0),
    ),
    remaining = round(balance - paid);
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal billing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-title"
      >
        <header>
          <div>
            <h2 id="billing-title">
              {direct
                ? "Venta de mostrador"
                : existing
                  ? "Cobrar saldo"
                  : "Cobrar servicio"}
            </h2>
            <p>
              Registrá los importes recibidos. El saldo permanece en la misma
              venta.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Cerrar cobro"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setBusy(true);
            try {
              const payments = paymentMethods
                .filter((m) => Number(amounts[m] || 0) > 0)
                .map((method) => ({
                  method,
                  amount: Number(amounts[method]),
                  reference,
                }));
              const c: Command = direct
                ? {
                    action: "sale",
                    branchId,
                    customerId: customerId || null,
                    vehicleId: vehicleId || null,
                    items: lines,
                  }
                : {
                    action: existing ? "sale.pay" : "chargeOrder",
                    id: existing?.id ?? order?.id,
                  };
              await execute({
                ...c,
                payments,
                ...(!existing ? { discount, discountReason: reason } : {}),
              });
              onClose();
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "No se pudo registrar el cobro.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy} className="billing-fields">
            {direct && (
              <>
                <div className="billing-two">
                  <label>
                    Sucursal
                    <select
                      value={branchId}
                      onChange={(e) => {
                        setBranch(e.target.value);
                        setLines([{ productId: "", quantity: 1 }]);
                        setAmounts({ cash: "", transfer: "", card: "" });
                      }}
                      required
                    >
                      {s.branches.map((b) => (
                        <option value={b.id} key={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Cliente
                    <select
                      value={customerId}
                      onChange={(e) => {
                        setCustomer(e.target.value);
                        setVehicle("");
                      }}
                    >
                      <option value="">
                        Consumidor sin ficha (pago completo)
                      </option>
                      {s.customers.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  Vehículo
                  <select
                    value={vehicleId}
                    onChange={(e) => setVehicle(e.target.value)}
                    disabled={!customerId}
                  >
                    <option value="">Sin vehículo asociado</option>
                    {s.vehicles
                      .filter((v) => v.customerId === customerId)
                      .map((v) => (
                        <option value={v.id} key={v.id}>
                          {v.plate} · {v.brand} {v.model}
                        </option>
                      ))}
                  </select>
                </label>
                <h3>Productos</h3>
                {lines.map((i, index) => (
                  <div className="billing-product" key={index}>
                    <label>
                      Producto {index + 1}
                      <select
                        required
                        value={i.productId}
                        onChange={(e) =>
                          setLines(
                            lines.map((x, j) =>
                              j === index
                                ? { ...x, productId: e.target.value }
                                : x,
                            ),
                          )
                        }
                      >
                        <option value="">Seleccionar…</option>
                        {s.products
                          .filter((p) => p.branchId === branchId)
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.name} · {money(p.price)} · Disponible{" "}
                              {availableStock(s, p)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Cantidad {index + 1}
                      <input
                        type="number"
                        min={
                          s.products.find((p) => p.id === i.productId)?.unit ===
                          "unidad"
                            ? 1
                            : 0.01
                        }
                        max="1000"
                        step={
                          s.products.find((p) => p.id === i.productId)?.unit ===
                          "unidad"
                            ? "1"
                            : "0.01"
                        }
                        required
                        value={i.quantity}
                        onChange={(e) =>
                          setLines(
                            lines.map((x, j) =>
                              j === index
                                ? { ...x, quantity: Number(e.target.value) }
                                : x,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Quitar producto ${index + 1}`}
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines(lines.filter((_, j) => j !== index))
                      }
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="button secondary small"
                  disabled={lines.length >= 30}
                  onClick={() =>
                    setLines([...lines, { productId: "", quantity: 1 }])
                  }
                >
                  <Plus size={16} />
                  Producto
                </button>
              </>
            )}
            {!existing && manager && (
              <div className="billing-two">
                <label>
                  Descuento autorizado ($)
                  <input
                    type="number"
                    min="0"
                    max={subtotal}
                    step="0.01"
                    value={discount}
                    onChange={(e) => {
                      setDiscount(Number(e.target.value));
                      setAmounts({ cash: "", transfer: "", card: "" });
                    }}
                  />
                </label>
                <label>
                  Motivo del descuento
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required={discount > 0}
                    minLength={discount > 0 ? 5 : undefined}
                    maxLength={500}
                  />
                </label>
              </div>
            )}
            <div className="billing-summary">
              <span>
                {existing ? "Saldo antes de este cobro" : "Total a cobrar"}
                <strong>{money(balance)}</strong>
              </span>
              <span>
                Este cobro<strong>{money(paid)}</strong>
              </span>
              <span>
                Saldo después<strong>{money(remaining)}</strong>
              </span>
            </div>
            <h3>Importes recibidos</h3>
            <p>
              Podés combinar medios o cobrar una parte. Para efectivo, ingresá
              lo retenido después del vuelto.
            </p>
            <div className="billing-amounts">
              {paymentMethods.map((m) => (
                <label key={m}>
                  {labels[m]}
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, balance)}
                    step="0.01"
                    value={amounts[m]}
                    onChange={(e) =>
                      setAmounts({ ...amounts, [m]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="row-actions">
              {paymentMethods.map((m) => (
                <button
                  className="text-button"
                  type="button"
                  key={m}
                  onClick={() =>
                    setAmounts({
                      ...amounts,
                      [m]: String(
                        round(
                          Math.max(
                            0,
                            balance -
                              paymentMethods
                                .filter((x) => x !== m)
                                .reduce(
                                  (n, x) => n + Number(amounts[x] || 0),
                                  0,
                                ),
                          ),
                        ),
                      ),
                    })
                  }
                >
                  Completar en {labels[m].toLowerCase()}
                </button>
              ))}
            </div>
            <label>
              Referencia / comprobante del pago
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={200}
                placeholder="Opcional: número de transferencia o cupón"
              />
            </label>
            {remaining > 0 && (
              <p className="warning-box">
                Quedará un saldo pendiente de {money(remaining)}.
                {direct && !customerId
                  ? " Seleccioná un cliente para registrarlo."
                  : direct || (existing && !existing.orderId)
                    ? " Podés cobrarlo más adelante desde la ficha de venta."
                    : " La entrega del vehículo requiere cancelar el saldo."}
              </p>
            )}
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={
                  remaining < 0 ||
                  balance < 0 ||
                  (paid === 0 && !direct && balance > 0) ||
                  (direct && !customerId && remaining > 0)
                }
              >
                {busy
                  ? "Registrando…"
                  : paid > 0
                    ? "Registrar cobro"
                    : "Registrar venta"}
              </button>
            </footer>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
