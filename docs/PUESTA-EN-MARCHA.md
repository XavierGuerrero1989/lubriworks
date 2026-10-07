# Puesta en marcha: Firebase + Vercel

La configuración pública recibida se aplicó localmente para el proyecto `lubriworks-77db2`, con dominio de Auth `lubriworks-77db2.firebaseapp.com`. El SDK y las variables públicas y privadas de Firebase Admin quedaron configurados en Vercel. La aplicación se despliega en `https://lubriworks.vercel.app`. `.env.local` está excluido de Git. Se publicaron las reglas de `firestore.rules` en producción y se autorizó `lubriworks.vercel.app` en Firebase Auth.

## 1. Estado de Firebase y pasos pendientes

1. **Completado:** proyecto `lubriworks-77db2` creado. Usar un proyecto distinto para pruebas y producción cuando habilitemos clientes reales.
2. **Completado:** aplicación Web registrada y configuración pública aplicada localmente. Firebase Hosting no es necesario: el despliegue será en Vercel.
3. **Completado, según confirmación del titular:** Authentication con Email/Password habilitado.
4. **Completado, según confirmación del titular:** Firestore creado en modo producción. Las reglas de LubriWorks se publicaron y compilaron correctamente desde Firebase CLI.
5. Publicar el contenido de `firestore.rules` en la consola de Firestore, o usar `firebase deploy --only firestore:rules,firestore:indexes --project TU_PROJECT_ID`. Estas reglas deniegan acceso directo; el backend usa Firebase Admin con autorización propia.
6. En **Authentication → Settings → Authorized domains**, agregar tu dominio de Vercel y el dominio definitivo. Agregar `localhost` / `127.0.0.1` sólo para desarrollo cuando corresponda.
7. **Configuración recibida:** cargar también los valores públicos de la aplicación Web en las variables de Vercel indicadas abajo.
8. En **Project settings → Service accounts**, generar una clave privada de servicio para el backend. Guardarla de manera privada. Sus valores se cargan directamente en los secretos de Vercel; no pegar el JSON privado en el chat ni guardarlo en Git.

## 2. Lo que necesitás crear en Vercel

1. **Completado:** código publicado en `https://github.com/XavierGuerrero1989/lubriworks`, rama `main`. El titular autorizó el repositorio público. `.env.local`, claves privadas, `node_modules` y `dist` quedan excluidos.
2. Crear un proyecto Vercel e importar ese repositorio. Alternativamente se puede desplegar la carpeta con Vercel CLI.
3. Framework: **Vite**. Node.js **22.x**. Build: `npm run build`. Output: `dist`. Root: raíz del proyecto LubriWorks.
4. Cargar estas variables. La configuración pública se incorpora al build y requiere redeploy cuando cambia.

| Variable | Fuente | Dónde se usa |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | `apiKey` de app web Firebase | Navegador |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` de app web | Navegador |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` de app web | Navegador |
| `VITE_FIREBASE_APP_ID` | `appId` de app web | Navegador |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` de app web | Navegador, opcional en esta etapa |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` de app web | Navegador, opcional en esta etapa |
| `FIREBASE_PROJECT_ID` | `project_id` de cuenta de servicio | Servidor |
| `FIREBASE_CLIENT_EMAIL` | `client_email` de cuenta de servicio | Servidor, privado |
| `FIREBASE_PRIVATE_KEY` | `private_key` completa, incluidos BEGIN/END | Servidor, secreto |
| `APP_ORIGIN` | `https://TU-PROYECTO.vercel.app`, sin barra final | Servidor |
| `CRON_SECRET` | Aleatorio, al menos 32 caracteres | Servidor, secreto |
| `VAPID_PUBLIC_KEY` | Generada para Web Push | Servidor, se entrega a clientes autenticados |
| `VAPID_PRIVATE_KEY` | Generada junto a la pública | Servidor, secreto |
| `VAPID_SUBJECT` | `mailto:correo-de-contacto-real@dominio.com` | Servidor |
| `VITE_ENABLE_DEMO` | `false` | Build de producción |

La clave privada de Firebase admite saltos de línea reales o `\n`. Nunca agregar `VITE_` a una clave de servidor. Usar credenciales de pruebas en Preview y credenciales de producción sólo en Production. `APP_ORIGIN` debe coincidir con el dominio desde el que se abre la app; si cambiás de dominio, actualizarlo.

Para generar las claves push: `npm run vapid`. Hacerlo localmente y copiar la privada directamente a Vercel. No subir la salida al repositorio. Se usa **Web Push estándar**; no hace falta configurar Firebase Cloud Messaging para esta implementación.

Para generar `CRON_SECRET`, usar un generador criptográfico de contraseñas o `openssl rand -hex 32` localmente. Guardar el valor sólo en las variables del servidor.

5. Desplegar, agregar ese dominio a Firebase Auth y comprobar registro, verificación de correo e ingreso.
6. Revisar los logs de las funciones `/api/rpc` y `/api/reminders`.

Las claves VAPID y `CRON_SECRET` se generaron y cargaron en Production. El contacto Web Push es `mailto:xavier@brainworks.ar`. El cron está habilitado. En el plan Hobby se ejecuta dentro de una ventana de una hora desde las 12:00 UTC (09:00–10:00 Argentina). La entrega a un dispositivo real requiere primero crear la cuenta, el tenant y una suscripción push.

## 3. Primer administrador y primer tenant

1. Registrarte en la app desplegada y verificar el correo.
2. Para el alta inicial, crear en la consola de Firestore el documento **`platformAdmins/UID_DE_TU_USUARIO`**, con `active: true` de tipo booleano. El UID se obtiene desde Authentication → Users. Es una operación de administración de plataforma, no algo que deba poder hacer cualquier usuario.
3. Alternativa para el operador del proyecto: completar `.env.local` en privado y ejecutar `npm run bootstrap -- tu-correo@dominio.com`. La cuenta tiene que existir y estar verificada.
4. Volver a ingresar. Abrir **Administrar plataforma → Nueva empresa**. Definir identificador, nombre y correo del administrador (puede ser tu mismo correo).
5. Volver a **Mis empresas** e ingresar al lubricentro.
6. Cargar sucursales, productos, servicios, clientes y vehículos. Abrir caja antes del primer cobro.

## 4. Dar acceso a un cliente o empleado

1. La persona crea su cuenta con correo y contraseña, y verifica el correo.
2. El administrador abre **Configuración → Gestionar un acceso**.
3. Completa el correo registrado, nombre y rol.
4. Para rol **Cliente**, selecciona su ficha de cliente. Para empleados, la ficha queda vacía.
5. La persona actualiza sus accesos y entra. Un cliente sólo verá los vehículos vinculados a su ficha en esa empresa.

Un administrador puede modificar o desactivar un acceso usando el mismo correo. El sistema impide quitar el último administrador activo. La misma persona puede pertenecer a más de una empresa; cada membresía es independiente.

## 5. Recordatorios y PWA

`vercel.json` programa `/api/reminders` una vez por día, a las 12:00 UTC (09:00 Argentina; el horario efectivo depende del plan de Vercel). Vercel envía `CRON_SECRET` como Bearer. La función falla si falta ese secreto o es demasiado corto.

Se calculan dos hitos: mantenimiento próximo (15 días o 500 km) y vencido. Se crea una notificación persistente por hito y se envía push sólo cuando hay suscripción y consentimiento del perfil. Hay protección de concurrencia, reintentos y limpieza de suscripciones 404/410. Web Push no ofrece garantía de entrega exactamente una vez; se usa un tag estable para agrupar posibles reintentos en el dispositivo.

En iPhone con iOS 16.4 o posterior: agregar la web a Inicio, abrirla desde su ícono y tocar **Activar recordatorios**. En Android: usar un navegador compatible y conceder permiso. La entrega real debe probarse en dispositivos con el despliegue HTTPS, credenciales y suscripciones de producción.

La PWA no guarda datos comerciales privados para trabajar sin conexión; muestra un aviso explícito. No hay operaciones offline pendientes de sincronización.

## Fuentes de configuración

- Firebase Admin: https://firebase.google.com/docs/admin/setup
- Verificación de ID tokens: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- Firestore: https://firebase.google.com/docs/firestore/quickstart
- Vercel Functions Node.js: https://vercel.com/docs/functions/runtimes/node-js
- Cron y secretos: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Web Push iOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
