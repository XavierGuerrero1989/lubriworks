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

## Notificaciones — 8 de octubre de 2026

Se incorporó la sección para propietarios y encargados con resumen, reglas de anticipación por fecha/kilómetros, categorías, pausa por turno, repeticiones de vencidos, plantilla, mensajes individuales o a todos los clientes, historial de lectura/entrega y preferencias. En el portal del cliente hay bandeja con acciones, preferencias por categoría y dispositivos propios.

La revisión de push sigue siendo diaria a las 09:00 de Argentina. El aviso manual aparece inmediatamente en el portal; push queda en cola para el cron. Los estados de entrega representan aceptación del proveedor, no recepción comprobada del teléfono. No hay correo ni WhatsApp. Las reglas y preferencias son independientes por empresa; clientes y dispositivos se validan contra la membresía y el tenant.

Pruebas: reglas por fecha/km, categorías desactivadas, persistencia de preferencias al editar clientes, separación entre empresas, prohibición de administrar reglas desde cliente/técnico, dispositivos propios, destinatarios válidos, idempotencia de mensajes, reintento push con proveedor simulado y cancelación de avisos de mantenimiento ya completado. Revisión visual de pantallas de lubricentro y cliente en navegador local, incluyendo formulario de lectura del tablero. La recepción push en un teléfono real sigue pendiente de prueba.

## Alta de cuentas de cliente — 8 de octubre de 2026

El formulario de nuevo cliente solicita contraseña (mínimo 8 caracteres) y crea Firebase Auth, la ficha, la membresía de cliente y su índice de empresas. No envía correo de verificación ni exige `emailVerified`. Sólo propietarios y encargados pueden dar de alta cuentas. Un correo que ya exista en Auth se conserva sin cambiarle contraseña ni permisos: se vincula mediante Configuración → Accesos. El perfil del cliente agrega Cambiar contraseña con contraseña actual, nueva y confirmación; usa reautenticación y actualización del propio usuario mediante Firebase Auth.

La provisión entre Auth y Firestore utiliza un identificador determinístico de cuenta y un registro de progreso para reintentar errores sin duplicar usuarios. Las contraseñas no se guardan en Firestore, auditoría ni en la huella del alta. Pruebas con Auth/Firestore locales: inicio de sesión sin verificación con contraseña elegida, vínculo automático, idempotencia, cuentas preexistentes, permisos entre empresas, recuperación de falla de persistencia y cambio de contraseña con reautenticación (la contraseña vieja deja de funcionar). Se inspeccionaron ambos formularios en el navegador con datos de demo local.

## Lubri, asistente en pantalla — 8 de octubre de 2026

Se incorporó una mascota vectorial con forma de gota, sonrisa, parpadeo y movimiento suave. El botón flota abajo a la derecha del lubricentro, el portal del cliente y la consola de superadministración. El panel ofrece guías contextuales, búsqueda de consultas frecuentes y enlaces a las secciones habilitadas para el perfil. Las guías describen las funciones implementadas y se mantienen en `src/help/guides.ts`; la búsqueda funciona localmente, sin servicios de IA ni configuración adicional.

Revisión visual en escritorio y móvil: búsqueda de próxima visita, navegación a Servicios y precios, guías del cliente, búsqueda de cambio de contraseña y cierre con Escape que devuelve el foco al botón. También se revisó la consola de plataforma con datos ficticios. La animación respeta `prefers-reduced-motion`; el asistente se oculta al abrir formularios, recibos o menú móvil y no se imprime.

Pruebas de búsqueda y separación de guías por perfil y navegación permitida; compilación de frontend y servidor. Capturas de revisión local en la copia de trabajo: `lubri-assistant-desktop-preview.png` y `lubri-assistant-client-mobile-preview.png`.

## Inicio: tablero operativo (9 de octubre de 2026)

- Tablero por sucursal con llegadas del día y órdenes abiertas de días anteriores. Búsqueda por cliente, patente y responsable; filtro por estado.
- Recepción desde turno con datos precargados y vínculo transaccional; dos recepciones concurrentes no duplican la orden.
- Acciones comenzar, finalizar, cobrar y entregar con permisos en servidor. Entregar requiere cobro, registra actor/hora y completa el turno vinculado.
- Horas de recepción, inicio y finalización calculadas por servidor. Los datos anteriores sin hora no muestran estimaciones inventadas. Los cobros antiguos sin datos de visita quedan en el historial.
- Aprobación: columna preparada; la gestión del presupuesto sigue pendiente del punto 3. Portal del cliente sin cambios de interfaz.
- El borrador previo de puntos 1–11 quedó separado en output/pending-improvements-2026-10-09.tar.gz del workspace local; no forma parte del despliegue.
- Pruebas: tablero por fecha de Argentina, sucursales, estados, permisos, recepción única y entrega. Firebase emulado: concurrencia, aislamiento, persistencia y reintentos idempotentes.

## Agenda: duración, capacidad y reprogramaciones (9 de octubre de 2026)

- Vistas por día y 7 días; búsqueda por cliente/patente/motivo/técnico, filtros de estado, técnico y sucursal. Resumen de solicitudes, pendientes de recepción y ausencias.
- Duración prevista y fin visible, técnico responsable y número de puesto; 0 significa sin asignar. Las sucursales sin capacidad definida conservan un puesto y los turnos antiguos sin duración, 60 minutos. No se migran ni fabrican datos históricos.
- Disponibilidad al completar el formulario, con alternativas desde el horario ingresado. El servidor vuelve a comprobar intervalos, capacidad simultánea, puesto, vehículo y técnico (también entre sucursales del mismo tenant). Intervalos contiguos son válidos. Los turnos solicitados reservan capacidad; los cancelados, ausentes y completados la liberan.
- Reprogramar fecha/hora/sucursal requiere un motivo. El servidor conserva historial, fecha, actor y cambio de horario; el cliente no puede fabricar o borrar ese historial. Cancelar/marcar ausente requiere motivo y ausencia no se admite antes de la hora del turno.
- Recibir cliente desde Agenda reutiliza el alta de orden vinculada de Inicio. Un turno ya recibido conserva fecha, sucursal, vehículo y estado; su entrega completa el turno desde la orden.
- Capacidad configurable por administradores/encargados. Cambiarla no puede invalidar reservas futuras existentes. Los técnicos se identifican por nombre normalizado; se debe usar un nombre consistente. Horarios comerciales, días no laborables y gestión de recursos nominales quedan para Configuración (punto 11). Las alternativas indican disponibilidad de reservas, no apertura del local.
- Pruebas unitarias: límites de intervalos y medianoche, capacidad simultánea (incluyendo turnos sucesivos dentro de un turno largo), técnicos entre sucursales, puestos, vehículos, estados que liberan espacio, motivos largos, historial, capacidad reducida, restricciones de turnos recibidos y campos exclusivos del personal.
- API con Auth/Firestore emulados: dos reservas concurrentes para un puesto producen una aceptación y un rechazo, ampliación de capacidad permite un segundo turno, reducción incompatible se rechaza; persistencia de reprogramación/ausencia, idempotencia y permisos del cliente. Total: 61 pruebas unitarias y 41 de emuladores. Compilación de frontend y servidor exitosa.
- Verificación visual local: superposición rechazada, turno contiguo de 30 minutos guardado, reprogramación a las 12:00 con historial, ausencia con motivo, vistas día/7 días y adaptación a 390 px sin desbordamiento horizontal. Capturas de demo en la copia de trabajo: agenda-desktop-preview.png y agenda-mobile-preview.png.


## Órdenes de servicio: presupuesto y ejecución (9 de octubre de 2026)

- Ficha con búsqueda por patente, cliente, servicio o técnico; filtros separados de trabajo y cobro. Recepción desde turno o nueva orden, con varios servicios e insumos extra. Evita dos órdenes abiertas para el mismo vehículo, incluso con peticiones concurrentes y con el endpoint anterior.
- Presupuesto con precios, mano de obra e intervalos guardados al cotizar, impresión/PDF mediante el navegador, revisiones antes de comenzar e historial de decisiones. Administración/encargado/caja registra la autorización presencial, telefónica o por mensaje, con constancia obligatoria. Una aprobación no se puede sobrescribir ni cambiar de precio por editar el catálogo.
- Adicionales con detalle, precios y autorización o rechazo propio. Los pendientes bloquean inicio/finalización y confirmación de consumos. Las cantidades que excedan lo autorizado requieren un adicional aprobado.
- Consumos reales editables por personal técnico y administradores antes de finalizar: se quitan insumos no usados o se reducen cantidades. Sólo se descuenta stock al finalizar; se factura lo usado a los precios autorizados, preservando precios distintos para el mismo producto en adicionales. La mano de obra aprobada se mantiene.
- Responsable, controles, notas y recomendaciones internas; historial de recepción, decisiones, inicio, consumos, cierre, cobro y entrega. Cancelación con motivo únicamente antes de comenzar; cancela el turno vinculado. Trabajo finalizado, cobro y entrega son estados separados. Entregar exige cobro y completa el turno.
- Al finalizar se genera un mantenimiento por cada servicio incluido, con sus intervalos originales. Las órdenes históricas conservan compatibilidad y no reciben aprobaciones u horarios inventados.
- Fotos privadas de recepción/trabajo/entrega: optimización en el navegador, metadatos en la orden y contenido JPEG separado en Firestore, leído mediante RPC autenticado. No se expone URL pública ni contenido al portal del cliente; sin configuración adicional de Storage. Cada imagen optimizada admite hasta 180 KB para proteger el tamaño de la petición; no hay cuota de cantidad de imágenes.
- API emulada: presupuesto y ejecución con autorización, adicional pendiente y rechazado, consumos reales, stock, cobro y entrega del turno, concurrencia/idempotencia, aislamiento de empresas, denegación al cliente, fotos inválidas/sobredimensionadas y acceso cruzado a otra orden. 68 pruebas unitarias y 43 de emuladores aprobadas. Compilación de frontend y servidor exitosa.
- Revisión visual en demo local: recepción de Lucía desde turno, dos servicios, autorización, adicional de mano de obra, consumo de 3,5 litros frente a 4,5 previstos, finalización, cobro de $122.250 y entrega. Adjuntar/ver foto y presupuesto imprimible. Móvil a 390 px sin desbordamiento horizontal de la página; las tablas tienen desplazamiento interno. Capturas locales: output/orders-desktop-preview.png y output/orders-mobile-preview.png.
- Esta etapa registra las decisiones comunicadas al personal; la autorización desde el portal del cliente y las mejoras de ese portal siguen pendientes. Pagos parciales/combinados y correcciones de trabajos iniciados corresponden a las etapas posteriores.
