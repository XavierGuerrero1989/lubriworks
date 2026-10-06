import { useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "./lib/firebase";
import { rpc } from "./lib/api";
import { Login } from "./components/Login";
import { Workspace } from "./components/Workspace";
import { demoAccess, demoState } from "../shared/demo";
import { execute, type Command } from "../shared/engine";
import {
  projectState,
  type Access,
  type State,
  type Tenant,
} from "../shared/model";
import { FormDialog, type Dialog } from "./components/ui";
export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [demo, setDemo] = useState(false),
    [loading, setLoading] = useState(Boolean(auth)),
    [access, setAccess] = useState<Access[]>([]),
    [platform, setPlatform] = useState(false),
    [active, setActive] = useState<Access | null>(null),
    [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [vapid, setVapid] = useState(""),
    [tenants, setTenants] = useState<Tenant[]>([]),
    [showPlatform, setShowPlatform] = useState(false),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const pendingOperations = useRef(new Map<string, string>());
  const demoDb = useRef<Record<string, State>>({}),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  const clear = () => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setActive(null);
    setState(null);
    setVapid("");
    setShowPlatform(false);
    setError("");
  };
  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, async (u) => {
      clear();
      setUser(u);
      setAccess([]);
      setPlatform(false);
      if (!u || !u.emailVerified) {
        setLoading(false);
        return;
      }
      const current = generation.current;
      setLoading(true);
      try {
        const result = await rpc<{ access: Access[]; platform: boolean }>(
          "access",
        );
        if (current === generation.current) {
          setAccess(result.access);
          setPlatform(result.platform);
        }
      } catch (e) {
        if (current === generation.current) setError((e as Error).message);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    });
  }, []);
  useEffect(() => {
    if (demo || !active) return;
    const tenantId = active.tenant.id,
      current = generation.current;
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const r = await rpc<{
          access: Access;
          state: State;
          vapidPublicKey: string;
        }>("snapshot", {}, tenantId, controller.current?.signal);
        if (current === generation.current) {
          setActive(r.access);
          setState(r.state);
          setVapid(r.vapidPublicKey);
        }
      } catch (e) {
        if (
          current === generation.current &&
          (e as Error).name !== "AbortError"
        ) {
          setState(null);
          setError((e as Error).message);
        }
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [active?.tenant.id, demo]);
  const startDemo = () => {
    clear();
    demoDb.current = {
      "demo-centro": demoState(),
      "demo-norte": {
        ...demoState(),
        orders: [],
        sales: [],
        cash: [],
        appointments: [],
      },
    };
    setDemo(true);
    const a = structuredClone(demoAccess),
      b = structuredClone(demoAccess);
    b.tenant.id = "demo-norte";
    b.tenant.name = "Lubricentro Norte";
    b.member.tenantId = b.tenant.id;
    setAccess([a, b]);
    setActive(a);
    setState(projectState(demoDb.current[a.tenant.id], a.member));
  };
  const select = async (a: Access) => {
    clear();
    const current = generation.current;
    setActive(a);
    if (demo) {
      setState(projectState(demoDb.current[a.tenant.id], a.member));
      return;
    }
    controller.current = new AbortController();
    try {
      const result = await rpc<{
        access: Access;
        state: State;
        vapidPublicKey: string;
      }>("snapshot", {}, a.tenant.id, controller.current.signal);
      if (current === generation.current) {
        setActive(result.access);
        setState(result.state);
        setVapid(result.vapidPublicKey);
      }
    } catch (e) {
      if (
        current === generation.current &&
        (e as Error).name !== "AbortError"
      ) {
        setState(null);
        setError((e as Error).message);
      }
    }
  };
  const run = async (cmd: Command) => {
    if (!active) throw new Error("Seleccioná una empresa.");
    const current = generation.current,
      scope = active;
    const requestKey = JSON.stringify([scope.tenant.id, scope.member.uid, cmd]);
    const operationId =
      pendingOperations.current.get(requestKey) || crypto.randomUUID();
    pendingOperations.current.set(requestKey, operationId);
    if (demo) {
      const next = execute(
        demoDb.current[scope.tenant.id],
        scope.member,
        cmd,
        operationId,
      );
      demoDb.current[scope.tenant.id] = next;
      setState(projectState(next, scope.member));
      pendingOperations.current.delete(requestKey);
      return;
    }
    await rpc(
      "command",
      cmd,
      scope.tenant.id,
      controller.current?.signal,
      operationId,
    );
    if (current !== generation.current)
      throw new Error(
        "Cambiaste de empresa. La operación se procesó en la empresa anterior.",
      );
    try {
      const result = await rpc<{ access: Access; state: State }>(
        "snapshot",
        {},
        scope.tenant.id,
        controller.current?.signal,
      );
      if (current === generation.current) {
        setActive(result.access);
        setState(result.state);
        pendingOperations.current.delete(requestKey);
      }
    } catch (e) {
      if (current === generation.current) {
        setState(null);
        setError(
          "La operación se guardó, pero no se pudo actualizar la pantalla. Volvé a abrir la empresa.",
        );
      }
      throw e;
    }
  };
  const logout = async () => {
    clear();
    pendingOperations.current.clear();
    setAccess([]);
    setDemo(false);
    setPlatform(false);
    if (auth) await signOut(auth);
  };
  if (loading)
    return (
      <div className="full-loader">
        <div className="spinner" />
        Verificando tu acceso…
      </div>
    );
  if (!demo && (!user || !user.emailVerified))
    return <Login onDemo={startDemo} />;
  if (active && state)
    return (
      <Workspace
        key={`${active.tenant.id}-${active.member.role}`}
        access={active}
        accesses={access}
        state={state}
        run={run}
        onSwitch={select}
        onLogout={logout}
        demo={demo}
        vapid={vapid}
        onDemoRole={() => {
          if (!demo) return;
          const a = structuredClone(active);
          a.member.role = a.member.role === "customer" ? "owner" : "customer";
          a.member.customerId = a.member.role === "customer" ? "c1" : null;
          a.member.name =
            a.member.role === "customer"
              ? "Martín González"
              : "Xavier Guerrero";
          setActive(a);
          setState(projectState(demoDb.current[a.tenant.id], a.member));
        }}
        platform={platform}
        onPlatform={() => {
          clear();
          setShowPlatform(true);
          void rpc<Tenant[]>("platform.list")
            .then(setTenants)
            .catch((e) => setError(e.message));
        }}
      />
    );
  return (
    <main className="access-page">
      <img src="/brand/logo.png" alt="LubriWorks" />
      <div className="access-top">
        <div>
          <span className="eyebrow">
            {showPlatform ? "BRAINWORKS · PLATAFORMA" : "TU ESPACIO DE TRABAJO"}
          </span>
          <h1>{showPlatform ? "Empresas" : "Elegí tu lubricentro"}</h1>
          <p>
            {showPlatform
              ? "Administración de tenants y estado de acceso."
              : "Cada empresa mantiene sus datos y permisos separados."}
          </p>
        </div>
        <button className="button secondary" onClick={logout}>
          Cerrar sesión
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {active && !state && !error && <p>Cargando empresa…</p>}
      {showPlatform ? (
        <>
          <button
            className="button primary"
            onClick={() =>
              setDialog({
                title: "Crear empresa",
                fields: [
                  {
                    key: "id",
                    label: "Identificador",
                    hint: "Minúsculas y guiones. Ejemplo: lubricentro-central",
                  },
                  { key: "name", label: "Nombre comercial" },
                  {
                    key: "ownerEmail",
                    label: "Correo del administrador",
                    type: "email",
                  },
                ],
                submit: async (data) => {
                  await rpc("platform.create", data);
                  setTenants(await rpc("platform.list"));
                },
              })
            }
          >
            Nueva empresa
          </button>
          <div className="access-grid">
            {tenants.map((t) => (
              <article className="panel access-card" key={t.id}>
                <h2>{t.name}</h2>
                <p>
                  {t.id} · {t.active ? "Activa" : "Suspendida"}
                </p>
                <button
                  className="button secondary"
                  onClick={() =>
                    setDialog({
                      title: t.active
                        ? "Suspender empresa"
                        : "Reactivar empresa",
                      description: t.active
                        ? "Todos sus usuarios perderán acceso mientras esté suspendida."
                        : "Se restablecerá el acceso de los miembros activos.",
                      fields: [],
                      submit: async () => {
                        await rpc("platform.status", {
                          id: t.id,
                          active: !t.active,
                        });
                        setTenants(await rpc("platform.list"));
                      },
                    })
                  }
                >
                  {t.active ? "Suspender" : "Reactivar"}
                </button>
              </article>
            ))}
          </div>
          <button
            className="text-button"
            onClick={async () => {
              setShowPlatform(false);
              const r = await rpc<{ access: Access[] }>("access");
              setAccess(r.access);
            }}
          >
            Volver a mis empresas
          </button>
        </>
      ) : (
        <>
          <div className="access-grid">
            {access.map((a) => (
              <button
                className="panel access-card"
                key={a.tenant.id}
                onClick={() => select(a)}
              >
                <span className="eyebrow">LUBRICENTRO</span>
                <h2>{a.tenant.name}</h2>
                <p>Ingresar →</p>
              </button>
            ))}
          </div>
          {!access.length && (
            <div className="panel empty">
              <h2>Tu cuenta está lista.</h2>
              <p>
                El administrador debe vincular tu correo a una empresa o ficha
                de cliente.
              </p>
              <button
                className="button secondary"
                onClick={() => location.reload()}
              >
                Actualizar accesos
              </button>
            </div>
          )}
          {platform && (
            <button
              className="button secondary"
              onClick={async () => {
                setShowPlatform(true);
                try {
                  setTenants(await rpc("platform.list"));
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Administrar plataforma
            </button>
          )}
        </>
      )}
      {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </main>
  );
}
