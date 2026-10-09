import { useEffect, useState } from "react";
import {
  permissionLabels,
  permitted,
  roleLabels,
  type Access,
  type Member,
  type State,
} from "../../shared/model";
import { rpc } from "../lib/api";
import { Section, FormDialog, type Dialog, type Field } from "./ui";
export function AccessDesk({
  access,
  state,
  demo,
}: {
  access: Access;
  state: State;
  demo: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [message, setMessage] = useState("");
  const load = async () => {
    try {
      setMembers(
        demo
          ? [access.member]
          : await rpc<Member[]>("members", {}, access.tenant.id),
      );
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    if (access.member.role === "owner") void load();
  }, [access.tenant.id]);
  const edit = (m?: Member) => {
    const f = (
      key: string,
      label: string,
      extra: Partial<Field> = {},
    ): Field => ({ key, label, type: "text", ...extra });
    setDialog({
      title: m ? "Editar acceso y permisos" : "Vincular un acceso",
      description:
        "Usá un correo registrado en Firebase Auth. Los permisos limitan las acciones del rol; el administrador conserva todos. No se envía verificación de correo.",
      fields: [
        f("email", "Correo de acceso", { type: "email", value: m?.email }),
        f("name", "Nombre", { value: m?.name }),
        f("role", "Rol", {
          value: m?.role ?? "customer",
          options: Object.entries(roleLabels).map(([value, label]) => ({
            value,
            label,
          })),
        }),
        f("customerId", "Ficha de cliente (sólo para rol Cliente)", {
          value: m?.customerId ?? "",
          required: false,
          options: state.customers.map((c) => ({ value: c.id, label: c.name })),
        }),
        ...Object.entries(permissionLabels).map(([key, label]) =>
          f(`permission_${key}`, label, {
            type: "checkbox",
            value:
              m?.permissions?.[key as keyof typeof permissionLabels] !== false,
            hint: "Se aplica únicamente si el rol permite esta acción.",
          }),
        ),
        f("active", "Acceso activo", {
          type: "checkbox",
          value: m?.active ?? true,
        }),
      ],
      submit: async (data) => {
        if (demo)
          throw new Error(
            "Los accesos reales se gestionan en el entorno conectado a Firebase.",
          );
        if (m && data.email.toLowerCase() !== m.email.toLowerCase())
          throw new Error("Conservá el correo del acceso que estás editando.");
        await rpc(
          "member.save",
          {
            email: data.email,
            name: data.name,
            role: data.role,
            active: data.active,
            customerId: data.role === "customer" ? data.customerId : null,
            permissions: Object.fromEntries(
              Object.keys(permissionLabels).map((k) => [
                k,
                data[`permission_${k}`] === true,
              ]),
            ),
          },
          access.tenant.id,
        );
        await load();
        setMessage(
          "Acceso actualizado. Los permisos se aplican en cada operación.",
        );
      },
    });
  };
  return (
    <Section
      title="Accesos y permisos"
      subtitle="Usuarios de la empresa y permisos para precios, descuentos, kilometraje, cobros y entrega."
    >
      <div className="configuration-body">
        <p>
          Los clientes sólo acceden a sus propios vehículos, servicios y avisos.
          La empresa debe conservar un administrador activo.
        </p>
        {access.member.role === "owner" ? (
          <>
            <div className="configuration-slot">
              <button className="button primary" onClick={() => edit()}>
                Vincular un acceso
              </button>
              <button className="button secondary" onClick={() => void load()}>
                Actualizar accesos
              </button>
            </div>
            {members.map((m) => (
              <div key={m.uid} className="payment-row">
                <div>
                  <strong>
                    {m.name} · {roleLabels[m.role]}
                  </strong>
                  <small>
                    {m.email} · {m.active ? "Activo" : "Inactivo"}
                  </small>
                  <small>
                    {Object.entries(permissionLabels)
                      .filter(([k]) =>
                        permitted(m, k as keyof typeof permissionLabels),
                      )
                      .map(([, v]) => v)
                      .join(" · ") || "Sin permisos de cobro o administración"}
                  </small>
                </div>
                <button className="text-button" onClick={() => edit(m)}>
                  Editar acceso
                </button>
              </div>
            ))}
          </>
        ) : (
          <p>
            La gestión de accesos está disponible para el administrador de la
            empresa.
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </div>
      {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
    </Section>
  );
}
