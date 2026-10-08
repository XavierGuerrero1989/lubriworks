# Verificación de la entrega inicial

Fecha: 5 de octubre de 2026.

## Comprobado localmente

- Auditoría de dependencias npm: 0 vulnerabilidades detectadas al entregar.
- Compilación TypeScript de frontend, API y scripts; build de producción Vite.
- 33 pruebas de dominio: membresía y tenant, proyección por rol, pertenencia del vehículo, stock, cobros, compras, caja, estimación, fechas y autenticación del cron.
- 16 pruebas de integración de la API con Firebase Auth y Firestore emulados: token inválido, índice falso, aislamiento de dos empresas, cliente restringido, administración de miembros, último administrador, concurrencia e idempotencia, endpoint push, revocación, suspensión y generación idempotente de notificaciones del cron.
- 2 pruebas de reglas Firestore: denegación de acceso directo incluso con claims falsos, y acceso anónimo.
- Prueba de navegador: entrar a demo; finalizar una orden; comprobar descuento de insumo; cobrar; abrir el portal del cliente y editar perfil; consultar próximo mantenimiento; cambiar a otra empresa sin heredar órdenes/ventas; crear un combo con litros fraccionados y verificar su total.
- Revisión visual de escritorio (1440 px) y móvil (390 px). Capturas en `docs/screenshots`.

## Pendiente de cuentas y entorno real

- Proyecto Firebase real y claves de servidor.
- Registro, correo de verificación, recuperación de contraseña y vinculación con cuentas reales.
- Alta de repositorio/proyecto Vercel y despliegue HTTPS.
- Ejecución del cron en Vercel, suscripción push en dispositivos reales y recepción con la PWA cerrada.
- Prueba de instalación en dispositivos iOS/Android físicos.
- Impresión/PDF del comprobante en los navegadores de operación.

Las pruebas de emulador no validan configuración de credenciales, IAM, dominios autorizados ni cuotas de producción. No se enviaron correos ni notificaciones a personas reales, ni se modificaron BrainRetail o BrainFleet.

## Verificación en producción — 7 de octubre de 2026

- Dominio `lubriworks.vercel.app` autorizado en Firebase Auth.
- Reglas de Firestore compiladas y publicadas en `lubriworks-77db2`.
- Web Push configurado en Vercel con claves privadas como secretos y contacto `xavier@brainworks.ar`; cron diario habilitado.
- API sin sesión: HTTP 401. Cron sin credencial: HTTP 401.
- Cron autorizado: HTTP 200, `completed: true`, `pushConfigured: true`, cero notificaciones y cero envíos (sin datos elegibles de clientes). Confirma conexión real con Firebase Admin y Firestore.
- Build y comprobación de arranque sin require(ESM) aprobados; 33 pruebas de negocio y 18 de API/reglas en emuladores aprobadas. npm audit: cero vulnerabilidades.
- Cuenta inicial de superadministrador designada y verificada. Falta crear el primer tenant y probar recepción push en un dispositivo con consentimiento.


## Consola de superadministración — 7 de octubre de 2026

- Estructura basada en los paneles existentes de BrainFleet y BrainRetail: Resumen, Empresas y usuarios, Soporte, Auditoría y Ayuda. Identidad visual propia de LubriWorks.
- Las cuentas de plataforma entran directamente al resumen después del login; pueden volver a sus accesos operativos y regresar a la consola.
- Indicadores reales de Firestore: cantidad global de empresas activas/suspendidas; membresías, clientes, vehículos y órdenes de las empresas de la página. Paginación de 50 empresas y alcance indicado en pantalla.
- Alta y suspensión/reactivación de empresas, consulta de equipos y asignación/edición de roles por empresa. Cuentas existentes, habilitadas y con correo verificado. Protección del último administrador activo, vínculo de cliente dentro del mismo tenant y auditoría de cambios.
- Soporte ofrece diagnóstico de accesos. Abrir una operación requiere una membresía activa propia; no incluye suplantación de cuentas ni sesiones de edición como soporte.
- Auditoría muestra hasta 40 eventos recientes, con un máximo de 8 por empresa de la página. El directorio de miembros/clientes admite hasta 2000 registros por empresa y muestra un error explícito si requiere paginación adicional.
- Build de producción y comprobación de runtime aprobados. 33 pruebas de dominio y 24 pruebas de API/reglas con Firebase emulado aprobadas (57 en total). Las nuevas pruebas cubren permisos de plataforma, indicadores, aislamiento del directorio, asignación de roles, último administrador y revocación.
- Revisión visual de escritorio (1440 px) y móvil (390 px) usando el componente real con datos de ejemplo en un entorno local separado. Las capturas `platform-desktop-preview.jpg` y `platform-mobile-preview.jpg` contienen datos de ejemplo; no representan empresas de producción.


## Acceso sin verificación de correo — 7 de octubre de 2026

Por pedido explícito del titular para todas las empresas, se retiró el requisito de `emailVerified` en login, registro, API, asignación de miembros, alta de empresas y bootstrap. No se modifica el estado de verificación almacenado en Firebase. Se mantienen token válido con revocación comprobada, cuentas habilitadas, membresías explícitas, roles, aislamiento de tenants y reglas Firestore sin acceso directo. Las cuentas de las pruebas de API se crean con correo sin verificar para comprobar los flujos en esa condición.

Build de producción aprobado y 26 pruebas de API/reglas en emuladores aprobadas con cuentas sin verificar, incluyendo alta de empresas y rechazo de cuentas deshabilitadas. La cuenta solicitada por el usuario quedó vinculada como owner de `lubricentro-demo`, con índice de acceso y auditoría.


## Ingreso con un único lubricentro — 7 de octubre de 2026

Una cuenta común con una única membresía entra directamente a su lubricentro después del login o al restaurar la sesión. El número de sucursales no interviene. Se conserva el selector para múltiples empresas y el ingreso del superadmin a plataforma. Al abrir los accesos operativos desde plataforma también se abre directamente la única empresa. La carga conserva comprobaciones de generación y cancelación para evitar datos de una sesión anterior; un fallo de carga ofrece reintento sin selector para cuentas con un único acceso.

Build aprobado. Revisión local del componente App real con autenticación y datos ficticios: una empresa con dos sucursales abrió Inicio; dos empresas mostraron el selector; un fallo simulado mostró error y Reintentar.


## Historial sin tope de 2.000 y KPI por empresa — 8 de octubre de 2026

- API `snapshot`/`state.page` con páginas de 200 registros y verificación de tenant, membresía y proyección por rol en cada solicitud. El cliente obtiene todas las páginas sin truncar los reportes. Se cancela el resultado si cambia el rol o el vínculo de cliente durante la carga.
- Consultas dirigidas por comando: finalizar órdenes, cobros, stock, recepción de compras, perfiles y lecturas ya no cargan todas las colecciones del tenant. Las lecturas de ventas para cerrar caja se acotan desde su apertura; las validaciones de duplicados se consultan por clave, sucursal/horario o vínculo pertinente. Se conservan transacciones, idempotencia y auditoría.
- Directorios de plataforma y usuarios sin el anterior tope; consultas internas por páginas. Cron con iteración gradual y reanudación dentro de una empresa con muchos recordatorios.
- Panel de superadmin: tabla por lubricentro y tarjetas en Empresas y usuarios con totales de clientes, vehículos, órdenes y ventas, obtenidos mediante conteos de Firestore. Totales agregados de portada indican su alcance por página de empresas.
- 35 pruebas de negocio/transporte y 29 de API/reglas aprobadas (64). Caso de carga con 2.108 clientes y vehículos, 2.107 órdenes y ventas; recorrido de todas las páginas sin duplicados; conteos exactos, directorio completo, cierre de orden con una sola orden/vehículo cargados, restricciones y revocación en cada página; cron reanuda una empresa con más de 2.100 recordatorios activos.
- Revisión visual de las tarjetas en escritorio y celular usando datos ficticios. Captura `tenant-kpis-preview.jpg` corresponde a revisión local, no a los valores de producción.
- Los tamaños por página, validaciones de entrada, presupuesto de tiempo del cron y límites técnicos de Firebase/Vercel se mantienen; no son cuotas de registros por lubricentro. La carga inicial de la interfaz operativa sigue reuniendo el historial completo en memoria y puede volverse pesada con historiales muy grandes.
