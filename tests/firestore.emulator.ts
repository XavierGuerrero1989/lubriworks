import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { beforeAll, afterAll, it } from "vitest";
let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-lubriworks",
    firestore: {
      host: "127.0.0.1",
      port: 8087,
      rules: readFileSync("firestore.rules", "utf8"),
    },
  });
});
afterAll(async () => {
  await env.cleanup();
});
it("denies direct browser access even with forged admin claims", async () => {
  const db = env
    .authenticatedContext("user", {
      role: "owner",
      platformAdmin: true,
      tenantId: "victim",
    })
    .firestore();
  await assertFails(getDoc(doc(db, "tenants/victim")));
  await assertFails(
    setDoc(doc(db, "tenants/victim/products/p1"), { stock: 100 }),
  );
  await assertFails(setDoc(doc(db, "platformAdmins/user"), { active: true }));
});
it("denies unauthenticated reads", async () => {
  await assertFails(
    getDoc(
      doc(
        env.unauthenticatedContext().firestore(),
        "tenants/victim/customers/c1",
      ),
    ),
  );
});
