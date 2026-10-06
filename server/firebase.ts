import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
export function admin() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (!projectId)
      throw new Error("Falta configurar Firebase en el servidor.");
    if (process.env.FIRESTORE_EMULATOR_HOST) initializeApp({ projectId });
    else {
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL,
        privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
      if (!clientEmail || !privateKey)
        throw new Error("Faltan credenciales del servidor.");
      initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
      });
    }
  }
  return { db: getFirestore(), auth: getAuth() };
}
