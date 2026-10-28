import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApplication } from "./app";
import { defaultSettings, emptyProgress } from "../src/shared/model";
import type { Action, Snapshot } from "../src/shared/sync";

const origin = "http://127.0.0.1:5188";
test("rewritten tunnel origins require same-origin Fetch Metadata and reject foreign sites", async () => {
  const alias = "https://192.168.31.178:18088";
  const app = createApplication({
    database: ":memory:",
    allowedOrigins: [origin, "https://mure.iepose.cn"],
    rewrittenOrigins: [alias],
    words: new Set(["abandon"]),
  });
  await new Promise<void>((accept) =>
    app.server.listen(0, "127.0.0.1", accept),
  );
  const port = (app.server.address() as { port: number }).port;
  const probe = async (requestOrigin: string, site?: string) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: {
        Origin: requestOrigin,
        "Content-Type": "application/json",
        ...(site ? { "Sec-Fetch-Site": site } : {}),
      },
      body: JSON.stringify({
        username: "origin_probe",
        password: "probe-only-invalid-1234",
      }),
    });
    const data = await response.json();
    return { status: response.status, code: data.code };
  };
  try {
    assert.deepEqual(await probe(alias, "same-origin"), {
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    for (const site of [undefined, "cross-site", "same-site", "none"])
      assert.deepEqual(await probe(alias, site), {
        status: 403,
        code: "ORIGIN_REJECTED",
      });
    assert.equal((await probe(origin)).status, 401);
    assert.equal(
      (await probe("https://mure.iepose.cn", "same-origin")).status,
      401,
    );
    assert.equal((await probe(origin, "cross-site")).status, 403);
    assert.equal(
      (await probe("https://untrusted.invalid", "same-origin")).status,
      403,
    );
  } finally {
    await app.close();
  }
});

async function fixture(database = ":memory:") {
  const app = createApplication({
    database,
    allowedOrigins: [origin],
    words: new Set(["abandon", "ability"]),
  });
  await new Promise<void>((accept) =>
    app.server.listen(0, "127.0.0.1", accept),
  );
  const address = app.server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const call = async (
    path: string,
    cookie = "",
    data?: unknown,
    requestOrigin = origin,
  ) => {
    const response = await fetch(base + path, {
      method: data === undefined ? "GET" : "POST",
      headers: {
        Origin: requestOrigin,
        Cookie: cookie,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
      headers: response.headers,
    };
  };
  const register = (username: string) =>
    call("/api/auth/register", "", {
      username,
      password: "Test-password-only-123",
      timezone: "Asia/Singapore",
    });
  const mutate = (
    cookie: string,
    snapshot: Snapshot,
    action: Action,
    operationId = randomUUID(),
  ) =>
    call("/api/mutations", cookie, {
      userId: snapshot.userId,
      operationId,
      datasetId: "word-atlas-open",
      baseRevision: snapshot.revision,
      epoch: snapshot.epoch,
      action,
    });
  return { app, call, register, mutate };
}

test("visitors register, duplicate accounts fail, password hashes and revocable sessions remain private", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call("/api/state")).status, 401);
    const account = await f.register("family_alice");
    assert.equal(account.status, 200);
    assert.match(account.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(account.headers.get("set-cookie")!, /SameSite=Strict/);
    assert.equal(account.headers.get("cache-control"), "no-store");
    assert.equal(account.data.user.password, undefined);
    const row = f.app.db.prepare("SELECT password,salt FROM users").get() as {
      password: string;
      salt: string;
    };
    assert.notEqual(row.password, "Test-password-only-123");
    assert.equal(row.password.length, 128);
    assert.equal((await f.register("FAMILY_ALICE")).status, 409);
    assert.equal(
      (
        await f.call("/api/auth/login", "", {
          username: "family_alice",
          password: "wrong-password",
        })
      ).status,
      401,
    );
    const login = await f.call("/api/auth/login", "", {
      username: "family_alice",
      password: "Test-password-only-123",
    });
    assert.equal(login.status, 200);
    assert.equal(
      (await f.call("/api/auth/logout", login.cookie, {})).status,
      200,
    );
    assert.equal((await f.call("/api/state", login.cookie)).status, 401);
    assert.equal((await f.call("/api/state", account.cookie)).status, 200);
  } finally {
    await f.app.close();
  }
});

test("server schedules reviews, deduplicates network retries and first answers, and isolates accounts", async () => {
  const f = await fixture();
  try {
    const alice = await f.register("alice");
    const bob = await f.register("bob");
    const operationId = randomUUID();
    const action: Action = {
      type: "review",
      wordId: "abandon",
      grade: 3,
      sessionId: randomUUID(),
    };
    const first = await f.mutate(
      alice.cookie,
      alice.data.snapshot,
      action,
      operationId,
    );
    assert.equal(first.status, 200);
    assert.equal(first.data.progress.cards.abandon.reps, 1);
    const again = await f.mutate(
      alice.cookie,
      alice.data.snapshot,
      action,
      operationId,
    );
    assert.equal(again.status, 200);
    assert.equal(again.data.revision, first.data.revision);
    const sameRound = await f.mutate(alice.cookie, first.data, action);
    assert.equal(sameRound.data.progress.cards.abandon.reps, 1);
    assert.equal(
      Object.values(sameRound.data.progress.days).reduce(
        (n: number, d: any) => n + d.r,
        0,
      ),
      1,
    );
    assert.equal(
      (
        await f.mutate(alice.cookie, alice.data.snapshot, {
          type: "bookmark",
          wordId: "ability",
          saved: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await f.mutate(
          alice.cookie,
          alice.data.snapshot,
          { ...action, grade: 1 },
          operationId,
        )
      ).status,
      409,
    );
    const isolated = await f.call("/api/state", bob.cookie);
    assert.deepEqual(isolated.data.progress.cards, {});
    assert.deepEqual(isolated.data.progress.bookmarks, []);
    assert.equal(
      (
        await f.mutate(bob.cookie, alice.data.snapshot, {
          type: "bookmark",
          wordId: "abandon",
          saved: true,
        })
      ).status,
      409,
    );
  } finally {
    await f.app.close();
  }
});

test("two devices cannot overwrite a shared old revision", async () => {
  const f = await fixture();
  try {
    const alice = await f.register("alice");
    const responses = await Promise.all([
      f.mutate(alice.cookie, alice.data.snapshot, {
        type: "bookmark",
        wordId: "abandon",
        saved: true,
      }),
      f.mutate(alice.cookie, alice.data.snapshot, {
        type: "bookmark",
        wordId: "ability",
        saved: true,
      }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const fresh = await f.call("/api/state", alice.cookie);
    assert.equal(fresh.data.progress.bookmarks.length, 1);
    const other =
      fresh.data.progress.bookmarks[0] === "abandon" ? "ability" : "abandon";
    const merged = await f.mutate(alice.cookie, fresh.data, {
      type: "bookmark",
      wordId: other,
      saved: true,
    });
    assert.equal(merged.data.progress.bookmarks.length, 2);
  } finally {
    await f.app.close();
  }
});

test("manual whole-snapshot saves are atomic, idempotent, isolated and reject stale versions or invalid content", async () => {
  const f = await fixture();
  try {
    const alice = await f.register("manual_alice");
    const bob = await f.register("manual_bob");
    const original = alice.data.snapshot as Snapshot;
    const backup = {
      app: "word-atlas",
      version: 2,
      progress: {
        ...emptyProgress("word-atlas-open"),
        bookmarks: ["ability"],
        days: { "2026-10-26": { n: 1, r: 2, c: 1, t: 60 } },
      },
      settings: { ...defaultSettings, dailyNew: 30 },
    };
    const operationId = randomUUID();
    const saved = await f.mutate(
      alice.cookie,
      original,
      { type: "save", backup },
      operationId,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.data.revision, original.revision + 1);
    assert.equal(saved.data.epoch, original.epoch + 1);
    assert.deepEqual(saved.data.progress.bookmarks, ["ability"]);
    assert.deepEqual(saved.data.progress.days, backup.progress.days);
    assert.equal(saved.data.settings.dailyNew, 30);
    assert.equal(saved.data.progress.session, null);
    const retry = await f.mutate(
      alice.cookie,
      original,
      { type: "save", backup },
      operationId,
    );
    assert.equal(retry.status, 200);
    assert.equal(retry.data.revision, saved.data.revision);
    assert.equal(
      (await f.mutate(alice.cookie, original, { type: "save", backup })).status,
      409,
    );
    assert.equal(
      (await f.mutate(bob.cookie, original, { type: "save", backup })).status,
      409,
    );
    const malformed = structuredClone(backup);
    malformed.progress.bookmarks = ["unknown-word"];
    assert.equal(
      (
        await f.mutate(alice.cookie, saved.data, {
          type: "save",
          backup: malformed,
        })
      ).status,
      400,
    );
    const after = await f.call("/api/state", alice.cookie);
    assert.deepEqual(after.data, saved.data);
    assert.deepEqual(
      (await f.call("/api/state", bob.cookie)).data.progress.bookmarks,
      [],
    );
    const unchanged = await f.mutate(alice.cookie, saved.data, {
      type: "save",
      backup,
    });
    assert.equal(unchanged.data.revision, saved.data.revision + 1);
    assert.equal(
      (
        f.app.db.prepare("SELECT COUNT(*) AS n FROM imports").get() as {
          n: number;
        }
      ).n,
      0,
    );
  } finally {
    await f.app.close();
  }
});

test("version 2 imports preserve progress, settings, historical statistics and export compatibility", async () => {
  const f = await fixture();
  try {
    const alice = await f.register("alice");
    const backup = {
      app: "word-atlas",
      version: 2,
      progress: {
        ...emptyProgress("word-atlas-open"),
        cards: {
          abandon: {
            due: 10,
            s: 2,
            d: 5,
            el: 0,
            sd: 1,
            ls: 0,
            reps: 3,
            lapses: 0,
            st: 2,
            seen: 1,
          },
        },
        bookmarks: ["ability"],
        days: { "2026-01-01": { n: 10, r: 30, c: 20, t: 100 } },
      },
      settings: { ...defaultSettings, dailyNew: 15 },
    };
    const imported = await f.mutate(alice.cookie, alice.data.snapshot, {
      type: "import",
      backup,
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(imported.data.progress.cards, backup.progress.cards);
    assert.deepEqual(imported.data.progress.days, backup.progress.days);
    assert.equal(imported.data.settings.dailyNew, 15);
    assert.equal(imported.data.progress.session, null);
    const repeated = await f.mutate(alice.cookie, imported.data, {
      type: "import",
      backup,
    });
    assert.equal(repeated.data.progress.days["2026-01-01"].r, 30);
    assert.equal(repeated.data.epoch, imported.data.epoch);
    const wrong = structuredClone(backup);
    wrong.progress.datasetId = "other";
    assert.equal(
      (
        await f.mutate(alice.cookie, repeated.data, {
          type: "import",
          backup: wrong,
        })
      ).status,
      400,
    );
    const invalid = structuredClone(backup);
    invalid.progress.cards.abandon.d = 500;
    assert.equal(
      (
        await f.mutate(alice.cookie, repeated.data, {
          type: "import",
          backup: invalid,
        })
      ).status,
      400,
    );
    const otherWord = structuredClone(backup);
    otherWord.progress.bookmarks = ["not-in-dataset"];
    assert.equal(
      (
        await f.mutate(alice.cookie, repeated.data, {
          type: "import",
          backup: otherWord,
        })
      ).status,
      400,
    );
    assert.equal(
      (await f.call("/api/state", alice.cookie)).data.progress.cards.abandon
        .reps,
      3,
    );
    assert.equal(
      (
        f.app.db.prepare("SELECT before_state FROM imports").get() as {
          before_state: string;
        }
      ).before_state.includes('"cards":{}'),
      true,
    );
  } finally {
    await f.app.close();
  }
});

test("reset rejects old devices and delayed replay never restores erased cards", async () => {
  const f = await fixture();
  try {
    const alice = await f.register("alice");
    const op = randomUUID();
    const action: Action = {
      type: "review",
      wordId: "abandon",
      grade: 3,
      sessionId: randomUUID(),
    };
    const before = await f.mutate(
      alice.cookie,
      alice.data.snapshot,
      action,
      op,
    );
    const reset = await f.mutate(alice.cookie, before.data, { type: "reset" });
    assert.equal(reset.data.epoch, 1);
    assert.equal(
      (
        await f.mutate(alice.cookie, before.data, {
          type: "bookmark",
          wordId: "ability",
          saved: true,
        })
      ).status,
      409,
    );
    const replay = await f.mutate(
      alice.cookie,
      alice.data.snapshot,
      action,
      op,
    );
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.data.progress.cards, {});
  } finally {
    await f.app.close();
  }
});

test("typing and active time do not double count business events", async () => {
  const f = await fixture();
  try {
    const alice = await f.register("alice");
    const action: Action = {
      type: "advance",
      sessionId: randomUUID(),
      stepIndex: 0,
      seconds: 1000,
    };
    const one = await f.mutate(alice.cookie, alice.data.snapshot, action);
    const two = await f.mutate(alice.cookie, one.data, action);
    assert.equal(
      Object.values(two.data.progress.days).reduce(
        (n: number, d: any) => n + d.t,
        0,
      ),
      90,
    );
    const typing: Action = {
      type: "typing",
      roundId: randomUUID(),
      round: { at: Date.now(), mode: "word", items: 10, wpm: 40, accuracy: 99 },
    };
    const first = await f.mutate(alice.cookie, two.data, typing);
    const second = await f.mutate(alice.cookie, first.data, typing);
    assert.equal(second.data.progress.typing.length, 1);
  } finally {
    await f.app.close();
  }
});

test("cross-origin writes, unsupported words and unsupported operations are rejected atomically", async () => {
  const f = await fixture();
  try {
    const alice = await f.register("alice");
    assert.equal(
      (
        await f.call(
          "/api/auth/logout",
          alice.cookie,
          {},
          "https://untrusted.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.mutate(alice.cookie, alice.data.snapshot, {
          type: "bookmark",
          wordId: "__proto__",
          saved: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.mutate(alice.cookie, alice.data.snapshot, {
          type: "bad",
        } as unknown as Action)
      ).status,
      400,
    );
    assert.equal((await f.call("/api/state", alice.cookie)).data.revision, 0);
    assert.equal(
      f.app.db.prepare("SELECT count(*) AS n FROM operations").get()!.n,
      0,
    );
  } finally {
    await f.app.close();
  }
});

test("data and login sessions survive process recreation on the same local database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlas-test-"));
  const database = join(directory, "test.sqlite");
  const first = await fixture(database);
  const alice = await first.register("alice");
  await first.mutate(alice.cookie, alice.data.snapshot, {
    type: "bookmark",
    wordId: "abandon",
    saved: true,
  });
  await first.app.close();
  const restarted = await fixture(database);
  try {
    const restored = await restarted.call("/api/state", alice.cookie);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.data.progress.bookmarks, ["abandon"]);
  } finally {
    await restarted.app.close();
    rmSync(directory, { recursive: true });
  }
});

test("public registration is rate limited without requiring an invitation", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 10; i++)
      assert.equal((await f.call("/api/auth/register", "", {})).status, 400);
    assert.equal((await f.register("visitor")).status, 429);
  } finally {
    await f.app.close();
  }
});
