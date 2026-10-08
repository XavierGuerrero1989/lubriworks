import { beforeAll, it, expect } from "vitest";
import { admin } from "../server/firebase";
import { createCustomerAccount } from "../server/customerAccounts";
process.env.FIREBASE_PROJECT_ID = "demo-lubriworks";
const tenantId = "account-tests",
  password = "OnlyForEmulator123!";
const payload = {
  password,
  data: {
    name: "Cliente de prueba",
    email: "new-client@test.local",
    phone: "",
    notes: "",
    pushEnabled: true,
  },
};
beforeAll(async () => {
  if (
    !process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw new Error("Emulators required");
  const { db } = admin();
  const root = db.doc(`tenants/${tenantId}`);
  await root.set({
    id: tenantId,
    name: "Test",
    active: true,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
  });
  for (const [uid, role, customerId] of [
    ["account-owner", "owner", null],
    ["account-client", "customer", "c1"],
  ] as const)
    await root
      .collection("members")
      .doc(uid)
      .set({
        uid,
        role,
        customerId,
        tenantId,
        active: true,
        name: uid,
        email: `${uid}@test.local`,
      });
});
it("creates Auth, customer and membership without email verification and preserves password outside Firestore", async () => {
  const { db, auth } = admin();
  const out = await createCustomerAccount(
    db,
    auth,
    tenantId,
    "account-owner",
    payload,
    "new-account",
  );
  expect(out.customerId).toBe("new-account");
  const user = await auth.getUserByEmail(payload.data.email);
  expect(user.emailVerified).toBe(false);
  const member = await db.doc(`tenants/${tenantId}/members/${user.uid}`).get();
  expect(member.data()?.role).toBe("customer");
  expect(member.data()?.customerId).toBe("new-account");
  expect(
    (await db.doc(`userTenants/${user.uid}/tenants/${tenantId}`).get()).exists,
  ).toBe(true);
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: payload.data.email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  expect(response.status).toBe(200);
  const signed = await response.json();
  expect(signed.localId).toBe(user.uid);
  for (const collection of [
    "customers",
    "members",
    "customerProvisioning",
    "audit",
  ]) {
    const rows = await db.collection(`tenants/${tenantId}/${collection}`).get();
    expect(JSON.stringify(rows.docs.map((d) => d.data()))).not.toContain(
      password,
    );
  }
  await createCustomerAccount(
    db,
    auth,
    tenantId,
    "account-owner",
    payload,
    "new-account",
  );
  expect(
    (await db.collection(`tenants/${tenantId}/customers`).get()).size,
  ).toBe(1);
});
it("does not reset or reassign an existing account", async () => {
  const { db, auth } = admin();
  const existing = await auth.createUser({
    uid: "existing-admin-test",
    email: "existing-account@test.local",
    password,
  });
  await expect(
    createCustomerAccount(
      db,
      auth,
      tenantId,
      "account-owner",
      { ...payload, data: { ...payload.data, email: existing.email } },
      "existing-email",
    ),
  ).rejects.toThrow("ya tiene una cuenta");
  expect(
    (await db.doc(`tenants/${tenantId}/members/${existing.uid}`).get()).exists,
  ).toBe(false);
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: existing.email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  expect(response.status).toBe(200);
});
it("denies customers and administrators of other tenants before creating Auth", async () => {
  const { db, auth } = admin();
  const data = {
    ...payload,
    data: { ...payload.data, email: "blocked-account@test.local" },
  };
  await expect(
    createCustomerAccount(
      db,
      auth,
      tenantId,
      "account-client",
      data,
      "blocked-client",
    ),
  ).rejects.toThrow();
  await expect(
    createCustomerAccount(
      db,
      auth,
      "alpha",
      "account-owner",
      data,
      "blocked-cross",
    ),
  ).rejects.toThrow();
  await expect(auth.getUserByEmail(data.data.email)).rejects.toThrow();
});
it("resumes provisioning after a Firestore failure without another Auth account", async () => {
  const { db, auth } = admin();
  const original = db.runTransaction.bind(db);
  let calls = 0;
  const { vi } = await import("vitest");
  const spy = vi
    .spyOn(db, "runTransaction")
    .mockImplementation((...args: any[]) => {
      calls++;
      if (calls === 2)
        return Promise.reject(new Error("Transient persistence error"));
      return (original as any)(...args);
    });
  const data = {
    ...payload,
    data: { ...payload.data, email: "retry-account@test.local" },
  };
  try {
    await expect(
      createCustomerAccount(
        db,
        auth,
        tenantId,
        "account-owner",
        data,
        "retry-account",
      ),
    ).rejects.toThrow("Transient");
  } finally {
    spy.mockRestore();
  }
  const first = await auth.getUserByEmail(data.data.email);
  await createCustomerAccount(
    db,
    auth,
    tenantId,
    "account-owner",
    data,
    "retry-account",
  );
  expect((await auth.getUserByEmail(data.data.email)).uid).toBe(first.uid);
  expect(
    (await db.doc(`tenants/${tenantId}/customers/retry-account`).get()).exists,
  ).toBe(true);
});

it("lets the client reauthenticate and change their own password without verification", async () => {
  const { initializeApp, deleteApp } = await import("firebase/app");
  const {
    getAuth,
    connectAuthEmulator,
    signInWithEmailAndPassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updatePassword,
    signOut,
  } = await import("firebase/auth");
  const app = initializeApp(
    { apiKey: "fake-key", projectId: "demo-lubriworks" },
    "password-change-test",
  );
  const auth = getAuth(app);
  connectAuthEmulator(
    auth,
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,
    { disableWarnings: true },
  );
  try {
    const { user } = await signInWithEmailAndPassword(
      auth,
      payload.data.email,
      password,
    );
    expect(user.emailVerified).toBe(false);
    await expect(
      reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email!, "WrongPassword123!"),
      ),
    ).rejects.toThrow();
    await reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(user.email!, password),
    );
    await updatePassword(user, "UpdatedOnlyForEmulator123!");
    await signOut(auth);
    await expect(
      signInWithEmailAndPassword(auth, payload.data.email, password),
    ).rejects.toThrow();
    const updated = await signInWithEmailAndPassword(
      auth,
      payload.data.email,
      "UpdatedOnlyForEmulator123!",
    );
    expect(updated.user.uid).toBe(user.uid);
    expect(updated.user.emailVerified).toBe(false);
  } finally {
    await deleteApp(app);
  }
});
