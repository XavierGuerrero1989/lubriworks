import { CustomerHistory } from "./CustomerHistory";
import { localDay } from "../../shared/dashboard";
import { CustomerAppointments } from "./CustomerAppointments";
import { CustomerHome } from "./CustomerHome";
import { AccessDesk } from "./AccessDesk";
import { SettingsDesk } from "./SettingsDesk";
import { ReportsDesk } from "./ReportsDesk";
import { ServiceDesk } from "./ServiceDesk";
import { serviceLabel } from "../../shared/services";
import { PurchaseDesk } from "./PurchaseDesk";
import { StockDesk } from "./StockDesk";
import { availableStock, reservedStock } from "../../shared/inventory";
import { BillingDialog, type Checkout } from "./BillingDialog";
import { SalesDesk } from "./SalesDesk";
import { CustomerDesk } from "./CustomerDesk";
import { OrderDesk } from "./OrderDesk";
import { orderTotal, workStage } from "../../shared/orders";
import { Agenda } from "./Agenda";
import { availability, availableTimes } from "../../shared/agenda";
import { OperationalDashboard } from "./OperationalDashboard";
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
  permissionLabels,
  permitted,
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
  ["vehicles", "Inicio / Mis vehículos", Car],
  ["appointments", "Mis turnos", CalendarDays],
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
    charge = permitted(access.member, "charge");
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [focusedOrder, setFocusedOrder] = useState("");
  const [focusedVehicle, setFocusedVehicle] = useState("");
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
    [subtab, setSubtab] = useState("");
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
  function newOrder(initial: Record<string, any> = {}) {
    setDialog({
      title: "Nueva orden y presupuesto",
      description:
        "Seleccioná uno o varios servicios. La orden queda pendiente de autorización antes de iniciar el trabajo.",
      fields: [
        field("vehicleId", "Vehículo", "text", {
          options: s.vehicles.map((v) => ({
            value: v.id,
            label: `${v.plate} · ${clientName(v.customerId)}`,
          })),
          value: initial.vehicleId,
        }),
        field("branchId", "Sucursal", "text", {
          options: opts("branches"),
          value: initial.branchId || defaultBranch,
        }),
        field("serviceIds", "Servicios incluidos", "choices", {
          options: s.services
            .filter((v) => v.active !== false)
            .map((v) => ({
              value: v.id,
              label: `${serviceLabel(v)}${v.branchId ? " · " + branchName(v.branchId) : ""}`,
            })),
          value: [],
          hint: "Elegí al menos un servicio; se sumarán mano de obra e insumos.",
        }),
        field("extraItems", "Otros insumos del presupuesto", "lines", {
          options: s.products.map((p) => ({
            value: p.id,
            label: `${p.name} · ${branchName(p.branchId)}`,
          })),
          value: [],
          required: false,
        }),
        field("odometer", "Kilometraje al ingresar", "number", {
          min: 0,
          step: "1",
          value: initial.odometer,
        }),
        field("technician", "Técnico responsable", "text", {
          suggestions: [
            ...new Set(s.branches.flatMap((b) => b.technicians ?? [])),
          ],
          value: initial.technician || "",
          required: false,
        }),
        field("checklist", "Controles de recepción", "textarea", {
          required: false,
          hint: "Separados por coma.",
        }),
        field("notes", "Observaciones internas", "textarea", {
          value: initial.notes || "",
          required: false,
          maxLength: 1000,
        }),
      ],
      preview: (values) => {
        const v = s.vehicles.find((r) => r.id === values.vehicleId);
        return v ? (
          <p className="agenda-availability">
            Última lectura registrada: {number(v.odometer)} km (
            {fmtDate(v.readingDate)}). Confirmá el kilometraje del tablero al
            ingresar.
          </p>
        ) : null;
      },
      submit: async (data) => {
        await execute({
          action: "order.create",
          ...data,
          checklist: String(data.checklist)
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          ...(initial.appointmentId
            ? { appointmentId: initial.appointmentId }
            : {}),
        });
        setFocusedOrder("");
        go("orders");
      },
    });
  }
  function edit(
    collection: Collection,
    record?: any,
    initial: Record<string, any> = {},
  ) {
    if (String(collection) === "orders") {
      if (!record) newOrder(initial);
      else {
        setFocusedOrder(record.id);
        go("orders");
      }
      return;
    }
    const d = { ...record, ...initial };
    let fields: Field[] = [];
    if (collection === "branches")
      fields = [
        field("name", "Nombre"),
        field("address", "Dirección", "text", { required: false }),
        field(
          "appointmentCapacity",
          "Puestos de atención simultánea",
          "number",
          {
            min: 1,
            max: 50,
            step: "1",
            value: 1,
            hint: "Cada puesto admite un turno a la vez. No se puede reducir si afecta turnos reservados.",
          },
        ),
      ];
    if (collection === "customers")
      fields = [
        field("name", "Nombre y apellido"),
        field("email", "Correo electrónico", "email", {
          readOnly: !!record,
          hint: record
            ? "Correo de su cuenta de acceso. Los cambios de cuenta se gestionan por separado."
            : undefined,
        }),
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
        field("oilSpecification", "Especificación del aceite", "text", {
          required: false,
          maxLength: 300,
          hint: "Registrá viscosidad y norma confirmadas para este motor; por ejemplo, SAE / ACEA / API.",
        }),
        field("oilCapacity", "Capacidad de aceite (litros)", "number", {
          required: false,
          omitWhenEmpty: true,
          min: 0,
          max: 100,
          step: "0.01",
          hint: "Capacidad confirmada para este vehículo. Dejá vacío si no se conoce.",
        }),
        field("compatibleFilters", "Filtros compatibles", "textarea", {
          required: false,
          maxLength: 1000,
          hint: "Códigos de filtros de aceite, aire, combustible o habitáculo confirmados.",
        }),
        field("technicalNotes", "Observaciones técnicas internas", "textarea", {
          required: false,
          maxLength: 1000,
          hint: "Uso exclusivo del personal; las recomendaciones para compartir se cargan en la ficha.",
        }),
        field("odometer", "Kilometraje real", "number", {
          step: "1",
          min: record?.odometer ?? 0,
          hint: record
            ? "Para corregir una lectura equivocada, usá Corregir kilometraje en la ficha."
            : undefined,
        }),
        field("readingDate", "Fecha de lectura", "date", { value: today() }),
        field("hasExtinguisher", "¿Tiene matafuegos?", "text", {
          options: [
            { value: "yes", label: "Sí" },
            { value: "no", label: "No" },
          ],
          value:
            d.hasExtinguisher === true || d.extinguisherDue
              ? "yes"
              : d.hasExtinguisher === false
                ? "no"
                : "",
        }),
        field("extinguisherDue", "Vencimiento del matafuegos", "date", {
          showWhen: { key: "hasExtinguisher", value: "yes" },
          hint: "Podés cargar una fecha pasada si está vencido.",
        }),
        field(
          "wantsExtinguisher",
          "Quiere comprar un matafuegos nuevo",
          "checkbox",
          {
            required: false,
            hint: "Queda registrado en la ficha para ofrecerle uno nuevo.",
          },
        ),
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
        field("minStock", "Stock mínimo disponible", "number", {
          hint: "La alerta compara el mínimo con el físico menos las reservas.",
        }),
        field("location", "Ubicación", "text", {
          required: false,
          maxLength: 120,
          hint: "Estante, depósito o tanque dentro de esta sucursal.",
        }),
        field("compatibility", "Compatibilidades confirmadas", "textarea", {
          required: false,
          maxLength: 1000,
          hint: "Vehículos, motores o referencias compatibles, según documentación técnica.",
        }),
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
        field("variant", "Variante", "text", {
          required: false,
          maxLength: 80,
          hint: "Por ejemplo: sintético, semisintético o motor diésel.",
        }),
        field("category", "Categoría", "text", {
          required: false,
          maxLength: 80,
        }),
        field("branchId", "Sucursal del servicio", "text", {
          required: false,
          options: [
            { value: "", label: "Todas (sólo servicios sin insumos)" },
            ...opts("branches"),
          ],
          value: defaultBranch,
        }),
        field("description", "Descripción / alcance", "textarea", {
          required: false,
          maxLength: 1000,
        }),
        field("durationMinutes", "Duración estimada (minutos)", "number", {
          required: false,
          omitWhenEmpty: true,
          min: 5,
          max: 720,
          step: "1",
          hint: "Referencia para planificar turnos; no cambia su duración automáticamente.",
        }),
        field("active", "Disponible para nuevos presupuestos", "checkbox", {
          required: false,
          value: true,
        }),
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
        field("durationMinutes", "Duración prevista (minutos)", "number", {
          min: 5,
          max: 720,
          step: "1",
          value: 60,
        }),
        field("technician", "Técnico responsable", "text", {
          suggestions: [
            ...new Set(s.branches.flatMap((b) => b.technicians ?? [])),
          ],
          required: false,
          hint: "Usá siempre el mismo nombre para controlar sus superposiciones entre sucursales.",
        }),
        field("station", "Número de puesto", "number", {
          min: 0,
          max: 50,
          step: "1",
          value: 0,
          hint: "0 = por asignar. Usá 1, 2, etc., según la capacidad de la sucursal.",
        }),
        field("status", "Estado", "text", {
          value: "confirmed",
          options: [
            { value: "requested", label: "Solicitado" },
            { value: "confirmed", label: "Confirmado" },
            { value: "completed", label: "Completado" },
            { value: "cancelled", label: "Cancelado" },
            { value: "no_show", label: "Ausente" },
          ],
        }),
        field("statusReason", "Motivo de cancelación / ausencia", "textarea", {
          showWhen: { key: "status", value: ["cancelled", "no_show"] },
        }),
        ...(record
          ? [
              field(
                "rescheduleReason",
                "Motivo de reprogramación",
                "textarea",
                {
                  required: false,
                  hint: "Obligatorio si cambiás la fecha, hora o sucursal. Queda en el historial.",
                },
              ),
            ]
          : []),
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
        field("technician", "Técnico responsable", "text", {
          suggestions: [
            ...new Set(s.branches.flatMap((b) => b.technicians ?? [])),
          ],
          required: false,
        }),
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
        field("expectedDate", "Entrega prevista", "date", { required: false }),
        field("reference", "Referencia / pedido", "text", {
          required: false,
          maxLength: 200,
        }),
        field("notes", "Observaciones de compra", "textarea", {
          required: false,
          maxLength: 1000,
        }),
        field("items", "Productos · cantidad · costo unitario", "lines", {
          options: opts("products"),
          value: [],
          hint: "purchase",
        }),
      ];
    fields = fields.map((f) => ({
      ...f,
      value:
        f.key === "checklist" || f.key === "hasExtinguisher"
          ? f.value
          : (d[f.key] ?? f.value),
    }));
    setDialog({
      title: `${record ? "Editar" : "Nuevo registro"} · ${{ branches: "Sucursal", customers: "Cliente", vehicles: "Vehículo", products: "Producto", suppliers: "Proveedor", services: "Servicio", appointments: "Turno", orders: "Orden de servicio", purchases: "Compra" }[collection]}`,
      fields,
      preview:
        collection === "appointments"
          ? (values) => {
              if (
                !values.date ||
                !values.time ||
                !values.branchId ||
                !values.vehicleId
              )
                return (
                  <div className="agenda-availability">
                    Elegí vehículo, fecha, horario y sucursal para ver la
                    disponibilidad.
                  </div>
                );
              const b = s.branches.find((r) => r.id === values.branchId);
              if (!b) return null;
              const candidate = {
                ...d,
                ...values,
                id: record?.id || "preview",
                durationMinutes: Number(values.durationMinutes || 60),
                station: Number(values.station || 0),
                technician: values.technician || "",
              } as State["appointments"][number];
              if (
                !Number.isInteger(candidate.durationMinutes) ||
                candidate.durationMinutes! < 5 ||
                candidate.durationMinutes! > 720 ||
                !Number.isInteger(candidate.station)
              )
                return (
                  <div className="agenda-availability">
                    Revisá la duración y el número de puesto.
                  </div>
                );
              const conflict = availability(candidate, s.appointments, b);
              const slots = availableTimes(
                { ...candidate, status: "confirmed" },
                s.appointments,
                b,
              );
              return (
                <div className="agenda-availability">
                  <strong>Disponibilidad prevista</strong>
                  <p className={conflict ? "conflict" : ""}>
                    {conflict ||
                      (candidate.status === "cancelled" ||
                      candidate.status === "no_show"
                        ? "Este estado libera la reserva del turno."
                        : "El horario tiene capacidad para este turno.")}
                  </p>
                  {conflict && (
                    <p>
                      Alternativas desde ese horario:{" "}
                      {slots.length
                        ? slots.join(" · ")
                        : "No hay horarios disponibles para esa duración en el resto del día."}
                    </p>
                  )}
                  <small>
                    La disponibilidad se vuelve a comprobar al guardar. Confirmá
                    también que el horario coincida con la atención del local.
                  </small>
                </div>
              );
            }
          : undefined,
      description:
        collection === "customers" && !record
          ? "Al guardar se crea su cuenta de acceso con este correo y contraseña, sin verificación de correo."
          : undefined,
      submit: async (values) => {
        let data = { ...d, ...values };
        delete data.id;
        delete data.password;
        if (collection === "vehicles") {
          data.oilCapacity = values.oilCapacity ?? null;
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
  const chargeOrder = (id: string) => setCheckout({ orderId: id });
  const receiveAppointment = (appointment: State["appointments"][number]) => {
    const vehicle = s.vehicles.find((v) => v.id === appointment.vehicleId);
    edit("orders", undefined, {
      appointmentId: appointment.id,
      vehicleId: appointment.vehicleId,
      branchId: appointment.branchId,
      technician: appointment.technician,
      odometer: vehicle?.odometer,
      notes: appointment.reason,
    });
  };
  const requestAppointment = (vehicleId?: string) =>
    setDialog({
      title: "Solicitar un turno",
      description:
        "Elegí vehículo, sucursal y horario preferidos. La solicitud debe respetar los horarios de atención y queda pendiente de confirmación por el lubricentro.",
      fields: [
        field("vehicleId", "Vehículo", "text", {
          options: opts("vehicles", "plate"),
          value: vehicleId,
        }),
        field("branchId", "Sucursal", "text", {
          options: opts("branches"),
          value: s.branches[0]?.id,
        }),
        field("date", "Fecha preferida", "date", {
          value: localDay(new Date().toISOString()),
        }),
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
                <td className="numeric">{money(orderTotal(o))}</td>
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
              orders.filter((o) =>
                ["received", "working", "waiting"].includes(workStage(o)),
              ).length
            }
            detail={`${orders.filter((o) => !o.deliveredAt && (o.status === "ready" || (o.status === "paid" && (o.receivedAt || o.finishedAt || o.date === today())))).length} listos o pendientes de entrega`}
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
        <OperationalDashboard
          state={s}
          access={access}
          branch={branch}
          onReceive={receiveAppointment}
          onManageAppointment={(appointment) =>
            edit("appointments", appointment)
          }
          onEdit={(order) => edit("orders", order)}
          onStart={(id) =>
            action(
              "Comenzar atención",
              { action: "startOrder", id },
              "Se registrará la hora de inicio del trabajo.",
            )
          }
          onFinish={(id) => {
            const o = s.orders.find((v) => v.id === id);
            if (!o?.consumptionConfirmed) {
              setFocusedOrder(id);
              go("orders");
            } else
              action(
                "Finalizar servicio",
                { action: "finishOrder", id },
                "Se descontarán los consumos reales confirmados y se generarán los próximos mantenimientos.",
              );
          }}
          onCharge={chargeOrder}
          onDeliver={(id) =>
            action(
              "Entregar vehículo",
              { action: "deliverOrder", id },
              "La orden debe estar cobrada. Se registrará quién entrega y a qué hora; el turno vinculado quedará completado.",
            )
          }
          onView={(order) => {
            setFocusedOrder(order.id);
            go("orders");
          }}
        />
        <div className="dashboard-bottom">
          <Section
            title="Atención a estos productos"
            subtitle="Disponible en el mínimo o por debajo"
            action={
              <LinkButton onClick={() => go("products")}>Ver stock</LinkButton>
            }
          >
            {scoped(s.products).filter(
              (p) => availableStock(s, p) <= p.minStock,
            ).length ? (
              scoped(s.products)
                .filter((p) => availableStock(s, p) <= p.minStock)
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
                      {number(availableStock(s, p))}{" "}
                      {p.unit === "litro" ? "L" : "u."}
                    </Badge>
                  </div>
                ))
            ) : (
              <div className="all-good">
                <CheckCircle2 /> El disponible está por encima de los mínimos.
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
      <CustomerDesk
        state={s}
        access={access}
        run={execute}
        focusVehicleId={focusedVehicle}
        onSelection={setFocusedVehicle}
        onNewCustomer={() => edit("customers")}
        onCustomer={(c) => edit("customers", c)}
        onVehicle={(v, customerId) =>
          edit("vehicles", v, customerId ? { customerId } : {})
        }
        onReading={readKm}
        onOrder={(o) => {
          setBranch("all");
          setFocusedOrder(o.id);
          setFocusedVehicle(o.vehicleId);
          go("orders");
        }}
        onNewOrder={(v) => newOrder({ vehicleId: v.id, odometer: v.odometer })}
        onAppointment={(v) =>
          edit("appointments", undefined, { vehicleId: v.id })
        }
        onAgenda={() => go("appointments")}
      />
    );
  else if (tab === "orders" && !customer)
    content = (
      <OrderDesk
        key={access.tenant.id}
        state={s}
        access={access}
        branch={branch}
        focusId={focusedOrder}
        run={execute}
        onNew={() => newOrder()}
        onInventory={() => go("products")}
        onVehicle={(id) => {
          setFocusedVehicle(id);
          go("customers");
        }}
        onCharge={chargeOrder}
        onReceipt={(o) => setReceipt(s.sales.find((v) => v.orderId === o.id)!)}
        onRefresh={onRefresh}
        demo={demo}
      />
    );
  else if (customer && tab === "history")
    content = (
      <CustomerHistory
        state={s}
        access={access}
        search={search}
        onSearch={setSearch}
        onRefresh={onRefresh}
        onReceipt={setReceipt}
        onVisit={() => go("vehicles")}
        onMaintenance={() => go("reminders")}
      />
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
    content = customer ? (
      <CustomerAppointments
        state={s}
        access={access}
        run={execute}
        onRefresh={onRefresh}
        onNew={() => requestAppointment()}
        onVisit={() => go("vehicles")}
      />
    ) : (
      <Agenda
        state={s}
        branch={branch}
        manager={manager}
        onNew={(date) => edit("appointments", undefined, { date })}
        onEdit={(a, initial) => edit("appointments", a, initial)}
        onReceive={receiveAppointment}
        onCapacity={(b) => edit("branches", b)}
      />
    );
  else if (tab === "products")
    content = (
      <StockDesk
        s={s}
        branch={branch}
        manager={manager}
        onEdit={(p) => edit("products", p)}
        onAdjust={(p) =>
          setDialog({
            title: `Ajustar stock · ${p.name}`,
            description: `Físico ${p.stock}; reservado ${reservedStock(s, p.id)}. Registrá la diferencia real de inventario. Un ajuste puede revelar faltantes de las reservas, que quedarán señalados.`,
            fields: [
              field("quantity", "Variación de stock", "number", {
                min: -p.stock,
                step: p.unit === "unidad" ? "1" : "0.01",
                hint: "Positivo para agregar; negativo para descontar.",
              }),
              field("reason", "Motivo del ajuste", "textarea", {
                minLength: 5,
                maxLength: 200,
              }),
            ],
            submit: async (data) =>
              execute({ action: "adjustStock", id: p.id, ...data }),
          })
        }
        onOrder={(id) => {
          setFocusedOrder(id);
          setBranch("all");
          go("orders");
        }}
        onPurchase={() => go("purchases")}
      />
    );
  else if (tab === "services")
    content = (
      <ServiceDesk
        s={s}
        branch={branch}
        manager={manager}
        onEdit={(v) => edit("services", v)}
        onDuplicate={(v) =>
          edit("services", undefined, {
            ...v,
            variant: "Nueva variante",
            active: true,
          })
        }
        onToggle={(v) =>
          execute({
            action: "save",
            collection: "services",
            id: v.id,
            data: { ...v, active: v.active === false },
          })
        }
      />
    );
  else if (tab === "purchases")
    content = (
      <PurchaseDesk
        s={s}
        branch={branch}
        run={execute}
        onEdit={(p) => edit("purchases", p)}
        onSupplier={(p) => edit("suppliers", p)}
        onNew={(initial) => edit("purchases", undefined, initial)}
      />
    );
  else if (tab === "sales") {
    content = (
      <SalesDesk
        s={s}
        branch={branch}
        manager={permitted(access.member, "discounts")}
        execute={execute}
        onCharge={chargeOrder}
        onSalePay={(saleId) => setCheckout({ saleId })}
        onNewSale={() => setCheckout({ branchId: defaultBranch })}
        onReceipt={setReceipt}
        onOrder={(id) => {
          setFocusedOrder(id);
          setBranch("all");
          go("orders");
        }}
      />
    );
  } else if (tab === "reports") {
    content = (
      <ReportsDesk
        s={s}
        branch={branch}
        onReceipt={setReceipt}
        onOrder={(id) => {
          setFocusedOrder(id);
          setBranch("all");
          go("orders");
        }}
      />
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
        <SettingsDesk
          state={s}
          run={execute}
          newBranch={() => edit("branches")}
        />
        <AccessDesk access={access} state={s} demo={demo} />
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
      <CustomerHome
        state={s}
        access={access}
        run={execute}
        onRefresh={onRefresh}
        onReading={readKm}
        onAppointment={requestAppointment}
        onHistory={(v) => {
          go("history");
          setSearch(v.plate);
        }}
        onMaintenance={() => go("reminders")}
      />
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
        branch={branch}
        onVisit={(order) => go(order ? "vehicles" : "appointments")}
        onOrder={(id) => {
          setFocusedOrder(id);
          setBranch("all");
          go("orders");
        }}
        onAgenda={() => go("appointments")}
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
      {!dialog && !receipt && !checkout && !mobile && (
        <LubriAssistant
          scope={customer ? "customer" : "staff"}
          context={tab}
          allowed={items.map(([id]) => id)}
          onNavigate={go}
        />
      )}
      {receipt && (
        <Receipt
          sale={s.sales.find((v) => v.id === receipt.id) ?? receipt}
          state={s}
          vehicle={
            s.vehicles.find((v) => v.id === receipt.vehicleId)?.plate ?? ""
          }
          company={access.tenant.name}
          client={clientName(receipt.customerId)}
          onClose={() => setReceipt(null)}
        />
      )}{" "}
      {checkout && (
        <BillingDialog
          key={JSON.stringify(checkout)}
          target={checkout}
          s={s}
          manager={permitted(access.member, "discounts")}
          execute={execute}
          onClose={() => setCheckout(null)}
        />
      )}
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
      {(v.hasExtinguisher !== undefined ||
        v.extinguisherDue ||
        v.wantsExtinguisher) && (
        <p>
          {v.hasExtinguisher === false
            ? "Sin matafuegos"
            : v.extinguisherDue
              ? `Matafuegos: ${v.extinguisherDue < today() ? "vencido" : "vence"} el ${fmtDate(v.extinguisherDue)}`
              : "Matafuegos sin datos"}
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
