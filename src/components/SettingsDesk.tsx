import { useState } from "react";
import { Building2, Clock, ClipboardCheck } from "lucide-react";
import type { Entity, State } from "../../shared/model";
import type { Command } from "../../shared/engine";
import { Section } from "./ui";
import "./settings.css";
const days = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
];
const split = (v: string) =>
  v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
function BranchSettings({
  branch,
  run,
}: {
  branch: Entity<"branches">;
  run: (c: Command) => Promise<void>;
}) {
  const [b, setB] = useState(branch),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [scheduled, setScheduled] = useState(
    branch.hours !== undefined && branch.scheduleEnabled !== false,
  );
  const [hours, setHours] = useState(
    branch.hours ??
      [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: "08:00", close: "18:00" })),
  );
  const [closed, setClosed] = useState((branch.closedDates ?? []).join("\n"));
  const [technicians, setTechnicians] = useState(
    (branch.technicians ?? []).join("\n"),
  );
  const [stations, setStations] = useState((branch.stations ?? []).join("\n"));
  const [reception, setReception] = useState(
    (branch.receptionChecklist ?? []).join("\n"),
  );
  const [delivery, setDelivery] = useState(
    (branch.deliveryChecklist ?? []).join("\n"),
  );
  const input = (
    key: "name" | "commercialName" | "address" | "phone" | "contactEmail",
    label: string,
    type = "text",
  ) => (
    <label>
      {label}
      <input
        type={type}
        value={b[key] ?? ""}
        required={key === "name"}
        onChange={(e) => setB({ ...b, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <form
      className="configuration-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
          // Keep configured intervals when temporarily disabling schedule validation.
          await run({
            action: "save",
            collection: "branches",
            id: b.id,
            data: {
              ...b,
              scheduleEnabled: scheduled,
              hours,
              closedDates: split(closed),
              technicians: split(technicians),
              stations: split(stations),
              receptionChecklist: split(reception),
              deliveryChecklist: split(delivery),
            },
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Section title="Identidad y contacto" subtitle="Datos de esta sucursal">
        <div className="configuration-grid">
          {input("name", "Nombre de sucursal")}
          {input("commercialName", "Nombre comercial")}
          {input("address", "Dirección")}
          {input("phone", "Teléfono", "tel")}
          {input("contactEmail", "Correo de contacto", "email")}
        </div>
      </Section>
      <Section
        title="Días y horarios"
        subtitle="Los turnos deben comenzar y terminar dentro de un intervalo de atención."
      >
        <div className="configuration-body">
          <label className="configuration-check">
            <input
              type="checkbox"
              checked={scheduled}
              onChange={(e) => setScheduled(e.target.checked)}
            />
            Controlar horarios de atención
          </label>
          {scheduled && (
            <>
              <p>Agregá dos intervalos para un día si cerrás al mediodía.</p>
              {days.map((day, i) => (
                <div className="configuration-day" key={day}>
                  <strong>{day}</strong>
                  <div>
                    {hours.map((h, index) =>
                      h.day === i ? (
                        <div className="configuration-slot" key={index}>
                          <input
                            aria-label={`Apertura ${day}`}
                            type="time"
                            required
                            value={h.open}
                            onChange={(e) =>
                              setHours(
                                hours.map((v, j) =>
                                  j === index
                                    ? { ...v, open: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          />
                          <span>a</span>
                          <input
                            aria-label={`Cierre ${day}`}
                            type="time"
                            required
                            value={h.close}
                            onChange={(e) =>
                              setHours(
                                hours.map((v, j) =>
                                  j === index
                                    ? { ...v, close: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          />
                          <button
                            type="button"
                            className="text-button"
                            aria-label={`Eliminar intervalo ${day}`}
                            onClick={() =>
                              setHours(hours.filter((_, j) => j !== index))
                            }
                          >
                            Quitar
                          </button>
                        </div>
                      ) : null,
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        setHours([
                          ...hours,
                          { day: i, open: "08:00", close: "18:00" },
                        ])
                      }
                    >
                      + Intervalo
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
          <label>
            Fechas de cierre excepcional
            <textarea
              value={closed}
              onChange={(e) => setClosed(e.target.value)}
              placeholder="2026-12-25"
            />
            <small>Una fecha por línea, en formato AAAA-MM-DD.</small>
          </label>
        </div>
      </Section>
      <Section
        title="Técnicos, puestos y capacidad"
        subtitle="Los puestos se asignan por su número en Agenda."
      >
        <div className="configuration-grid">
          <label>
            Capacidad simultánea
            <input
              type="number"
              min={1}
              max={50}
              required
              value={b.appointmentCapacity ?? 1}
              onChange={(e) =>
                setB({ ...b, appointmentCapacity: Number(e.target.value) })
              }
            />
          </label>
          <label>
            Técnicos disponibles
            <textarea
              value={technicians}
              onChange={(e) => setTechnicians(e.target.value)}
              placeholder="Juan Pérez"
            />
            <small>
              Un nombre por línea. Usá esos mismos nombres en los turnos.
            </small>
          </label>
          <label>
            Nombres de puestos
            <textarea
              value={stations}
              onChange={(e) => setStations(e.target.value)}
              placeholder="Elevador 1"
            />
            <small>
              Una línea por puesto, en orden: 1, 2… Deben coincidir con la
              capacidad; vacío conserva la numeración.
            </small>
          </label>
        </div>
      </Section>
      <Section
        title="Controles obligatorios"
        subtitle="Se completan en la ficha de trabajo de cada orden."
      >
        <div className="configuration-grid">
          <label>
            Antes de iniciar el trabajo
            <textarea
              value={reception}
              onChange={(e) => setReception(e.target.value)}
              placeholder="Kilometraje registrado&#10;Estado exterior revisado"
            />
            <small>
              Un control por línea. Vacío permite iniciar sin controles
              obligatorios.
            </small>
          </label>
          <label>
            Antes de entregar el vehículo
            <textarea
              value={delivery}
              onChange={(e) => setDelivery(e.target.value)}
              placeholder="Nivel de aceite verificado&#10;Recomendaciones explicadas"
            />
            <small>
              Un control por línea. Se verifica además que la orden esté
              cobrada.
            </small>
          </label>
        </div>
      </Section>
      {error && (
        <p className="configuration-error" role="alert">
          {error}
        </p>
      )}
      <div className="configuration-save">
        <p>
          Los cambios se verifican contra los turnos vigentes. Reprogramá los
          afectados antes de reducir horarios o recursos.
        </p>
        <button disabled={busy} className="button primary">
          {busy ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
    </form>
  );
}
export function SettingsDesk({
  state,
  run,
  newBranch,
}: {
  state: State;
  run: (c: Command) => Promise<void>;
  newBranch: () => void;
}) {
  const [id, setId] = useState(state.branches[0]?.id ?? "");
  const branch = state.branches.find((b) => b.id === id);
  return (
    <>
      <div className="configuration-intro">
        <div>
          <Building2 />
          <strong>Operación por sucursal</strong>
          <p>
            Configurá cada local del lubricentro. Los accesos siguen
            perteneciendo a la empresa.
          </p>
        </div>
        <button className="button secondary" onClick={newBranch}>
          + Sucursal
        </button>
      </div>
      <div className="configuration-selector">
        <label>
          Sucursal
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {state.branches.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <span>
          <Clock size={16} /> Agenda y capacidad
        </span>
        <span>
          <ClipboardCheck size={16} /> Recepción y entrega
        </span>
      </div>
      {branch && <BranchSettings key={branch.id} branch={branch} run={run} />}
    </>
  );
}
