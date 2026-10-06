# LubriWorks by Brainworks

Primera implementación para lubricentros: React + TypeScript + Vite, Firebase Auth, Firestore y API Node.js en Vercel. Incluye una demo explícita sin credenciales; los cambios de demo se conservan sólo durante la sesión de la página.

## Ejecutar

Requiere Node.js 22.12 o posterior de la rama 22. Si usás nvm, ejecutar `nvm install` y `nvm use` en esta carpeta antes de instalar dependencias.

```sh
npm ci
npm run dev
```

Abrir http://127.0.0.1:5180. Sin Firebase, usar **Explorar demo interactiva**. Se pueden cambiar dos empresas de ejemplo y alternar entre administrador y portal del cliente. No se mezclan datos demo con Firestore. En producción la demo está deshabilitada salvo `VITE_ENABLE_DEMO=true`.

Para conectar Firebase, copiar `.env.example` a `.env.local`, completar las variables y reiniciar el servidor. Las credenciales de servidor nunca llevan prefijo `VITE_` ni se incluyen en el repositorio.

## Funcionalidades

- Empresas, sucursales, miembros y roles: administrador, encargado, técnico, caja y cliente.
- Panel de plataforma separado: alta y suspensión de empresas, asignación inicial de administrador.
- Agenda: solicitudes del cliente, confirmación, técnico y prevención de reservas duplicadas en un horario por sucursal.
- Clientes y vehículos: búsqueda por patente, historial y lecturas reales de odómetro.
- Órdenes: recepción, técnico, checklist, insumos, mano de obra, finalización, consumo de stock y cobro.
- Productos: litros fraccionados, unidades enteras, stock mínimo y ajustes con motivo.
- Compras: proveedores, pedidos, recepción atómica y actualización de costos.
- Servicios: múltiples insumos, mano de obra e intervalo por kilómetros o meses.
- Caja: apertura, ventas directas, cobro de servicios, medios de pago y cierre con diferencia de efectivo.
- Reportes: ventas, margen bruto antes de gastos/mano de obra, ticket promedio, servicios, técnicos y clientes recurrentes; exportación CSV.
- Comprobante de operación imprimible / guardable como PDF desde el navegador. No es una factura fiscal.
- Portal del cliente: vehículos propios, historial, comprobantes, próxima visita, perfil, solicitudes de turno, notificaciones y actualización de kilometraje.
- PWA: manifest, ícono, service worker, pantalla explícita sin conexión, suscripción Web Push y avisos en bandeja.
- Recordatorios diarios por kilometraje estimado o fecha, incluida renovación del matafuegos.

## Multitenancy primero

Se revisaron como referencia las capas de `brainretail-multitenant` y `BrainFleet 2.0` del disco externo. Se conservan membresías autoritativas, índice de accesos no autoritativo, suspensión de tenant, autorización por rol y descarte del contexto anterior. No se reutilizan credenciales ni datos de esos proyectos.

La decisión de almacenamiento para LubriWorks es **Firestore**, con datos bajo `tenants/{tenantId}`. Firebase Auth identifica a la persona; un UID puede pertenecer a varias empresas. Esto es multitenancy de aplicación, no requiere el producto de tenants de Identity Platform.

La API verifica el ID token y su revocación, correo verificado, empresa activa y membresía en cada operación. Los cambios comerciales se ejecutan dentro de transacciones Firestore con clave idempotente y auditoría. Un `tenantId` enviado por el navegador no otorga permisos.

Las reglas Firestore deniegan todo acceso directo del navegador. Las lecturas y escrituras pasan por la API; el Admin SDK las realiza después de autorizar. La proyección del cliente se hace en el servidor y no incluye registros ajenos, notas internas, compras ni costos. Al cambiar de tenant o usuario se cancela y descarta el contexto anterior. El acceso se revalida al operar, cada minuto y al recuperar foco.

## Documentación

- [Firebase y Vercel: pasos de puesta en marcha](docs/PUESTA-EN-MARCHA.md)
- [Modelo, permisos y límites de la primera versión](docs/ARQUITECTURA.md)
- [Verificación y estado de entrega](docs/VERIFICACION.md)

## Validación

```sh
npm test
npm run build
npm run test:emulators
```

El último comando requiere Firebase CLI y Java compatibles con su emulador. Usa exclusivamente el proyecto ficticio `demo-lubriworks`; no necesita credenciales de producción. Puertos: Firestore 8087 y Auth 9097. Las pruebas incluyen aislamiento de empresas, filtrado de clientes, membresías revocadas, tenant suspendido, permisos de Firestore, idempotencia concurrente, stock, caja y cálculo de mantenimiento.
