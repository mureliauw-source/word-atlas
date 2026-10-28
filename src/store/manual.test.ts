import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSettings, emptyProgress } from "../shared/model";
import type { Mutation, Snapshot } from "../shared/sync";

const user = {
  id: "manual-test-user",
  username: "manualtest",
  timezone: "Asia/Singapore",
};
const initial = (): Snapshot => ({
  userId: user.id,
  progress: emptyProgress("word-atlas-open"),
  settings: { ...defaultSettings, onboarded: true },
  revision: 0,
  epoch: 0,
  updatedAt: 1,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function harness() {
  const data = new Map<string, string>();
  const handlers = new Map<string, (() => void)[]>();
  let rejectWrites = false;
  const listen = (name: string, fn: () => void) =>
    handlers.set(name, [...(handlers.get(name) ?? []), fn]);
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (rejectWrites) throw new Error("quota");
        data.set(k, v);
      },
    },
    window: {
      addEventListener: listen,
      setTimeout: () => 0,
      clearTimeout: () => {},
    },
    document: { addEventListener: listen, visibilityState: "visible" },
  });
  let snapshot = initial();
  const writes: Mutation[] = [];
  const calls: string[] = [];
  let mutationHandler: ((m: Mutation) => Promise<Response>) | null = null;
  let offline = false;
  globalThis.fetch = async (input, options) => {
    const path = String(input);
    calls.push(path);
    if (offline) throw new TypeError("offline");
    if (path === "/api/auth/login") return json({ user, snapshot });
    if (path === "/api/auth/me") return json({ user });
    if (path === "/api/auth/logout") return json({ ok: true });
    if (path === "/api/state") return json(snapshot);
    if (path === "/api/mutations") {
      const m = JSON.parse(String(options!.body)) as Mutation;
      writes.push(m);
      if (mutationHandler) return mutationHandler(m);
      const a = m.action as Extract<Mutation["action"], { type: "save" }>;
      const backup = a.backup as {
        progress: Snapshot["progress"];
        settings: Snapshot["settings"];
      };
      snapshot = {
        ...snapshot,
        progress: structuredClone(backup.progress),
        settings: { ...backup.settings },
        revision: snapshot.revision + 1,
        epoch: snapshot.epoch + 1,
        updatedAt: Date.now(),
      };
      return json(snapshot);
    }
    throw new Error("Unexpected request: " + path);
  };
  let count = 0;
  const load = (): Promise<typeof import("./store")> =>
    import(
      new URL(
        "./store.ts?manual=" + Date.now() + "-" + count++,
        import.meta.url,
      ).href
    );
  const m = await load();
  await m.store.authenticate("login", user.username, "test-password-123");
  return {
    m,
    load,
    data,
    calls,
    writes,
    handlers,
    setOffline: (value: boolean) => {
      offline = value;
    },
    setRejectWrites: (value: boolean) => {
      rejectWrites = value;
    },
    setHandler: (value: typeof mutationHandler) => {
      mutationHandler = value;
    },
    getSnapshot: () => snapshot,
    setSnapshot: (value: Snapshot) => {
      snapshot = value;
    },
  };
}

test("account interactions persist locally without network writes or automatic refresh; reload and offline reload retain drafts", async () => {
  const h = await harness();
  const start = h.calls.length;
  assert.equal(
    await h.m.store.commit(
      { type: "bookmark", wordId: "ability", saved: true },
      (p) => ({ ...p, bookmarks: ["ability"] }),
    ),
    true,
  );
  await h.m.store.settings({ dailyNew: 30 });
  await h.m.store.addTyping({
    at: 1,
    mode: "word",
    items: 2,
    wpm: 20,
    accuracy: 90,
  });
  for (const event of ["focus", "online", "visibilitychange"])
    for (const fn of h.handlers.get(event) ?? []) fn();
  assert.equal(h.calls.length, start);
  assert.equal(h.writes.length, 0);
  assert.equal(h.m.store.get().unsaved, true);
  const reloaded = await h.load();
  await reloaded.store.initialize();
  assert.equal(reloaded.store.get().settings.dailyNew, 30);
  assert.deepEqual(reloaded.store.get().progress.bookmarks, ["ability"]);
  assert.equal(reloaded.store.get().progress.typing.length, 1);
  h.setOffline(true);
  const offline = await h.load();
  await offline.store.initialize();
  assert.equal(offline.store.get().authStatus, "account");
  assert.equal(offline.store.get().unsaved, true);
  assert.equal(offline.store.get().reauth, true);
  assert.deepEqual(offline.store.get().progress.bookmarks, ["ability"]);
});

test("one manual click sends the whole snapshot; edits made in flight remain local until the next click", async () => {
  const h = await harness();
  await h.m.store.settings({ dailyNew: 30 });
  let finish!: (r: Response) => void;
  h.setHandler(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const saving = h.m.store.save();
  await h.m.store.settings({ dailyNew: 20 });
  finish(
    json({
      ...h.getSnapshot(),
      settings: { ...defaultSettings, dailyNew: 30 },
      revision: 1,
      epoch: 1,
    }),
  );
  assert.equal(await saving, true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.m.store.get().settings.dailyNew, 20);
  assert.equal(h.m.store.get().unsaved, true);
  assert.equal(h.m.store.get().pending, false);
  assert.equal(h.m.store.get().revision, 1);
  h.setSnapshot({ ...h.getSnapshot(), revision: 1, epoch: 1 });
  h.setHandler(null);
  assert.equal(await h.m.store.save(), true);
  assert.equal(h.writes.length, 2);
  assert.equal(h.getSnapshot().settings.dailyNew, 20);
  assert.equal(h.m.store.get().unsaved, false);
});

test("an uncertain save survives reload, retries the identical ID and body, then saves newer local edits", async () => {
  const h = await harness();
  await h.m.store.settings({ dailyNew: 30 });
  h.setHandler(async () => {
    throw new TypeError("response lost");
  });
  assert.equal(await h.m.store.save(), false);
  assert.equal(h.m.store.get().pending, true);
  const first = h.writes[0];
  const reloaded = await h.load();
  await reloaded.store.initialize();
  await reloaded.store.settings({ dailyNew: 40 });
  let retried = false;
  h.setHandler(async (m) => {
    if (!retried) {
      retried = true;
      assert.deepEqual(m, first);
      return json({
        ...h.getSnapshot(),
        settings: { ...defaultSettings, dailyNew: 30 },
        revision: 1,
        epoch: 1,
      });
    }
    const a = m.action as {
      type: "save";
      backup: { settings: Snapshot["settings"] };
    };
    return json({
      ...h.getSnapshot(),
      settings: a.backup.settings,
      revision: 2,
      epoch: 2,
    });
  });
  assert.equal(await reloaded.store.save(), true);
  assert.equal(h.writes.length, 3);
  assert.notEqual(h.writes[2].operationId, first.operationId);
  assert.equal(reloaded.store.get().settings.dailyNew, 40);
  assert.equal(reloaded.store.get().unsaved, false);
});

test("revision conflicts preserve local drafts and require explicit discard before reading remote data", async () => {
  const h = await harness();
  await h.m.store.settings({ dailyNew: 30 });
  h.setHandler(async () =>
    json({ error: "conflict", code: "REVISION_CONFLICT" }, 409),
  );
  assert.equal(await h.m.store.save(), false);
  assert.equal(h.m.store.get().conflict, true);
  assert.equal(h.m.store.get().settings.dailyNew, 30);
  assert.equal(h.m.store.get().unsaved, true);
  const before = h.calls.length;
  assert.equal(await h.m.store.refresh(), false);
  assert.equal(h.calls.length, before);
  assert.equal(await h.m.store.refresh(true), true);
  assert.equal(h.m.store.get().settings.dailyNew, defaultSettings.dailyNew);
  assert.equal(h.m.store.get().unsaved, false);
});

test("a retry cannot silently overwrite another device's update after a lost acknowledgement", async () => {
  const h = await harness();
  await h.m.store.settings({ dailyNew: 30 });
  h.setHandler(async () => {
    throw new TypeError("response lost");
  });
  await h.m.store.save();
  await h.m.store.settings({ dailyNew: 40 });
  h.setHandler(async () => json({ ...h.getSnapshot(), revision: 2, epoch: 2 }));
  assert.equal(await h.m.store.save(), false);
  assert.equal(h.m.store.get().conflict, true);
  assert.equal(h.m.store.get().settings.dailyNew, 40);
  assert.equal(h.writes.length, 2);
});

test("import and reset remain local; export includes the draft; storage failure rejects edits without network writes", async () => {
  const h = await harness();
  const backup = {
    app: "word-atlas",
    version: 2,
    progress: { ...emptyProgress("word-atlas-open"), bookmarks: ["ability"] },
    settings: { ...defaultSettings, dailyNew: 15 },
  };
  assert.equal((await h.m.importBackup(JSON.stringify(backup))).ok, true);
  assert.equal(h.m.store.get().settings.dailyNew, 15);
  assert.deepEqual(JSON.parse(h.m.exportBackup()).progress.bookmarks, [
    "ability",
  ]);
  assert.equal(h.writes.length, 0);
  assert.equal(await h.m.resetProgress(), true);
  assert.deepEqual(h.m.store.get().progress.bookmarks, []);
  h.setRejectWrites(true);
  assert.equal(
    await h.m.store.commit(
      { type: "bookmark", wordId: "ability", saved: true },
      (p) => ({ ...p, bookmarks: ["ability"] }),
    ),
    false,
  );
  assert.deepEqual(h.m.store.get().progress.bookmarks, []);
  assert.equal(h.writes.length, 0);
});

test("logout retains an account's draft without leaking it into another account or guest data", async () => {
  const h = await harness();
  await h.m.store.settings({ dailyNew: 30 });
  await h.m.store.logout();
  assert.equal(h.m.store.get().authStatus, "guest");
  assert.equal(h.m.store.get().unsaved, false);
  const originalFetch = globalThis.fetch;
  const other = { ...user, id: "other-user", username: "other" };
  globalThis.fetch = async (url, options) =>
    String(url) === "/api/auth/login"
      ? json({ user: other, snapshot: { ...initial(), userId: other.id } })
      : originalFetch(url, options);
  await h.m.store.authenticate("login", other.username, "test-password-123");
  assert.equal(h.m.store.get().settings.dailyNew, defaultSettings.dailyNew);
  assert.equal(h.m.store.get().unsaved, false);
  await h.m.store.logout();
  globalThis.fetch = originalFetch;
  await h.m.store.authenticate("login", user.username, "test-password-123");
  assert.equal(h.m.store.get().settings.dailyNew, 30);
  assert.equal(h.m.store.get().unsaved, true);
  assert.equal(h.writes.length, 0);
});

test("a previous version's unconfirmed bookmark is recovered as a local draft rather than automatically sent", async () => {
  const h = await harness();
  h.data.set(
    "word-atlas:account:" + user.id + ":word-atlas-open:pending",
    JSON.stringify({
      request: {
        userId: user.id,
        operationId: "legacy-operation",
        datasetId: "word-atlas-open",
        baseRevision: 0,
        epoch: 0,
        action: { type: "bookmark", wordId: "ability", saved: true },
      },
      session: null,
    }),
  );
  const reloaded = await h.load();
  await reloaded.store.initialize();
  assert.deepEqual(reloaded.store.get().progress.bookmarks, ["ability"]);
  assert.equal(reloaded.store.get().unsaved, true);
  assert.equal(h.writes.length, 0);
  assert.ok(JSON.parse(reloaded.exportBackup()).unconfirmedOperation);
  assert.equal(await reloaded.store.save(), true);
  assert.equal(h.writes[0].action.type, "save");
  assert.deepEqual(h.getSnapshot().progress.bookmarks, ["ability"]);
});
