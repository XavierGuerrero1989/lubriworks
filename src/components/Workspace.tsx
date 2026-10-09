import { LubriAssistant } from "./LubriAssistant";
import { auth } from "../lib/firebase";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";
import { Notifications } from "./Notifications";
import { useState, type ReactNode } from "react";
import {
  LayoutDashboard,
  CalendarDays,
  ClipboardList,
  Users,
  Wallet,
  Package,
  Truck,
  Wrench,
  BarChart3,
  Settings,
  Bell,
  Search,
  Plus,
  ArrowUpRight,
  ArrowRight,
  Droplets,
  Car,
  LogOut,
  Menu,
  X,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  RefreshCw,
  Building2,
  ShieldCheck,
} from "lucide-react";
import {
  canManage,
  canCharge,
  dueInfo,
  estimatedKm,
  monthlyUsage,
  vehicleYear,
  roleLabels,
  today,
  type Access,
  type Collection,
  type State,
  type Sale,
  type Vehicle,
} from "../../shared/model";
import type { Command } from "../../shared/engine";
import { Receipt } from "./Receipt";
import { rpc } from "../lib/api";
import { enablePush } from "../lib/push";
import {
  Badge,
  Empty,
  FormDialog,
  LinkButton,
  SearchBox,
  Section,
  Stat,
  exportCsv,
  fmtDate,
  money,
  number,
  type Dialog,
  type Field,
} from "./ui";
type Props = {
  access: Access;
  accesses: Access[];
  state: State;
  run: (cmd: Command) => Promise<void>;
  onRefresh: () => Promise<void>;
  onSwitch: (a: Access) => void;
  onLogout: () => void;
  demo: boolean;
  vapid: string;
  onDemoRole: () => void;
  platform: boolean;
  onPlatform: () => void;
};
const nav = [
  ["dashboard", "Inicio", LayoutDashboard],
  ["appointments", "Agenda", CalendarDays],
  ["orders", "Órdenes de servicio", ClipboardList],
  ["customers", "Clientes y vehículos", Users],
  ["sales", "Ventas y caja", Wallet],
  ["products", "Productos y stock", Package],
  ["purchases", "Compras y proveedores", Truck],
  ["services", "Servicios y precios", Wrench],
  ["reports", "Reportes", BarChart3],
  ["notifications", "Notificaciones", Bell],
  ["settings", "Configuración", Settings],
] as const;
const clientNav = [
  ["vehicles", "Mis vehículos", Car],
  ["history", "Historial de servicios", ClipboardList],
  ["reminders", "Próximos mantenimientos", CalendarDays],
  ["notifications", "Notificaciones", Bell],
  ["profile", "Mi perfil", Users],
] as const;
export function Workspace({
  access,
  accesses,
  state: s,
  run,
  onSwitch,
  onRefresh,
  onLogout,
  demo,
  vapid,
  onDemoRole,
  platform,
  onPlatform,
}: Props) {
  const customer = access.member.role === "customer",
    manager = canManage(access.member.role),
    charge = canCharge(access.member.role);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [tab, setTab] = useState(
      customer
        ? new URLSearchParams(location.search).get("portal") === "notifications"
          ? "notifications"
          : "vehicles"
        : "dashboard",
    ),
    [search, setSearch] = useState(""),
    [branch, setBranch] = useState("all"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [notice, setNotice] = useState(""),
    [mobile, setMobile] = useState(false),
    [subtab, setSubtab] = useState(""),
    [dateFrom, setDateFrom] = useState(today().slice(0, 7) + "-01"),
    [dateTo, setDateTo] = useState(today());
  const go = (id: string) => {
    setTab(id);
    setSearch("");
    setSubtab("");
    setMobile(false);
  };
  const items = customer
    ? clientNav
    : nav.filter(([id]) =>
        access.member.role === "technician"
          ? [
              "dashboard",
              "appointments",
              "orders",
              "customers",
              "services",
            ].includes(id)
          : access.member.role === "cashier"
            ? !["purchases", "reports", "settings", "notifications"].includes(
                id,
              )
            : true,
      );
  const title = items.find(([id]) => id === tab)?.[1] || "Inicio";
  const execute = async (cmd: Command) => {
    await run(cmd);
    setNotice("Cambios guardados correctamente.");
  };
  const action = (title: string, cmd: Command, description?: string) =>
    setDialog({
      title,
      description,
      fields: [],
      submitLabel: "Confirmar",
      submit: async () => execute(cmd),
    });
  const scoped = <T extends { branchId: string }>(rows: T[]) =>
    rows.filter((r) => branch === "all" || r.branchId === branch);
  const match = (...values: unknown[]) =>
    values.join(" ").toLowerCase().includes(search.toLowerCase());
  const clientName = (id: string | null) =>
    s.customers.find((c) => c.id === id)?.name || "Venta de mostrador";
  const vehicleName = (id: string) => {
    const v = s.vehicles.find((v) => v.id === id);
    return v ? `${v.brand} ${v.model}` : "Vehículo";
  };
  const plate = (id: string) =>
    s.vehicles.find((v) => v.id === id)?.plate || "—";
  const branchName = (id: string) =>
    s.branches.find((b) => b.id === id)?.name || "—";
  const opts = (collection: Collection, label = "name") =>
    (s[collection] as any[]).map((r) => ({
      value: r.id,
      label: String(r[label] || r.id),
    }));
  const field = (
    key: string,
    label: string,
    type = "text",
    extra: Partial<Field> = {},
  ): Field => ({ key, label, type, ...extra });
  const defaultBranch = branch === "all" ? s.branches[0]?.id || "" : branch;
  function edit(collection: Collection, record?: any) {
    const d = record || {};
    let fields: Field[] = [];
    if (collection === "branches")
      fields = [
        field("name", "Nombre"),
        field("address", "Dirección", "text", { required: false }),
      ];
    if (collection === "customers")
      fields = [
        field("name", "Nombre y apellido"),
        field("email", "Correo electrónico", "email"),
        ...(!record
          ? [
              field("password", "Contraseña de acceso", "password", {
                minLength: 8,
                maxLength: 128,
                autoComplete: "new-password",
                hint: "Al menos 8 caracteres. El cliente podrá cambiarla desde su perfil.",
              }),
            ]
          : []),
        field("phone", "Teléfono", "tel", { required: false }),
        field("notes", "Notas internas", "textarea", { required: false }),
      ];
    if (collection === "vehicles")
      fields = [
        field("customerId", "Cliente", "text", { options: opts("customers") }),
        field("plate", "Patente"),
        field("brand", "Marca"),
        field("model", "Modelo / motor"),
        field("year", "Año del vehículo", "number", {
          min: 1900,
          max: Number(today().slice(0, 4)),
          step: "1",
          value: record ? vehicleYear(record as Vehicle) : undefined,
          hint: "Por ejemplo, 2020. Usamos el año para estimar el uso inicial.",
        }),
        field("odometer", "Kilometraje real", "number", { step: "1" }),
        field("readingDate", "Fecha de lectura", "date", { value: today() }),
        field("hasExtinguisher", "¿Tiene matafuegos?", "text", {
          options: [ { value: "yes", label: "Sí" }, { value: "no", label: "No" } ],
          value: d.hasExtinguisher === true || d.extinguisherDue ? "yes" : d.hasExtinguisher === false ? "no" : "",
        }),
        field("extinguisherDue", "Vencimiento del matafuegos", "date", {
          showWhen: { key: "hasExtinguisher", value: "yes" },
          hint: "Podés cargar una fecha pasada si está vencido.",
        }),
        field("wantsExtinguisher", "Quiere comprar un matafuegos nuevo", "checkbox", {
          required: false,
          hint: "Queda registrado en la ficha para ofrecerle uno nuevo.",
        }),
      ];
    if (collection === "products")
      fields = [
        field("name", "Nombre del producto"),
        field("sku", "Código / SKU"),
        field("unit", "Unidad", "text", {
          options: [
            { value: "unidad", label: "Unidad" },
            { value: "litro", label: "Litro (a granel)" },
          ],
          value: "unidad",
        }),
        field("branchId", "Sucursal", "text", {
          options: opts("branches"),
          value: defaultBranch,
        }),
        field("price", "Precio de venta", "number"),
        field("cost", "Costo unitario", "number"),
        field("minStock", "Stock mínimo", "number"),
        ...(!record
          ? [field("stock", "Stock inicial", "number", { value: 0 })]
          : []),
      ];
    if (collection === "suppliers")
      fields = [
        field("name", "Razón social"),
        field("email", "Correo", "email", { required: false }),
        field("phone", "Teléfono", "tel", { required: false }),
      ];
    if (collection === "services")
      fields = [
        field("name", "Nombre del servicio"),
        field("labor", "Mano de obra", "number"),
        field("intervalKm", "Próximo servicio: kilómetros", "number", {
          step: "1",
          value: 10000,
          hint: "0 = sin límite por kilometraje.",
        }),
        field("intervalMonths", "Próximo servicio: meses", "number", {
          step: "1",
          value: 12,
          hint: "0 = sin límite por tiempo.",
        }),
        field("items", "Insumos del combo", "lines", {
          options: opts("products"),
          value: [],
          required: false,
        }),
      ];
    if (collection === "appointments")
      fields = [
        field("vehicleId", "Vehículo", "text", {
          options: s.vehicles.map((v) => ({
            value: v.id,
            label: `${v.plate} · ${clientName(v.customerId)}`,
          })),
        }),
        field("branchId", "Sucursal", "text", {
          options: opts("branches"),
          value: defaultBranch,
        }),
        field("date", "Fecha", "date", { value: today() }),
        field("time", "Horario", "time"),
        field("reason", "Motivo"),
        field("technician", "Técnico / puesto", "text", { required: false }),
        field("status", "Estado", "text", {
          value: "confirmed",
          options: [
            { value: "requested", label: "Solicitado" },
            { value: "confirmed", label: "Confirmado" },
            { value: "completed", label: "Completado" },
            { value: "cancelled", label: "Cancelado" },
          ],
        }),
      ];
    if (collection === "orders")
      fields = [
        field("vehicleId", "Vehículo", "text", {
          options: s.vehicles.map((v) => ({
            value: v.id,
            label: `${v.plate} · ${clientName(v.customerId)}`,
          })),
        }),
        field("branchId", "Sucursal", "text", {
          options: opts("branches"),
          value: defaultBranch,
        }),
        field("serviceId", "Servicio / combo", "text", {
          options: opts("services"),
        }),
        field("odometer", "Kilometraje al ingresar", "number", { step: "1" }),
        field("date", "Fecha de recepción", "date", { value: today() }),
        field("technician", "Técnico responsable", "text", { required: false }),
        field("status", "Estado", "text", {
          value: "received",
          options: [
            { value: "received", label: "Recibido" },
            { value: "working", label: "En atención" },
          ],
        }),
        field("checklist", "Controles realizados", "textarea", {
          required: false,
          value: (d.checklist || []).join(", "),
          hint: "Separados por coma: luces, niveles, neumáticos…",
        }),
        field("notes", "Observaciones internas", "textarea", {
          required: false,
        }),
      ];
    if (collection === "purchases")
      fields = [
        field("supplierId", "Proveedor", "text", {
          options: opts("suppliers"),
        }),
        field("branchId", "Sucursal", "text", {
          options: opts("branches"),
          value: defaultBranch,
        }),
        field("date", "Fecha", "date", { value: today() }),
        field("items", "Productos · cantidad · costo unitario", "lines", {
          options: opts("products"),
          value: [],
          hint: "purchase",
        }),
      ];
    fields = fields.map((f) => ({
      ...f,
      value: f.key === "checklist" || f.key === "hasExtinguisher" ? f.value : (d[f.key] ?? f.value),
    }));
    setDialog({
      title: `${record ? "Editar" : "Nuevo registro"} · ${{ branches: "Sucursal", customers: "Cliente", vehicles: "Vehículo", products: "Producto", suppliers: "Proveedor", services: "Servicio", appointments: "Turno", orders: "Orden de servicio", purchases: "Compra" }[collection]}`,
      fields,
      description:
        collection === "customers" && !record
          ? "Al guardar se crea su cuenta de acceso con este correo y contraseña, sin verificación de correo."
          : undefined,
      submit: async (values) => {
        let data = { ...d, ...values };
        delete data.id;
        delete data.password;
        if (collection === "vehicles") {
          delete data.firstRegistration;
          data.hasExtinguisher = values.hasExtinguisher === "yes";
          if (!data.hasExtinguisher) data.extinguisherDue = "";
          data.previousOdometer = d.previousOdometer ?? null;
          data.previousReadingDate = d.previousReadingDate || "";
        }
        if (collection === "customers")
          data.pushEnabled = d.pushEnabled ?? true;
        if (collection === "orders" || collection === "appointments")
          data.customerId = s.vehicles.find(
            (v) => v.id === values.vehicleId,
          )?.customerId;
        if (collection === "orders") {
          data = {
            ...data,
            items: [],
            labor: 0,
            intervalKm: 0,
            intervalMonths: 0,
            checklist: String(values.checklist)
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean),
          };
        }
        if (collection === "purchases") data.status = "draft";
        await execute(
          collection === "customers" && !record
            ? { action: "createCustomer", data, password: values.password }
            : { action: "save", collection, id: record?.id, data },
        );
      },
    });
  }
  const newButton = (collection: Collection, label: string) => (
    <button className="button primary" onClick={() => edit(collection)}>
      <Plus size={17} />
      {label}
    </button>
  );
  const chargeOrder = (id: string) =>
    setDialog({
      title: "Cobrar servicio",
      description: "La venta se registrará en la caja abierta de la sucursal.",
      fields: [
        field("method", "Medio de pago", "text", {
          options: [
            { value: "cash", label: "Efectivo" },
            { value: "transfer", label: "Transferencia" },
            { value: "card", label: "Tarjeta" },
          ],
          value: "cash",
        }),
      ],
      submit: async (data) => execute({ action: "chargeOrder", id, ...data }),
    });
  const requestAppointment = (vehicleId?: string) =>
    setDialog({
      title: "Solicitar un turno",
      description: "El lubricentro confirmará tu solicitud.",
      fields: [
        field("vehicleId", "Vehículo", "text", {
          options: opts("vehicles", "plate"),
          value: vehicleId,
        }),
        field("branchId", "Sucursal", "text", {
          options: opts("branches"),
          value: s.branches[0]?.id,
        }),
        field("date", "Fecha preferida", "date", { value: today() }),
        field("time", "Horario preferido", "time"),
        field("reason", "Motivo"),
      ],
      submit: async (data) =>
        execute({ action: "requestAppointment", ...data }),
    });
  const readKm = (v: Vehicle) =>
    setDialog({
      title: `Actualizar kilometraje · ${v.plate}`,
      description:
        "Ingresá la lectura real del tablero para mejorar tus recordatorios.",
      fields: [
        field("odometer", "Kilometraje actual", "number", {
          value: v.odometer,
          min: v.odometer,
          step: "1",
        }),
        field("date", "Fecha de lectura", "date", { value: today() }),
      ],
      submit: async (data) => execute({ action: "reading", id: v.id, ...data }),
    });
  const activeReminders = s.reminders
    .filter((r) => r.status === "active")
    .map((r) => ({ r, v: s.vehicles.find((v) => v.id === r.vehicleId)! }))
    .filter((x) => x.v)
    .map((x) => ({ ...x, info: dueInfo(x.r, x.v) }));
  const sales = scoped(s.sales),
    todaysSales = sales.filter((x) => x.date.slice(0, 10) === today());
  const orders = scoped(s.orders),
    appointments = scoped(s.appointments)
      .filter((a) => a.date === today())
      .sort((a, b) => a.time.localeCompare(b.time));
  const orderTable = (rows = orders) =>
    rows.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Vehículo / cliente</th>
              <th>Servicio</th>
              <th>Ingreso</th>
              <th>Estado</th>
              <th>Total</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong className="plate">{plate(o.vehicleId)}</strong>
                  <small>{clientName(o.customerId)}</small>
                </td>
                <td>
                  {o.serviceName ||
                    s.services.find((x) => x.id === o.serviceId)?.name ||
                    "Servicio"}
                  <small>{vehicleName(o.vehicleId)}</small>
                </td>
                <td>
                  {fmtDate(o.date)}
                  <small>{number(o.odometer)} km</small>
                </td>
                <td>
                  <Badge value={o.status} />
                </td>
                <td className="numeric">
                  {money(
                    o.labor +
                      o.items.reduce((n, i) => n + i.price * i.quantity, 0),
                  )}
                </td>
                <td>
                  <div className="row-actions">
                    {!customer &&
                      ["received", "working"].includes(o.status) && (
                        <>
                          <button
                            className="text-button"
                            onClick={() => edit("orders", o)}
                          >
                            Editar
                          </button>
                          {access.member.role !== "cashier" && (
                            <button
                              className="button small secondary"
                              onClick={() =>
                                action(
                                  "Finalizar servicio",
                                  { action: "finishOrder", id: o.id },
                                  "Se descontarán los insumos y se calculará el próximo mantenimiento.",
                                )
                              }
                            >
                              Finalizar
                            </button>
                          )}
                        </>
                      )}
                    {charge && o.status === "ready" && (
                      <button
                        className="button small primary"
                        onClick={() => chargeOrder(o.id)}
                      >
                        Cobrar
                      </button>
                    )}
                    {s.sales.some((v) => v.orderId === o.id) && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setReceipt(s.sales.find((v) => v.orderId === o.id)!)
                        }
                      >
                        Comprobante
                      </button>
                    )}
                    {(customer ||
                      o.status === "paid" ||
                      o.status === "ready") && (
                      <button
                        className="text-button"
                        onClick={() =>
                          setDialog({
                            title: `Servicio · ${plate(o.vehicleId)}`,
                            description: `${fmtDate(o.date)} · ${number(o.odometer)} km. Insumos: ${o.items.map((i) => `${i.name || s.products.find((p) => p.id === i.productId)?.name || "Producto registrado"} × ${i.quantity}`).join(", ")}. Mano de obra: ${money(o.labor)}. Controles: ${o.checklist.join(", ") || "Sin controles registrados"}.`,
                            fields: [],
                            submitLabel: "Cerrar",
                            submit: async () => {},
                          })
                        }
                      >
                        Detalle
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <Empty text="No hay órdenes para mostrar." />
    );
  let content: ReactNode;
  if (tab === "dashboard")
    content = (
      <>
        <div className="welcome">
          <div>
            <span className="eyebrow">TODO LISTO PARA UN NUEVO DÍA</span>
            <h1>
              Buen día, {access.member.name.split(" ")[0]}{" "}
              <span className="sun">☀</span>
            </h1>
            <p>Así está tu lubricentro hoy. Vamos a ponerlo en marcha.</p>
          </div>
          {newButton("orders", "Nueva orden")}
        </div>
        <div className="stats">
          <Stat
            label="Ventas de hoy"
            value={money(todaysSales.reduce((n, x) => n + x.total, 0))}
            detail={`${todaysSales.length} operaciones registradas`}
            icon={<Wallet size={20} />}
          />
          <Stat
            label="Vehículos en atención"
            value={
              orders.filter((o) => ["received", "working"].includes(o.status))
                .length
            }
            detail={`${orders.filter((o) => o.status === "ready").length} listos para entregar`}
            icon={<Car size={20} />}
          />
          <Stat
            label="Turnos de hoy"
            value={appointments.filter((a) => a.status !== "cancelled").length}
            detail={`${appointments.filter((a) => a.status === "requested").length} pendientes de confirmar`}
            icon={<CalendarDays size={20} />}
          />
          <Stat
            label="Mantenimientos próximos"
            value={activeReminders.filter((x) => x.info.soon).length}
            detail="Por fecha o kilometraje estimado"
            icon={<Bell size={20} />}
          />
        </div>
        <div className="dashboard-grid">
          <Section
            title="El taller, en movimiento"
            subtitle="Seguí cada servicio de principio a fin"
            action={
              <LinkButton onClick={() => go("orders")}>Ver órdenes</LinkButton>
            }
          >
            {orderTable(orders.filter((o) => o.status !== "paid").slice(0, 5))}
          </Section>
          <Section
            title="Agenda de hoy"
            subtitle={new Date().toLocaleDateString("es-AR", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            action={
              <button
                className="icon-button"
                aria-label="Abrir agenda"
                onClick={() => go("appointments")}
              >
                <ArrowUpRight size={18} />
              </button>
            }
          >
            {appointments.length ? (
              <div className="agenda-list">
                {appointments.slice(0, 4).map((a) => (
                  <div className="agenda-item" key={a.id}>
                    <time>{a.time}</time>
                    <div>
                      <strong>{vehicleName(a.vehicleId)}</strong>
                      <span>{clientName(a.customerId)}</span>
                      <small>{a.reason}</small>
                    </div>
                    <span className={`status-dot ${a.status}`} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="Tu agenda está libre." />
            )}
            <button className="agenda-add" onClick={() => edit("appointments")}>
              <Plus size={16} /> Agendar un turno
            </button>
          </Section>
        </div>
        <div className="dashboard-bottom">
          <Section
            title="Atención a estos productos"
            subtitle="Stock por debajo del mínimo"
            action={
              <LinkButton onClick={() => go("products")}>Ver stock</LinkButton>
            }
          >
            {scoped(s.products).filter((p) => p.stock <= p.minStock).length ? (
              scoped(s.products)
                .filter((p) => p.stock <= p.minStock)
                .slice(0, 3)
                .map((p) => (
                  <div className="stock-alert" key={p.id}>
                    <i>
                      <Package size={20} />
                    </i>
                    <div>
                      <strong>{p.name}</strong>
                      <small>
                        {p.sku} · {branchName(p.branchId)}
                      </small>
                    </div>
                    <Badge value="warning">
                      {number(p.stock)} {p.unit === "litro" ? "L" : "u."}
                    </Badge>
                  </div>
                ))
            ) : (
              <div className="all-good">
                <CheckCircle2 /> El stock está por encima de los mínimos.
              </div>
            )}
          </Section>
          <div className="care-card">
            <span className="eyebrow light">
              UN BUEN SERVICIO CONTINÚA DESPUÉS
            </span>
            <h2>
              Que tus clientes
              <br />
              vuelvan a tiempo.
            </h2>
            <p>
              El historial y los recordatorios acompañan
              <br />a cada vehículo entre visitas.
            </p>
            <button onClick={() => go("customers")}>
              Ver clientes <ArrowRight size={17} />
            </button>
            <Droplets className="care-drop" size={140} />
          </div>
        </div>
      </>
    );
  else if (tab === "customers")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Clientes y vehículos</h1>
            <p>Una historia de cuidado para cada patente.</p>
          </div>
          <div className="row-actions">
            {newButton("customers", "Cliente")}
            {newButton("vehicles", "Vehículo")}
          </div>
        </div>
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar por patente, cliente o modelo…"
          />
          <div className="segmented">
            <button
              className={subtab !== "clients" ? "active" : ""}
              onClick={() => setSubtab("vehicles")}
            >
              Vehículos
            </button>
            <button
              className={subtab === "clients" ? "active" : ""}
              onClick={() => setSubtab("clients")}
            >
              Clientes
            </button>
          </div>
        </div>
        {subtab === "clients" ? (
          <Section title={`${s.customers.length} clientes`}>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th>Vehículos</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.customers
                    .filter((c) => match(c.name, c.email))
                    .map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td>
                          {c.email}
                          <small>{c.phone}</small>
                        </td>
                        <td>
                          {
                            s.vehicles.filter((v) => v.customerId === c.id)
                              .length
                          }
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => edit("customers", c)}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Section>
        ) : (
          <div className="vehicle-grid">
            {s.vehicles
              .filter((v) =>
                match(v.plate, v.brand, v.model, clientName(v.customerId)),
              )
              .map((v) => (
                <VehicleCard
                  key={v.id}
                  v={v}
                  owner={clientName(v.customerId)}
                  onEdit={() => edit("vehicles", v)}
                  onReading={() => readKm(v)}
                  onHistory={() => {
                    go("orders");
                    setSearch(v.plate);
                  }}
                />
              ))}
            {!s.vehicles.length && <Empty text="Cargá tu primer vehículo." />}
          </div>
        )}
      </>
    );
  else if (tab === "orders" || tab === "history")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>
              {customer ? "Tu historial de servicios" : "Órdenes de servicio"}
            </h1>
            <p>Recepción, trabajo, insumos y entrega.</p>
          </div>
          {!customer && newButton("orders", "Nueva orden")}
        </div>
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar patente o cliente…"
          />
          <select
            aria-label="Filtrar estado"
            value={subtab}
            onChange={(e) => setSubtab(e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="received">Recibidos</option>
            <option value="working">En atención</option>
            <option value="ready">Listos para cobrar</option>
            <option value="paid">Cobrados</option>
          </select>
        </div>
        <Section
          title={customer ? "Servicios registrados" : "Seguimiento del taller"}
        >
          {orderTable(
            orders.filter(
              (o) =>
                (!subtab || o.status === subtab) &&
                match(plate(o.vehicleId), clientName(o.customerId)),
            ),
          )}
        </Section>
      </>
    );
  else if (tab === "appointments")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Agenda</h1>
            <p>Organizá los turnos de cada sucursal.</p>
          </div>
          {newButton("appointments", "Nuevo turno")}
        </div>
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar cliente, patente o motivo…"
          />
          <input
            type="date"
            aria-label="Fecha de agenda"
            value={subtab}
            onChange={(e) => setSubtab(e.target.value)}
          />
        </div>
        <Section
          title={subtab ? `Turnos del ${fmtDate(subtab)}` : "Todos los turnos"}
        >
          {scoped(s.appointments).length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha / hora</th>
                    <th>Cliente / vehículo</th>
                    <th>Motivo</th>
                    <th>Sucursal / técnico</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {scoped(s.appointments)
                    .filter(
                      (a) =>
                        (!subtab || a.date === subtab) &&
                        match(
                          clientName(a.customerId),
                          plate(a.vehicleId),
                          a.reason,
                        ),
                    )
                    .sort((a, b) =>
                      (a.date + a.time).localeCompare(b.date + b.time),
                    )
                    .map((a) => (
                      <tr key={a.id}>
                        <td>
                          <strong>{a.time}</strong>
                          <small>{fmtDate(a.date)}</small>
                        </td>
                        <td>
                          {clientName(a.customerId)}
                          <small>{plate(a.vehicleId)}</small>
                        </td>
                        <td>{a.reason}</td>
                        <td>
                          {branchName(a.branchId)}
                          <small>{a.technician || "Sin asignar"}</small>
                        </td>
                        <td>
                          <Badge value={a.status} />
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => edit("appointments", a)}
                          >
                            Gestionar
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="Todavía no hay turnos." />
          )}
        </Section>
      </>
    );
  else if (tab === "products")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Productos y stock</h1>
            <p>Aceites a granel, filtros y repuestos por sucursal.</p>
          </div>
          {manager && newButton("products", "Nuevo producto")}
        </div>
        <div className="toolbar">
          <SearchBox
            value={search}
            onChange={setSearch}
            placeholder="Buscar producto o código…"
          />
          <button
            className="button secondary"
            onClick={() => setSubtab(subtab === "movements" ? "" : "movements")}
          >
            {subtab === "movements" ? "Ver productos" : "Movimientos"}
          </button>
        </div>
        <Section
          title={
            subtab === "movements" ? "Movimientos de inventario" : "Inventario"
          }
        >
          {subtab === "movements" ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {scoped(s.movements)
                    .slice()
                    .reverse()
                    .map((m) => (
                      <tr key={m.id}>
                        <td>{fmtDate(m.date)}</td>
                        <td>
                          {s.products.find((p) => p.id === m.productId)?.name}
                        </td>
                        <td>
                          {m.quantity > 0 ? "+" : ""}
                          {number(m.quantity)}
                        </td>
                        <td>{m.reason}</td>
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
                    <th>Sucursal</th>
                    <th>Stock</th>
                    <th>Mínimo</th>
                    <th>Precio</th>
                    {manager && <th>Costo</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {scoped(s.products)
                    .filter((p) => match(p.name, p.sku))
                    .map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <small>{p.sku}</small>
                        </td>
                        <td>{branchName(p.branchId)}</td>
                        <td>
                          <Badge
                            value={p.stock <= p.minStock ? "warning" : "ok"}
                          >
                            {number(p.stock)} {p.unit === "litro" ? "L" : "u."}
                          </Badge>
                        </td>
                        <td>{number(p.minStock)}</td>
                        <td>{money(p.price)}</td>
                        {manager && <td>{money(p.cost)}</td>}
                        <td>
                          {manager && (
                            <div className="row-actions">
                              <button
                                className="text-button"
                                onClick={() => edit("products", p)}
                              >
                                Editar
                              </button>
                              <button
                                className="text-button"
                                onClick={() =>
                                  setDialog({
                                    title: `Ajustar stock · ${p.name}`,
                                    fields: [
                                      field(
                                        "quantity",
                                        "Variación de stock",
                                        "number",
                                        {
                                          min: -p.stock,
                                          hint: "Positivo para agregar; negativo para descontar.",
                                        },
                                      ),
                                      field("reason", "Motivo del ajuste"),
                                    ],
                                    submit: async (data) =>
                                      execute({
                                        action: "adjustStock",
                                        id: p.id,
                                        ...data,
                                      }),
                                  })
                                }
                              >
                                Ajustar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {!s.products.length && <Empty text="Cargá el primer producto." />}
        </Section>
      </>
    );
  else if (tab === "services")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Servicios y precios</h1>
            <p>
              Combos con mano de obra, insumos e intervalos de mantenimiento.
            </p>
          </div>
          {manager && newButton("services", "Nuevo servicio")}
        </div>
        <div className="service-grid">
          {s.services.map((v) => (
            <article className="panel service-card" key={v.id}>
              <i className="service-icon">
                <Wrench />
              </i>
              <h2>{v.name}</h2>
              <p>{v.items.length} insumos en el combo</p>
              <ul>
                {v.items.map((i, index) => (
                  <li key={index}>
                    {s.products.find((p) => p.id === i.productId)?.name ||
                      i.productId}
                    <strong>× {i.quantity}</strong>
                  </li>
                ))}
              </ul>
              <div className="service-total">
                <small>Total actual</small>
                <strong>
                  {money(
                    v.labor +
                      v.items.reduce(
                        (n, i) =>
                          n +
                          i.quantity *
                            (s.products.find((p) => p.id === i.productId)
                              ?.price || 0),
                        0,
                      ),
                  )}
                </strong>
              </div>
              <p className="muted">Mano de obra: {money(v.labor)}</p>
              <div className="service-interval">
                <RefreshCw size={15} />
                {v.intervalKm ? `${number(v.intervalKm)} km` : ""}
                {v.intervalKm && v.intervalMonths ? " o " : ""}
                {v.intervalMonths ? `${v.intervalMonths} meses` : ""}
                {!v.intervalKm && !v.intervalMonths
                  ? "Sin recordatorio automático"
                  : ""}
              </div>
              {manager && (
                <button
                  className="button secondary wide"
                  onClick={() => edit("services", v)}
                >
                  Editar servicio
                </button>
              )}
            </article>
          ))}
        </div>
        {!s.services.length && <Empty text="Creá el primer servicio." />}
      </>
    );
  else if (tab === "purchases")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Compras y proveedores</h1>
            <p>Recibí mercadería y actualizá el stock en un paso.</p>
          </div>
          <div className="row-actions">
            {newButton("suppliers", "Proveedor")}
            {newButton("purchases", "Nueva compra")}
          </div>
        </div>
        <div className="segmented">
          <button
            className={subtab !== "suppliers" ? "active" : ""}
            onClick={() => setSubtab("")}
          >
            Compras
          </button>
          <button
            className={subtab === "suppliers" ? "active" : ""}
            onClick={() => setSubtab("suppliers")}
          >
            Proveedores
          </button>
        </div>
        <Section
          title={
            subtab === "suppliers" ? "Tus proveedores" : "Órdenes de compra"
          }
        >
          <div className="table-scroll">
            {subtab === "suppliers" ? (
              <table>
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th>Contacto</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {s.suppliers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                      </td>
                      <td>
                        {p.email}
                        <small>{p.phone}</small>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => edit("suppliers", p)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Proveedor</th>
                    <th>Sucursal</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {scoped(s.purchases).map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.date)}</td>
                      <td>
                        {s.suppliers.find((v) => v.id === p.supplierId)?.name}
                      </td>
                      <td>{branchName(p.branchId)}</td>
                      <td>
                        {money(
                          p.items.reduce((n, i) => n + i.quantity * i.cost, 0),
                        )}
                      </td>
                      <td>
                        <Badge value={p.status}>
                          {p.status === "received" ? "Recibida" : "Pendiente"}
                        </Badge>
                      </td>
                      <td>
                        {p.status === "draft" && (
                          <div className="row-actions">
                            <button
                              className="text-button"
                              onClick={() => edit("purchases", p)}
                            >
                              Editar
                            </button>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                action(
                                  "Recibir mercadería",
                                  { action: "receivePurchase", id: p.id },
                                  "Se sumarán las cantidades al stock y se actualizarán los costos.",
                                )
                              }
                            >
                              Recibir
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Section>
      </>
    );
  else if (tab === "sales") {
    const open = scoped(s.cash).filter((c) => !c.closedAt);
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Ventas y caja</h1>
            <p>Cobros de servicios y ventas de mostrador.</p>
          </div>
          {charge && (
            <div className="row-actions">
              <button
                className="button secondary"
                onClick={() =>
                  setDialog({
                    title: "Abrir caja",
                    fields: [
                      field("branchId", "Sucursal", "text", {
                        options: opts("branches"),
                        value: defaultBranch,
                      }),
                      field("opening", "Efectivo inicial", "number", {
                        value: 0,
                      }),
                    ],
                    submit: async (data) =>
                      execute({ action: "openCash", ...data }),
                  })
                }
              >
                Abrir caja
              </button>
              <button
                className="button primary"
                onClick={() =>
                  setDialog({
                    title: "Venta de mostrador",
                    description: "Los precios y el stock se validan al cobrar.",
                    fields: [
                      field("branchId", "Sucursal", "text", {
                        options: opts("branches"),
                        value: defaultBranch,
                      }),
                      field("items", "Productos y cantidades", "lines", {
                        options: opts("products"),
                        value: [],
                      }),
                      field("method", "Medio de pago", "text", {
                        options: [
                          { value: "cash", label: "Efectivo" },
                          { value: "transfer", label: "Transferencia" },
                          { value: "card", label: "Tarjeta" },
                        ],
                        value: "cash",
                      }),
                    ],
                    submitLabel: "Cobrar venta",
                    submit: async (data) =>
                      execute({ action: "sale", ...data }),
                  })
                }
              >
                <Plus size={17} />
                Nueva venta
              </button>
            </div>
          )}
        </div>
        <div className="cash-grid">
          {open.map((c) => (
            <div className="panel cash-card" key={c.id}>
              <span className="badge ok">Caja abierta</span>
              <h2>{branchName(c.branchId)}</h2>
              <p>Efectivo esperado</p>
              <strong>
                {money(
                  c.opening +
                    s.sales
                      .filter(
                        (a) =>
                          a.branchId === c.branchId &&
                          a.date >= c.openedAt &&
                          a.method === "cash",
                      )
                      .reduce((n, a) => n + a.total, 0),
                )}
              </strong>
              <small>Apertura: {money(c.opening)}</small>
              {charge && (
                <button
                  className="button secondary"
                  onClick={() =>
                    setDialog({
                      title: `Cerrar caja · ${branchName(c.branchId)}`,
                      fields: [field("counted", "Efectivo contado", "number")],
                      submit: async (data) =>
                        execute({ action: "closeCash", id: c.id, ...data }),
                    })
                  }
                >
                  Cerrar caja
                </button>
              )}
            </div>
          ))}
        </div>
        {!open.length && (
          <p className="warning-box">
            No hay cajas abiertas en esta selección. Abrí una para registrar
            cobros.
          </p>
        )}
        <Section
          title="Ventas registradas"
          action={
            <button
              className="button secondary small"
              onClick={() =>
                exportCsv(
                  "lubriworks-ventas.csv",
                  sales.map((x) => ({
                    Fecha: x.date,
                    Total: x.total,
                    Medio: x.method,
                    Sucursal: branchName(x.branchId),
                  })),
                )
              }
            >
              <Download size={15} />
              Exportar
            </button>
          }
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente / concepto</th>
                  <th>Medio de pago</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sales
                  .slice()
                  .reverse()
                  .map((v) => (
                    <tr key={v.id}>
                      <td>{fmtDate(v.date)}</td>
                      <td>
                        {clientName(v.customerId)}
                        <small>
                          {v.orderId
                            ? "Orden de servicio"
                            : v.items.map((i) => i.name).join(", ")}
                        </small>
                      </td>
                      <td>
                        <Badge value={v.method} />
                      </td>
                      <td className="numeric">{money(v.total)}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setReceipt(v)}
                        >
                          Comprobante
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Section>
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
                {scoped(s.cash)
                  .filter((c) => c.closedAt)
                  .map((c) => (
                    <tr key={c.id}>
                      <td>{branchName(c.branchId)}</td>
                      <td>{fmtDate(c.closedAt!)}</td>
                      <td>{money(c.expected || 0)}</td>
                      <td>{money(c.counted || 0)}</td>
                      <td>{money((c.counted || 0) - (c.expected || 0))}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Section>
      </>
    );
  } else if (tab === "reports") {
    const period = sales.filter(
        (x) => x.date.slice(0, 10) >= dateFrom && x.date.slice(0, 10) <= dateTo,
      ),
      total = period.reduce((n, x) => n + x.total, 0),
      cost = period.reduce((n, x) => n + x.cost, 0);
    const popular = s.services
      .map((v) => ({
        name: v.name,
        count: orders.filter(
          (o) =>
            o.serviceId === v.id &&
            o.status === "paid" &&
            o.date >= dateFrom &&
            o.date <= dateTo,
        ).length,
      }))
      .sort((a, b) => b.count - a.count);
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Reportes</h1>
            <p>Datos reales de tus operaciones y del movimiento del taller.</p>
          </div>
          <button
            className="button secondary"
            onClick={() =>
              exportCsv(
                "lubriworks-reporte.csv",
                period.map((v) => ({
                  Fecha: v.date,
                  Venta: v.total,
                  Costo: v.cost,
                  Margen: v.total - v.cost,
                  Medio: v.method,
                })),
              )
            }
          >
            <Download size={17} />
            Exportar
          </button>
        </div>
        <div className="toolbar">
          <label>
            Desde{" "}
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </label>
          <label>
            Hasta{" "}
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </label>
        </div>
        <div className="stats">
          <Stat
            label="Ventas del período"
            value={money(total)}
            detail={`${period.length} operaciones`}
            icon={<Wallet size={20} />}
          />
          <Stat
            label="Margen bruto"
            value={money(total - cost)}
            detail="Antes de gastos y costo laboral"
            icon={<BarChart3 size={20} />}
          />
          <Stat
            label="Ticket promedio"
            value={money(period.length ? total / period.length : 0)}
            detail="Por operación cobrada"
            icon={<ClipboardList size={20} />}
          />
          <Stat
            label="Clientes recurrentes"
            value={
              s.customers.filter(
                (c) =>
                  s.orders.filter(
                    (o) => o.customerId === c.id && o.status === "paid",
                  ).length > 1,
              ).length
            }
            detail="Con más de un servicio cobrado, histórico"
            icon={<Users size={20} />}
          />
        </div>
        <div className="dashboard-bottom">
          <Section
            title="Servicios más realizados"
            subtitle="Servicios cobrados del período"
          >
            <div className="bars">
              {popular.map((p) => (
                <div className="bar-item" key={p.name}>
                  <div>
                    <span>{p.name}</span>
                    <strong>{p.count}</strong>
                  </div>
                  <div className="bar-track">
                    <i
                      style={{
                        width: `${(p.count / Math.max(1, ...popular.map((p) => p.count))) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Medios de pago">
            <div className="bars">
              {(["cash", "transfer", "card"] as const).map((method) => (
                <div className="payment-row" key={method}>
                  <Badge value={method} />
                  <strong>
                    {money(
                      period
                        .filter((x) => x.method === method)
                        .reduce((n, x) => n + x.total, 0),
                    )}
                  </strong>
                </div>
              ))}
            </div>
          </Section>
        </div>
        <Section title="Servicios por técnico">
          <div className="bars">
            {[...new Set(orders.map((o) => o.technician || "Sin asignar"))].map(
              (name) => (
                <div className="payment-row" key={name}>
                  <span>{name}</span>
                  <strong>
                    {
                      orders.filter(
                        (o) =>
                          (o.technician || "Sin asignar") === name &&
                          ["ready", "paid"].includes(o.status) &&
                          o.date >= dateFrom &&
                          o.date <= dateTo,
                      ).length
                    }{" "}
                    finalizados
                  </strong>
                </div>
              ),
            )}
          </div>
        </Section>
      </>
    );
  } else if (tab === "settings")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Configuración</h1>
            <p>El espacio de {access.tenant.name}.</p>
          </div>
        </div>
        <div className="dashboard-bottom">
          <Section
            title="Sucursales"
            action={newButton("branches", "Sucursal")}
          >
            <div className="bars">
              {s.branches.map((b) => (
                <div className="payment-row" key={b.id}>
                  <div>
                    <strong>{b.name}</strong>
                    <small>{b.address || "Sin dirección"}</small>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => edit("branches", b)}
                  >
                    Editar
                  </button>
                </div>
              ))}
            </div>
          </Section>
          <Section
            title="Accesos y roles"
            subtitle="Administradores, empleados y clientes"
          >
            <div className="settings-body">
              <ShieldCheck size={28} />
              <p>
                Los usuarios se registran con correo y contraseña. Después
                vinculás su acceso a esta empresa.
              </p>
              <p>
                Los clientes sólo ven sus propios vehículos, servicios y avisos.
              </p>
              {access.member.role === "owner" && (
                <>
                  <button
                    className="button primary"
                    onClick={() =>
                      setDialog({
                        title: "Vincular o actualizar acceso",
                        description:
                          "Usá un correo ya registrado. Para modificar un acceso, ingresá el mismo correo.",
                        fields: [
                          field("email", "Correo de acceso", "email"),
                          field("name", "Nombre"),
                          field("role", "Rol", "text", {
                            options: Object.entries(roleLabels).map(
                              ([value, label]) => ({ value, label }),
                            ),
                            value: "customer",
                          }),
                          field(
                            "customerId",
                            "Ficha de cliente (sólo para rol Cliente)",
                            "text",
                            { options: opts("customers"), required: false },
                          ),
                          field("active", "Acceso activo", "checkbox", {
                            value: true,
                          }),
                        ],
                        submit: async (data) => {
                          if (demo) {
                            throw new Error(
                              "La gestión de accesos requiere Firebase. La demo no crea usuarios.",
                            );
                          }
                          await rpc(
                            "member.save",
                            {
                              ...data,
                              customerId:
                                data.role === "customer"
                                  ? data.customerId
                                  : null,
                            },
                            access.tenant.id,
                          );
                          setNotice("Acceso actualizado.");
                        },
                      })
                    }
                  >
                    Gestionar un acceso
                  </button>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        if (demo) {
                          setNotice(
                            "Demo: administrador y cliente de prueba disponibles desde el selector superior.",
                          );
                          return;
                        }
                        const members = await rpc<any[]>(
                          "members",
                          {},
                          access.tenant.id,
                        );
                        setDialog({
                          title: "Equipo y clientes con acceso",
                          description: members
                            .map(
                              (m) =>
                                `${m.name} · ${m.email} · ${roleLabels[m.role as keyof typeof roleLabels]} · ${m.active ? "Activo" : "Inactivo"}`,
                            )
                            .join("\n"),
                          fields: [],
                          submitLabel: "Cerrar",
                          submit: async () => {},
                        });
                      } catch (e) {
                        setNotice((e as Error).message);
                      }
                    }}
                  >
                    Ver accesos
                  </button>
                </>
              )}
            </div>
          </Section>
        </div>
        <div className="security-note">
          <ShieldCheck />
          <div>
            <strong>Datos separados por empresa</strong>
            <p>
              Los permisos se verifican en cada operación. Moneda: ARS · Zona
              horaria: Argentina.
            </p>
          </div>
        </div>
      </>
    );
  else if (tab === "vehicles")
    content = (
      <>
        <div className="welcome">
          <div>
            <span className="eyebrow">TU VEHÍCULO, BIEN ACOMPAÑADO</span>
            <h1>Hola, {access.member.name.split(" ")[0]}.</h1>
            <p>Tu historial y el próximo mantenimiento, siempre a mano.</p>
          </div>
          <button
            className="button primary"
            onClick={() => requestAppointment()}
          >
            <Plus size={17} />
            Solicitar turno
          </button>
        </div>
        <div className="vehicle-grid">
          {s.vehicles.map((v) => (
            <VehicleCard
              key={v.id}
              v={v}
              onReading={() => readKm(v)}
              onHistory={() => go("history")}
              onAppointment={() => requestAppointment(v.id)}
            />
          ))}
        </div>
        <Section title="Tus próximos turnos">
          <div className="bars">
            {s.appointments
              .filter((a) => a.date >= today() && a.status !== "cancelled")
              .map((a) => (
                <div className="payment-row" key={a.id}>
                  <div>
                    <strong>
                      {fmtDate(a.date)} · {a.time}
                    </strong>
                    <small>
                      {a.reason} · {branchName(a.branchId)}
                    </small>
                  </div>
                  <Badge value={a.status} />
                </div>
              ))}
            {!s.appointments.length && (
              <Empty text="Todavía no tenés turnos." />
            )}
          </div>
        </Section>
      </>
    );
  else if (tab === "reminders")
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Próximos mantenimientos</h1>
            <p>Se considera lo que ocurra primero: kilómetros o fecha.</p>
          </div>
        </div>
        <div className="service-grid">
          {activeReminders.map(({ r, v, info }) => (
            <article className="panel reminder-card" key={r.id}>
              <Badge
                value={info.overdue ? "warning" : info.soon ? "soon" : "ok"}
              >
                {info.overdue
                  ? "Vencido / estimado"
                  : info.soon
                    ? "Se acerca"
                    : "Programado"}
              </Badge>
              <h2>{r.title}</h2>
              <p>
                {v.plate} · {v.brand} {v.model}
              </p>
              <strong className="reminder-date">
                {info.effective ? fmtDate(info.effective) : "Según kilometraje"}
              </strong>
              <p>
                {r.dueKm !== null
                  ? `Próximo objetivo: ${number(r.dueKm)} km`
                  : "Vencimiento por fecha registrada"}
              </p>
              {r.dueKm !== null && (
                <small>
                  Estimación según tu uso. Confirmá la lectura del tablero.
                </small>
              )}
              <button
                className="button secondary wide"
                onClick={() => requestAppointment(v.id)}
              >
                Solicitar turno <ArrowRight size={16} />
              </button>
            </article>
          ))}
        </div>
        {!activeReminders.length && (
          <Empty text="No tenés mantenimientos pendientes." />
        )}
      </>
    );
  else if (tab === "notifications")
    content = (
      <Notifications
        access={access}
        state={s}
        demo={demo}
        vapid={vapid}
        onRead={(id) =>
          action("Marcar como leído", { action: "readNotice", id })
        }
        onAppointment={requestAppointment}
        onReading={(id) => {
          const v = s.vehicles.find((v) => v.id === id);
          if (v) readKm(v);
        }}
        onRefresh={onRefresh}
      />
    );
  else if (tab === "profile") {
    const c = s.customers[0];
    content = (
      <>
        <div className="page-heading">
          <div>
            <h1>Mi perfil</h1>
            <p>Tus datos y preferencias de contacto.</p>
          </div>
        </div>
        {c && (
          <Section title={c.name}>
            <div className="profile-body">
              <div className="avatar large">
                {c.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <dl>
                <dt>Correo de acceso</dt>
                <dd>{auth?.currentUser?.email || c.email}</dd>
                <dt>Correo de la ficha</dt>
                <dd>{c.email}</dd>
                <dt>Teléfono</dt>
                <dd>{c.phone || "Sin cargar"}</dd>
                <dt>Recordatorios push</dt>
                <dd>
                  {c.pushEnabled ? "Permitidos en tu perfil" : "Desactivados"}
                </dd>
              </dl>
              <button
                className="button primary"
                onClick={() =>
                  setDialog({
                    title: "Editar mi perfil",
                    fields: [
                      field("name", "Nombre", "text", { value: c.name }),
                      field("phone", "Teléfono", "tel", {
                        value: c.phone,
                        required: false,
                      }),
                      field(
                        "pushEnabled",
                        "Recibir notificaciones push",
                        "checkbox",
                        { value: c.pushEnabled },
                      ),
                    ],
                    submit: async (data) =>
                      execute({ action: "profile", data }),
                  })
                }
              >
                Editar mis datos
              </button>
              <button
                className="button"
                onClick={() =>
                  setDialog({
                    title: "Cambiar contraseña",
                    description:
                      "Confirmá tu contraseña actual y elegí la nueva. No se envía verificación por correo.",
                    fields: [
                      field(
                        "currentPassword",
                        "Contraseña actual",
                        "password",
                        { autoComplete: "current-password" },
                      ),
                      field("newPassword", "Nueva contraseña", "password", {
                        minLength: 8,
                        maxLength: 128,
                        autoComplete: "new-password",
                      }),
                      field(
                        "confirmPassword",
                        "Repetir nueva contraseña",
                        "password",
                        {
                          minLength: 8,
                          maxLength: 128,
                          autoComplete: "new-password",
                        },
                      ),
                    ],
                    submit: async (data) => {
                      if (demo)
                        throw new Error(
                          "El cambio de contraseña está disponible con una cuenta real.",
                        );
                      if (data.newPassword !== data.confirmPassword)
                        throw new Error("Las nuevas contraseñas no coinciden.");
                      if (String(data.newPassword).length < 8)
                        throw new Error("Usá al menos 8 caracteres.");
                      const user = auth?.currentUser;
                      if (!user?.email)
                        throw new Error("Volvé a iniciar sesión.");
                      try {
                        await reauthenticateWithCredential(
                          user,
                          EmailAuthProvider.credential(
                            user.email,
                            data.currentPassword,
                          ),
                        );
                        await updatePassword(user, data.newPassword);
                        setNotice("Contraseña actualizada.");
                      } catch {
                        throw new Error(
                          "No se pudo cambiar la contraseña. Revisá la contraseña actual e intentá nuevamente.",
                        );
                      }
                    },
                  })
                }
              >
                Cambiar contraseña
              </button>
            </div>
          </Section>
        )}
      </>
    );
  } else content = <Empty />;
  return (
    <div className={`app-shell ${customer ? "customer-shell" : ""}`}>
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/brand/logo.png" alt="LubriWorks by Brainworks" />
          <button
            className="icon-button mobile-only"
            aria-label="Cerrar menú"
            onClick={() => setMobile(false)}
          >
            <X />
          </button>
        </div>
        <div className="tenant-select">
          <Building2 size={18} />
          <select
            aria-label="Seleccionar empresa"
            value={access.tenant.id}
            onChange={(e) => {
              const a = accesses.find((a) => a.tenant.id === e.target.value);
              if (a) onSwitch(a);
            }}
          >
            {accesses.map((a) => (
              <option key={a.tenant.id} value={a.tenant.id}>
                {a.tenant.name}
              </option>
            ))}
          </select>
        </div>
        <span className="nav-label">
          {customer ? "MI PORTAL" : "ESPACIO DE TRABAJO"}
        </span>
        <nav>
          {items.map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
              {id === "orders" &&
                orders.filter((o) => o.status === "working").length > 0 && (
                  <b>{orders.filter((o) => o.status === "working").length}</b>
                )}
              {id === "notifications" &&
                s.notifications.some((n) => !n.read) && (
                  <b>{s.notifications.filter((n) => !n.read).length}</b>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {platform && (
            <button onClick={onPlatform}>
              <ShieldCheck size={18} /> Plataforma Brainworks
            </button>
          )}
          <div className="sidebar-signature">
            <span>Una solución de</span>
            <strong>
              brainworks<span>®</span>
            </strong>
          </div>
          <button onClick={onLogout}>
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {mobile && (
        <div className="sidebar-scrim" onClick={() => setMobile(false)} />
      )}
      <div className="main-wrap">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="Abrir menú"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </button>
            <span>{customer ? "Portal del cliente" : "Mi lubricentro"}</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            {!customer && (
              <select
                aria-label="Filtrar sucursal"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              >
                <option value="all">Todas las sucursales</option>
                {s.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            {customer && (
              <button
                className="icon-button"
                aria-label="Ver notificaciones"
                onClick={() => go("notifications")}
              >
                <Bell size={19} />
              </button>
            )}
            <span className="topbar-divider" />
            <div className="user-block">
              <div className="avatar">
                {access.member.name
                  .split(" ")
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <strong>{access.member.name}</strong>
                <small>{roleLabels[access.member.role]}</small>
              </div>
            </div>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <span className="demo-dot" /> DEMO INTERACTIVA · Datos de ejemplo,
              cambios temporales
            </span>
            <button onClick={onDemoRole}>
              {customer ? "Volver al lubricentro" : "Ver portal del cliente"}
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        <main className="content">
          {notice && (
            <div className="toast" role="status">
              <span>{notice}</span>
              <button
                aria-label="Cerrar aviso"
                className="icon-button"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {content}
          <footer className="page-footer">
            <span>
              LubriWorks <span>by Brainworks</span>
            </span>
            <span>Todo conectado. Todo cuidado.</span>
          </footer>
        </main>
      </div>
      {!dialog && !receipt && !mobile && (
        <LubriAssistant
          scope={customer ? "customer" : "staff"}
          context={tab}
          allowed={items.map(([id]) => id)}
          onNavigate={go}
        />
      )}
      {receipt && (
        <Receipt
          sale={receipt}
          company={access.tenant.name}
          client={clientName(receipt.customerId)}
          onClose={() => setReceipt(null)}
        />
      )}{" "}
      {dialog && (
        <FormDialog
          key={dialog.title}
          dialog={dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
function VehicleCard({
  v,
  owner,
  onEdit,
  onReading,
  onHistory,
  onAppointment,
}: {
  v: Vehicle;
  owner?: string;
  onEdit?: () => void;
  onReading: () => void;
  onHistory: () => void;
  onAppointment?: () => void;
}) {
  const usage = monthlyUsage(v);
  return (
    <article className="panel vehicle-card">
      <div className="vehicle-top">
        <i>
          <Car size={30} />
        </i>
        <strong className="license-plate">{v.plate}</strong>
      </div>
      <h2>
        {v.brand} {v.model}
      </h2>
      {owner && <p>{owner}</p>}
      <div className="vehicle-metrics">
        <div>
          <small>Última lectura real</small>
          <strong>
            {number(v.odometer)} <span>km</span>
          </strong>
          <small>{fmtDate(v.readingDate)}</small>
        </div>
        <div>
          <small>Uso promedio estimado</small>
          <strong>
            {number(usage.km)} <span>km/mes</span>
          </strong>
          <small>
            {usage.source === "visits"
              ? "Según lecturas recientes"
              : "Según antigüedad"}
          </small>
        </div>
      </div>
      <div className="estimated">
        <RefreshCw size={14} /> Hoy, aproximadamente {number(estimatedKm(v))} km
      </div>
      {(v.hasExtinguisher !== undefined || v.extinguisherDue || v.wantsExtinguisher) && (
        <p>
          {v.hasExtinguisher === false ? "Sin matafuegos" : v.extinguisherDue ? `Matafuegos: ${v.extinguisherDue < today() ? "vencido" : "vence"} el ${fmtDate(v.extinguisherDue)}` : "Matafuegos sin datos"}
          {v.wantsExtinguisher && " · Quiere comprar uno nuevo"}
        </p>
      )}
      <div className="vehicle-actions">
        <button className="text-button" onClick={onReading}>
          Actualizar km
        </button>
        <button className="text-button" onClick={onHistory}>
          Historial <ArrowUpRight size={14} />
        </button>
        {onEdit && (
          <button className="text-button" onClick={onEdit}>
            Editar
          </button>
        )}
      </div>
      {onAppointment && (
        <button className="button primary wide" onClick={onAppointment}>
          Solicitar turno
        </button>
      )}
    </article>
  );
}
