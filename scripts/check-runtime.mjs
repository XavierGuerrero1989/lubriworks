// Vercel cannot synchronously require ESM-only dependencies in its runtime.
await Promise.all([
  import("firebase-admin/auth"),
  import("firebase-admin/firestore"),
  import("web-push"),
]);
console.log("Server dependencies load without require(ESM).");
