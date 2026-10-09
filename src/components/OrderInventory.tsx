import type { State } from "../../shared/model";
import { approvedItems, type Order } from "../../shared/orders";
import { availableStock, reservationItems } from "../../shared/inventory";
import { round } from "../../shared/model";
import { number } from "./ui";
export function OrderInventory({
  s,
  o,
  onInventory,
}: {
  s: State;
  o: Order;
  onInventory: () => void;
}) {
  if (
    !["received", "working"].includes(o.status) ||
    o.workStatus === "cancelled"
  )
    return null;
  const quantities = new Map<string, number>();
  for (const i of approvedItems(o))
    quantities.set(
      i.productId,
      round((quantities.get(i.productId) ?? 0) + i.quantity),
    );
  if (!quantities.size) return null;
  const own = reservationItems(o);
  return (
    <section
      className="inventory-reservations"
      aria-label="Disponibilidad de insumos de la orden"
    >
      <div className="row-actions">
        <strong>Insumos y reservas</strong>
        <button className="text-button" onClick={onInventory}>
          Ver inventario
        </button>
      </div>
      <ul>
        {[...quantities].map(([pid, quantity]) => {
          const p = s.products.find((p) => p.id === pid),
            held = round(
              own
                .filter((i) => i.productId === pid)
                .reduce((n, i) => n + i.quantity, 0),
            ),
            available = p ? availableStock(s, p, o.id) : 0,
            shortage = round(Math.max(0, quantity - available));
          return (
            <li key={pid}>
              {p?.name ?? "Producto"}: {number(quantity)}{" "}
              {p?.unit === "litro" ? "L" : "u."} previstos · {number(held)}{" "}
              reservados para esta orden
              {shortage > 0 && (
                <strong className="inventory-shortage">
                  {" "}
                  · Faltan {number(shortage)}
                </strong>
              )}
            </li>
          );
        })}
      </ul>
      <p>
        La autorización reserva insumos si hay disponible. Las cantidades
        autorizadas se conservan hasta cancelar o finalizar; al finalizar sólo
        se descuenta el consumo real. Los adicionales pendientes no reservan
        stock.
      </p>
    </section>
  );
}
