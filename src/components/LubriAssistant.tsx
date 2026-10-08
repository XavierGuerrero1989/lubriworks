import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search, X, ChevronLeft } from "lucide-react";
import { findGuides, type GuideScope } from "../help/guides";
import "./assistant.css";
function LubriFace() {
  return (
    <svg viewBox="0 0 80 86" aria-hidden="true" className="lubri-face">
      <path
        d="M40 4C34 17 12 35 12 53a28 28 0 0 0 56 0C68 35 46 17 40 4Z"
        fill="#ffb12a"
      />
      <path
        d="M26 29c-7 9-10 17-10 24"
        fill="none"
        stroke="#ffe2a5"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M17 54c3 15 12 23 25 23 8 0 16-4 21-9-4 11-13 17-23 17-14 0-25-12-25-27Z"
        fill="#f49c15"
        opacity=".6"
      />
      <g className="lubri-eyes">
        <ellipse cx="30" cy="47" rx="3.8" ry="5.3" fill="#12343b" />
        <ellipse cx="50" cy="47" rx="3.8" ry="5.3" fill="#12343b" />
        <circle cx="31" cy="45" r="1.2" fill="white" />
        <circle cx="51" cy="45" r="1.2" fill="white" />
      </g>
      <ellipse cx="23" cy="57" rx="5" ry="3" fill="#ee845c" opacity=".55" />
      <ellipse cx="57" cy="57" rx="5" ry="3" fill="#ee845c" opacity=".55" />
      <path
        d="M31 59q9 11 18 0"
        fill="none"
        stroke="#12343b"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M31 18h18l-3 6H34Z" fill="#12343b" opacity=".8" />
    </svg>
  );
}
export function LubriAssistant({
  scope,
  context,
  allowed,
  onNavigate,
}: {
  scope: GuideScope;
  context: string;
  allowed: string[];
  onNavigate: (section: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [all, setAll] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const available = findGuides("", scope, allowed, context),
    results = findGuides(query, scope, allowed, context),
    guide = available.find((g) => g.id === selected);
  function close() {
    setOpen(false);
    launcher.current?.focus();
  }
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  return (
    <div className="lubri-assistant">
      {open && (
        <section
          id="lubri-assistant-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="lubri-assistant-title"
          className="lubri-panel"
        >
          <header className="lubri-header">
            <span className="lubri-avatar">
              <LubriFace />
            </span>
            <div>
              <h2 id="lubri-assistant-title">Lubri</h2>
              <p>Tu guía en LubriWorks</p>
            </div>
            <button
              type="button"
              className="lubri-icon-button"
              aria-label="Cerrar asistente"
              onClick={close}
            >
              <X size={20} />
            </button>
          </header>
          <div className="lubri-content">
            {guide ? (
              <>
                <button
                  className="lubri-back"
                  type="button"
                  onClick={() => {
                    setSelected("");
                    input.current?.focus();
                  }}
                >
                  <ChevronLeft size={16} />
                  Volver a las guías
                </button>
                <h3>{guide.title}</h3>
                <ol className="lubri-steps">
                  {guide.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
                {guide.note && <p className="lubri-note">{guide.note}</p>}
                <button
                  className="lubri-open-section"
                  type="button"
                  onClick={() => {
                    onNavigate(guide.destination);
                    close();
                  }}
                >
                  Abrir esta sección <ArrowRight size={17} />
                </button>
              </>
            ) : (
              <>
                <div className="lubri-greeting">
                  <strong>¡Hola! Soy Lubri 👋</strong>
                  <p>
                    Te ayudo a encontrar cómo hacer las cosas. Escribí tu
                    consulta o elegí una guía.
                  </p>
                </div>
                <p className="lubri-list-label">
                  {query.trim()
                    ? "Guías para tu consulta"
                    : "Para empezar desde acá"}
                </p>
                {results.length ? (
                  <div className="lubri-guides">
                    {results.slice(0, all ? results.length : 5).map((g) => (
                      <button
                        type="button"
                        key={g.id}
                        onClick={() => setSelected(g.id)}
                      >
                        {g.title}
                        <ArrowRight size={16} />
                      </button>
                    ))}
                    {results.length > 5 && !all && (
                      <button
                        type="button"
                        className="lubri-more"
                        onClick={() => setAll(true)}
                      >
                        Ver las {results.length} guías
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="lubri-note" role="status">
                    Todavía no encontré una guía para esa consulta. Probá con
                    palabras como{" "}
                    {scope === "customer"
                      ? "contraseña, kilómetros o turno"
                      : scope === "platform"
                        ? "empresa, acceso o auditoría"
                        : "cliente, orden, stock o notificaciones"}
                    .
                  </p>
                )}
              </>
            )}
          </div>
          <form
            className="lubri-search"
            onSubmit={(e) => {
              e.preventDefault();
              if (results.length && query.trim()) setSelected(results[0].id);
            }}
          >
            <label className="sr-only" htmlFor="lubri-question">
              Tu consulta para Lubri
            </label>
            <input
              ref={input}
              id="lubri-question"
              maxLength={250}
              autoComplete="off"
              placeholder="¿Cómo hago…?"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected("");
                setAll(false);
              }}
            />
            <button type="submit" aria-label="Buscar ayuda">
              <Search size={20} />
            </button>
          </form>
          <p className="lubri-footer">Guías paso a paso para tu perfil</p>
        </section>
      )}
      <button
        ref={launcher}
        type="button"
        className={`lubri-launcher ${open ? "is-open" : ""}`}
        aria-label={
          open
            ? "Cerrar Lubri, asistente de ayuda"
            : "Abrir Lubri, asistente de ayuda"
        }
        aria-expanded={open}
        aria-controls="lubri-assistant-panel"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <LubriFace />
        <span>Lubri</span>
      </button>
    </div>
  );
}
