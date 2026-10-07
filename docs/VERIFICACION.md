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
- Falta designar la cuenta inicial de superadministrador, crear el primer tenant y probar recepción push en un dispositivo con consentimiento.
