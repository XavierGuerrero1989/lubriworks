# Arquitectura inicial

## Almacenamiento

```text
platformAdmins/{uid}                  # autoridad de plataforma, sólo operador
userTenants/{uid}/tenants/{tenantId}   # índice de descubrimiento, no autoriza
systemJobs/reminders                 # lease y progreso del cron

tenants/{tenantId}                    # id, nombre, estado, versión de esquema
  members/{uid}                      # rol, activo, ficha de cliente opcional
  branches/{id}
  customers/{id}
  vehicles/{id}
  appointments/{id}
  products/{id}                      # stock por producto y sucursal; litros o unidades
  services/{id}                      # combo, mano de obra, intervalos
  orders/{id}                        # precios y costos congelados al crear/editar
  suppliers/{id}
  purchases/{id}
  sales/{id}
  cash/{id}
  movements/{id}
  reminders/{id}
  notifications/{id}
  subscriptions/{hash}                # UID + endpoint; sólo servidor
  deliveries/{hash}                   # intento, lease, estado y reintentos
  operations/{uuid}                   # UID + hash de carga idempotente
  audit/{uuid}                       # actor, acción, destino, fecha
```

## Permisos

| Rol | Alcance |
|---|---|
| Plataforma | Crear/suspender empresas; no habilita lectura de datos comerciales sin membresía propia |
| Administrador | Todos los módulos de la empresa y gestión de accesos |
| Encargado | Operación, compras, precios, caja, reportes y sucursales; no gestiona accesos |
| Técnico | Clientes/vehículos, agenda y órdenes; finaliza servicios, sin cobros ni costos |
| Caja | Clientes/vehículos, agenda/órdenes, productos/precios y cobros; sin compras ni costos |
| Cliente | Sólo ficha, vehículos, órdenes, ventas, turnos, mantenimientos y avisos vinculados a su `customerId` |

Los roles se consultan en Firestore en cada operación; no se confía en un campo enviado por el frontend ni en un claim de tenant. Todas las mutaciones comerciales usan transacción y auditoría. No hay alta de administrador por registro público.

## Cálculo de mantenimiento

- Primera lectura: kilómetros totales / meses desde primera matriculación.
- Cuando existen lecturas separadas por al menos siete días: delta de kilómetros / tiempo transcurrido. Se conservan lecturas anteriores útiles cuando hay actualizaciones muy cercanas.
- El odómetro estimado nunca reemplaza el real ni se escribe como una lectura.
- El vencimiento se calcula por fecha, kilómetros o lo que ocurra primero. El matafuegos usa la fecha cargada por el lubricentro.
- Los intervalos de cada servicio son configurables por el negocio; los valores de demo son ejemplos, no recomendaciones mecánicas universales.

## Límites explícitos de esta primera implementación

- Está preparada para un piloto de poco volumen. Cada operación carga colecciones del tenant en una transacción; es conservador para integridad, pero **no es todavía una arquitectura de consultas para alto volumen**. Hay un límite que falla explícitamente a 2.000 registros por colección, para evitar resultados truncados. Antes de superar ese volumen, reemplazar por repositorios de consultas paginadas y lecturas dirigidas por comando. No usarla como solución de escala ilimitada.
- El cron procesa por presupuesto de tiempo, conserva cursor de empresa y expone `completed`. Si es false, revisar logs y ejecutar nuevamente; para más volumen implementar cola y cursor por recordatorio, y una frecuencia acorde al plan. No hay monitor externo de este estado configurado.
- La agenda admite un turno por horario exacto y sucursal; no calcula duración ni disponibilidad solapada de varios puestos.
- Los combos usan productos específicos de sucursal; se crea otro combo para productos de otra sucursal.
- Sin facturación fiscal/ARCA, pasarela de pago, devoluciones, cuentas corrientes, pagos a proveedores, envíos de WhatsApp, adjuntos ni migración de datos de otros productos. Los comprobantes son internos, no fiscales.
- No se automatizan invitaciones por email: la persona se registra, verifica correo y un administrador la vincula explícitamente.
- El stock se descuenta al finalizar el servicio; se factura/cobra después. Las órdenes cerradas son inmutables. Las correcciones de stock se hacen con movimientos auditados, no editando el número.
- El inventario de esta etapa permite ajustes y recepción; no incluye transferencias entre sucursales.
- Sin backups programados, alertas externas ni restauración automatizada configurados. Definirlos en Firebase antes de operar con datos que requieran recuperación.
- Los formularios en curso se descartan al cambiar de empresa; no se mezclan borradores entre tenants.
- El aislamiento de membresías no reemplaza límites de consumo y protección contra abuso de infraestructura. El endpoint verifica tokens revocados y orígenes; no incluye App Check ni una cuota distribuida por usuario en esta etapa.

## Organización del código

- `shared/model.ts`: esquema de datos, autorización, proyección por rol y estimaciones.
- `shared/engine.ts`: comandos puros y validaciones comerciales.
- `server/rpc.ts`: API autenticada, transacciones, accesos y plataforma.
- `server/store.ts`: persistencia y diferencias de estado.
- `server/reminders.ts`: cron, bandeja, leases y envío push.
- `src/components`: interfaz del lubricentro y portal.
- `src/lib`: Auth, transporte HTTP y suscripción push.
- `tests`: pruebas de dominio, Auth/Firestore emulados y reglas.

## Identidad visual

Azul petróleo `#12343B`, ámbar aceite `#F5A623`, blanco hielo `#F4F7F8`, gris pizarra `#52636B`. El logo proviene de la propuesta aprobada. El ícono de PWA se generó con la herramienta integrada de imágenes, conservando el símbolo y quitando la tipografía.

Prompt del ícono: “Create the PWA app icon for this exact LubriWorks identity. Isolate and preserve ONLY the oil droplet/mechanical nut symbol from the left of the reference logo. No words or text. Center the symbol with generous 20% safe padding on a solid ice white #F4F7F8 square background. Preserve petroleum blue and amber colors and the recognizable shape. Flat clean app icon, square 1024x1024, no corner rounding, no shadows or 3D. Output one icon.” El resultado entregado por la herramienta mide 1254×1254; el manifest declara la dimensión real.
