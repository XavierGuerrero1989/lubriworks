import { useCallback, useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Headphones,
  History,
  CircleHelp,
  LogOut,
  RefreshCw,
  Plus,
  ArrowUpRight,
  Users,
  Car,
  ShieldCheck,
  Menu,
  X,
} from "lucide-react";
import { rpc } from "../lib/api";
import { roleLabels, roles, type Member } from "../../shared/model";
import type {
  PlatformOverview,
  PlatformTenant,
  PlatformTeam,
  PlatformActivity,
} from "../../shared/platform";
import { FormDialog, Stat, type Dialog } from "./ui";
import "./platform.css";
const sections = [
  { id: "overview", label: "Resumen", icon: LayoutDashboard },
  { id: "tenants", label: "Empresas y usuarios", icon: Building2 },
  { id: "support", label: "Soporte", icon: Headphones },
  { id: "audit", label: "Auditoría", icon: History },
  { id: "help", label: "Ayuda", icon: CircleHelp },
];
const titles: Record<string, [string, string]> = {
  overview: [
    "Resumen de la plataforma",
    "Estado general de LubriWorks y los lubricentros conectados.",
  ],
  tenants: [
    "Empresas y usuarios",
    "Administrá lubricentros, responsables y permisos.",
  ],
  support: [
    "Soporte a lubricentros",
    "Diagnóstico de acceso y estado de cada empresa.",
  ],
  audit: [
    "Auditoría de la plataforma",
    "Consultá la actividad registrada en cada lubricentro.",
  ],
  help: ["Centro de ayuda", "Primeros pasos para administrar LubriWorks."],
};
const actions: Record<string, string> = {
  "platform.create": "Empresa creada",
  "platform.status": "Estado de empresa actualizado",
  "platform.member.save": "Acceso actualizado",
  "member.save": "Acceso actualizado",
  command: "Operación registrada",
};
const date = (s: string) =>
  s
    ? new Date(s).toLocaleString("es-AR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "Sin fecha";
export function Platform({
  email,
  onLogout,
  onOpenTenant,
  onAccesses,
}: {
  email: string;
  onLogout: () => Promise<void>;
  onOpenTenant: (id: string) => Promise<void>;
  onAccesses: () => Promise<void>;
}) {
  const [section, setSection] = useState("overview"),
    [data, setData] = useState<PlatformOverview | null>(null),
    [selectedId, setSelectedId] = useState(""),
    [team, setTeam] = useState<PlatformTeam | null>(null),
    [busy, setBusy] = useState(false),
    [teamBusy, setTeamBusy] = useState(false),
    [error, setError] = useState(""),
    [teamError, setTeamError] = useState(""),
    [search, setSearch] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [mobile, setMobile] = useState(false),
    [cursor, setCursor] = useState<string | undefined>(),
    [pages, setPages] = useState<(string | undefined)[]>([]);
  const generation = useRef(0),
    alive = useRef(true);
  const refresh = useCallback(async () => {
    const g = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await rpc<PlatformOverview>(
        "platform.overview",
        cursor ? { cursor } : {},
      );
      if (alive.current && g === generation.current) setData(result);
    } catch (e) {
      if (alive.current && g === generation.current) {
        setData(null);
        setTeam(null);
        setError((e as Error).message);
      }
    } finally {
      if (alive.current && g === generation.current) setBusy(false);
    }
  }, [cursor]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [refresh]);
  useEffect(() => {
    setTeam(null);
    setTeamError("");
    if (!selectedId) return;
    const ac = new AbortController();
    setTeamBusy(true);
    void rpc<PlatformTeam>(
      "platform.team",
      { id: selectedId },
      undefined,
      ac.signal,
    )
      .then((r) => {
        if (!ac.signal.aborted) setTeam(r);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setTeamError(e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setTeamBusy(false);
      });
    return () => ac.abort();
  }, [selectedId, data?.refreshedAt]);
  const go = (id: string) => {
    setSection(id);
    setSearch("");
    setMobile(false);
  };
  const select = (t: PlatformTenant, destination = "tenants") => {
    setSelectedId(t.id);
    go(destination);
  };
  const create = () =>
    setDialog({
      title: "Nuevo lubricentro",
      description:
        "El responsable debe tener una cuenta de Firebase habilitada.",
      submitLabel: "Crear empresa",
      fields: [
        { key: "name", label: "Nombre comercial" },
        {
          key: "id",
          label: "Identificador permanente",
          hint: "Minúsculas y guiones. Ejemplo: lubricentro-central",
        },
        {
          key: "ownerEmail",
          label: "Correo del administrador",
          type: "email",
          value: email,
        },
      ],
      submit: async (values) => {
        await rpc("platform.create", values);
        setSelectedId(values.id);
        go("tenants");
        await refresh();
      },
    });
  const selected = data?.tenants.find((t) => t.id === selectedId);
  const memberDialog = (m?: Member) => {
    if (!selected || !team) return;
    const id = selected.id;
    setDialog({
      title: m ? "Editar acceso" : "Asignar acceso",
      description:
        "Vinculá una cuenta existente y habilitada. Los roles se aplican sólo a esta empresa.",
      fields: [
        {
          key: "email",
          label: "Correo de la cuenta",
          type: "email",
          value: m?.email,
        },
        { key: "name", label: "Nombre y apellido", value: m?.name },
        {
          key: "role",
          label: "Rol",
          type: "select",
          value: m?.role || "manager",
          options: roles.map((value) => ({ value, label: roleLabels[value] })),
        },
        {
          key: "customerId",
          label: "Ficha de cliente (sólo para rol Cliente)",
          type: "select",
          required: false,
          value: m?.customerId || "",
          options: [
            { value: "", label: "Sin vinculación" },
            ...team.customers.map((c) => ({ value: c.id, label: c.name })),
          ],
        },
        {
          key: "active",
          label: "Acceso activo",
          type: "checkbox",
          value: m?.active ?? true,
        },
      ],
      submit: async (v) => {
        await rpc("platform.member.save", {
          ...v,
          id,
          customerId: v.customerId || null,
          expectedUid: m?.uid,
        });
        await refresh();
      },
    });
  };
  const status = () => {
    if (!selected) return;
    const t = selected;
    setDialog({
      title: t.active ? "Suspender empresa" : "Reactivar empresa",
      description: t.active
        ? "Se bloqueará el acceso operativo de todos sus miembros. Los datos se conservan."
        : "Se restablecerá el acceso de los miembros activos.",
      fields: [],
      submit: async () => {
        await rpc("platform.status", { id: t.id, active: !t.active });
        await refresh();
      },
    });
  };
  const filtered =
    data?.tenants.filter((t) =>
      `${t.name} ${t.id}`.toLowerCase().includes(search.toLowerCase()),
    ) || [];
  const activityRows =
    data?.activity.filter((a) =>
      `${a.tenantName} ${a.action} ${a.actor}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  const activity = (rows: PlatformActivity[]) => (
    <div className="lw-activity">
      {rows.map((a) => (
        <article key={a.id}>
          <span className="lw-activity-icon">
            <History size={17} />
          </span>
          <div>
            <strong>{actions[a.action] || a.action}</strong>
            <p>{a.tenantName}</p>
            <small>
              Responsable: {a.actor}
              {a.target ? ` · Cuenta: ${a.target}` : ""}
            </small>
          </div>
          <time>{date(a.date)}</time>
        </article>
      ))}
      {!rows.length && (
        <p className="lw-muted">Todavía no hay movimientos registrados.</p>
      )}
    </div>
  );
  const totals = data?.tenants.reduce(
    (n, t) => ({
      members: n.members + t.activeMembers,
      vehicles: n.vehicles + t.vehicles,
      customers: n.customers + t.customers,
      orders: n.orders + t.orders,
      sales: n.sales + t.sales,
    }),
    { members: 0, vehicles: 0, customers: 0, orders: 0, sales: 0 },
  );
  const pageControls = data && (pages.length > 0 || data.nextCursor) && (
    <div className="lw-pages">
      <button
        className="button secondary"
        disabled={!pages.length || busy}
        onClick={() => {
          setCursor(pages.at(-1));
          setPages((p) => p.slice(0, -1));
          setSelectedId("");
        }}
      >
        Anterior
      </button>
      <span>Página {pages.length + 1} · hasta 50 empresas por página</span>
      <button
        className="button secondary"
        disabled={!data.nextCursor || busy}
        onClick={() => {
          setPages((p) => [...p, cursor]);
          setCursor(data.nextCursor!);
          setSelectedId("");
        }}
      >
        Siguiente
      </button>
    </div>
  );
  return (
    <div className="lw-platform">
      <button
        className="lw-mobile-toggle"
        onClick={() => setMobile(!mobile)}
        aria-expanded={mobile}
        aria-controls="platform-navigation"
      >
        {mobile ? <X /> : <Menu />} Menú de plataforma
      </button>
      {mobile && (
        <button
          className="lw-mobile-overlay"
          aria-label="Cerrar menú"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="platform-navigation"
        className={`lw-platform-sidebar ${mobile ? "open" : ""}`}
        aria-label="Administración de plataforma"
      >
        <img src="/brand/logo.png" alt="LubriWorks by Brainworks" />
        <div className="lw-platform-context">
          <small>ACCESO DE PLATAFORMA</small>
          <strong>Todas las empresas</strong>
          <span>
            <ShieldCheck size={15} /> Superadministrador
          </span>
        </div>
        <nav>
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              className={section === id ? "active" : ""}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="lw-sidebar-bottom">
          <button
            onClick={async () => {
              try {
                await onAccesses();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <ArrowUpRight size={18} /> Mis accesos operativos
          </button>
          <div className="lw-user">
            <span>{email.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>Administrador de plataforma</strong>
              <small>{email}</small>
            </div>
          </div>
          <button onClick={() => void onLogout()}>
            <LogOut size={18} /> Cerrar sesión
          </button>
          <small className="lw-brainworks">Una plataforma de Brainworks</small>
        </div>
      </aside>
      <div className="lw-platform-main">
        <header className="lw-platform-topbar">
          <span>
            <ShieldCheck size={16} /> Consola de administración
          </span>
          <span className="lw-admin-badge">Superadmin</span>
        </header>
        <main>
          <div className="lw-page-heading">
            <div>
              <span className="eyebrow">CONTROL GLOBAL · LUBRIWORKS</span>
              <h1>{titles[section][0]}</h1>
              <p>{titles[section][1]}</p>
            </div>
            <div className="lw-heading-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw size={16} />
                {busy ? "Actualizando…" : "Actualizar"}
              </button>
              {section !== "help" && (
                <button
                  className="button primary"
                  disabled={!data || busy}
                  onClick={create}
                >
                  <Plus size={16} /> Nueva empresa
                </button>
              )}
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {busy && !data && (
            <div className="panel empty">
              <div className="spinner" />
              <h2>Cargando plataforma…</h2>
            </div>
          )}
          {data && section === "overview" && (
            <>
              <section className="lw-platform-kpis">
                <Stat
                  label="Empresas activas"
                  value={`${data.activeTenants} / ${data.totalTenants}`}
                  detail="Cartera total de LubriWorks"
                  icon={<Building2 />}
                />
                <Stat
                  label="Accesos activos"
                  value={totals!.members}
                  detail="Membresías en esta página"
                  icon={<Users />}
                />
                <Stat
                  label="Vehículos registrados"
                  value={totals!.vehicles}
                  detail="En los lubricentros de esta página"
                  icon={<Car />}
                />
                <Stat
                  label="Empresas suspendidas"
                  value={data.totalTenants - data.activeTenants}
                  detail="Acceso operativo bloqueado"
                  icon={<ShieldCheck />}
                />
              </section>
              <div className="lw-overview-grid">
                <section className="panel">
                  <div className="lw-panel-heading">
                    <div>
                      <span className="eyebrow">CARTERA DE CLIENTES</span>
                      <h2>Empresas y operación</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => go("tenants")}
                    >
                      Administrar <ArrowUpRight size={16} />
                    </button>
                  </div>
                  <div className="lw-table-scroll">
                    <table className="lw-table">
                      <thead>
                        <tr>
                          <th>Empresa</th>
                          <th>Clientes</th>
                          <th>Vehículos</th>
                          <th>Órdenes</th>
                          <th>Ventas</th>
                          <th>Estado</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.tenants.map((t) => (
                          <tr key={t.id}>
                            <td>
                              <strong>{t.name}</strong>
                              <small>{t.id}</small>
                            </td>
                            <td>{t.customers}</td>
                            <td>{t.vehicles}</td>
                            <td>{t.orders}</td>
                            <td>{t.sales}</td>
                            <td>
                              <span
                                className={`lw-status ${t.active ? "active" : "paused"}`}
                              >
                                {t.active ? "Activa" : "Suspendida"}
                              </span>
                            </td>
                            <td>
                              <button
                                className="text-button"
                                onClick={() => select(t)}
                              >
                                Ver <ArrowUpRight size={15} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data.tenants.length && (
                    <div className="lw-platform-empty">
                      <Building2 size={34} />
                      <h3>Tu plataforma está lista</h3>
                      <p>
                        Creá el primer lubricentro y asigná su administrador.
                      </p>
                      <button className="button primary" onClick={create}>
                        Crear primer lubricentro
                      </button>
                    </div>
                  )}
                </section>
                <section className="panel lw-attention">
                  <span className="eyebrow">ATENCIÓN</span>
                  <h2>Estado de acceso</h2>
                  <div className="lw-health">
                    <span>
                      Empresas operativas{" "}
                      <b>
                        {data.activeTenants}/{data.totalTenants}
                      </b>
                    </span>
                    <progress
                      value={data.activeTenants}
                      max={data.totalTenants || 1}
                    />
                  </div>
                  {data.tenants
                    .filter((t) => !t.active || !t.administrators)
                    .map((t) => (
                      <button
                        className="lw-attention-row"
                        key={t.id}
                        onClick={() => select(t)}
                      >
                        <strong>{t.name}</strong>
                        <small>
                          {!t.active
                            ? "Empresa suspendida"
                            : "Sin administrador activo"}
                        </small>
                      </button>
                    ))}
                  {!data.tenants.length ? (
                    <p className="lw-muted">
                      Los controles aparecerán al crear tu primera empresa.
                    </p>
                  ) : (
                    data.tenants.every(
                      (t) => t.active && t.administrators > 0,
                    ) && (
                      <div className="lw-all-clear">
                        <ShieldCheck size={28} />
                        <strong>Accesos en orden</strong>
                        <p>
                          Las empresas de esta página están activas y tienen un
                          administrador.
                        </p>
                      </div>
                    )
                  )}
                </section>
              </div>
              <div className="lw-overview-grid">
                <section className="panel">
                  <span className="eyebrow">VOLUMEN DE PLATAFORMA</span>
                  <h2>Uso acumulado</h2>
                  <div className="lw-volumes">
                    <div>
                      <strong>{totals!.customers}</strong>
                      <span>Clientes</span>
                    </div>
                    <div>
                      <strong>{totals!.vehicles}</strong>
                      <span>Vehículos</span>
                    </div>
                    <div>
                      <strong>{totals!.orders}</strong>
                      <span>Órdenes de trabajo</span>
                    </div>
                    <div>
                      <strong>{totals!.sales}</strong>
                      <span>Ventas registradas</span>
                    </div>
                  </div>
                  <small className="lw-muted">
                    Totales de las empresas incluidas en esta página.
                  </small>
                </section>
                <section className="panel">
                  <div className="lw-panel-heading">
                    <h2>Actividad reciente</h2>
                    <button className="text-button" onClick={() => go("audit")}>
                      Ver auditoría
                    </button>
                  </div>
                  {activity(data.activity.slice(0, 5))}
                </section>
              </div>
              {pageControls}
              <div className="lw-quick-actions">
                <button onClick={() => go("tenants")}>
                  <Building2 />
                  <span>
                    <strong>Empresas y usuarios</strong>
                    <small>Altas, roles y estado de acceso.</small>
                  </span>
                  <ArrowUpRight />
                </button>
                <button onClick={() => go("support")}>
                  <Headphones />
                  <span>
                    <strong>Soporte</strong>
                    <small>Verificá accesos y operación.</small>
                  </span>
                  <ArrowUpRight />
                </button>
                <button onClick={() => go("audit")}>
                  <History />
                  <span>
                    <strong>Auditoría</strong>
                    <small>Consultá movimientos registrados.</small>
                  </span>
                  <ArrowUpRight />
                </button>
              </div>
            </>
          )}
          {data && ["tenants", "support"].includes(section) && (
            <>
              <label className="lw-search">
                Buscar lubricentro
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nombre o identificador"
                />
              </label>
              <div className="lw-master-detail">
                <section className="panel lw-tenant-list">
                  <h2>
                    Lubricentros <span>{data.tenants.length}</span>
                  </h2>
                  {filtered.map((t) => (
                    <button
                      key={t.id}
                      className={selectedId === t.id ? "selected" : ""}
                      aria-pressed={selectedId === t.id}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <strong>{t.name}</strong>
                      <small>{t.id}</small>
                      <span
                        className={`lw-status ${t.active ? "active" : "paused"}`}
                      >
                        {t.active ? "Activa" : "Suspendida"} · {t.activeMembers}{" "}
                        accesos
                      </span>
                    </button>
                  ))}
                  {!filtered.length && (
                    <p className="lw-muted">No hay empresas para mostrar.</p>
                  )}
                </section>
                <section className="panel lw-tenant-detail">
                  {!selected ? (
                    <div className="lw-platform-empty">
                      <Building2 size={34} />
                      <h2>Elegí una empresa</h2>
                      <p>
                        Seleccioná un lubricentro para consultar sus accesos y
                        operación.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="lw-panel-heading">
                        <div>
                          <h2>{selected.name}</h2>
                          <p className="lw-muted">{selected.id}</p>
                        </div>
                        <span
                          className={`lw-status ${selected.active ? "active" : "paused"}`}
                        >
                          {selected.active ? "Activa" : "Suspendida"}
                        </span>
                      </div>
                      <section
                        className="lw-tenant-metrics"
                        aria-label="Totales del lubricentro"
                      >
                        <Stat
                          label="Clientes"
                          value={selected.customers}
                          detail="Registrados en este lubricentro"
                          icon={<Users />}
                        />
                        <Stat
                          label="Vehículos"
                          value={selected.vehicles}
                          detail="Registrados en este lubricentro"
                          icon={<Car />}
                        />
                        <Stat
                          label="Órdenes"
                          value={selected.orders}
                          detail="Historial completo"
                          icon={<History />}
                        />
                        <Stat
                          label="Ventas"
                          value={selected.sales}
                          detail="Cantidad de operaciones, no importe"
                          icon={<Building2 />}
                        />
                      </section>
                      {teamError && (
                        <p className="error" role="alert">
                          {teamError}
                        </p>
                      )}
                      {section === "support" ? (
                        <>
                          <div className="lw-support-note">
                            <Headphones />
                            <div>
                              <strong>
                                Diagnóstico de plataforma · sólo lectura
                              </strong>
                              <p>
                                Consultá el estado de los accesos sin modificar
                                los datos del lubricentro.
                              </p>
                            </div>
                          </div>
                          <div className="lw-volumes">
                            <div>
                              <strong>{selected.administrators}</strong>
                              <span>Administradores activos</span>
                            </div>
                            <div>
                              <strong>{selected.activeMembers}</strong>
                              <span>Accesos activos</span>
                            </div>
                            <div>
                              <strong>{selected.orders}</strong>
                              <span>Órdenes registradas</span>
                            </div>
                          </div>
                          <h3>Verificaciones</h3>
                          <ul className="lw-checks">
                            <li>
                              Empresa{" "}
                              {selected.active ? "habilitada" : "suspendida"}.
                            </li>
                            <li>
                              {selected.administrators
                                ? "Cuenta con administrador activo."
                                : "Necesita un administrador activo."}
                            </li>
                            <li>
                              {selected.members - selected.activeMembers}{" "}
                              accesos desactivados.
                            </li>
                          </ul>
                          <button
                            className="button secondary"
                            onClick={() => go("tenants")}
                          >
                            Gestionar usuarios y permisos
                          </button>
                          <button
                            className="button secondary"
                            disabled={!selected.active}
                            onClick={async () => {
                              try {
                                await onOpenTenant(selected.id);
                              } catch (e) {
                                setTeamError((e as Error).message);
                              }
                            }}
                          >
                            Abrir mi acceso operativo
                          </button>
                          <p className="lw-muted">
                            Abrir el entorno requiere una membresía propia en
                            esta empresa. El rol de plataforma no crea permisos
                            operativos automáticamente.
                          </p>
                        </>
                      ) : (
                        <>
                          <div className="lw-panel-heading">
                            <h3>Equipo y accesos</h3>
                            <button
                              className="button secondary"
                              disabled={!team || teamBusy}
                              onClick={() => memberDialog()}
                            >
                              <Plus size={15} /> Asignar acceso
                            </button>
                          </div>
                          {teamBusy ? (
                            <p>Cargando accesos…</p>
                          ) : (
                            team?.members.map((m) => (
                              <article className="lw-member" key={m.uid}>
                                <span className="lw-member-avatar">
                                  {m.name.slice(0, 1)}
                                </span>
                                <div>
                                  <strong>{m.name}</strong>
                                  <small>{m.email}</small>
                                  <span>
                                    {roleLabels[m.role]} ·{" "}
                                    {m.active ? "Activo" : "Desactivado"}
                                  </span>
                                </div>
                                <button
                                  className="text-button"
                                  onClick={() => memberDialog(m)}
                                >
                                  Editar
                                </button>
                              </article>
                            ))
                          )}
                          {team && !team.members.length && (
                            <p className="lw-muted">
                              Esta empresa todavía no tiene usuarios.
                            </p>
                          )}
                          <div className="lw-status-zone">
                            <h3>Estado de la empresa</h3>
                            <p>
                              Suspender bloquea sus accesos operativos y
                              conserva los datos.
                            </p>
                            <button
                              className="button secondary"
                              onClick={status}
                            >
                              {selected.active
                                ? "Suspender empresa"
                                : "Reactivar empresa"}
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </section>
              </div>
              {pageControls}
            </>
          )}
          {data && section === "audit" && (
            <section className="panel">
              <label className="lw-search">
                Buscar actividad
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Empresa, acción o UID del responsable"
                />
              </label>
              <p className="lw-muted">
                Últimos 40 movimientos disponibles, hasta 8 por empresa de esta
                página.
              </p>
              {activity(activityRows)}
              {pageControls}
            </section>
          )}
          {section === "help" && (
            <section className="panel lw-help">
              <h2>Administrar tu plataforma</h2>
              <ol>
                <li>
                  <strong>Creá un lubricentro.</strong> En Empresas y usuarios,
                  indicá nombre, identificador y correo del administrador
                  registrado.
                </li>
                <li>
                  <strong>Gestioná sus accesos.</strong> Seleccioná una empresa
                  para vincular cuentas y asignar roles. Un cliente debe estar
                  vinculado a su ficha.
                </li>
                <li>
                  <strong>Revisá la operación.</strong> El resumen muestra
                  empresas, accesos, vehículos y actividad. Soporte permite
                  diagnosticar problemas de acceso.
                </li>
                <li>
                  <strong>Ingresá a tu lubricentro.</strong> Mis accesos
                  operativos abre las empresas en las que tenés una membresía.
                </li>
              </ol>
              <h3>Recordatorios a clientes</h3>
              <p>
                Los clientes deben ingresar desde su cuenta y activar los
                recordatorios. En iPhone, deben agregar la app a la pantalla de
                inicio y abrirla desde su ícono.
              </p>
              <h3>Separación de empresas</h3>
              <p>
                Los permisos operativos se verifican por empresa. La
                administración de plataforma requiere el rol de
                superadministrador activo.
              </p>
            </section>
          )}
          {data && (
            <p className="lw-refreshed">
              Datos actualizados el {date(data.refreshedAt)}.
            </p>
          )}
        </main>
      </div>
      {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}
