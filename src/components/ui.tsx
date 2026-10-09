import { useState, type ReactNode } from "react";
import { X, Search, Inbox, ArrowUpRight } from "lucide-react";
export const money = (v: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(v);
export const number = (v: number) =>
  new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(v);
export const fmtDate = (v: string) =>
  v
    ? new Date(v.slice(0, 10) + "T12:00:00").toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "Sin fecha";
export const labels: Record<string, string> = {
  received: "Recibido",
  working: "En atención",
  ready: "Listo para cobrar",
  paid: "Cobrado",
  requested: "Solicitado",
  confirmed: "Confirmado",
  completed: "Completado",
  waiting: "Esperando autorización",
  approved: "Autorizado",
  rejected: "Rechazado",
  pending: "Pendiente de autorización",
  delivered: "Entregado",
  unpaid: "Sin cobrar",
  legacy: "Orden anterior sin constancia de autorización",
  cancelled: "Cancelado",
  no_show: "Ausente",
  draft: "Pendiente",
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  active: "Activo",
  done: "Realizado",
};
export function Badge({
  value,
  children,
}: {
  value: string;
  children?: ReactNode;
}) {
  return (
    <span className={`badge ${value}`}>
      {children || labels[value] || value}
    </span>
  );
}
export function Empty({
  text = "Todavía no hay registros.",
  action,
}: {
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={32} />
      <h3>{text}</h3>
      <p>Todo lo que cargues aparecerá acá.</p>
      {action}
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <div className="stat">
      <div className="stat-top">
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
export type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  omitWhenEmpty?: boolean;
  readOnly?: boolean;
  options?: { value: string; label: string }[];
  value?: unknown;
  min?: number;
  max?: number;
  hint?: string;
  step?: string;
  minLength?: number;
  maxLength?: number;
  autoComplete?: string;
  showWhen?: { key: string; value: string | string[] };
};
export type Dialog = {
  title: string;
  description?: string;
  fields: Field[];
  submitLabel?: string;
  preview?: (values: Record<string, string>) => ReactNode;
  submit: (data: Record<string, any>) => Promise<void>;
};
export function FormDialog({
  dialog,
  onClose,
}: {
  dialog: Dialog;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        dialog.fields.map((f) => [f.key, String(f.value ?? "")]),
      ),
    );
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="modal"
      >
        <header>
          <div>
            <h2 id="dialog-title">{dialog.title}</h2>
            <p>{dialog.description || "Completá los datos para continuar."}</p>
          </div>
          <button
            className="icon-button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={busy}
          >
            <X />
          </button>
        </header>
        <form
          onInput={(e) => {
            setError("");
            setFieldValues(
              Object.fromEntries(
                Array.from(new FormData(e.currentTarget).entries()).map(
                  ([key, value]) => [key, String(value)],
                ),
              ),
            );
          }}
          onChange={(e) => {
            setError("");
            setFieldValues(
              Object.fromEntries(
                Array.from(new FormData(e.currentTarget).entries()).map(
                  ([key, value]) => [key, String(value)],
                ),
              ),
            );
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const fd = new FormData(e.currentTarget);
            const data: Record<string, any> = {};
            for (const f of dialog.fields)
              data[f.key] =
                f.type === "choices"
                  ? fd.getAll(f.key).map(String)
                  : f.type === "lines"
                    ? JSON.parse(String(fd.get(f.key) || "[]"))
                    : f.type === "number"
                      ? f.omitWhenEmpty && !fd.get(f.key)
                        ? undefined
                        : Number(fd.get(f.key))
                      : f.type === "checkbox"
                        ? fd.has(f.key)
                        : String(fd.get(f.key) || "");
            try {
              await dialog.submit(data);
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            {dialog.fields
              .filter(
                (f) =>
                  !f.showWhen ||
                  (Array.isArray(f.showWhen.value)
                    ? f.showWhen.value.includes(fieldValues[f.showWhen.key])
                    : fieldValues[f.showWhen.key] === f.showWhen.value),
              )
              .map((f, i) =>
                f.type === "choices" ? (
                  <fieldset className="form-choices full" key={f.key}>
                    <legend>{f.label}</legend>
                    {f.options?.map((o) => (
                      <label key={o.value}>
                        <input
                          type="checkbox"
                          name={f.key}
                          value={o.value}
                          defaultChecked={
                            Array.isArray(f.value) && f.value.includes(o.value)
                          }
                        />{" "}
                        {o.label}
                      </label>
                    ))}
                    {f.hint && <small>{f.hint}</small>}
                  </fieldset>
                ) : f.type === "lines" ? (
                  <div key={f.key} className="full">
                    <p className="field-label">{f.label}</p>
                    <Lines field={f} />
                  </div>
                ) : (
                  <label
                    key={f.key}
                    className={f.type === "textarea" ? "full" : ""}
                  >
                    {f.label}
                    {f.required !== false && f.type !== "checkbox" && (
                      <span className="required"> *</span>
                    )}
                    {f.type === "lines" ? (
                      <Lines field={f} />
                    ) : f.options ? (
                      <select
                        name={f.key}
                        defaultValue={String(f.value ?? "")}
                        required={f.required !== false}
                        autoFocus={i === 0}
                      >
                        <option value="">Seleccionar…</option>
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : f.type === "textarea" ? (
                      <textarea
                        name={f.key}
                        defaultValue={String(f.value ?? "")}
                        rows={3}
                        required={f.required !== false}
                        maxLength={f.maxLength}
                      />
                    ) : f.type === "checkbox" ? (
                      <input
                        type="checkbox"
                        name={f.key}
                        defaultChecked={Boolean(f.value)}
                      />
                    ) : (
                      <input
                        autoFocus={i === 0}
                        name={f.key}
                        type={f.type || "text"}
                        minLength={f.minLength}
                        maxLength={f.maxLength}
                        autoComplete={f.autoComplete}
                        readOnly={f.readOnly}
                        required={f.required !== false}
                        defaultValue={String(f.value ?? "")}
                        min={f.min ?? (f.type === "number" ? 0 : undefined)}
                        max={f.max}
                        step={
                          f.step ?? (f.type === "number" ? "0.01" : undefined)
                        }
                      />
                    )}{" "}
                    {f.hint && <small>{f.hint}</small>}
                  </label>
                ),
              )}
          </div>
          {dialog.preview?.(fieldValues)}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "Guardando…" : dialog.submitLabel || "Guardar"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "Buscar…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={18} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function LinkButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ArrowUpRight size={15} />
    </button>
  );
}
export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+\-@]/, "'$&")
      .replaceAll('"', '""') +
    '"';
  const blob = new Blob(
    [
      "\ufeff" +
        [
          keys.map(cell).join(";"),
          ...rows.map((r) => keys.map((k) => cell(r[k])).join(";")),
        ].join("\r\n"),
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function Lines({ field }: { field: Field }) {
  const [rows, setRows] = useState<
    { productId: string; quantity: number; cost: number }[]
  >((field.value as any[]) || []);
  return (
    <div className="lines">
      <input type="hidden" name={field.key} value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div className="line-row" key={i}>
          <select
            aria-label="Producto"
            required
            value={r.productId}
            onChange={(e) =>
              setRows(
                rows.map((v, j) =>
                  j === i ? { ...v, productId: e.target.value } : v,
                ),
              )
            }
          >
            <option value="">Producto…</option>
            {field.options?.map((o) => (
              <option value={o.value} key={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Cantidad"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={r.quantity}
            onChange={(e) =>
              setRows(
                rows.map((v, j) =>
                  j === i ? { ...v, quantity: Number(e.target.value) } : v,
                ),
              )
            }
          />
          {field.hint === "purchase" && (
            <input
              aria-label="Costo unitario"
              type="number"
              min="0"
              step="0.01"
              required
              value={r.cost}
              onChange={(e) =>
                setRows(
                  rows.map((v, j) =>
                    j === i ? { ...v, cost: Number(e.target.value) } : v,
                  ),
                )
              }
            />
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Quitar producto"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        onClick={() =>
          setRows([...rows, { productId: "", quantity: 1, cost: 0 }])
        }
      >
        + Agregar producto
      </button>
    </div>
  );
}
