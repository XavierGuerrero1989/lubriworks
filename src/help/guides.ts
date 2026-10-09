export type GuideScope = "staff" | "customer" | "platform";
export type HelpGuide = {
  id: string;
  scope: GuideScope;
  section: string;
  title: string;
  keywords: string;
  steps: string[];
  note?: string;
  destination: string;
  requires?: string[];
};
export const guides: HelpGuide[] = [
  {
    id: "staff-start",
    requires: [
      "settings",
      "products",
      "services",
      "customers",
      "orders",
      "sales",
    ],
    scope: "staff",
    section: "dashboard",
    title: "¿Cómo empiezo a usar el lubricentro?",
    keywords: "inicio empezar primeros pasos circuito trabajar",
    steps: [
      "Cargá las sucursales en Configuración y los productos en Productos y stock.",
      "Definí los servicios, sus insumos, precio de mano de obra e intervalo de mantenimiento en Servicios y precios.",
      "Registrá al cliente y su vehículo en Clientes y vehículos.",
      "Creá la orden, registrá la autorización del presupuesto, comenzá el trabajo y confirmá los consumos reales antes de finalizar. Luego cobrá y entregá el vehículo.",
    ],
    note: "Cada persona ve las secciones habilitadas para su rol.",
    destination: "dashboard",
  },
  {
    id: "staff-dashboard",
    scope: "staff",
    section: "dashboard",
    title: "¿Cómo uso el tablero de Inicio?",
    keywords:
      "inicio tablero llegada recibir recepcion comenzar finalizar cobrar entregar entrega tiempos espera responsable sucursal",
    steps: [
      "Filtrá la sucursal y consultá Próximas llegadas. Recibir cliente abre la orden con los datos del turno; elegí el servicio y confirmá el kilometraje real.",
      "Las tarjetas muestran el estado, responsable y tiempo registrado. Usá Comenzar, Finalizar y Cobrar según corresponda a tu rol.",
      "Después del cobro, Entregar vehículo registra la entrega y completa el turno vinculado. El vehículo sale del tablero y conserva su historial.",
      "Buscá por patente, cliente o responsable y tocá un contador para filtrar un estado.",
    ],
    note: "Los registros antiguos sin hora muestran Sin hora registrada. Los presupuestos y adicionales pendientes se resuelven desde la ficha en Órdenes de servicio.",
    destination: "dashboard",
  },
  {
    id: "staff-customer",
    requires: ["settings"],
    scope: "staff",
    section: "customers",
    title: "¿Cómo doy de alta a un cliente?",
    keywords:
      "alta nuevo cliente registrar cuenta correo mail email contraseña acceso auth",
    steps: [
      "Entrá a Clientes y vehículos y tocá + Cliente.",
      "Completá nombre, correo, contraseña de acceso (al menos 8 caracteres) y los datos de contacto.",
      "Guardá. El sistema crea la ficha, su cuenta y el acceso a este lubricentro.",
      "El cliente ingresa con ese correo y contraseña; no necesita verificar el correo.",
    ],
    note: "Sólo administrador y encargado crean cuentas. Si el correo ya tiene cuenta, vinculala desde Configuración → Accesos; su contraseña se conserva.",
    destination: "customers",
  },
  {
    id: "staff-vehicle",
    scope: "staff",
    section: "customers",
    title: "¿Cómo registro un vehículo?",
    keywords:
      "vehiculo auto patente kilometros kilometraje matafuegos año antiguedad",
    steps: [
      "En Clientes y vehículos, tocá + Vehículo y elegí al cliente.",
      "Completá patente, marca, modelo y año del vehículo.",
      "Cargá la lectura real del tablero y la fecha de lectura.",
      "Indicá si tiene matafuegos. Si tiene, cargá su vencimiento, incluso si ya venció. Marcá si quiere comprar uno nuevo y guardá.",
    ],
    note: "La antigüedad y el kilometraje permiten estimar el uso inicial. Las próximas lecturas mejoran la estimación.",
    destination: "customers",
  },
  {
    id: "staff-customer-file",
    scope: "staff",
    section: "customers",
    title: "¿Cómo uso la ficha del cliente y corrijo kilometraje?",
    keywords:
      "ficha cliente historial visita actual aceite especificación capacidad filtros técnica notas recomendación resolver corregir kilometraje lectura motivo",
    steps: [
      "Buscá una patente, nombre, correo o teléfono en Clientes y vehículos y elegí la ficha.",
      "Seleccioná un vehículo o Todos los vehículos del cliente para consultar visitas, turnos, mantenimientos e historial de todas las sucursales.",
      "En Editar vehículo / ficha técnica, cargá la especificación y capacidad de aceite confirmadas y los códigos de filtros compatibles. Las observaciones técnicas y las notas del cliente son internas.",
      "Cargá por separado las Recomendaciones para el cliente y marcá su resolución con una explicación cuando se atiendan. Su presentación en el portal se incorporará en la etapa del cliente.",
      "Nueva lectura real registra una medición que no puede disminuir. Si hubo un error, administrador o encargado usa Corregir kilometraje y explica el motivo. Quedan guardados el valor anterior, responsable y fecha.",
      "Abrí la orden de la visita actual para continuar el trabajo, Recibir sin turno para una nueva visita o Agendar turno para reservar.",
    ],
    note: "Una corrección reinicia la base de cálculo del uso promedio y no cambia órdenes históricas ni mantenimientos programados. No se permite una lectura que contradiga una visita abierta. Las lecturas anteriores a esta función no reciben un historial inventado.",
    destination: "customers",
  },
  {
    id: "staff-order",
    scope: "staff",
    section: "orders",
    title: "¿Cómo hago una orden de servicio?",
    keywords:
      "orden servicio taller recibir trabajar finalizar atender checklist",
    steps: [
      "En Órdenes de servicio, tocá Nueva orden.",
      "Elegí vehículo, sucursal y servicio; registrá kilometraje, técnico y observaciones.",
      "Actualizá el estado mientras el vehículo está en atención.",
      "Al terminar, tocá Finalizar. Se descuentan los insumos y se registra el próximo mantenimiento.",
      "El personal con permisos de caja cobra la orden cuando corresponda, con la caja abierta en esa sucursal.",
    ],
    note: "Finalizar no equivale a cobrar. Una orden finalizada queda lista para cobrar.",
    destination: "orders",
  },
  {
    id: "staff-interval",
    scope: "staff",
    section: "services",
    title: "¿Dónde indico cuándo debe volver el auto?",
    keywords:
      "volver vuelve volvera retorno proximo mantenimiento cambio aceite filtro intervalo periodo meses fecha kilometros kilometrage service",
    steps: [
      "Abrí Servicios y precios y creá o editá el servicio.",
      "Cargá Próximo servicio: kilómetros y Próximo servicio: meses.",
      "La orden guarda esos intervalos al crearla. Al finalizar el servicio, se genera el próximo mantenimiento.",
      "Se considera lo que ocurra primero: kilómetros o fecha. La anticipación del aviso se define en Notificaciones → Reglas automáticas.",
    ],
    note: "Editar un servicio no cambia las órdenes que ya fueron creadas. El kilometraje calculado es una estimación: se confirma con el tablero.",
    destination: "services",
  },
  {
    id: "staff-appointment",
    scope: "staff",
    section: "appointments",
    title: "¿Cómo agendo o confirmo un turno?",
    keywords:
      "agenda agendar turno cita reservar confirmar cancelar horario duración capacidad puesto técnico reprogramar ausente ausencia",
    steps: [
      "Entrá a Agenda y tocá Nuevo turno.",
      "Definí la capacidad de cada sucursal desde Configurar capacidad: es la cantidad de puestos de atención simultánea.",
      "Elegí vehículo, fecha, hora, duración, técnico y puesto. Usá 0 si todavía no asignaste un puesto. Revisá la disponibilidad antes de guardar.",
      "Filtrá por día o por 7 días, estado y técnico. Para confirmar una solicitud, editá su estado a Confirmado.",
      "Para reprogramar, cambiá la fecha, hora o sucursal y explicá el motivo; queda un historial en el turno.",
      "Cancelar turno o Marcar ausente requieren un motivo y liberan la reserva. Ausente solo se admite después de la hora acordada.",
      "Cuando llegue, tocá Recibir cliente para crear la orden vinculada. Un turno recibido se gestiona desde la orden y se completa al entregar el vehículo.",
    ],
    note: "Los turnos sin duración se consideran de 60 minutos y las sucursales sin capacidad definida, de un puesto. Las sugerencias controlan reservas y capacidad; confirmá que el horario coincida con la atención del local.",
    destination: "appointments",
  },
  {
    id: "staff-order-desk",
    scope: "staff",
    section: "orders",
    title: "¿Cómo trabajo con una orden de servicio?",
    keywords:
      "orden presupuesto aprobar autorizar autorización adicional consumo real fotos trabajo entrega finalizar cancelar revisión imprimir",
    steps: [
      "Recibí al cliente desde Inicio o Agenda, o creá una orden desde Órdenes de servicio. Elegí los servicios, insumos adicionales y kilometraje real.",
      "Revisá el presupuesto y usá Imprimir presupuesto para compartirlo. Registrá la decisión del cliente, el medio y una constancia de quién autorizó o rechazó.",
      "Comenzá el trabajo. Si aparece algo nuevo, proponé un adicional y registrá su decisión. El precio autorizado se conserva aunque cambie el catálogo.",
      "Actualizá responsable, controles realizados, notas y recomendaciones. Adjuntá fotos de recepción, trabajo o entrega en la ficha.",
      "Confirmá los consumos reales: quitá lo que no se usó y corregí cantidades. Para superar lo autorizado, registrá primero un adicional aprobado.",
      "Finalizá: se descuenta el stock utilizado y se generan los próximos mantenimientos de los servicios incluidos. Cobrá y luego entregá el vehículo para completar el turno vinculado.",
    ],
    note: "Las autorizaciones las registra el personal a partir de lo comunicado por el cliente. Las fotos y recomendaciones son internas. Una orden iniciada no puede cancelarse desde esta ficha. Los presupuestos rechazados pueden revisarse antes de comenzar.",
    destination: "orders",
  },
  {
    id: "staff-stock",
    scope: "staff",
    section: "products",
    title: "¿Cómo cargo y controlo el stock?",
    keywords:
      "stock inventario fisico reservado disponible producto aceite insumos sku ubicacion compatibilidad ajuste movimientos minimo faltante reserva",
    steps: [
      "Agregá el producto con código, unidad, sucursal, stock inicial y mínimo. Podés cargar ubicación y compatibilidades confirmadas según ficha técnica o catálogo.",
      "Físico es la existencia registrada; reservado son insumos autorizados en órdenes abiertas; disponible es físico menos reservado. Las alertas se calculan sobre el disponible.",
      "Autorizar un presupuesto o adicional reserva sus insumos si hay disponibilidad. Los adicionales pendientes no reservan. Una venta de mostrador no puede tomar insumos reservados para otras órdenes.",
      "En Detalle / reservas consultá qué órdenes retienen stock y abrí su ficha. Cancelar libera la reserva. Finalizar descuenta sólo el consumo real y libera lo que no se utilizó; confirmar un consumo menor todavía no libera la reserva.",
      "Administración puede consultar Movimientos o corregir el físico con motivo en Ajustar. Si la corrección deja menos físico que reservado, aparece el faltante; reponé o revisá el trabajo antes de continuar.",
    ],
    note: "Las órdenes anteriores que ya estaban en atención protegen sus insumos sin inventar autorizaciones. Las compras recibidas aumentan el físico; una compra pendiente y un turno futuro todavía no reservan ni agregan existencias. La unidad no cambia mientras existan stock o reservas.",
    destination: "products",
  },
  {
    id: "staff-purchase",
    scope: "staff",
    section: "purchases",
    title: "¿Cómo registro una compra a un proveedor?",
    keywords: "compra proveedor recibir mercaderia reponer ingreso factura",
    steps: [
      "En Compras y proveedores, cargá primero el proveedor.",
      "Creá la compra, elegí sucursal y agregá productos, cantidades y costos.",
      "Cuando llegue la mercadería, tocá Recibir.",
      "La recepción suma los productos al stock de esa sucursal.",
    ],
    note: "Una compra pendiente todavía no suma stock. Este registro no emite comprobantes fiscales.",
    destination: "purchases",
  },
  {
    id: "staff-cash",
    scope: "staff",
    section: "sales",
    title: "¿Cómo cobro y cierro la caja?",
    keywords:
      "venta cobrar caja efectivo transferencia tarjeta combinado parcial saldo descuento corregir revertir comprobante",
    steps: [
      "Abrí la caja de la sucursal e ingresá el efectivo inicial. La cola de cobro reúne los servicios finalizados con saldo.",
      "Cobrar saldo permite ingresar efectivo, transferencia y tarjeta juntos o cobrar una parte. Registrá lo recibido; en efectivo, el importe retenido después del vuelto. La entrega requiere cancelar el saldo.",
      "Nueva venta permite vincular productos con cliente y vehículo. Para dejar deuda, seleccioná un cliente; se descuenta stock una sola vez.",
      "En Ver venta y cobros consultá saldo, pagos y comprobante. Administración/encargado puede autorizar descuentos con motivo y revertir un pago registrado, conservando el original. Las reversiones requieren caja abierta y reflejan la devolución o corrección real del cobro.",
      "El cierre compara efectivo contado con apertura más cobros en efectivo menos reversiones de esa caja. Transferencias y tarjetas no se suman al efectivo.",
    ],
    note: "Los comprobantes anteriores se conservan como ventas cobradas. El sistema registra pagos; no procesa transferencias, tarjetas ni devoluciones bancarias. Un descuento que deje un total inferior a lo cobrado requiere revertir primero el importe excedente.",
    destination: "sales",
  },
  {
    id: "staff-notifications",
    scope: "staff",
    section: "notifications",
    title: "¿Cómo configuro recordatorios y mensajes?",
    keywords:
      "notificacion notificaciones aviso recordatorio push mensaje enviar plantilla vencimiento anticipacion repetir activar desactivar",
    steps: [
      "En Notificaciones → Reglas automáticas, configurá días y kilómetros de anticipación, repeticiones y pausa por turno.",
      "En Mensajes, editá la plantilla o enviá un mensaje a un cliente o a todos.",
      "En Historial, consultá si se leyó en el portal y los intentos de push; reintentá fallos temporales.",
      "En Preferencias, revisá qué clientes permiten push y cuántos dispositivos registraron.",
    ],
    note: "El mensaje manual aparece inmediatamente en el portal. Push se procesa a las 09:00 de Argentina y requiere permiso del cliente y un dispositivo registrado. Enviado no garantiza que el teléfono lo haya mostrado.",
    destination: "notifications",
  },
  {
    id: "staff-settings",
    scope: "staff",
    section: "settings",
    title: "¿Cómo gestiono sucursales y accesos?",
    keywords:
      "configuracion sucursal empresa permisos usuario empleado tecnico encargado administrador cuenta vincular correo",
    steps: [
      "En Configuración, agregá o editá las sucursales del lubricentro.",
      "En Accesos, el administrador vincula una cuenta existente por correo.",
      "Elegí su rol y, si es cliente, la ficha que corresponde.",
      "Revisá que el acceso esté activo y guardá.",
    ],
    note: "Una empresa puede tener varias sucursales. El selector de empresas se usa cuando la cuenta pertenece a más de un lubricentro.",
    destination: "settings",
  },
  {
    id: "staff-reports",
    scope: "staff",
    section: "reports",
    title: "¿Cómo consulto los reportes?",
    keywords:
      "reporte estadistica ventas periodo facturacion indicadores informe exportar",
    steps: [
      "Entrá a Reportes y elegí el período que querés consultar.",
      "Revisá ventas, medios de pago y los resultados de las operaciones registradas.",
      "Usá el filtro de sucursal para consultar una sede.",
      "Exportá los datos disponibles para analizarlos fuera del sistema.",
    ],
    note: "Los resultados dependen de las operaciones que se hayan cargado en LubriWorks.",
    destination: "reports",
  },
  {
    id: "client-vehicle",
    scope: "customer",
    section: "vehicles",
    title: "¿Cómo actualizo los kilómetros de mi auto?",
    keywords:
      "vehiculo auto kilometros kilometraje tablero lectura actualizar uso promedio",
    steps: [
      "Abrí Mis vehículos y buscá tu auto.",
      "Tocá Actualizar km e ingresá la lectura real del tablero.",
      "Completá la fecha de lectura y guardá.",
      "El sistema ajusta la estimación de uso y los próximos recordatorios.",
    ],
    note: "El kilometraje no puede disminuir. La estimación no reemplaza la lectura del tablero.",
    destination: "vehicles",
  },
  {
    id: "client-history",
    scope: "customer",
    section: "history",
    title: "¿Dónde veo los servicios de mi vehículo?",
    keywords:
      "historial servicio anterior trabajo cambio aceite registro mantenimiento",
    steps: [
      "Abrí Historial de servicios.",
      "Revisá los servicios registrados por tu lubricentro.",
      "Consultá vehículo, fecha y los detalles disponibles de cada orden.",
    ],
    destination: "history",
  },
  {
    id: "client-reminders",
    scope: "customer",
    section: "reminders",
    title: "¿Cuándo tengo que volver y cómo pido turno?",
    keywords:
      "volver proximo turno cita agendar reservar mantenimiento vencimiento fecha matafuegos aceite kilometros",
    steps: [
      "Entrá a Próximos mantenimientos.",
      "Revisá la fecha y los kilómetros previstos. Se considera lo que ocurra primero.",
      "Tocá Solicitar turno y elegí vehículo, sucursal, fecha y hora.",
      "Tu solicitud queda pendiente de confirmación por el lubricentro.",
    ],
    note: "Si el kilometraje mostrado es estimado, actualizá la lectura del tablero en Mis vehículos.",
    destination: "reminders",
  },
  {
    id: "client-notifications",
    scope: "customer",
    section: "notifications",
    title: "¿Cómo activo o desactivo las notificaciones?",
    keywords:
      "notificacion notificaciones push aviso recordatorio dispositivo activar desactivar iphone permiso mensaje",
    steps: [
      "En Notificaciones → Dispositivos, tocá Activar este dispositivo y permití los avisos en el navegador.",
      "En Preferencias, permití push y elegí mantenimiento, matafuegos y mensajes.",
      "Consultá Bandeja para leer los avisos, actualizar kilómetros o pedir turno.",
      "Para dejar de recibirlos, desactivá push o desvinculá el dispositivo.",
    ],
    note: "En iPhone, agregá LubriWorks a Inicio y abrilo desde ese ícono. Los avisos siguen disponibles en el portal aunque desactives push.",
    destination: "notifications",
  },
  {
    id: "client-profile",
    scope: "customer",
    section: "profile",
    title: "¿Cómo cambio mi contraseña o mis datos?",
    keywords:
      "contraseña clave password cambiar perfil nombre telefono correo datos cuenta",
    steps: [
      "Entrá a Mi perfil.",
      "Para cambiar nombre o teléfono, tocá Editar mis datos.",
      "Para cambiar la contraseña, tocá Cambiar contraseña e ingresá la actual.",
      "Escribí una nueva contraseña de al menos 8 caracteres, repetila y guardá.",
    ],
    note: "No se requiere verificación por correo. Si olvidaste tu contraseña, cerrá sesión y usá Olvidé mi contraseña en el ingreso para recuperar el acceso.",
    destination: "profile",
  },
  {
    id: "platform-start",
    scope: "platform",
    section: "overview",
    title: "¿Cómo reviso la actividad de cada lubricentro?",
    keywords:
      "resumen plataforma kpi indicadores clientes vehiculos ordenes ventas volumen empresa",
    steps: [
      "En Resumen, revisá el estado de la plataforma.",
      "Abrí Empresas y usuarios y buscá un lubricentro.",
      "Consultá sus totales de clientes, vehículos, órdenes y ventas.",
      "Seleccioná la empresa para gestionar sus accesos.",
    ],
    note: "Ventas indica cantidad de operaciones registradas, no facturación monetaria.",
    destination: "tenants",
  },
  {
    id: "platform-tenants",
    scope: "platform",
    section: "tenants",
    title: "¿Cómo creo una empresa y asigno usuarios?",
    keywords:
      "alta crear empresa lubricentro tenant administrador usuario permisos acceso sucursal",
    steps: [
      "Entrá a Empresas y usuarios y usá el alta de empresa.",
      "Completá los datos del lubricentro.",
      "Seleccioná la empresa y gestioná sus usuarios, roles y estado de acceso.",
      "Las sucursales y operaciones se administran dentro de cada lubricentro.",
    ],
    note: "Las cuentas y datos se vinculan a su empresa; no se comparten fichas entre lubricentros.",
    destination: "tenants",
  },
  {
    id: "platform-support",
    scope: "platform",
    section: "support",
    title: "¿Cómo reviso un problema de acceso?",
    keywords:
      "soporte error acceso ingresar bloqueado inactivo diagnostico permisos",
    steps: [
      "En Soporte, seleccioná el lubricentro afectado.",
      "Revisá que la empresa esté activa y que el usuario tenga un acceso activo.",
      "Verificá su rol y la ficha de cliente asociada, si corresponde.",
      "Consultá Auditoría para revisar cambios registrados.",
    ],
    destination: "support",
  },
  {
    id: "platform-audit",
    scope: "platform",
    section: "audit",
    title: "¿Dónde reviso los cambios de una empresa?",
    keywords: "auditoria historial actividad cambios acciones registro",
    steps: [
      "Abrí Auditoría y seleccioná la empresa.",
      "Consultá las acciones registradas y sus fechas.",
      "Usá esos registros para revisar altas, cambios de acceso y operaciones.",
    ],
    destination: "audit",
  },
  {
    id: "platform-help",
    scope: "platform",
    section: "help",
    title: "¿Qué puedo hacer como superadministrador?",
    keywords: "ayuda superadmin plataforma empezar perfiles roles",
    steps: [
      "Administrá empresas y accesos desde Empresas y usuarios.",
      "Consultá la actividad y los totales por lubricentro.",
      "Usá Soporte y Auditoría para revisar problemas.",
      "Para tareas del taller, abrí el lubricentro con tu acceso operativo.",
    ],
    destination: "help",
  },
];
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ");
const stop = new Set(
  "como que donde cuando para por con una uno las los del de el la mi mis un se hago hacer puedo quiero en y a es dentro sistema tengo necesito me al".split(
    " ",
  ),
);
export function findGuides(
  query: string,
  scope: GuideScope,
  allowed: string[],
  section: string,
) {
  const available = guides.filter(
    (g) =>
      g.scope === scope &&
      allowed.includes(g.destination) &&
      (g.requires || []).every((section) => allowed.includes(section)),
  );
  const tokens = normalize(query)
    .replace(/\bkm\b/g, "kilometros")
    .replace(/\b(vuelve|volveria|regresa)\b/g, "volver")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
  if (!query.trim())
    return available
      .slice()
      .sort(
        (a, b) => Number(b.section === section) - Number(a.section === section),
      );
  if (!tokens.length) return [];
  return available
    .map((g) => ({
      g,
      score: tokens.reduce(
        (n, t) =>
          n +
          (normalize(g.title + " " + g.keywords)
            .split(" ")
            .some(
              (w) =>
                w === t ||
                (t.length >= 5 &&
                  (w.startsWith(t) || (w.length >= 4 && t.startsWith(w)))),
            )
            ? 1
            : 0),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.g.section === section) - Number(a.g.section === section),
    )
    .map((x) => x.g);
}
