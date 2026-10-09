import { visitObsolete, visitLabels } from "../../shared/visitNotices";
import { reportDay } from "../../shared/reports";
import "./notifications.css";
import { useEffect, useState, useRef } from "react";
import { Bell, RefreshCw } from "lucide-react";
import { rpc } from "../lib/api";
import { enablePush } from "../lib/push";
import {
  defaultNotificationSettings,
  reminderStage,
  renderNotice,
  type NotificationSettings,
} from "../../shared/notifications";
import { today, type Access, type State } from "../../shared/model";
import { Section, Empty, Stat, fmtDate, exportCsv } from "./ui";
type Overview = {
  settings?: NotificationSettings;
  pushConfigured?: boolean;
  scheduler?: { lastRunAt: string | null; completed: boolean | null };
  preferences?: {
    pushEnabled: boolean;
    maintenance: boolean;
    extinguisher: boolean;
    messages: boolean;
    visit: boolean;
  };
  devices: {
    id: string;
    customerId: string;
    label: string;
    updatedAt: string;
  }[];
  deliveries: {
    id: string;
    noticeId?: string;
    customerId?: string;
    status: string;
    attempts: number;
    sentAt?: string;
    updatedAt?: string;
    statusCode?: number;
    nextAttemptAt?: number;
    leaseUntil?: number;
  }[];
};
export function Notifications({
  access,
  state: s,
  demo,
  vapid,
  onRead,
  onAppointment,
  onReading,
  onRefresh,
  branch = "all",
  onOrder,
  onAgenda,
  onVisit,
}: {
  access: Access;
  state: State;
  demo: boolean;
  vapid: string;
  onRead: (id: string) => void;
  onAppointment: (id?: string) => void;
  onReading: (id: string) => void;
  onRefresh: () => Promise<void>;
  branch?: string;
  onOrder?: (id: string) => void;
  onAgenda?: () => void;
  onVisit?: (order: boolean) => void;
}) {
  const pending = useRef(new Map<string, string>());
  const customer = access.member.role === "customer";
  const [tab, setTab] = useState(customer ? "Bandeja" : "Resumen"),
    [overview, setOverview] = useState<Overview>({
      devices: [],
      deliveries: [],
    }),
    [settings, setSettings] = useState(defaultNotificationSettings),
    [prefs, setPrefs] = useState({
      pushEnabled: s.customers[0]?.pushEnabled === true,
      maintenance: true,
      extinguisher: true,
      messages: true,
      visit: true,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState({
      customerId: "",
      vehicleId: "",
      title: "",
      body: "",
    }),
    [filter, setFilter] = useState(""),
    [status, setStatus] = useState("all"),
    [category, setCategory] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  async function load() {
    if (demo) {
      setError(
        "Vista de demostración local: los envíos y la configuración se guardan al ingresar a una empresa real.",
      );
      return;
    }
    try {
      const data = await rpc<Overview>(
        "notifications.overview",
        {},
        access.tenant.id,
      );
      setOverview({
        ...data,
        devices: data.devices || [],
        deliveries: data.deliveries || [],
      });
      if (data.settings) setSettings(data.settings);
      if (data.preferences) setPrefs(data.preferences);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [access.tenant.id, access.member.uid]);
  async function save(action: string, payload: Record<string, unknown>) {
    if (demo) {
      setError("Ingresá a una empresa real para guardar o enviar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const requestKey = JSON.stringify({ action, payload });
      const op = pending.current.get(requestKey) || crypto.randomUUID();
      pending.current.set(requestKey, op);
      await rpc(action, payload, access.tenant.id, undefined, op);
      await load();
      await onRefresh();
      pending.current.delete(requestKey);
      setError(
        action === "notifications.send"
          ? "Mensaje creado en el portal. Se intentó el push; consultá su estado en Historial."
          : "Cambios guardados.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendMessage() {
    if (!message.title.trim() || !message.body.trim() || !message.customerId) {
      setError("Elegí un cliente y completá título y mensaje antes de enviar.");
      return;
    }
    if (message.customerId !== "all")
      return save("notifications.send", message);
    if (demo) {
      setError("Ingresá a una empresa real para enviar.");
      return;
    }
    setBusy(true);
    let sent = 0;
    try {
      for (const c of s.customers) {
        const payload = { ...message, customerId: c.id, vehicleId: "" };
        const requestKey = JSON.stringify(payload);
        const op = pending.current.get(requestKey) || crypto.randomUUID();
        pending.current.set(requestKey, op);
        await rpc(
          "notifications.send",
          payload,
          access.tenant.id,
          undefined,
          op,
        );

        sent++;
      }
      await onRefresh();
      await load();
      for (const c of s.customers)
        pending.current.delete(
          JSON.stringify({ ...message, customerId: c.id, vehicleId: "" }),
        );
      setError(
        `${sent} mensajes creados en el portal. Se intentó el push; consultá su estado en Historial.`,
      );
    } catch (e) {
      setError(`${sent} mensajes creados. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }
  const upcoming = s.reminders
    .filter((r) => r.status === "active")
    .map((r) => ({ r, v: s.vehicles.find((v) => v.id === r.vehicleId) }))
    .filter((x) => x.v)
    .map(({ r, v }) => ({
      r,
      v: v!,
      info: reminderStage(r, v!, settings),
      appointment: s.appointments.some(
        (a) =>
          a.vehicleId === r.vehicleId &&
          ["requested", "confirmed"].includes(a.status) &&
          a.date >= today(),
      ),
    }));
  const notices = s.notifications
    .filter(
      (n) =>
        (customer || branch === "all" || n.branchId === branch) &&
        (tab !== "Visitas" || n.origin === "operational") &&
        (category === "all" ||
          (category === "visit"
            ? n.origin === "operational"
            : n.category === category ||
              (category === "maintenance" && !n.category && !!n.reminderId))) &&
        (!from || reportDay(n.date) >= from) &&
        (!to || reportDay(n.date) <= to) &&
        (!filter ||
          `${n.title} ${n.body} ${s.customers.find((c) => c.id === n.customerId)?.name || ""} ${s.vehicles.find((v) => v.id === n.vehicleId)?.plate || ""}`
            .toLowerCase()
            .includes(filter.toLowerCase())) &&
        (status === "all" ||
          (status === "read"
            ? n.read
            : status === "unread"
              ? !n.read
              : n.pushStatus === status ||
                overview.deliveries.some(
                  (d) => d.noticeId === n.id && d.status === status,
                ))),
    )
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
  const check = (
    label: string,
    value: boolean,
    change: (v: boolean) => void,
  ) => (
    <label style={{ display: "block", margin: "12px 0" }}>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => change(e.target.checked)}
      />{" "}
      {label}
    </label>
  );
  const button = (text: string, fn: () => void) => (
    <button className="button" disabled={busy} onClick={fn}>
      {text}
    </button>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Notificaciones</h1>
          <p>
            {customer
              ? "Tus avisos, preferencias y dispositivos."
              : "Avisos de la visita, recordatorios y seguimiento por cliente."}
          </p>
        </div>
        {button("Actualizar", async () => {
          setBusy(true);
          try {
            await onRefresh();
            await load();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        })}
      </div>
      <div className="notification-tabs">
        {(customer
          ? ["Bandeja", "Preferencias", "Dispositivos"]
          : [
              "Resumen",
              "Visitas",
              "Reglas automáticas",
              "Mensajes",
              "Historial",
              "Preferencias",
            ]
        ).map((t) => (
          <button
            key={t}
            className={`button ${tab === t ? "primary" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p className="info-box" role="status">
          {error}
        </p>
      )}
      {!customer && (
        <p className="info-box">
          Visitas y mensajes: intento de push al ocurrir el cambio.
          Mantenimiento y reintentos automáticos: revisión diaria a las 09:00 de
          Argentina.{" "}
          {demo
            ? "Demo: no se envían push reales."
            : overview.pushConfigured === false
              ? "Push sin configurar: los avisos quedan en el portal."
              : "El envío requiere permiso, preferencias y un dispositivo con acceso activo."}
          {overview.scheduler?.lastRunAt && (
            <>
              {" "}
              Última ejecución global: {fmtDate(
                overview.scheduler.lastRunAt,
              )} ·{" "}
              {overview.scheduler.completed
                ? "recorrido completo"
                : "recorrido pendiente de continuar"}
              .
            </>
          )}
        </p>
      )}
      {tab === "Resumen" && (
        <>
          <div className="stats">
            <Stat
              label="Próximos avisos"
              value={
                upcoming.filter(
                  (x) =>
                    x.info.soon &&
                    !(settings.pauseWithAppointment && x.appointment),
                ).length
              }
              detail="Mantenimientos activos que requieren aviso"
              icon={<Bell />}
            />
            <Stat
              label="Avisos en portal"
              value={s.notifications.length}
              detail="Historial de la empresa"
              icon={<Bell />}
            />
            <Stat
              label="Clientes con dispositivo"
              value={new Set(overview.devices.map((d) => d.customerId)).size}
              detail="Registro de push; no garantiza permiso vigente"
              icon={<Bell />}
            />
            <Stat
              label="Fallos de envío"
              value={
                overview.deliveries.filter((d) =>
                  ["pending", "permanent-failure"].includes(d.status),
                ).length
              }
              detail="Intentos pendientes o dispositivos vencidos"
              icon={<RefreshCw />}
            />
          </div>
          <Section
            title="Próximos mantenimientos"
            subtitle="De toda la empresa; los mantenimientos no tienen una sucursal asignada."
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente / vehículo</th>
                    <th>Mantenimiento</th>
                    <th>Fecha / km</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map(({ r, v, info, appointment }) => (
                    <tr key={r.id}>
                      <td>
                        {s.customers.find((c) => c.id === r.customerId)?.name}
                        <br />
                        {v.plate}
                      </td>
                      <td>{r.title}</td>
                      <td>
                        {fmtDate(info.effective)} ·{" "}
                        {r.dueKm === null ? "Por fecha" : `${r.dueKm} km`}
                      </td>
                      <td>
                        {settings.pauseWithAppointment && appointment
                          ? "Pausado: tiene turno"
                          : !info.soon
                            ? "Programado"
                            : info.overdue
                              ? "Vencido"
                              : "Se aproxima"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!upcoming.length && <Empty text="Sin mantenimientos activos." />}
          </Section>
        </>
      )}
      {tab === "Reglas automáticas" && (
        <Section
          title="Cuándo enviar recordatorios"
          subtitle="Se considera lo que ocurra primero: fecha o kilometraje estimado."
        >
          <div className="notification-form">
            {check(
              "Intentar push inmediato de avisos de la visita",
              settings.visitEnabled,
              (v) => setSettings({ ...settings, visitEnabled: v }),
            )}
            <p className="notice-caption">
              Turno confirmado, reprogramado o cancelado; presupuesto y
              adicional pendiente; vehículo listo. Los avisos se guardan en el
              portal aunque desactives su push. Las decisiones de presupuesto se
              registran por el personal; no se aprueban desde esta bandeja.
            </p>
            {check("Activar recordatorios automáticos", settings.enabled, (v) =>
              setSettings({ ...settings, enabled: v }),
            )}
            {check("Mantenimiento y servicios", settings.maintenance, (v) =>
              setSettings({ ...settings, maintenance: v }),
            )}
            {check("Vencimiento del matafuegos", settings.extinguisher, (v) =>
              setSettings({ ...settings, extinguisher: v }),
            )}
            {(
              [
                ["daysBefore", "Días de anticipación", 365],
                ["kmBefore", "Kilómetros de anticipación", 20000],
                ["repeatDays", "Días entre repeticiones de vencidos", 90],
                ["repeats", "Repeticiones después del primer aviso vencido", 4],
              ] as const
            ).map(([k, label, max]) => (
              <label key={k}>
                {label}
                <input
                  type="number"
                  min={k === "repeatDays" ? 1 : 0}
                  max={max}
                  value={settings[k]}
                  onChange={(e) =>
                    setSettings({ ...settings, [k]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
            {check(
              "Pausar avisos si el vehículo tiene un turno pendiente",
              settings.pauseWithAppointment,
              (v) => setSettings({ ...settings, pauseWithAppointment: v }),
            )}
            <p>
              Revisión diaria a las 09:00 (Argentina). Al registrar el nuevo
              servicio, se cancela el mantenimiento anterior del mismo servicio.
            </p>
            {button(
              "Guardar reglas",
              () => void save("notifications.settings", settings),
            )}
          </div>
        </Section>
      )}
      {tab === "Mensajes" && (
        <>
          <Section
            title="Plantilla automática"
            subtitle="Variables disponibles: {mantenimiento} y {estado}."
          >
            <div className="notification-form">
              <label>
                Título
                <input
                  maxLength={120}
                  value={settings.title}
                  onChange={(e) =>
                    setSettings({ ...settings, title: e.target.value })
                  }
                />
              </label>
              <label>
                Texto
                <textarea
                  maxLength={1000}
                  value={settings.template}
                  onChange={(e) =>
                    setSettings({ ...settings, template: e.target.value })
                  }
                />
              </label>
              <p className="info-box">
                Vista previa:{" "}
                {renderNotice(settings, "Cambio de aceite", false)}
              </p>
              {button(
                "Guardar plantilla",
                () => void save("notifications.settings", settings),
              )}
            </div>
          </Section>
          <Section
            title="Mensaje a un cliente"
            subtitle="Se guarda en su portal. Se intenta push al enviar, respetando sus preferencias. Los fallos quedan para reintento."
          >
            <div className="notification-form">
              <label>
                Cliente
                <select
                  value={message.customerId}
                  onChange={(e) =>
                    setMessage({
                      ...message,
                      customerId: e.target.value,
                      vehicleId: "",
                    })
                  }
                >
                  <option value="">Elegir cliente</option>
                  <option value="all">
                    Todos los clientes ({s.customers.length})
                  </option>
                  {s.customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Vehículo (opcional)
                <select
                  value={message.vehicleId}
                  onChange={(e) =>
                    setMessage({ ...message, vehicleId: e.target.value })
                  }
                >
                  <option value="">Mensaje general</option>
                  {s.vehicles
                    .filter((v) => v.customerId === message.customerId)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Título
                <input
                  maxLength={120}
                  value={message.title}
                  onChange={(e) =>
                    setMessage({ ...message, title: e.target.value })
                  }
                />
              </label>
              <label>
                Mensaje
                <textarea
                  maxLength={1000}
                  value={message.body}
                  onChange={(e) =>
                    setMessage({ ...message, body: e.target.value })
                  }
                />
              </label>
              <p className="info-box">
                <strong>{message.title || "Vista previa"}</strong>
                <br />
                {message.body ||
                  "Escribí el mensaje para revisarlo antes de enviar."}
              </p>
              {button(
                message.customerId === "all"
                  ? `Enviar a ${s.customers.length} clientes`
                  : "Enviar mensaje",
                () => void sendMessage(),
              )}
            </div>
          </Section>
        </>
      )}
      {(tab === "Historial" || tab === "Bandeja" || tab === "Visitas") && (
        <Section
          title={
            customer
              ? "Tu bandeja"
              : tab === "Visitas"
                ? "Avisos operativos de la visita"
                : "Historial de avisos"
          }
          action={
            !customer ? (
              <button
                className="button secondary small"
                disabled={!!from && !!to && from > to}
                onClick={() =>
                  exportCsv(
                    "notificaciones",
                    notices.map((n) => ({
                      Fecha: n.date,
                      Cliente:
                        s.customers.find((c) => c.id === n.customerId)?.name ||
                        n.customerId,
                      Patente:
                        s.vehicles.find((v) => v.id === n.vehicleId)?.plate ||
                        "",
                      Sucursal:
                        s.branches.find((b) => b.id === n.branchId)?.name ||
                        "Sin sucursal registrada",
                      Categoria: n.category || "Anterior",
                      Evento: n.event
                        ? visitLabels[n.event]
                        : n.origin || "Anterior",
                      Titulo: n.title,
                      Mensaje: n.body,
                      LeidoEnPortal: n.read,
                      EstadoPush: n.pushStatus || "Sin registro",
                      Motivo: n.pushReason || "",
                      SituacionActual: visitObsolete(n, s),
                      Intentos: overview.deliveries
                        .filter((d) => d.noticeId === n.id)
                        .reduce((sum, d) => sum + d.attempts, 0),
                    })),
                  )
                }
              >
                Exportar historial
              </button>
            ) : undefined
          }
        >
          {!customer && (
            <div className="notice-filters">
              <label>
                Desde
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              <label>
                Categoría
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="all">Todas</option>
                  <option value="visit">Visita</option>
                  <option value="maintenance">Mantenimiento</option>
                  <option value="extinguisher">Matafuegos</option>
                  <option value="messages">Mensaje manual</option>
                </select>
              </label>
              <button
                className="button secondary small"
                onClick={() => {
                  setFrom("");
                  setTo("");
                  setCategory("all");
                  setStatus("all");
                  setFilter("");
                }}
              >
                Limpiar filtros
              </button>
            </div>
          )}
          {!customer && branch !== "all" && (
            <p className="notice-caption">
              Filtrando avisos con esta sucursal registrada. Los avisos
              anteriores, manuales y de mantenimiento sin sucursal se consultan
              en Todas las sucursales.
            </p>
          )}
          {from && to && from > to && (
            <p role="alert">Desde debe ser anterior o igual a Hasta.</p>
          )}
          <div className="notification-tabs notice-controls">
            <input
              placeholder="Buscar aviso, cliente o patente"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <select
              aria-label="Estado del aviso"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="read">Leídos en portal</option>
              <option value="unread">Sin leer</option>
              {!customer && (
                <>
                  <option value="sent">Push enviado</option>
                  <option value="pending">Fallos temporales</option>
                  <option value="permanent-failure">Dispositivo vencido</option>
                  <option value="exhausted">Intentos agotados</option>
                  <option value="skipped">Sin push / preferencias</option>
                  <option value="superseded">Situación resuelta</option>
                  <option value="failed">Fallos definitivos</option>
                </>
              )}
            </select>
          </div>
          <div className="notification-list">
            {notices.map((n) => (
              <article className={n.read ? "" : "unread"} key={n.id}>
                <i>
                  <Bell size={20} />
                </i>
                <div>
                  <h3>{n.title}</h3>
                  {n.origin === "operational" && (
                    <small>
                      Aviso de visita ·{" "}
                      {n.event ? visitLabels[n.event] : "Operativo"}
                    </small>
                  )}
                  <p>{n.body}</p>
                  <small>
                    {fmtDate(n.date)} ·{" "}
                    {n.read ? "Leído en portal" : "Sin leer"}
                    {!customer &&
                      ` · ${s.customers.find((c) => c.id === n.customerId)?.name || "Cliente"}`}
                  </small>
                  {n.origin === "operational" && (
                    <p className="notice-caption">
                      {visitObsolete(n, s)
                        ? `Situación actual: ${visitObsolete(n, s)}. Este aviso se conserva como historial.`
                        : "Consultá la visita o el turno para ver su estado actual."}
                    </p>
                  )}
                  {!customer && (
                    <div className="row-actions">
                      {n.orderId &&
                        onOrder &&
                        button("Abrir orden", () => onOrder(n.orderId!))}
                      {n.appointmentId &&
                        onAgenda &&
                        button("Ir a Agenda", onAgenda)}
                    </div>
                  )}
                  {customer ? (
                    <div className="notification-tabs">
                      {!n.read && button("Marcar leído", () => onRead(n.id))}
                      {n.origin === "operational" &&
                        onVisit &&
                        button(
                          n.orderId ? "Ver visita" : "Ver mis turnos",
                          () => onVisit(!!n.orderId),
                        )}
                      {n.vehicleId && n.origin !== "operational" && (
                        <>
                          {button("Ver mantenimiento", () =>
                            document
                              .getElementById(`notice-maintenance-${n.id}`)
                              ?.scrollIntoView({ behavior: "smooth" }),
                          )}
                          {button("Actualizar kilómetros", () =>
                            onReading(n.vehicleId),
                          )}
                          {button("Solicitar turno", () =>
                            onAppointment(n.vehicleId),
                          )}
                        </>
                      )}
                      {!n.vehicleId &&
                        button("Solicitar turno", () => onAppointment())}
                    </div>
                  ) : (
                    <div>
                      <p className="notice-state">
                        Push:{" "}
                        {n.pushStatus === "sent"
                          ? "aceptado por el servicio de envío"
                          : n.pushStatus === "superseded"
                            ? "omitido: situación resuelta"
                            : n.pushStatus === "skipped"
                              ? "sin envío"
                              : n.pushStatus === "failed"
                                ? "fallo en uno o más dispositivos"
                                : n.pushStatus === "pending"
                                  ? visitObsolete(n, s)
                                    ? "no se enviará: situación resuelta"
                                    : "en cola o pendiente de reintento"
                                  : "sin registro"}
                        {n.pushReason ? ` · ${n.pushReason}` : ""}. La lectura
                        en portal se registra por separado; push aceptado no
                        demuestra que el teléfono lo mostró.
                      </p>
                      {overview.deliveries
                        .filter((d) => d.noticeId === n.id)
                        .map((d) => (
                          <p key={d.id}>
                            {d.status === "sent"
                              ? "Push aceptado por el servicio de envío"
                              : d.status === "permanent-failure"
                                ? "Dispositivo vencido"
                                : d.status === "sending"
                                  ? "En proceso"
                                  : d.status === "exhausted"
                                    ? "Intentos agotados; requiere revisión"
                                    : "Fallo temporal pendiente de reintento"}{" "}
                            · {d.attempts} intento(s){" "}
                            {["pending", "exhausted"].includes(d.status) &&
                              button(
                                "Reintentar",
                                () =>
                                  void save("notifications.retry", {
                                    id: d.id,
                                  }),
                              )}
                          </p>
                        ))}
                      {!overview.deliveries.some(
                        (d) => d.noticeId === n.id,
                      ) && (
                        <p>
                          Disponible en portal. Sin intento por dispositivo
                          registrado.
                        </p>
                      )}
                    </div>
                  )}
                  {customer && n.vehicleId && n.origin !== "operational" && (
                    <div id={`notice-maintenance-${n.id}`}>
                      <p>
                        <strong>
                          {s.vehicles.find((v) => v.id === n.vehicleId)?.plate}
                        </strong>
                      </p>
                      {s.reminders
                        .filter(
                          (r) =>
                            r.vehicleId === n.vehicleId &&
                            r.status === "active",
                        )
                        .map((r) => (
                          <p key={r.id}>
                            {r.title} · {fmtDate(r.dueDate)}
                            {r.dueKm !== null && ` · ${r.dueKm} km`}
                            <br />
                            <small>
                              El uso estimado no reemplaza la lectura del
                              tablero.
                            </small>
                          </p>
                        ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!notices.length && <Empty text="Sin avisos para este filtro." />}
        </Section>
      )}
      {tab === "Preferencias" &&
        (customer ? (
          <Section title="Qué querés recibir">
            <div className="notification-form">
              {check("Permitir notificaciones push", prefs.pushEnabled, (v) =>
                setPrefs({ ...prefs, pushEnabled: v }),
              )}
              {check("Avisos de turnos y visitas", prefs.visit, (v) =>
                setPrefs({ ...prefs, visit: v }),
              )}
              {check("Mantenimiento y servicios", prefs.maintenance, (v) =>
                setPrefs({ ...prefs, maintenance: v }),
              )}
              {check("Matafuegos", prefs.extinguisher, (v) =>
                setPrefs({ ...prefs, extinguisher: v }),
              )}
              {check("Mensajes del lubricentro", prefs.messages, (v) =>
                setPrefs({ ...prefs, messages: v }),
              )}
              <p>
                Los avisos quedan en el portal aunque desactives push. También
                debés permitir notificaciones en el navegador.
              </p>
              {button(
                "Guardar preferencias",
                () => void save("notifications.preferences", prefs),
              )}
            </div>
          </Section>
        ) : (
          <Section title="Canales y clientes">
            <p>
              Canales disponibles: portal y push. Visitas y mensajes se intentan
              al ocurrir el evento; mantenimiento y reintentos se revisan
              diariamente.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Push en perfil</th>
                    <th>Avisos de visita</th>
                    <th>Dispositivos registrados</th>
                  </tr>
                </thead>
                <tbody>
                  {s.customers.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.pushEnabled ? "Permitido" : "Desactivado"}</td>
                      <td>
                        {c.notificationPreferences?.visit === false
                          ? "Desactivados"
                          : "Permitidos"}
                      </td>
                      <td>
                        {
                          overview.devices.filter((d) => d.customerId === c.id)
                            .length
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ))}
      {tab === "Dispositivos" && (
        <Section title="Tus dispositivos">
          <p>
            En iPhone, agregá LubriWorks a Inicio y abrilo desde ese ícono para
            activar push.
          </p>
          {button("Activar este dispositivo", async () => {
            try {
              if (demo)
                throw new Error("Push no disponible en la demostración local.");
              await enablePush(access.tenant.id, vapid);
              await load();
              setError(
                "Dispositivo registrado. Revisá también tus preferencias de push.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          })}
          {overview.devices.map((d) => (
            <div className="info-box" key={d.id}>
              <p>
                {d.label}
                <br />
                <small>Registrado: {fmtDate(d.updatedAt)}</small>
              </p>
              {button(
                "Desvincular",
                () => void save("notifications.deviceRemove", { id: d.id }),
              )}
            </div>
          ))}
          {!overview.devices.length && (
            <Empty text="Todavía no registraste dispositivos." />
          )}
        </Section>
      )}
    </>
  );
}
