import { useEffect, useRef, useState } from "react";
import { Bell, RefreshCw, Smartphone, UserRound } from "lucide-react";
import type { Access, State } from "../../shared/model";
import type { Command } from "../../shared/engine";
import {
  accountCustomer,
  accountPreferences,
  customerNotices,
  noticeCategory,
  noticeDestination,
} from "../../shared/clientAccount";
import { portalDateTime } from "../../shared/clientHome";
import { visitObsolete } from "../../shared/visitNotices";
import { workStage } from "../../shared/orders";
import { rpc } from "../lib/api";
import { enablePush } from "../lib/push";
import { auth } from "../lib/firebase";
import { Badge, fmtDate, SearchBox } from "./ui";
import "./customer-account.css";
type Device = { id: string; label: string; updatedAt: string };
type Overview = {
  devices: Device[];
  preferences?: ReturnType<typeof accountPreferences>;
  pushConfigured?: boolean;
};
const categories = {
  visit: "Visitas y turnos",
  maintenance: "Mantenimiento",
  extinguisher: "Matafuegos",
  messages: "Mensajes del lubricentro",
};
export function CustomerAccount({
  mode,
  state: s,
  access,
  demo,
  vapid,
  run,
  onRefresh,
  onGo,
  onAppointment,
  onPassword,
}: {
  mode: "profile" | "notifications";
  state: State;
  access: Access;
  demo: boolean;
  vapid: string;
  run: (c: Command) => Promise<void>;
  onRefresh: () => Promise<void>;
  onGo: (section: string) => void;
  onAppointment: (id?: string, reason?: string) => void;
  onPassword: () => void;
}) {
  const c = accountCustomer(s, access.member),
    [tab, setTab] = useState("Bandeja"),
    [overview, setOverview] = useState<Overview>({ devices: [] }),
    [prefs, setPrefs] = useState(() => accountPreferences(s, access.member)),
    [name, setName] = useState(c?.name ?? ""),
    [phone, setPhone] = useState(c?.phone ?? ""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(demo),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [search, setSearch] = useState(""),
    [vehicle, setVehicle] = useState("all"),
    [category, setCategory] = useState("all"),
    [status, setStatus] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [remove, setRemove] = useState<Device | null>(null),
    [permission, setPermission] = useState("unknown"),
    [currentDevice, setCurrentDevice] = useState("");
  const operations = useRef(new Map<string, string>());
  useEffect(() => {
    setError("");
    setMessage("");
  }, [mode]);
  useEffect(() => {
    setName(c?.name ?? "");
    setPhone(c?.phone ?? "");
  }, [c?.id, c?.name, c?.phone]);
  useEffect(() => {
    setPrefs(accountPreferences(s, access.member));
  }, [c?.id, c?.pushEnabled, JSON.stringify(c?.notificationPreferences)]);
  async function inspectDevice() {
    const supported =
      typeof Notification !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    setPermission(supported ? Notification.permission : "unsupported");
    if (!supported) return;
    const registration = await navigator.serviceWorker.getRegistration(),
      subscription = await registration?.pushManager.getSubscription();
    if (!subscription) {
      setCurrentDevice("");
      return;
    }
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(access.member.uid + subscription.endpoint),
    );
    setCurrentDevice(
      Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
  }
  async function load() {
    if (demo) {
      setLoaded(true);
      return;
    }
    const data = await rpc<Overview>(
      "notifications.overview",
      {},
      access.tenant.id,
    );
    setOverview({ ...data, devices: data.devices || [] });
    if (data.preferences) setPrefs(data.preferences);
    setLoaded(true);
    await inspectDevice();
  }
  useEffect(() => {
    void load().catch((e) => setError((e as Error).message));
  }, [access.tenant.id, access.member.uid, demo]);
  async function task(fn: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutation(action: string, payload: Record<string, unknown>) {
    const key = JSON.stringify({ action, payload }),
      op = operations.current.get(key) || crypto.randomUUID();
    operations.current.set(key, op);
    await rpc(action, payload, access.tenant.id, undefined, op);
    operations.current.delete(key);
  }
  const refresh = () =>
    task(async () => {
      await onRefresh();
      await load();
    }, "Información actualizada.");
  const rows = customerNotices(s, access.member, {
      search,
      vehicle,
      category,
      status,
      from,
      to,
    }),
    all = customerNotices(s, access.member),
    unread = rows.filter((n) => !n.read),
    vehicles = s.vehicles.filter(
      (v) => v.customerId === access.member.customerId,
    ),
    currentRegistered = overview.devices.some((d) => d.id === currentDevice);
  const read = (ids: string[]) =>
    task(async () => {
      for (let i = 0; i < ids.length; i += 100)
        await run({ action: "readNotices", ids: ids.slice(i, i + 100) });
    }, "Avisos marcados como leídos.");
  if (!c) return <p>No hay una ficha de cliente asociada a este acceso.</p>;
  return (
    <div className="client-account">
      <div className="page-heading">
        <div>
          <h1>{mode === "profile" ? "Mi perfil" : "Notificaciones"}</h1>
          <p>
            {mode === "profile"
              ? "Tus datos personales y el acceso a tu cuenta."
              : "Tus avisos, preferencias y dispositivos, en un mismo lugar."}
          </p>
        </div>
        <button className="button secondary" disabled={busy} onClick={refresh}>
          <RefreshCw size={16} />
          Actualizar
        </button>
      </div>
      {error && (
        <p className="account-feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="account-feedback" role="status">
          {message}
        </p>
      )}
      {mode === "profile" ? (
        <div className="account-profile-grid">
          <section className="panel account-panel">
            <UserRound />
            <h2>Datos personales</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void task(
                  () =>
                    run({
                      action: "profile",
                      data: {
                        name: name.trim(),
                        phone: phone.trim(),
                        pushEnabled: c.pushEnabled,
                      },
                    }),
                  "Datos personales actualizados.",
                );
              }}
            >
              <label>
                Nombre y apellido
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Teléfono
                <input
                  type="tel"
                  maxLength={40}
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <button className="button primary" disabled={busy}>
                Guardar mis datos
              </button>
            </form>
          </section>
          <section className="panel account-panel">
            <h2>Acceso y contraseña</h2>
            <dl>
              <dt>Correo de acceso</dt>
              <dd>{demo ? c.email : auth?.currentUser?.email || c.email}</dd>
              <dt>Correo registrado por el lubricentro</dt>
              <dd>{c.email}</dd>
              <dt>Lubricentro</dt>
              <dd>{access.tenant.name}</dd>
            </dl>
            <p>
              Si necesitás corregir el correo de tu ficha, coordiná con el
              lubricentro. El correo de acceso se gestiona por separado.
            </p>
            <button
              className="button secondary"
              disabled={busy}
              onClick={onPassword}
            >
              Cambiar contraseña
            </button>
            <p className="account-caption">
              Se pide tu contraseña actual y una nueva de al menos 8 caracteres.
              No se envía verificación por correo.
              {demo ? " El cambio de contraseña requiere una cuenta real." : ""}
            </p>
          </section>
          <section className="panel account-panel">
            <Bell />
            <h2>Tus preferencias de avisos</h2>
            <p>
              Push{" "}
              {c.pushEnabled
                ? "permitido en tu perfil"
                : "desactivado en tu perfil"}
              .
            </p>
            <ul>
              {Object.entries(categories).map(([k, label]) => (
                <li key={k}>
                  {label}:{" "}
                  {accountPreferences(s, access.member)[
                    k === "visit"
                      ? "visit"
                      : (k as "maintenance" | "extinguisher" | "messages")
                  ]
                    ? "permitidos"
                    : "desactivados"}
                </li>
              ))}
            </ul>
            <p>Los avisos siguen en tu bandeja aunque desactives push.</p>
            <button
              className="button secondary"
              onClick={() => {
                setTab("Preferencias");
                onGo("notifications");
              }}
            >
              Configurar notificaciones
            </button>
          </section>
        </div>
      ) : (
        <>
          <div className="account-tabs">
            {["Bandeja", "Preferencias", "Dispositivos"].map((t) => (
              <button
                key={t}
                className={`button ${t === tab ? "primary" : "secondary"}`}
                onClick={() => {
                  setTab(t);
                  setError("");
                  setMessage("");
                }}
              >
                {t}
                {t === "Bandeja"
                  ? ` (${all.filter((n) => !n.read).length} sin leer)`
                  : ""}
              </button>
            ))}
          </div>
          {tab === "Bandeja" && (
            <>
              <div className="account-filters">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder="Buscar aviso o vehículo…"
                />
                <label>
                  Vehículo
                  <select
                    value={vehicle}
                    onChange={(e) => setVehicle(e.target.value)}
                  >
                    <option value="all">Todos mis vehículos</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.plate} · {v.brand} {v.model}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Categoría
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="all">Todos los avisos</option>
                    {Object.entries(categories).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Estado
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="all">Todos</option>
                    <option value="unread">Sin leer</option>
                    <option value="read">Leídos</option>
                  </select>
                </label>
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
                <button
                  className="button secondary"
                  onClick={() => {
                    setSearch("");
                    setVehicle("all");
                    setCategory("all");
                    setStatus("all");
                    setFrom("");
                    setTo("");
                  }}
                >
                  Limpiar filtros
                </button>
              </div>
              {from && to && from > to && (
                <p role="alert">Desde debe ser anterior o igual a Hasta.</p>
              )}
              <div className="account-inbox-heading">
                <p>
                  {rows.length} {rows.length === 1 ? "aviso" : "avisos"} ·{" "}
                  {unread.length} sin leer en esta vista
                </p>
                <button
                  className="button secondary"
                  disabled={busy || !unread.length}
                  onClick={() => void read(unread.map((n) => n.id))}
                >
                  Marcar visibles como leídos
                </button>
              </div>
              <div className="account-notices">
                {rows.map((n) => {
                  const v = vehicles.find((v) => v.id === n.vehicleId),
                    dest = noticeDestination(n),
                    order = s.orders.find(
                      (o) => o.id === n.orderId && o.customerId === c.id,
                    ),
                    historical =
                      order &&
                      (["delivered", "cancelled"].includes(workStage(order)) ||
                        (!order.workStatus && order.status === "paid")),
                    obsolete =
                      n.origin === "operational" ? visitObsolete(n, s) : "",
                    reminder = s.reminders.find(
                      (r) => r.id === n.reminderId && r.customerId === c.id,
                    ),
                    resolved = reminder?.status === "done";
                  return (
                    <article
                      className={`panel account-notice ${n.read ? "" : "unread"}`}
                      key={n.id}
                    >
                      {n.newsHiddenAt && (
                        <p className="notice-caption">
                          El lubricentro retiró este mensaje de Novedades. Se
                          conserva en tu historial.
                        </p>
                      )}
                      <div className="account-notice-top">
                        <Badge value={n.read ? "ok" : "soon"}>
                          {n.read ? "Leído" : "Sin leer"}
                        </Badge>
                        <small>{portalDateTime(n.date)}</small>
                      </div>
                      <p className="account-caption">
                        {categories[noticeCategory(n)]}
                        {v ? ` · ${v.plate} · ${v.brand} ${v.model}` : ""}
                      </p>
                      <h2>{n.title}</h2>
                      <p className="account-notice-body">{n.body}</p>
                      {obsolete && (
                        <p className="account-context">
                          Situación actual: {obsolete}. Este aviso se conserva
                          como historial.
                        </p>
                      )}
                      {resolved && (
                        <p className="account-context">
                          El lubricentro ya resolvió el mantenimiento de este
                          aviso. Consultá los cuidados vigentes.
                        </p>
                      )}
                      <div className="account-actions">
                        {!n.read && (
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() => void read([n.id])}
                          >
                            Marcar leído
                          </button>
                        )}
                        {dest !== "none" && (
                          <button
                            className="button primary"
                            onClick={() =>
                              onGo(
                                dest === "maintenance"
                                  ? "reminders"
                                  : dest === "visit"
                                    ? historical
                                      ? "history"
                                      : "vehicles"
                                    : "appointments",
                              )
                            }
                          >
                            {dest === "maintenance"
                              ? "Ver mantenimientos"
                              : dest === "visit"
                                ? historical
                                  ? "Ver historial"
                                  : "Ver visita"
                                : "Ver mis turnos"}
                          </button>
                        )}
                        {["maintenance", "extinguisher"].includes(
                          noticeCategory(n),
                        ) &&
                          !resolved &&
                          v && (
                            <button
                              className="button secondary"
                              onClick={() => onAppointment(v.id, n.title)}
                            >
                              Solicitar turno
                            </button>
                          )}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!rows.length && (
                <div className="empty">
                  <Bell />
                  <h3>
                    {all.length
                      ? "No hay avisos que coincidan con estos filtros."
                      : "Todavía no tenés notificaciones."}
                  </h3>
                  <p>
                    Acá aparecen las novedades de tu visita, recordatorios y
                    mensajes del lubricentro.
                  </p>
                </div>
              )}
              <p className="account-caption">
                Leer un aviso no autoriza trabajos ni cancela turnos. Consultá
                la sección correspondiente para ver el estado actual.
              </p>
            </>
          )}
          {tab === "Preferencias" && (
            <section className="panel account-panel">
              <h2>Qué avisos querés recibir</h2>
              <p>
                Estas preferencias controlan el envío push. Los avisos
                permanecen disponibles en el portal.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void task(async () => {
                    if (demo) {
                      const { pushEnabled, ...notificationPreferences } = prefs;
                      await run({
                        action: "profile",
                        data: {
                          name: c.name,
                          phone: c.phone,
                          pushEnabled,
                          notificationPreferences,
                        },
                      });
                    } else {
                      await mutation("notifications.preferences", prefs);
                      await onRefresh();
                      await load();
                    }
                  }, "Preferencias guardadas.");
                }}
              >
                <label className="account-check">
                  <input
                    type="checkbox"
                    checked={prefs.pushEnabled}
                    onChange={(e) =>
                      setPrefs({ ...prefs, pushEnabled: e.target.checked })
                    }
                  />
                  Recibir notificaciones push
                </label>
                {Object.entries(categories).map(([k, label]) => (
                  <label className="account-check" key={k}>
                    <input
                      type="checkbox"
                      disabled={!prefs.pushEnabled}
                      checked={prefs[k as keyof typeof prefs]}
                      onChange={(e) =>
                        setPrefs({ ...prefs, [k]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
                {!prefs.pushEnabled && (
                  <p>
                    Push está desactivado. Tu selección por categoría se
                    conserva para cuando lo vuelvas a activar.
                  </p>
                )}
                <button className="button primary" disabled={busy || !loaded}>
                  Guardar preferencias
                </button>
              </form>
              <p>
                Para recibir push también necesitás permitirlos en el navegador
                y registrar un dispositivo.
              </p>
              <button
                className="text-button"
                onClick={() => setTab("Dispositivos")}
              >
                Ver mis dispositivos
              </button>
            </section>
          )}
          {tab === "Dispositivos" && (
            <section className="panel account-panel">
              <Smartphone />
              <h2>Recibir avisos en tus dispositivos</h2>
              <p>
                {demo
                  ? "Demo: no se registran dispositivos ni se envían push reales."
                  : permission === "unsupported"
                    ? "Este navegador no admite push. Podés consultar todos tus avisos en la bandeja."
                    : permission === "denied"
                      ? "El navegador bloqueó las notificaciones. Cambiá el permiso desde su configuración y volvé a registrar este dispositivo."
                      : permission === "granted"
                        ? currentRegistered
                          ? "Este dispositivo está registrado y el navegador permite notificaciones."
                          : "El navegador permite notificaciones; este dispositivo todavía no está vinculado a tu cuenta en este lubricentro."
                        : "Todavía no permitiste las notificaciones en este navegador."}
              </p>
              {!c.pushEnabled && (
                <p className="account-context">
                  Push está desactivado en tus preferencias. Registrar un
                  dispositivo no cambia esa selección.
                </p>
              )}
              {!demo && overview.pushConfigured === false && (
                <p className="account-context">
                  El lubricentro todavía no tiene configurado el envío push. Los
                  avisos siguen en la bandeja.
                </p>
              )}
              <button
                className="button primary"
                disabled={
                  busy ||
                  demo ||
                  !loaded ||
                  permission === "unsupported" ||
                  permission === "denied" ||
                  overview.pushConfigured === false
                }
                onClick={() =>
                  void task(async () => {
                    await enablePush(access.tenant.id, vapid);
                    await load();
                  }, "Dispositivo registrado. Revisá tus preferencias de push.")
                }
              >
                {currentRegistered
                  ? "Actualizar este dispositivo"
                  : "Activar este dispositivo"}
              </button>
              <p className="account-caption">
                En iPhone, agregá LubriWorks a Inicio y abrilo desde ese ícono
                para activar push. El permiso del navegador y tus preferencias
                son independientes.
              </p>
              <h3>Dispositivos registrados</h3>
              {overview.devices.map((d) => (
                <div className="account-device" key={d.id}>
                  <strong>
                    {d.label}
                    {d.id === currentDevice ? " · Este dispositivo" : ""}
                  </strong>
                  <p>Último registro: {fmtDate(d.updatedAt)}</p>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setRemove(d)}
                  >
                    Desvincular
                  </button>
                </div>
              ))}
              {!overview.devices.length && (
                <p>Todavía no hay dispositivos vinculados a este acceso.</p>
              )}
              <p className="account-caption">
                Desvincular deja de enviar push a ese dispositivo desde este
                lubricentro. No cambia el permiso del navegador ni borra la
                bandeja.
              </p>
            </section>
          )}
        </>
      )}
      {remove && (
        <div className="modal-backdrop">
          <section
            className="modal account-remove"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-device"
          >
            <h2 id="remove-device">Desvincular dispositivo</h2>
            <p>
              Se dejarán de enviar los avisos de este lubricentro a{" "}
              {remove.label}. Podés registrarlo nuevamente.
            </p>
            <div className="account-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setRemove(null)}
              >
                Cancelar
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    await mutation("notifications.deviceRemove", {
                      id: remove.id,
                    });
                    await load();
                    setRemove(null);
                  }, "Dispositivo desvinculado.")
                }
              >
                Confirmar desvinculación
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
