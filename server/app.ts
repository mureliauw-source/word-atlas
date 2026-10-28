import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  emptyProgress,
  defaultSettings,
  sanitizeProgress,
  sanitizeSettings,
  type Settings,
} from "../src/shared/model";
import {
  ACCOUNT_FIELDS,
  type Account,
  type Mutation,
  type Snapshot,
} from "../src/shared/sync";
import { review, Rating } from "../src/store/srs";

const DATASET = "word-atlas-open";
const COOKIE = "word_atlas_session";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}
const check: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new ApiError(400, message);
};
const identifier = (v: unknown) =>
  typeof v === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const passwordKey = (password: string, salt: string): Promise<Buffer> =>
  new Promise((accept, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : accept(key)),
    );
  });
type UserRow = {
  id: string;
  username: string;
  password: string;
  salt: string;
  timezone: string;
};
type StateRow = {
  progress: string;
  settings: string;
  revision: number;
  epoch: number;
  updated_at: number;
};

export function createApplication(
  options: {
    database?: string;
    allowedOrigins?: string[];
    rewrittenOrigins?: string[];
    secureCookies?: boolean;
    words?: Set<string>;
  } = {},
) {
  const filename =
    options.database ??
    resolve(process.env.DB_PATH ?? ".data/word-atlas.sqlite");
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, salt TEXT NOT NULL, timezone TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS states (user_id TEXT NOT NULL REFERENCES users(id), dataset TEXT NOT NULL, progress TEXT NOT NULL, settings TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, epoch INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,dataset));
    CREATE TABLE IF NOT EXISTS operations (user_id TEXT NOT NULL REFERENCES users(id), operation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, dataset TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,operation_id));
    CREATE TABLE IF NOT EXISTS reviews (user_id TEXT NOT NULL, dataset TEXT NOT NULL, epoch INTEGER NOT NULL, session_id TEXT NOT NULL, word_id TEXT NOT NULL, created_at INTEGER NOT NULL, grade INTEGER NOT NULL, before_state TEXT, after_state TEXT NOT NULL, PRIMARY KEY(user_id,dataset,epoch,session_id,word_id));
    CREATE TABLE IF NOT EXISTS business_events (user_id TEXT NOT NULL, dataset TEXT NOT NULL, epoch INTEGER NOT NULL, event_id TEXT NOT NULL, PRIMARY KEY(user_id,dataset,epoch,event_id));
    CREATE TABLE IF NOT EXISTS imports (user_id TEXT NOT NULL, dataset TEXT NOT NULL, epoch INTEGER NOT NULL, fingerprint TEXT NOT NULL, before_state TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,dataset,epoch,fingerprint));
    PRAGMA user_version=1;`);
  const words =
    options.words ??
    new Set(
      (
        JSON.parse(
          readFileSync(
            resolve(process.env.ATLAS_INDEX_PATH ?? "public/atlas/index.json"),
            "utf8",
          ),
        ).words as string[][]
      ).map((row) => row[0]),
    );
  const secure = options.secureCookies ?? process.env.COOKIE_SECURE === "true";
  const allowed = new Set(
    options.allowedOrigins ?? [
      "http://127.0.0.1:5188",
      "http://localhost:5188",
    ],
  );
  const rewritten = new Set(options.rewrittenOrigins ?? []);
  const rates = new Map<string, { count: number; until: number }>();
  const cookie = (token: string, seconds = 30 * 86400) =>
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? "; Secure" : ""}`;
  const userView = ({ id, username, timezone }: UserRow): Account => ({
    id,
    username,
    timezone,
  });
  function rate(key: string, max: number) {
    const now = Date.now();
    for (const [key, entry] of rates) if (entry.until < now) rates.delete(key);
    const record = rates.get(key) ?? { count: 0, until: now + 15 * 60_000 };
    if (++record.count > max || rates.size > 10000)
      throw new ApiError(429, "操作过于频繁，请稍后再试。", "RATE_LIMITED");
    rates.set(key, record);
  }
  function authenticate(req: IncomingMessage): UserRow {
    const token =
      req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(COOKIE + "="))
        ?.slice(COOKIE.length + 1) ?? "";
    if (!/^[a-f0-9]{64}$/.test(token))
      throw new ApiError(401, "请先登录。", "UNAUTHENTICATED");
    const user = db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?",
      )
      .get(hash(token), Date.now()) as UserRow | undefined;
    if (!user)
      throw new ApiError(401, "登录已过期，请重新登录。", "UNAUTHENTICATED");
    return user;
  }
  function state(user: UserRow): Snapshot {
    db.prepare(
      "INSERT OR IGNORE INTO states(user_id,dataset,progress,settings,updated_at) VALUES(?,?,?,?,?)",
    ).run(
      user.id,
      DATASET,
      JSON.stringify(emptyProgress(DATASET)),
      JSON.stringify({ ...defaultSettings, onboarded: true }),
      Date.now(),
    );
    const row = db
      .prepare("SELECT * FROM states WHERE user_id=? AND dataset=?")
      .get(user.id, DATASET) as StateRow;
    return {
      userId: user.id,
      progress: JSON.parse(row.progress),
      settings: JSON.parse(row.settings),
      revision: row.revision,
      epoch: row.epoch,
      updatedAt: row.updated_at,
    };
  }
  function mutate(user: UserRow, value: unknown): Snapshot {
    check(object(value), "提交格式无效。");
    check(
      identifier(value.operationId) &&
        value.datasetId === DATASET &&
        Number.isSafeInteger(value.baseRevision) &&
        Number.isSafeInteger(value.epoch) &&
        object(value.action),
      "提交参数无效或词库不匹配。",
    );
    const input = value as unknown as Mutation;
    if (input.userId !== user.id)
      throw new ApiError(
        409,
        "账号已在其他标签页切换，请重新登录当前账号。",
        "ACCOUNT_CHANGED",
      );
    const action = input.action;
    const fingerprint = hash(JSON.stringify(input));
    db.exec("BEGIN IMMEDIATE");
    try {
      const prior = db
        .prepare(
          "SELECT fingerprint FROM operations WHERE user_id=? AND operation_id=?",
        )
        .get(user.id, input.operationId) as { fingerprint: string } | undefined;
      if (prior && prior.fingerprint !== fingerprint)
        throw new ApiError(
          409,
          "操作编号不能用于不同请求。",
          "OPERATION_MISMATCH",
        );
      const next = state(user);
      if (prior) {
        db.exec("COMMIT");
        return next;
      }
      if (input.baseRevision !== next.revision || input.epoch !== next.epoch)
        throw new ApiError(
          409,
          "另一台设备已更新进度，请刷新后重新操作。",
          "REVISION_CONFLICT",
        );
      const p = next.progress;
      const now = Date.now();
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: user.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const bump = (
        patch: Partial<{ n: number; r: number; c: number; t: number }>,
      ) => {
        const old = p.days[day] ?? { n: 0, r: 0, c: 0, t: 0 };
        p.days[day] = {
          n: old.n + (patch.n ?? 0),
          r: old.r + (patch.r ?? 0),
          c: old.c + (patch.c ?? 0),
          t: old.t + (patch.t ?? 0),
        };
      };
      const once = (key: string) =>
        db
          .prepare("INSERT OR IGNORE INTO business_events VALUES(?,?,?,?)")
          .run(user.id, DATASET, next.epoch, key).changes > 0;
      switch (action.type) {
        case "review": {
          check(
            words.has(action.wordId) &&
              [1, 2, 3, 4].includes(action.grade) &&
              identifier(action.sessionId),
            "作答参数无效。",
          );
          const priorReview = db
            .prepare(
              "SELECT 1 FROM reviews WHERE user_id=? AND dataset=? AND epoch=? AND session_id=? AND word_id=?",
            )
            .get(user.id, DATASET, next.epoch, action.sessionId, action.wordId);
          if (!priorReview) {
            const before = p.cards[action.wordId];
            const after = review(
              before,
              action.grade,
              now,
              next.settings.retention,
            );
            db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?,?,?,?,?)").run(
              user.id,
              DATASET,
              next.epoch,
              action.sessionId,
              action.wordId,
              now,
              action.grade,
              before ? JSON.stringify(before) : null,
              JSON.stringify(after),
            );
            p.cards[action.wordId] = after;
            bump({
              r: 1,
              c: action.grade === Rating.Again ? 0 : 1,
              n: before ? 0 : 1,
            });
            if (action.grade === Rating.Again)
              p.mistakes = [
                action.wordId,
                ...p.mistakes.filter((id) => id !== action.wordId),
              ].slice(0, 300);
          }
          break;
        }
        case "advance":
          check(
            identifier(action.sessionId) &&
              Number.isSafeInteger(action.stepIndex) &&
              action.stepIndex >= 0 &&
              action.stepIndex <= 10000 &&
              Number.isFinite(action.seconds) &&
              action.seconds >= 0,
            "学习时长无效。",
          );
          if (once(`advance:${action.sessionId}:${action.stepIndex}`))
            bump({ t: Math.max(0, Math.min(90, Math.round(action.seconds))) });
          break;
        case "bookmark":
          check(
            words.has(action.wordId) && typeof action.saved === "boolean",
            "收藏参数无效。",
          );
          p.bookmarks = p.bookmarks.filter((id) => id !== action.wordId);
          if (action.saved) p.bookmarks.unshift(action.wordId);
          break;
        case "typing": {
          check(identifier(action.roundId), "练习编号无效。");
          const clean = sanitizeProgress(
            { ...emptyProgress(DATASET), typing: [action.round] },
            DATASET,
          ).typing;
          check(
            clean.length === 1 &&
              clean[0].items <= 10000 &&
              clean[0].at <= now + 300_000,
            "打字记录无效。",
          );
          if (once(`typing:${action.roundId}`))
            p.typing = [...p.typing, clean[0]].slice(-500);
          break;
        }
        case "settings": {
          check(object(action.patch), "设置格式无效。");
          const sanitized = sanitizeSettings({
            ...next.settings,
            ...action.patch,
          });
          for (const key of ACCOUNT_FIELDS)
            Object.assign(next.settings, { [key]: sanitized[key] });
          break;
        }
        case "save":
        case "import": {
          const backup = action.backup;
          check(
            object(backup) &&
              backup.app === "word-atlas" &&
              backup.version === 2 &&
              object(backup.progress),
            "这不是有效的词光版本 2 备份。",
          );
          check(
            backup.progress.version === 2 &&
              backup.progress.datasetId === DATASET,
            "备份来自另一个词库或版本。",
          );
          check(
            object(backup.progress.cards) &&
              Array.isArray(backup.progress.bookmarks) &&
              object(backup.progress.days),
            "备份结构不完整。",
          );
          const clean = sanitizeProgress(backup.progress, DATASET);
          check(
            Object.keys(clean.cards).length ===
              Object.keys((backup.progress.cards ?? {}) as object).length,
            "备份包含无效的记忆记录。",
          );
          check(
            Object.keys(clean.cards).every((id) => words.has(id)) &&
              clean.bookmarks.every((id) => words.has(id)) &&
              clean.mistakes.every((id) => words.has(id)),
            "备份包含当前词库不存在的单词。",
          );
          const importHash = hash(
            JSON.stringify({
              progress: backup.progress,
              settings: backup.settings,
            }),
          );
          if (
            action.type === "save" ||
            !db
              .prepare(
                "SELECT 1 FROM imports WHERE user_id=? AND dataset=? AND epoch=? AND fingerprint=?",
              )
              .get(user.id, DATASET, next.epoch, importHash)
          ) {
            const before = JSON.stringify(next);
            next.epoch += 1;
            next.progress = { ...clean, session: null };
            const settings = sanitizeSettings(backup.settings);
            for (const key of ACCOUNT_FIELDS)
              Object.assign(next.settings, { [key]: settings[key] });
            next.settings.onboarded = true;
            if (action.type === "import")
              db.prepare("INSERT INTO imports VALUES(?,?,?,?,?,?)").run(
                user.id,
                DATASET,
                next.epoch,
                importHash,
                before,
                now,
              );
          }
          break;
        }
        case "reset":
          next.progress = emptyProgress(DATASET);
          next.epoch += 1;
          break;
        default:
          throw new ApiError(400, "不支持的操作。");
      }
      next.progress.session = null;
      next.revision += 1;
      next.updatedAt = now;
      db.prepare(
        "UPDATE states SET progress=?,settings=?,revision=?,epoch=?,updated_at=? WHERE user_id=? AND dataset=?",
      ).run(
        JSON.stringify(next.progress),
        JSON.stringify(next.settings),
        next.revision,
        next.epoch,
        now,
        user.id,
        DATASET,
      );
      // Imported backup contents and passwords must not be retained in the operation log.
      db.prepare("INSERT INTO operations VALUES(?,?,?,?,?,?)").run(
        user.id,
        input.operationId,
        fingerprint,
        DATASET,
        action.type,
        now,
      );
      db.exec("COMMIT");
      return next;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  async function body(
    req: IncomingMessage,
    limit = 30 * 1024 * 1024,
  ): Promise<Record<string, unknown>> {
    if (!req.headers["content-type"]?.startsWith("application/json"))
      throw new ApiError(415, "请求必须使用 JSON。");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new ApiError(413, "请求内容超过允许的大小。");
      chunks.push(chunk);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ApiError(400, "JSON 格式无效。");
    }
    check(object(parsed), "请求必须是对象。");
    return parsed;
  }
  function send(res: ServerResponse, status: number, payload: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(payload));
  }
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (req.method === "GET" && path === "/api/health")
        return send(res, 200, { ok: true });
      if (req.method === "GET" && path === "/api/auth/me") {
        try {
          return send(res, 200, { user: userView(authenticate(req)) });
        } catch (error) {
          if (error instanceof ApiError && error.status === 401)
            return send(res, 200, { user: null });
          throw error;
        }
      }
      if (req.method === "GET" && path === "/api/state")
        return send(res, 200, state(authenticate(req)));
      if (req.method !== "POST")
        return send(res, 404, { error: "接口不存在。" });
      const requestOrigin = req.headers.origin ?? "";
      const fetchSite = req.headers["sec-fetch-site"];
      // A tunnel may rewrite Origin. Only browser-confirmed same-origin requests
      // can use these explicitly configured aliases.
      const directAllowed =
        allowed.has(requestOrigin) &&
        (fetchSite === undefined ||
          fetchSite === "same-origin" ||
          fetchSite === "none");
      const rewrittenAllowed =
        rewritten.has(requestOrigin) && fetchSite === "same-origin";
      if (!directAllowed && !rewrittenAllowed)
        throw new ApiError(403, "请求来源未获允许。", "ORIGIN_REJECTED");
      if (path === "/api/auth/register" || path === "/api/auth/login") {
        rate(
          `${path}:${req.socket.remoteAddress}`,
          path.endsWith("register") ? 10 : 20,
        );
        const input = await body(req, 4096);
        check(
          typeof input.username === "string" &&
            typeof input.password === "string",
          "请输入用户名和密码。",
        );
        const username = input.username.normalize("NFKC").trim().toLowerCase();
        check(
          /^[\p{L}\p{N}_-]{3,32}$/u.test(username) &&
            input.password.length >= 10 &&
            input.password.length <= 128,
          "用户名需为 3–32 位文字、数字、下划线或短横线；密码需为 10–128 位。",
        );
        let user = db
          .prepare("SELECT * FROM users WHERE username=?")
          .get(username) as UserRow | undefined;
        if (path.endsWith("register")) {
          if (user)
            throw new ApiError(409, "用户名已被使用。", "USERNAME_TAKEN");
          let timezone =
            typeof input.timezone === "string"
              ? input.timezone
              : "Asia/Singapore";
          try {
            new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
          } catch {
            timezone = "Asia/Singapore";
          }
          const salt = randomBytes(16).toString("hex");
          const key = await passwordKey(input.password, salt);
          user = {
            id: randomUUID(),
            username,
            password: key.toString("hex"),
            salt,
            timezone,
          };
          // Check again after the asynchronous password hash to handle racing registrations.
          if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username))
            throw new ApiError(409, "用户名已被使用。", "USERNAME_TAKEN");
          db.prepare("INSERT INTO users VALUES(?,?,?,?,?)").run(
            user.id,
            user.username,
            user.password,
            user.salt,
            user.timezone,
          );
        } else {
          const key = await passwordKey(
            input.password,
            user?.salt ?? "00000000000000000000000000000000",
          );
          if (!user || !timingSafeEqual(key, Buffer.from(user.password, "hex")))
            throw new ApiError(
              401,
              "用户名或密码错误。",
              "INVALID_CREDENTIALS",
            );
        }
        db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
        const token = randomBytes(32).toString("hex");
        db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
          hash(token),
          user.id,
          Date.now() + 30 * 86400_000,
        );
        res.setHeader("Set-Cookie", cookie(token));
        return send(res, 200, { user: userView(user), snapshot: state(user) });
      }
      const user = authenticate(req);
      if (path === "/api/auth/logout") {
        const token =
          req.headers.cookie
            ?.split(";")
            .map((s) => s.trim())
            .find((s) => s.startsWith(COOKIE + "="))
            ?.slice(COOKIE.length + 1) ?? "";
        db.prepare("DELETE FROM sessions WHERE token=?").run(hash(token));
        res.setHeader("Set-Cookie", cookie("", 0));
        return send(res, 200, { ok: true });
      }
      if (path === "/api/mutations")
        return send(res, 200, mutate(user, await body(req)));
      return send(res, 404, { error: "接口不存在。" });
    } catch (error) {
      if (error instanceof ApiError)
        send(res, error.status, { error: error.message, code: error.code });
      else {
        console.error(
          "API request failed:",
          error instanceof Error ? error.message : "unknown error",
        );
        send(res, 500, {
          error: "服务暂时不可用，请稍后重试。",
          code: "INTERNAL_ERROR",
        });
      }
    }
  });
  server.requestTimeout = 30_000;
  return {
    server,
    db,
    close: () =>
      new Promise<void>((accept, reject) => {
        server.close((error) => {
          db.close();
          error ? reject(error) : accept();
        });
        server.closeAllConnections();
      }),
  };
}
