import { beforeAll, it, expect } from "vitest";
import { admin } from "../server/firebase";
import { notificationRpc } from "../server/notifications";
process.env.FIREBASE_PROJECT_ID = "demo-lubriworks";
const tenantId = "notification-tests";
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Emulator required");
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
    ["notify-owner", "owner", null],
    ["notify-c1", "customer", "c1"],
    ["notify-c2", "customer", "c2"],
    ["notify-tech", "technician", null],
  ] as const)
    await root
      .collection("members")
      .doc(uid)
      .set({
        uid,
        tenantId,
        role,
        customerId,
        active: true,
        name: uid,
        email: `${uid}@test.local`,
      });
  for (const id of ["c1", "c2"])
    await root
      .collection("customers")
      .doc(id)
      .set({ id, name: id, pushEnabled: true });
  await root.collection("vehicles").doc("v2").set({ customerId: "c2" });
  await root
    .collection("subscriptions")
    .doc("device-c2")
    .set({ uid: "notify-c2", customerId: "c2", label: "Test" });
});
it("isolates tenant settings and denies customer/technician management", async () => {
  const { db } = admin();
  await notificationRpc(
    db,
    tenantId,
    "notify-owner",
    "notifications.settings",
    { daysBefore: 22 },
    "settings-1",
  );
  expect(
    (
      await notificationRpc(
        db,
        tenantId,
        "notify-owner",
        "notifications.overview",
        {},
      )
    ).settings?.daysBefore,
  ).toBe(22);
  await expect(
    notificationRpc(
      db,
      tenantId,
      "notify-c1",
      "notifications.settings",
      {},
      "settings-2",
    ),
  ).rejects.toThrow();
  await expect(
    notificationRpc(db, tenantId, "notify-tech", "notifications.overview", {}),
  ).rejects.toThrow();
  await expect(
    notificationRpc(db, "alpha", "notify-owner", "notifications.overview", {}),
  ).rejects.toThrow();
});
it("limits devices and preferences to the authenticated customer", async () => {
  const { db } = admin();
  const out = await notificationRpc(
    db,
    tenantId,
    "notify-c1",
    "notifications.overview",
    {},
  );
  expect(out.devices).toHaveLength(0);
  await expect(
    notificationRpc(
      db,
      tenantId,
      "notify-c1",
      "notifications.deviceRemove",
      { id: "device-c2" },
      "device-1",
    ),
  ).rejects.toThrow();
  await notificationRpc(
    db,
    tenantId,
    "notify-c1",
    "notifications.preferences",
    {
      pushEnabled: false,
      maintenance: false,
      messages: true,
      extinguisher: true,
    },
    "prefs-1",
  );
  expect(
    (await db.doc(`tenants/${tenantId}/customers/c1`).get()).data()
      ?.pushEnabled,
  ).toBe(false);
  expect(
    (await db.doc(`tenants/${tenantId}/customers/c2`).get()).data()
      ?.pushEnabled,
  ).toBe(true);
});
it("validates manual recipients and prevents duplicate notices", async () => {
  const { db } = admin();
  const data = { customerId: "c1", title: "Turno", body: "Recordá tu turno" };
  await expect(
    notificationRpc(
      db,
      tenantId,
      "notify-owner",
      "notifications.send",
      { ...data, vehicleId: "v2" },
      "msg-bad",
    ),
  ).rejects.toThrow();
  await notificationRpc(
    db,
    tenantId,
    "notify-owner",
    "notifications.send",
    data,
    "msg-ok",
  );
  await notificationRpc(
    db,
    tenantId,
    "notify-owner",
    "notifications.send",
    data,
    "msg-ok",
  );
  await expect(
    notificationRpc(
      db,
      tenantId,
      "notify-owner",
      "notifications.send",
      { ...data, body: "Otro" },
      "msg-ok",
    ),
  ).rejects.toThrow();
  const notices = await db
    .collection(`tenants/${tenantId}/notifications`)
    .get();
  expect(notices.size).toBe(1);
  expect(notices.docs[0].data().pushStatus).toBe("pending");
});

it("queues push safely, honors opt-outs and retries without duplicates", async () => {
  const { vi } = await import("vitest");
  const webpush = (await import("web-push")).default;
  const { sendQueuedNotices } = await import("../server/notificationDelivery");
  const { db } = admin();
  const root = db.doc(`tenants/${tenantId}`);
  const mock = vi
    .spyOn(webpush, "sendNotification")
    .mockRejectedValueOnce({ statusCode: 503 })
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  try {
    await notificationRpc(
      db,
      tenantId,
      "notify-owner",
      "notifications.send",
      { customerId: "c2", title: "Test", body: "Private portal message" },
      "push-test",
    );
    expect((await sendQueuedNotices(root, true, Date.now())).failed).toBe(1);
    expect(mock).toHaveBeenCalledTimes(1); // c1 opted out, only c2 is eligible
    // Backoff prevents a hot retry; the scheduler/manual retry can try later.
    expect((await sendQueuedNotices(root, true, Date.now())).sent).toBe(0);
    const waiting = await root
      .collection("deliveries")
      .where("noticeId", "==", "push-test")
      .get();
    await waiting.docs[0].ref.set({ nextAttemptAt: 0 }, { merge: true });
    expect((await sendQueuedNotices(root, true, Date.now())).sent).toBe(1);
    expect(mock.mock.calls[1][1]).not.toContain("Private portal message");
    await sendQueuedNotices(root, true, Date.now());
    expect(mock).toHaveBeenCalledTimes(2);
    const deliveries = await root.collection("deliveries").get();
    expect(deliveries.docs[0].data().attempts).toBe(2);
  } finally {
    mock.mockRestore();
  }
});
it("does not push an old reminder after the maintenance was completed", async () => {
  const { vi } = await import("vitest");
  const webpush = (await import("web-push")).default;
  const { sendQueuedNotices } = await import("../server/notificationDelivery");
  const { db } = admin();
  const root = db.doc(`tenants/${tenantId}`);
  await root.collection("reminders").doc("done-reminder").set({
    status: "done",
    vehicleId: "v2",
    customerId: "c2",
    dueDate: "2020-01-01",
    dueKm: null,
  });
  await root.collection("notifications").doc("stale-notice").set({
    id: "stale-notice",
    customerId: "c2",
    vehicleId: "v2",
    reminderId: "done-reminder",
    category: "maintenance",
    pushStatus: "pending",
    dueDate: "2020-01-01",
    dueKm: null,
  });
  const mock = vi
    .spyOn(webpush, "sendNotification")
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  try {
    await sendQueuedNotices(root, true, Date.now());
    expect(mock).not.toHaveBeenCalled();
  } finally {
    mock.mockRestore();
  }
});

it("suppresses resolved operational push and honors visit preferences separately", async () => {
  const { vi } = await import("vitest");
  const webpush = (await import("web-push")).default;
  const { sendQueuedNotices } = await import("../server/notificationDelivery");
  const { db } = admin();
  const root = db.doc(`tenants/${tenantId}`);
  const { demoState } = await import("../shared/demo");
  const { visitNotices } = await import("../shared/visitNotices");
  const before = demoState(),
    after = structuredClone(before);
  after.orders[0].customerId = "c2";
  after.orders[0].vehicleId = "v2";
  after.orders[0].approval = "pending";
  after.orders[0].quoteRevision = 2;
  const notice = visitNotices(
    before,
    after,
    "quote-push",
    new Date().toISOString(),
  ).find((n) => n.event === "quote-pending")!;
  await root
    .collection("orders")
    .doc(notice.orderId!)
    .set({ ...after.orders[0], approval: "approved" });
  await root.collection("notifications").doc(notice.id).set(notice);
  const mock = vi
    .spyOn(webpush, "sendNotification")
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  try {
    await sendQueuedNotices(root, true, Date.now(), { ids: [notice.id] });
    expect(mock).not.toHaveBeenCalled();
    expect(
      (await root.collection("notifications").doc(notice.id).get()).data()
        ?.pushStatus,
    ).toBe("superseded");
    const ready = {
      ...notice,
      id: "ready-push",
      event: "vehicle-ready",
      entityVersion: new Date().toISOString(),
    };
    await root
      .collection("orders")
      .doc(notice.orderId!)
      .set({ finishedAt: ready.entityVersion }, { merge: true });
    await root.collection("notifications").doc(ready.id).set(ready);
    await root
      .collection("customers")
      .doc("c2")
      .set({ notificationPreferences: { visit: false } }, { merge: true });
    await sendQueuedNotices(root, true, Date.now(), { ids: [ready.id] });
    expect(mock).not.toHaveBeenCalled();
    expect(
      (await root.collection("notifications").doc(ready.id).get()).data()
        ?.pushReason,
    ).toContain("Categoría");
  } finally {
    mock.mockRestore();
  }
});
it("expires invalid devices, preserves the failure and requires explicit retry after five attempts", async () => {
  const { vi } = await import("vitest");
  const webpush = (await import("web-push")).default;
  const { sendQueuedNotices } = await import("../server/notificationDelivery");
  const { db } = admin();
  const root = db.doc(`tenants/${tenantId}`);
  await root
    .collection("customers")
    .doc("c2")
    .set(
      { notificationPreferences: { visit: true, messages: true } },
      { merge: true },
    );
  await notificationRpc(
    db,
    tenantId,
    "notify-owner",
    "notifications.send",
    { customerId: "c2", title: "Test", body: "No personal data" },
    "expired-test",
  );
  const mock = vi
    .spyOn(webpush, "sendNotification")
    .mockRejectedValue({ statusCode: 410 });
  try {
    await sendQueuedNotices(root, true, Date.now(), { ids: ["expired-test"] });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(
      (await root.collection("subscriptions").doc("device-c2").get()).exists,
    ).toBe(false);
    expect(
      (await root.collection("notifications").doc("expired-test").get()).data()
        ?.pushStatus,
    ).toBe("failed");
    await sendQueuedNotices(root, true, Date.now(), { ids: ["expired-test"] });
    expect(mock).toHaveBeenCalledTimes(1);
    await root
      .collection("subscriptions")
      .doc("device-c2")
      .set({ uid: "notify-c2", customerId: "c2" });
    mock.mockRejectedValue({ statusCode: 503 });
    await notificationRpc(
      db,
      tenantId,
      "notify-owner",
      "notifications.send",
      { customerId: "c2", title: "Test", body: "Retry" },
      "exhausted-test",
    );
    for (let i = 0; i < 5; i++) {
      const ds = await root
        .collection("deliveries")
        .where("noticeId", "==", "exhausted-test")
        .get();
      for (const d of ds.docs)
        await d.ref.set({ nextAttemptAt: 0 }, { merge: true });
      await sendQueuedNotices(root, true, Date.now(), {
        ids: ["exhausted-test"],
      });
    }
    const ds = await root
      .collection("deliveries")
      .where("noticeId", "==", "exhausted-test")
      .get();
    expect(ds.docs[0].data().status).toBe("exhausted");
    expect(
      (
        await root.collection("notifications").doc("exhausted-test").get()
      ).data()?.pushStatus,
    ).toBe("failed");
    const result = await notificationRpc(
      db,
      tenantId,
      "notify-owner",
      "notifications.retry",
      { id: ds.docs[0].id },
      "retry-exhausted",
    );
    expect(result.noticeIds).toEqual(["exhausted-test"]);
    mock.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    await sendQueuedNotices(root, true, Date.now(), { ids: result.noticeIds });
    expect((await ds.docs[0].ref.get()).data()?.status).toBe("sent");
  } finally {
    mock.mockRestore();
  }
});

it("leases each device so concurrent queue processing does not duplicate the push", async () => {
  const { vi } = await import("vitest"),
    webpush = (await import("web-push")).default;
  const { sendQueuedNotices } = await import("../server/notificationDelivery");
  const { db } = admin(),
    root = db.doc(`tenants/${tenantId}`);
  await notificationRpc(
    db,
    tenantId,
    "notify-owner",
    "notifications.send",
    { customerId: "c2", title: "Concurrent", body: "Portal only" },
    "concurrent-push",
  );
  const mock = vi
    .spyOn(webpush, "sendNotification")
    .mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { statusCode: 201, body: "", headers: {} };
    });
  try {
    await Promise.all([
      sendQueuedNotices(root, true, Date.now(), { ids: ["concurrent-push"] }),
      sendQueuedNotices(root, true, Date.now(), { ids: ["concurrent-push"] }),
    ]);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(
      (
        await root.collection("notifications").doc("concurrent-push").get()
      ).data()?.pushStatus,
    ).toBe("sent");
  } finally {
    mock.mockRestore();
  }
});

it("preserves visit opt-outs when an older settings or preferences form omits the new field", async () => {
  const { db } = admin(),
    root = db.doc(`tenants/${tenantId}`);
  await notificationRpc(
    db,
    tenantId,
    "notify-owner",
    "notifications.settings",
    { visitEnabled: false },
    "visit-off",
  );
  await notificationRpc(
    db,
    tenantId,
    "notify-owner",
    "notifications.settings",
    { daysBefore: 7 },
    "old-settings",
  );
  expect(
    (await root.collection("settings").doc("notifications").get()).data()
      ?.visitEnabled,
  ).toBe(false);
  await notificationRpc(
    db,
    tenantId,
    "notify-c2",
    "notifications.preferences",
    { pushEnabled: true, visit: false },
    "visit-prefs-off",
  );
  await notificationRpc(
    db,
    tenantId,
    "notify-c2",
    "notifications.preferences",
    { pushEnabled: true, messages: false },
    "old-prefs",
  );
  expect(
    (await root.collection("customers").doc("c2").get()).data()
      ?.notificationPreferences.visit,
  ).toBe(false);
});

it("withdraws and restores promotions without deleting history, resending push, or allowing other roles", async () => {
  const { db } = admin(),
    root = db.doc(`tenants/${tenantId}`);
  const call = (uid: string, ids: string[], visible: boolean, op: string) =>
    notificationRpc(
      db,
      tenantId,
      uid,
      "notifications.newsVisibility",
      { ids, visible },
      op,
    );
  const refs = ["withdraw-pending", "withdraw-sent"].map((id) =>
    root.collection("notifications").doc(id),
  );
  for (const [i, ref] of refs.entries())
    await ref.set({
      id: ref.id,
      customerId: "c2",
      vehicleId: "",
      category: "messages",
      origin: "manual",
      title: "Promo",
      body: "Condiciones",
      read: i === 1,
      date: new Date().toISOString(),
      pushStatus: i === 0 ? "pending" : "sent",
    });
  for (const uid of ["notify-c2", "notify-tech"])
    await expect(
      call(uid, [refs[0].id], false, `withdraw-denied-${uid}`),
    ).rejects.toThrow();
  await expect(
    call(
      "notify-owner",
      [refs[0].id, "missing-or-other-tenant"],
      false,
      "withdraw-atomic",
    ),
  ).rejects.toThrow();
  expect((await refs[0].get()).data()?.newsHiddenAt).toBeUndefined();
  await root
    .collection("notifications")
    .doc("withdraw-care")
    .set({ customerId: "c2", category: "maintenance", reminderId: "r1" });
  await expect(
    call("notify-owner", ["withdraw-care"], false, "withdraw-not-care"),
  ).rejects.toThrow();
  const result = await call(
    "notify-owner",
    refs.map((r) => r.id),
    false,
    "withdraw-ok",
  );
  expect(result.noticeIds).toEqual([]);
  expect(
    await call(
      "notify-owner",
      refs.map((r) => r.id),
      false,
      "withdraw-ok",
    ),
  ).toEqual(result);
  const hidden = (await refs[0].get()).data()!;
  expect(hidden.newsHiddenAt).toBeTruthy();
  expect(hidden.pushStatus).toBe("skipped");
  expect(hidden.body).toBe("Condiciones");
  expect(hidden.read).toBe(false);
  expect((await refs[1].get()).data()?.pushStatus).toBe("sent");
  await root
    .collection("deliveries")
    .doc("withdraw-retry")
    .set({ noticeId: refs[0].id, status: "pending" });
  await expect(
    notificationRpc(
      db,
      tenantId,
      "notify-owner",
      "notifications.retry",
      { id: "withdraw-retry" },
      "withdraw-no-retry",
    ),
  ).rejects.toThrow("retirado");
  // Even a stale queued notice cannot be sent after withdrawal.
  await refs[0].update({ pushStatus: "pending" });
  const { vi } = await import("vitest");
  const webpush = (await import("web-push")).default;
  const { sendQueuedNotices } = await import("../server/notificationDelivery");
  const mock = vi
    .spyOn(webpush, "sendNotification")
    .mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  try {
    await sendQueuedNotices(root, true, Date.now(), { ids: [refs[0].id] });
    expect(mock).not.toHaveBeenCalled();
  } finally {
    mock.mockRestore();
  }
  const restored = await call(
    "notify-owner",
    refs.map((r) => r.id),
    true,
    "withdraw-restore",
  );
  expect(restored.noticeIds).toEqual([]);
  expect((await refs[0].get()).data()?.newsHiddenAt).toBeUndefined();
  expect((await refs[0].get()).data()?.pushStatus).toBe("skipped");
  expect((await refs[1].get()).data()?.read).toBe(true);
  for (const ref of refs) await ref.delete();
  await root.collection("notifications").doc("withdraw-care").delete();
});
