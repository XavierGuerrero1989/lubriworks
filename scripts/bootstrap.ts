import { admin } from "../server/firebase";
const email = process.argv[2];
if (!email) throw new Error("Uso: npm run bootstrap -- admin@dominio.com");
const { auth, db } = admin();
const user = await auth.getUserByEmail(email);
if (user.disabled)
  throw new Error(
    "La cuenta debe estar habilitada antes de habilitar la plataforma.",
  );
await db
  .doc(`platformAdmins/${user.uid}`)
  .set({ active: true, email, createdAt: new Date().toISOString() });
console.log(
  "Administrador de plataforma habilitado. Iniciá sesión y abrí Plataforma para crear la primera empresa.",
);
