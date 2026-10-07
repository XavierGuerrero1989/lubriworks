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
