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

- No hay un tope de 2.000 registros por colección. La API transporta historiales en páginas de 200, autoriza cada página y el cliente reúne el historial completo para conservar los totales y reportes existentes. Las operaciones comerciales leen sólo sus registros y dependencias (productos, vehículo, servicio, caja abierta y validaciones de duplicados), sin cargar todas las colecciones del tenant. La carga inicial de pantallas operativas todavía conserva el historial completo en memoria: su tiempo y memoria pueden crecer con volúmenes grandes; no se promete capacidad ilimitada de dispositivos o infraestructura.
- Los KPI de clientes, vehículos, órdenes y ventas por empresa se calculan con agregaciones `count()` de Firestore sobre las colecciones completas. No dependen de las páginas de historial cargadas por el navegador. Ventas es cantidad de operaciones, no importe facturado.
- El cron consume recordatorios y suscripciones gradualmente por páginas, conserva cursor de empresa y cursor de recordatorio dentro de la empresa, y expone `completed`. Si es false, revisar logs y ejecutar nuevamente; la frecuencia de ejecución y recursos del plan siguen condicionando cuánto se procesa por día. No hay monitor externo de este estado configurado.
- La agenda admite un turno por horario exacto y sucursal; no calcula duración ni disponibilidad solapada de varios puestos.
- Los combos usan productos específicos de sucursal; se crea otro combo para productos de otra sucursal.
- Sin facturación fiscal/ARCA, pasarela de pago, devoluciones, cuentas corrientes, pagos a proveedores, envíos de WhatsApp, adjuntos ni migración de datos de otros productos. Los comprobantes son internos, no fiscales.
- No se automatizan invitaciones por email: la persona se registra y un administrador la vincula explícitamente.
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

## Compatibilidad del runtime de Vercel

El backend usa importaciones relativas con extensión `.js` y una comprobación TypeScript con `NodeNext`. El build ejecuta `check:runtime` con `--no-experimental-require-module` para detectar dependencias que no arrancan en Vercel. Firebase Admin 14 usa `jwks-rsa` 4, que requiere `jose` sin importar dinámicamente su edición ESM. Se fija `jose` 5.10 dentro de `jwks-rsa` mediante un override acotado; la carga de Auth, Firestore y Web Push se verifica durante cada build. Seguimiento del problema: https://github.com/auth0/node-jwks-rsa/issues/507.
