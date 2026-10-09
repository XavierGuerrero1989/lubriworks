import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  canCharge,
  canManage,
  type Access,
  type State,
} from "../../shared/model";
import type { Command } from "../../shared/engine";
import {
  approvedItems,
  approvedLabor,
  hasPendingAddition,
  orderTotal,
  quoteTotal,
  workStage,
  type Order,
} from "../../shared/orders";
import { rpc } from "../lib/api";
import { compressOrderPhoto } from "../lib/orderPhotos";
import { OrderQuote } from "./OrderQuote";
import {
  Badge,
  Empty,
  FormDialog,
  SearchBox,
  Section,
  fmtDate,
  money,
  number,
  type Dialog,
  type Field,
} from "./ui";
import "./orders.css";
const decisions = [
  { value: "approved", label: "Autorizado" },
  { value: "rejected", label: "Rechazado" },
];
const methods = [
  { value: "presencial", label: "Presencial" },
  { value: "telefono", label: "Teléfono" },
  { value: "mensaje", label: "Mensaje" },
];
const phaseLabels = {
  arrival: "Recepción",
  work: "Trabajo",
  delivery: "Entrega",
};
const localTime = (at: string) =>
  new Date(at).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
export function OrderDesk({
  state: s,
  access,
  branch,
  focusId,
  run,
  onNew,
  onCharge,
  onReceipt,
  onRefresh,
  demo,
}: {
  state: State;
  access: Access;
  branch: string;
  focusId: string;
  run: (c: Command) => Promise<void>;
  onNew: () => void;
  onCharge: (id: string) => void;
  onReceipt: (o: Order) => void;
  onRefresh: () => Promise<void>;
  demo: boolean;
}) {
  const manager = canManage(access.member.role),
    charge = canCharge(access.member.role),
    technical = access.member.role !== "cashier";
  const [selected, setSelected] = useState(focusId),
    [query, setQuery] = useState(""),
    [stageFilter, setStageFilter] = useState("all"),
    [paymentFilter, setPaymentFilter] = useState("all"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [printing, setPrinting] = useState(false),
    [photoView, setPhotoView] = useState<{
      url: string;
      caption: string;
    } | null>(null),
    [photoBusy, setPhotoBusy] = useState(false),
    [photoError, setPhotoError] = useState(""),
    [caption, setCaption] = useState(""),
    [phase, setPhase] = useState<"arrival" | "work" | "delivery">("arrival"),
    [demoPhotos, setDemoPhotos] = useState<
      Record<
        string,
        NonNullable<Order["photos"]>[number] & {
          orderId: string;
          base64: string;
        }
      >
    >({});
  const photoPending = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    setSelected(focusId);
  }, [focusId]);
  const client = (id: string) =>
      s.customers.find((c) => c.id === id)?.name || "—",
    vehicle = (id: string) => s.vehicles.find((v) => v.id === id),
    bname = (id: string) => s.branches.find((b) => b.id === id)?.name || "—";
  const normalize = (v: string) =>
    v
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  const rows = s.orders
    .filter(
      (o) =>
        (branch === "all" || o.branchId === branch) &&
        (stageFilter === "all" || workStage(o) === stageFilter) &&
        (paymentFilter === "all" ||
          (paymentFilter === "paid") === (o.status === "paid")) &&
        normalize(
          `${vehicle(o.vehicleId)?.plate} ${client(o.customerId)} ${o.technician} ${o.serviceName}`,
        ).includes(normalize(query)),
    )
    .sort(
      (a, b) =>
        (b.receivedAt || b.date).localeCompare(a.receivedAt || a.date) ||
        b.id.localeCompare(a.id),
    );
  const o = rows.find((r) => r.id === selected) || rows[0],
    stage = o ? workStage(o) : "received",
    open = o && !["cancelled", "delivered"].includes(stage),
    editable = open && ["received", "working", "waiting"].includes(stage);
  const field = (
    key: string,
    label: string,
    type = "text",
    other: Partial<Field> = {},
  ): Field => ({ key, label, type, ...other });
  const products = o
    ? s.products
        .filter((p) => p.branchId === o.branchId)
        .map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }))
    : [];
  const command = (title: string, cmd: Command, description?: string) =>
    setDialog({
      title,
      description,
      fields: [],
      submitLabel: "Confirmar",
      submit: async () => run(cmd),
    });
  const authorize = (additionId?: string) =>
    setDialog({
      title: additionId
        ? "Registrar decisión del adicional"
        : "Registrar autorización del presupuesto",
      description:
        "Dejá constancia de quién autorizó o rechazó y cómo lo confirmó. Esta acción registra la decisión comunicada por el cliente.",
      fields: [
        field("decision", "Decisión", "text", {
          options: decisions,
          value: "approved",
        }),
        field("method", "Medio de autorización", "text", {
          options: methods,
          value: "presencial",
        }),
        field("note", "Constancia de la decisión", "textarea", {
          maxLength: 1000,
        }),
      ],
      submit: async (data) =>
        run({
          action: additionId ? "order.additionDecision" : "order.decision",
          id: o!.id,
          additionId,
          ...data,
        }),
    });
  const editQuote = () =>
    setDialog({
      title: "Revisar presupuesto",
      description:
        "Se crea una nueva revisión pendiente de autorización. Los valores se calculan con el catálogo actual.",
      fields: [
        field("serviceIds", "Servicios incluidos", "choices", {
          options: s.services.map((v) => ({ value: v.id, label: v.name })),
          value: o!.serviceSnapshots?.map((v) => v.serviceId) || [o!.serviceId],
        }),
        field("extraItems", "Insumos adicionales del presupuesto", "lines", {
          options: products,
          value: o!.extraItems ?? [],
          required: false,
        }),
        ...(manager
          ? [
              field("labor", "Mano de obra total", "number", {
                required: false,
                omitWhenEmpty: true,
                hint: "Dejá vacío para sumar la mano de obra de los servicios seleccionados.",
              }),
            ]
          : []),
      ],
      submit: async (data) =>
        run({ action: "order.quote", id: o!.id, ...data }),
    });
  const consumption = () => {
    const sum = new Map<string, number>();
    approvedItems(o!).forEach((i) =>
      sum.set(i.productId, (sum.get(i.productId) ?? 0) + i.quantity),
    );
    setDialog({
      title: "Confirmar consumos reales",
      description:
        "Cargá lo que efectivamente se utilizó. Quitá los productos no utilizados. Para exceder las cantidades autorizadas, primero registrá y autorizá un adicional.",
      fields: [
        field("items", "Insumos utilizados", "lines", {
          options: products.filter((p) => sum.has(p.value)),
          value: o!.consumptionConfirmed
            ? o!.actualItems
            : [...sum].map(([productId, quantity]) => ({
                productId,
                quantity,
              })),
          required: false,
        }),
        field("note", "Observaciones del consumo", "textarea", {
          value: o!.consumptionNote ?? "",
          required: false,
        }),
      ],
      submit: async (data) =>
        run({ action: "order.consumption", id: o!.id, ...data }),
    });
  };
  const update = () =>
    setDialog({
      title: "Ficha de trabajo",
      fields: [
        field("technician", "Técnico responsable", "text", {
          value: o!.technician,
          required: false,
        }),
        field("notes", "Notas internas", "textarea", {
          value: o!.notes,
          required: false,
          maxLength: 1000,
        }),
        field("checklist", "Controles realizados", "textarea", {
          value: o!.checklist.join(", "),
          required: false,
          hint: "Separá los controles por coma.",
        }),
        field("recommendations", "Recomendaciones registradas", "textarea", {
          value: o!.recommendations ?? "",
          required: false,
          maxLength: 1000,
        }),
      ],
      submit: async (data) =>
        run({
          action: "order.update",
          id: o!.id,
          data: {
            ...data,
            checklist: String(data.checklist)
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          },
        }),
    });
  const addition = () =>
    setDialog({
      title: "Proponer trabajo adicional",
      description:
        "Queda pendiente de autorización. El sistema impide finalizar hasta registrar la decisión.",
      fields: [
        field("title", "Trabajo / motivo"),
        ...(manager
          ? [field("labor", "Mano de obra adicional", "number", { value: 0 })]
          : []),
        field("items", "Insumos del adicional", "lines", {
          options: products,
          value: [],
          required: false,
        }),
      ],
      submit: async (data) =>
        run({ action: "order.addition", id: o!.id, labor: 0, ...data }),
    });
  const upload = async (file: File) => {
    const order = o!;
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const base64 = await compressOrderPhoto(file),
        payload = { orderId: order.id, base64, caption, phase },
        requestKey = JSON.stringify(payload);
      const id =
        photoPending.current?.key === requestKey
          ? photoPending.current.id
          : crypto.randomUUID();
      photoPending.current = { key: requestKey, id };
      if (demo)
        setDemoPhotos((v) => ({
          ...v,
          [id]: {
            id,
            orderId: order.id,
            base64,
            caption,
            phase,
            at: new Date().toISOString(),
            by: access.member.uid,
          },
        }));
      else {
        await rpc(
          "order.photo.upload",
          payload,
          access.tenant.id,
          undefined,
          id,
        );
        await onRefresh();
      }
      photoPending.current = null;
      setCaption("");
    } catch (error) {
      setPhotoError((error as Error).message);
    } finally {
      setPhotoBusy(false);
    }
  };
  const viewPhoto = async (id: string, caption: string) => {
    setPhotoError("");
    try {
      const local = demoPhotos[id];
      const url = local
        ? `data:image/jpeg;base64,${local.base64}`
        : (
            await rpc<{ dataUrl: string }>(
              "order.photo.read",
              { orderId: o!.id, photoId: id },
              access.tenant.id,
            )
          ).dataUrl;
      setPhotoView({ url, caption });
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  };
  const photos = o
    ? [
        ...(o.photos ?? []),
        ...Object.values(demoPhotos).filter((p) => p.orderId === o.id),
      ]
    : [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Órdenes de servicio</h1>
          <p>
            Presupuesto, autorizaciones, trabajo, consumos y entrega en una
            misma ficha.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => {
            setSelected("");
            setQuery("");
            setStageFilter("all");
            setPaymentFilter("all");
            onNew();
          }}
        >
          + Nueva orden
        </button>
      </div>
      <div className="toolbar">
        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder="Patente, cliente, servicio o técnico…"
        />
        <select
          aria-label="Estado del trabajo"
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
        >
          <option value="all">Todos los trabajos</option>
          <option value="received">Recibidos</option>
          <option value="waiting">Esperando autorización</option>
          <option value="working">En atención</option>
          <option value="ready">Finalizados</option>
          <option value="delivered">Entregados</option>
          <option value="cancelled">Cancelados</option>
        </select>
        <select
          aria-label="Estado del cobro"
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
        >
          <option value="all">Todos los cobros</option>
          <option value="unpaid">Sin cobrar</option>
          <option value="paid">Cobrados</option>
        </select>
      </div>
      {!rows.length ? (
        <Empty text="No hay órdenes para estos filtros." />
      ) : (
        <>
          <Section title="Seguimiento del taller">
            <div className="order-selector">
              {rows.map((r) => (
                <button
                  className={r.id === o?.id ? "selected" : ""}
                  key={r.id}
                  onClick={() => setSelected(r.id)}
                >
                  <strong>
                    {vehicle(r.vehicleId)?.plate} · {client(r.customerId)}
                  </strong>
                  <span>
                    {r.serviceName} · {fmtDate(r.date)}
                  </span>
                  <div>
                    <Badge value={workStage(r)} />
                    <Badge value={r.status === "paid" ? "paid" : "unpaid"} />
                  </div>
                </button>
              ))}
            </div>
          </Section>
          {o && (
            <div className="order-detail" key={o.id}>
              <div className="order-summary">
                <div>
                  <span className="eyebrow">FICHA DE ATENCIÓN</span>
                  <h2>
                    {vehicle(o.vehicleId)?.plate} · {client(o.customerId)}
                  </h2>
                  <p>
                    {vehicle(o.vehicleId)?.brand} {vehicle(o.vehicleId)?.model}{" "}
                    · {number(o.odometer)} km · {bname(o.branchId)}
                  </p>
                  <small>
                    Orden {o.id} · {o.technician || "Sin técnico asignado"}
                  </small>
                </div>
                <div>
                  <Badge value={stage} />
                  <Badge value={o.status === "paid" ? "paid" : "unpaid"} />
                  <strong>{money(orderTotal(o))}</strong>
                </div>
              </div>
              <div className="order-flow-actions">
                {open &&
                  technical &&
                  o.status === "received" &&
                  o.approval !== "pending" &&
                  o.approval !== "rejected" &&
                  !hasPendingAddition(o) && (
                    <button
                      className="button primary"
                      onClick={() =>
                        command("Comenzar atención", {
                          action: "startOrder",
                          id: o.id,
                        })
                      }
                    >
                      Comenzar atención
                    </button>
                  )}
                {editable &&
                  technical &&
                  o.approval !== "pending" &&
                  o.approval !== "rejected" &&
                  !hasPendingAddition(o) && (
                    <button className="button" onClick={consumption}>
                      Confirmar consumos reales
                    </button>
                  )}
                {editable &&
                  technical &&
                  o.status === "working" &&
                  (o.consumptionConfirmed || !o.workStatus) &&
                  !hasPendingAddition(o) && (
                    <button
                      className="button primary"
                      onClick={() =>
                        command(
                          "Finalizar servicio",
                          { action: "finishOrder", id: o.id },
                          "Se descontarán los consumos reales confirmados y se generarán los próximos mantenimientos.",
                        )
                      }
                    >
                      Finalizar servicio
                    </button>
                  )}
                {open && o.status === "ready" && charge && (
                  <button
                    className="button primary"
                    onClick={() => onCharge(o.id)}
                  >
                    Cobrar servicio
                  </button>
                )}
                {open && o.status === "paid" && charge && (
                  <button
                    className="button primary"
                    onClick={() =>
                      command(
                        "Entregar vehículo",
                        { action: "deliverOrder", id: o.id },
                        "Se registrará la entrega y se completará el turno vinculado.",
                      )
                    }
                  >
                    Entregar vehículo
                  </button>
                )}
                {s.sales.some((v) => v.orderId === o.id) && (
                  <button className="button" onClick={() => onReceipt(o)}>
                    Comprobante
                  </button>
                )}
                {open && !o.startedAt && o.status === "received" && charge && (
                  <button
                    className="text-button"
                    onClick={() =>
                      setDialog({
                        title: "Cancelar orden sin iniciar",
                        fields: [
                          field("reason", "Motivo de cancelación", "textarea"),
                        ],
                        submit: async (data) =>
                          run({ action: "order.cancel", id: o.id, ...data }),
                      })
                    }
                  >
                    Cancelar orden
                  </button>
                )}
              </div>
              <div className="order-detail-grid">
                <Section
                  title="Presupuesto y autorización"
                  subtitle={`Revisión ${o.quoteRevision ?? 1}`}
                  action={
                    <button
                      className="text-button"
                      onClick={() => setPrinting(true)}
                    >
                      Ver / imprimir presupuesto
                    </button>
                  }
                >
                  <div className="order-panel-content">
                    <Badge value={o.approval ?? "legacy"} />
                    <ul className="order-services">
                      {(
                        o.serviceSnapshots ?? [
                          { serviceId: o.serviceId, name: o.serviceName },
                        ]
                      ).map((v) => (
                        <li key={v.serviceId}>{v.name}</li>
                      ))}
                    </ul>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Insumo</th>
                            <th>Cantidad</th>
                            <th>Precio</th>
                            <th>Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {o.items.map((i, n) => (
                            <tr key={n}>
                              <td>{i.name}</td>
                              <td>{number(i.quantity)}</td>
                              <td>{money(i.price)}</td>
                              <td>{money(i.price * i.quantity)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p>
                      Mano de obra base: <strong>{money(o.labor)}</strong>
                    </p>
                    <p>
                      Total propuesto, con adicionales autorizados:{" "}
                      <strong>{money(quoteTotal(o))}</strong>
                    </p>
                    <div className="row-actions">
                      {open &&
                        !o.startedAt &&
                        o.status === "received" &&
                        o.approval !== "approved" && (
                          <button className="button" onClick={editQuote}>
                            Revisar presupuesto
                          </button>
                        )}
                      {open &&
                        !o.startedAt &&
                        o.status === "received" &&
                        o.approval !== "approved" &&
                        charge && (
                          <button
                            className="button primary"
                            onClick={() => authorize()}
                          >
                            Registrar autorización
                          </button>
                        )}
                    </div>
                    {o.approvalHistory?.map((a, n) => (
                      <p className="order-history-note" key={n}>
                        {localTime(a.at)} · Revisión {a.revision} ·{" "}
                        {a.decision === "approved" ? "Autorizado" : "Rechazado"}{" "}
                        · {a.method} · {money(a.total)}
                        <br />
                        {a.note}
                      </p>
                    ))}
                  </div>
                </Section>
                <Section
                  title="Trabajos adicionales"
                  subtitle="Cada propuesta conserva sus insumos, precio y decisión."
                  action={
                    editable &&
                    (o.approval === undefined || o.approval === "approved") ? (
                      <button className="text-button" onClick={addition}>
                        + Proponer adicional
                      </button>
                    ) : undefined
                  }
                >
                  <div className="order-panel-content">
                    {!o.additions?.length && (
                      <p>Sin adicionales registrados.</p>
                    )}
                    {o.additions?.map((a) => (
                      <article className="order-addition" key={a.id}>
                        <strong>{a.title}</strong>
                        <Badge value={a.status} />
                        <p>
                          {a.items
                            .map((i) => `${i.name} × ${number(i.quantity)}`)
                            .join(" · ") || "Sin insumos"}
                        </p>
                        <p>
                          Mano de obra: {money(a.labor)} · Total:{" "}
                          <strong>
                            {money(
                              a.labor +
                                a.items.reduce(
                                  (n, i) => n + i.price * i.quantity,
                                  0,
                                ),
                            )}
                          </strong>
                        </p>
                        {a.note && (
                          <small>
                            {a.method} · {a.note}
                          </small>
                        )}
                        {editable && a.status === "pending" && charge && (
                          <button
                            className="button small"
                            onClick={() => authorize(a.id)}
                          >
                            Registrar decisión
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </Section>
                <Section
                  title="Trabajo y consumos reales"
                  action={
                    editable ? (
                      <button className="text-button" onClick={update}>
                        Editar ficha
                      </button>
                    ) : undefined
                  }
                >
                  <div className="order-panel-content">
                    <p>
                      <strong>
                        {o.consumptionConfirmed
                          ? "Consumos confirmados"
                          : "Consumos pendientes de confirmar"}
                      </strong>
                    </p>
                    <ul>
                      {(o.consumptionConfirmed
                        ? (o.actualItems ?? [])
                        : approvedItems(o)
                      ).map((i, n) => (
                        <li key={n}>
                          {i.name} · {number(i.quantity)}{" "}
                          {s.products.find((p) => p.id === i.productId)?.unit ||
                            ""}
                        </li>
                      ))}
                    </ul>
                    {o.consumptionConfirmed && !o.actualItems?.length && (
                      <p>No se utilizaron insumos.</p>
                    )}
                    <p>
                      Mano de obra{" "}
                      {o.approval === "pending" || o.approval === "rejected"
                        ? "presupuestada"
                        : "autorizada"}
                      : {money(approvedLabor(o))}
                    </p>
                    <p>
                      Importe con consumos{" "}
                      {o.consumptionConfirmed ? "reales" : "previstos"}:{" "}
                      <strong>{money(orderTotal(o))}</strong>
                    </p>
                    {o.consumptionNote && <p>{o.consumptionNote}</p>}
                    <p>
                      Controles:{" "}
                      {o.checklist.join(" · ") || "Sin controles registrados"}
                    </p>
                    <p>Notas internas: {o.notes || "Sin notas"}</p>
                    <p>
                      Recomendaciones:{" "}
                      {o.recommendations || "Sin recomendaciones registradas"}
                    </p>
                  </div>
                </Section>
                <Section
                  title="Fotos del vehículo"
                  subtitle="Registro interno de recepción, trabajo y entrega."
                >
                  <div className="order-panel-content">
                    <div className="order-photo-list">
                      {photos.map((p) => (
                        <button
                          className="button"
                          key={p.id}
                          onClick={() => viewPhoto(p.id, p.caption)}
                        >
                          {phaseLabels[p.phase]} · {p.caption || "Ver foto"}
                          <small>{localTime(p.at)}</small>
                        </button>
                      ))}
                    </div>
                    {!photos.length && <p>Sin fotos adjuntas.</p>}
                    {open && (
                      <div className="order-photo-form">
                        <label>
                          Etapa
                          <select
                            value={phase}
                            onChange={(e) =>
                              setPhase(e.target.value as typeof phase)
                            }
                          >
                            <option value="arrival">Recepción</option>
                            <option value="work">Trabajo</option>
                            <option value="delivery">Entrega</option>
                          </select>
                        </label>
                        <label>
                          Descripción
                          <input
                            value={caption}
                            maxLength={300}
                            onChange={(e) => setCaption(e.target.value)}
                          />
                        </label>
                        <label>
                          Adjuntar foto
                          <input
                            type="file"
                            accept="image/*"
                            disabled={photoBusy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void upload(file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <small>
                          {photoBusy
                            ? "Preparando y guardando foto…"
                            : "Las fotos se optimizan automáticamente antes de guardarse."}
                        </small>
                      </div>
                    )}
                    {photoError && (
                      <p className="error" role="alert">
                        {photoError}
                      </p>
                    )}
                  </div>
                </Section>
              </div>
              <Section title="Historial de la orden">
                <div className="order-panel-content">
                  {o.cancelReason && <p>Cancelación: {o.cancelReason}</p>}
                  {o.events?.length ? (
                    <ol className="order-event-list">
                      {o.events.map((event) => (
                        <li key={event.id}>
                          <strong>{event.title}</strong>
                          <small>
                            {localTime(event.at)} ·{" "}
                            {event.actorName ||
                              (event.by === access.member.uid
                                ? access.member.name
                                : "Equipo del lubricentro")}
                          </small>
                          {event.note && <p>{event.note}</p>}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>
                      Esta orden es anterior al registro de eventos. Se conserva
                      su información original.
                    </p>
                  )}
                </div>
              </Section>
            </div>
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
      {printing && o && (
        <OrderQuote
          order={o}
          company={access.tenant.name}
          client={client(o.customerId)}
          plate={vehicle(o.vehicleId)?.plate || "—"}
          onClose={() => setPrinting(false)}
        />
      )}
      {photoView &&
        createPortal(
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-label="Foto del vehículo"
            >
              <header>
                <h2>{photoView.caption || "Foto del vehículo"}</h2>
                <button className="button" onClick={() => setPhotoView(null)}>
                  Cerrar foto
                </button>
              </header>
              <img
                className="order-photo-full"
                src={photoView.url}
                alt={photoView.caption || "Foto del vehículo"}
              />
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
