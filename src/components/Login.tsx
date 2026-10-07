import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  ArrowRight,
  ShieldCheck,
  Droplets,
  Car,
  CalendarCheck,
} from "lucide-react";
import { auth, configured, demoEnabled } from "../lib/firebase";
export function Login({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<"login" | "register" | "reset">("login"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  return (
    <main className="login">
      <section className="login-story">
        <div className="brand-light">
          <Droplets size={30} />
          <strong>
            Lubri<span>Works</span>
          </strong>
        </div>
        <div>
          <span className="eyebrow light">BY BRAINWORKS</span>
          <h1>
            El próximo service
            <br />
            empieza con una
            <br />
            <em>buena conexión.</em>
          </h1>
          <p>
            Tu lubricentro, tus clientes y cada vehículo.
            <br />
            Todo en un mismo lugar.
          </p>
          <div className="story-features">
            <span>
              <Car /> Historial de cada vehículo
            </span>
            <span>
              <CalendarCheck /> Mantenimientos a tiempo
            </span>
            <span>
              <ShieldCheck /> Una cuenta, tu espacio seguro
            </span>
          </div>
        </div>
        <small>Gestión de lubricentros y cuidado vehicular.</small>
      </section>
      <section className="login-form">
        <div>
          <img
            src="/brand/logo.png"
            alt="LubriWorks by Brainworks"
            className="login-logo"
          />
          <span className="eyebrow">TU LUBRICENTRO CONECTADO</span>
          <h2>
            {mode === "login"
              ? "Qué bueno verte de nuevo."
              : mode === "register"
                ? "Creá tu cuenta."
                : "Recuperá tu acceso."}
          </h2>
          <p>
            {mode === "register"
              ? "Creá tu cuenta y el lubricentro podrá vincularte a tus vehículos."
              : "Ingresá para continuar con tu día."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              setMessage("");
              const fd = new FormData(e.currentTarget);
              try {
                if (!auth)
                  throw new Error(
                    "Falta conectar el proyecto Firebase. Podés explorar la demo.",
                  );
                const email = String(fd.get("email"));
                const password = String(fd.get("password"));
                if (mode === "reset") {
                  await sendPasswordResetEmail(auth, email);
                  setMessage(
                    "Si existe una cuenta con ese correo, recibirás instrucciones para recuperar el acceso.",
                  );
                } else if (mode === "register") {
                  await createUserWithEmailAndPassword(auth, email, password);
                } else {
                  await signInWithEmailAndPassword(auth, email, password);
                }
              } catch (e) {
                const code = (e as any).code;
                setError(
                  code === "auth/invalid-credential"
                    ? "Correo o contraseña incorrectos."
                    : code === "auth/email-already-in-use"
                      ? "Ese correo ya tiene una cuenta. Ingresá o recuperá tu contraseña."
                      : code === "auth/weak-password"
                        ? "Usá una contraseña de al menos 8 caracteres."
                        : code
                          ? "No se pudo ingresar. Revisá los datos y tu conexión."
                          : (e as Error).message,
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Correo electrónico
              <input
                name="email"
                type="email"
                placeholder="nombre@correo.com"
                required
                autoComplete="email"
              />
            </label>
            {mode !== "reset" && (
              <label>
                Contraseña
                <input
                  name="password"
                  type="password"
                  placeholder="Tu contraseña"
                  minLength={8}
                  required
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
              </label>
            )}
            {mode === "login" && (
              <button
                type="button"
                className="text-button"
                onClick={() => setMode("reset")}
              >
                Olvidé mi contraseña
              </button>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="success" role="status">
                {message}
              </p>
            )}
            <button
              className="button primary wide"
              disabled={busy || !configured}
            >
              {busy
                ? "Un momento…"
                : mode === "login"
                  ? "Ingresar"
                  : mode === "register"
                    ? "Crear cuenta"
                    : "Enviar instrucciones"}
              <ArrowRight size={17} />
            </button>
          </form>
          <div className="login-switch">
            <button
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setMessage("");
              }}
            >
              {mode === "login"
                ? "¿Primera vez? Crear cuenta"
                : "Volver al ingreso"}
            </button>
          </div>
          {!configured && (
            <p className="setup-note">
              La conexión con Firebase está pendiente de configuración.
            </p>
          )}
          {demoEnabled && (
            <button className="button secondary wide" onClick={onDemo}>
              Explorar demo interactiva <ArrowRight size={17} />
            </button>
          )}
          <p className="login-foot">
            Cada empresa tiene su propio espacio.
            <br />
            Sólo accedés a la información que te corresponde.
          </p>
        </div>
      </section>
    </main>
  );
}
