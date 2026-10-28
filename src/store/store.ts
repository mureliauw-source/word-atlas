import { useSyncExternalStore } from "react";
import { newId } from "../lib/id";
import {
  emptyProgress,
  sanitizeProgress,
  sanitizeSettings,
  dayKey,
  setAccountTimezone,
  type ActiveSession,
  type DayStat,
  type Progress,
  type Settings,
  type TypingRound,
} from "../shared/model";
import {
  ACCOUNT_FIELDS,
  type Account,
  type Action,
  type Mutation,
  type Snapshot,
} from "../shared/sync";
import { review, Rating } from "./srs";
import { toast } from "../ui/Toast";
export * from "../shared/model";

const SETTINGS_KEY = "word-atlas:settings";
const LAST_ACCOUNT_KEY = "word-atlas:last-account";
const progressKey = (id: string) => "word-atlas:v2:" + id;
function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
interface SaveAttempt {
  request: Mutation;
  generation: number;
}
interface Draft {
  version: 1;
  userId: string;
  datasetId: string;
  progress: Progress;
  settings: Settings;
  baseRevision: number;
  epoch: number;
  generation: number;
  changeId: string;
  attempt: SaveAttempt | null;
}
interface LegacyPending {
  request: Mutation;
  session: ActiveSession | null;
}
interface State {
  progress: Progress;
  settings: Settings;
  saveError: boolean;
  account: Account | null;
  authStatus: "checking" | "guest" | "account";
  syncBusy: boolean;
  syncError: string | null;
  lastSync: number | null;
  pending: boolean;
  unsaved: boolean;
  conflict: boolean;
  revision: number;
  epoch: number;
  reauth: boolean;
}
let state: State = {
  progress: emptyProgress("word-atlas-open"),
  settings: sanitizeSettings(read(SETTINGS_KEY)),
  saveError: false,
  account: null,
  authStatus: "checking",
  syncBusy: false,
  syncError: null,
  lastSync: null,
  pending: false,
  unsaved: false,
  conflict: false,
  revision: 0,
  epoch: 0,
  reauth: false,
};
let attempt: SaveAttempt | null = null;
let generation = 0;
let draftToken: string | null = null;
let localConflict = false;
let authenticating = false;
let identity = 0;
let initializing: Promise<void> | null = null;
let saveTimer: number | undefined;
let dirty = false;
let loadedId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const accountKey = (name: string) =>
  "word-atlas:account:" +
  state.account!.id +
  ":" +
  state.progress.datasetId +
  ":" +
  name;
const draftKey = () => accountKey("draft");
const pendingKey = () => accountKey("pending");
function draftFor(
  next = state,
  nextGeneration = generation,
  token = draftToken ?? newId(),
): Draft {
  return {
    version: 1,
    userId: next.account!.id,
    datasetId: next.progress.datasetId,
    progress: next.progress,
    settings: next.settings,
    baseRevision: next.revision,
    epoch: next.epoch,
    generation: nextGeneration,
    changeId: token,
    attempt,
  };
}
function ownsDraft() {
  const stored = read<Draft>(draftKey());
  if (localConflict || (stored?.changeId ?? null) !== draftToken) {
    localConflict = true;
    state = {
      ...state,
      conflict: true,
      syncError: "另一标签页已修改本机草稿。请先导出当前进度，再重新加载页面。",
    };
    emit();
    return false;
  }
  return true;
}
function persistAccount() {
  if (!ownsDraft()) return false;
  if (!write(draftKey(), state.unsaved || attempt ? draftFor() : null))
    return false;
  return (
    write(accountKey("progress"), state.progress) &&
    write(accountKey("settings"), state.settings) &&
    write(accountKey("epoch"), state.epoch)
  );
}
function scheduleSave() {
  dirty = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 250);
}
export function flush() {
  if (typeof window === "undefined") return;
  window.clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  const ok = state.account
    ? persistAccount()
    : (loadedId !== state.progress.datasetId ||
        write(progressKey(state.progress.datasetId), state.progress)) &&
      write(SETTINGS_KEY, state.settings);
  if (state.saveError === ok) {
    state = { ...state, saveError: !ok };
    emit();
  }
}
class RequestError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "",
  ) {
    super(message);
  }
}
async function request<T>(path: string, data?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    data === undefined ? 10_000 : 30_000,
  );
  try {
    const response = await fetch("/api" + path, {
      method: data === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers:
        data === undefined ? undefined : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    let json: Record<string, unknown>;
    try {
      json = await response.json();
    } catch {
      throw new RequestError(
        "账号服务返回异常响应（HTTP " +
          response.status +
          "）。本机草稿仍保留。",
        response.status,
        "INVALID_RESPONSE",
      );
    }
    if (!response.ok)
      throw new RequestError(
        typeof json.error === "string"
          ? json.error
          : "账号服务返回 HTTP " + response.status,
        response.status,
        typeof json.code === "string" ? json.code : "",
      );
    return json as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      controller.signal.aborted
        ? "请求超时。本机进度已保留，请恢复连接后手动重试保存。"
        : "无法连接账号服务。本机进度已保留，可继续学习，稍后手动保存。",
    );
  } finally {
    clearTimeout(timer);
  }
}
function stage(progress: Progress, settings = state.settings) {
  if (authenticating) {
    toast("请等待账号登录完成。", "warn");
    return false;
  }
  if (!state.account) {
    state = { ...state, progress, settings };
    emit();
    dirty = true;
    flush();
    return true;
  }
  if (!ownsDraft()) return false;
  const token = newId();
  const next = { ...state, progress, settings, unsaved: true };
  if (!write(draftKey(), draftFor(next, generation + 1, token))) {
    state = { ...state, saveError: true };
    emit();
    toast("浏览器无法保存本机草稿，请先导出备份。", "warn");
    return false;
  }
  generation += 1;
  draftToken = token;
  state = { ...next, saveError: false };
  emit();
  dirty = true;
  flush();
  return true;
}
function receive(snapshot: Snapshot, session = state.progress.session) {
  if (snapshot.userId !== state.account?.id)
    throw new RequestError("账号已切换，请重新登录。", 409, "ACCOUNT_CHANGED");
  const settings = { ...state.settings };
  for (const key of ACCOUNT_FIELDS)
    Object.assign(settings, { [key]: snapshot.settings[key] });
  state = {
    ...state,
    progress: {
      ...sanitizeProgress(snapshot.progress, state.progress.datasetId),
      session,
    },
    settings,
    revision: snapshot.revision,
    epoch: snapshot.epoch,
    lastSync: snapshot.updatedAt,
    syncError: null,
    reauth: false,
  };
  write(accountKey("snapshot"), snapshot);
}
// Old clients may have one unconfirmed operation. Recover it locally, never resend it on login.
function recoverLegacy(
  legacy: LegacyPending,
  progress: Progress,
  settings: Settings,
) {
  const a = legacy.request.action;
  let p = structuredClone(progress);
  let s = { ...settings };
  if (a.type === "review") {
    if (!p.session?.graded[a.wordId]) {
      const before = p.cards[a.wordId];
      p.cards[a.wordId] = review(before, a.grade, Date.now(), s.retention);
      p = bumpDay(p, {
        r: 1,
        c: a.grade === Rating.Again ? 0 : 1,
        n: before ? 0 : 1,
      });
      if (a.grade === Rating.Again)
        p.mistakes = [
          a.wordId,
          ...p.mistakes.filter((id) => id !== a.wordId),
        ].slice(0, 300);
    }
  } else if (a.type === "advance")
    p = bumpDay(p, { t: Math.max(0, Math.min(90, Math.round(a.seconds))) });
  else if (a.type === "bookmark")
    p.bookmarks = a.saved
      ? [a.wordId, ...p.bookmarks.filter((id) => id !== a.wordId)]
      : p.bookmarks.filter((id) => id !== a.wordId);
  else if (a.type === "typing") p.typing = [...p.typing, a.round].slice(-500);
  else if (a.type === "settings") s = sanitizeSettings({ ...s, ...a.patch });
  else if (a.type === "reset") p = emptyProgress(p.datasetId);
  else if (a.type === "import") {
    const backup = a.backup as { progress: unknown; settings: unknown };
    p = sanitizeProgress(backup.progress, p.datasetId);
    s = sanitizeSettings(backup.settings);
  }
  p.session = legacy.session;
  return { progress: p, settings: s };
}
function enterAccount(user: Account, snapshot: Snapshot, discard = false) {
  if (snapshot.userId !== user.id) throw new RequestError("账号数据不匹配。");
  flush();
  identity += 1;
  setAccountTimezone(user.timezone);
  state = {
    ...state,
    account: user,
    authStatus: "account",
    progress: emptyProgress("word-atlas-open"),
    settings: sanitizeSettings(read(SETTINGS_KEY)),
    unsaved: false,
    pending: false,
    conflict: false,
    syncError: null,
    reauth: false,
  };
  loadedId = state.progress.datasetId;
  const deviceSettings = read<Settings>(accountKey("settings"));
  if (deviceSettings)
    state = { ...state, settings: sanitizeSettings(deviceSettings) };
  const cache = read<Progress>(accountKey("progress"));
  const savedDraft = read<Draft>(draftKey());
  const validDraft =
    savedDraft?.version === 1 &&
    savedDraft.userId === user.id &&
    savedDraft.datasetId === state.progress.datasetId &&
    Number.isSafeInteger(savedDraft.baseRevision) &&
    Number.isSafeInteger(savedDraft.epoch) &&
    typeof savedDraft.changeId === "string";
  attempt = null;
  generation = 0;
  localConflict = false;
  draftToken = savedDraft?.changeId ?? null;
  receive(
    snapshot,
    read<number>(accountKey("epoch")) === snapshot.epoch
      ? (cache?.session ?? null)
      : null,
  );
  if (validDraft && !discard) {
    attempt = savedDraft.attempt ?? null;
    generation = savedDraft.generation;
    const settings = { ...state.settings };
    for (const key of ACCOUNT_FIELDS)
      Object.assign(settings, {
        [key]: sanitizeSettings(savedDraft.settings)[key],
      });
    const conflict =
      !attempt &&
      (savedDraft.baseRevision !== snapshot.revision ||
        savedDraft.epoch !== snapshot.epoch);
    state = {
      ...state,
      progress: sanitizeProgress(savedDraft.progress, loadedId),
      settings,
      revision: savedDraft.baseRevision,
      epoch: savedDraft.epoch,
      unsaved: true,
      pending: !!attempt,
      conflict,
      syncError: conflict
        ? "账号已在其他设备更新。本机草稿已保留，请导出备份后读取账号进度。"
        : null,
    };
  } else {
    if (discard) {
      write(draftKey(), null);
      write(pendingKey(), null);
    }
    draftToken = null;
    const legacy = discard ? null : read<LegacyPending>(pendingKey());
    if (legacy?.request?.userId === user.id && legacy.request.operationId) {
      const recovered = recoverLegacy(
        legacy,
        cache ?? state.progress,
        state.settings,
      );
      generation = 1;
      draftToken = newId();
      state = {
        ...state,
        ...recovered,
        unsaved: true,
        revision: legacy.request.baseRevision,
        epoch: legacy.request.epoch,
        conflict:
          legacy.request.baseRevision !== snapshot.revision ||
          legacy.request.epoch !== snapshot.epoch,
        syncError: "已保留旧版本未确认操作为本机草稿，请先导出备份再保存。",
      };
      if (!write(draftKey(), draftFor())) state = { ...state, saveError: true };
    }
  }
  write(LAST_ACCOUNT_KEY, user);
  dirty = true;
  flush();
  emit();
}
async function saveAccount(): Promise<boolean> {
  if (!state.account || state.syncBusy || authenticating) return false;
  if (state.conflict || !ownsDraft()) {
    toast(state.syncError ?? "账号进度有更新，请先处理版本冲突。", "warn");
    return false;
  }
  if (!state.unsaved && !attempt) return true;
  state = { ...state, syncBusy: true, syncError: null };
  emit();
  try {
    let maySubmitNewer = !!attempt;
    // An uncertain earlier save must be acknowledged with the same ID before newer edits are sent.
    do {
      if (!attempt) {
        attempt = {
          generation,
          request: {
            userId: state.account!.id,
            operationId: newId(),
            datasetId: state.progress.datasetId,
            baseRevision: state.revision,
            epoch: state.epoch,
            action: {
              type: "save",
              backup: {
                app: "word-atlas",
                version: 2,
                progress: structuredClone({ ...state.progress, session: null }),
                settings: { ...state.settings },
              },
            },
          },
        };
        if (!persistAccount()) {
          attempt = null;
          throw new RequestError("无法在本机记录保存请求，请先导出备份。");
        }
        state = { ...state, pending: true };
        emit();
      }
      const sent = attempt;
      const snapshot = await request<Snapshot>("/mutations", sent.request);
      if (snapshot.userId !== state.account!.id)
        throw new RequestError("账号已切换。", 409, "ACCOUNT_CHANGED");
      const unchanged = generation === sent.generation;
      if (!unchanged && snapshot.revision !== sent.request.baseRevision + 1)
        throw new RequestError(
          "另一设备已在上次保存后更新进度。",
          409,
          "REVISION_CONFLICT",
        );
      if (unchanged) receive(snapshot);
      else {
        state = {
          ...state,
          revision: snapshot.revision,
          epoch: snapshot.epoch,
          lastSync: snapshot.updatedAt,
          reauth: false,
        };
        write(accountKey("snapshot"), snapshot);
      }
      attempt = null;
      state = {
        ...state,
        pending: false,
        unsaved: !unchanged,
        syncError: null,
      };
      write(pendingKey(), null);
      if (!state.unsaved) {
        if (!ownsDraft()) throw new RequestError(state.syncError!);
        write(draftKey(), null);
        draftToken = null;
      }
      dirty = true;
      flush();
      emit();
      // A second submission only resolves edits made after an earlier uncertain save.
      if (unchanged) break;
      if (!maySubmitNewer) break;
      maySubmitNewer = false;
    } while (state.unsaved);
    return true;
  } catch (error) {
    const failure = error as RequestError;
    const rejected =
      failure.status >= 400 &&
      failure.status < 500 &&
      failure.code !== "INVALID_RESPONSE";
    if (rejected && failure.status !== 401 && failure.status !== 429)
      attempt = null;
    state = {
      ...state,
      pending: !!attempt,
      unsaved: true,
      conflict: localConflict || failure.status === 409,
      reauth: failure.status === 401 || failure.code === "ACCOUNT_CHANGED",
      syncError:
        failure.status === 409
          ? "账号已在其他设备更新。本机草稿已保留，请先导出备份，再读取账号进度。"
          : failure.message,
    };
    dirty = true;
    flush();
    emit();
    return false;
  } finally {
    state = { ...state, syncBusy: false };
    emit();
  }
}
async function refresh(discard = false): Promise<boolean> {
  if (!state.account || state.syncBusy || authenticating) return false;
  if ((state.unsaved || attempt) && !discard) {
    state = {
      ...state,
      syncError: "本机有未保存进度。请先保存或导出备份，再读取账号进度。",
    };
    emit();
    return false;
  }
  const startIdentity = identity,
    startGeneration = generation;
  state = { ...state, syncBusy: true };
  emit();
  try {
    const snapshot = await request<Snapshot>("/state");
    if (identity !== startIdentity || generation !== startGeneration)
      throw new RequestError("读取期间本机进度已变化，草稿已保留，请重试。");
    const user = state.account!;
    if (snapshot.userId !== user.id)
      throw new RequestError("账号已切换。", 409, "ACCOUNT_CHANGED");
    enterAccount(user, snapshot, true);
    return true;
  } catch (error) {
    const failure = error as RequestError;
    state = {
      ...state,
      syncError: failure.message,
      reauth: failure.status === 401 || failure.code === "ACCOUNT_CHANGED",
    };
    emit();
    return false;
  } finally {
    state = { ...state, syncBusy: false };
    emit();
  }
}
async function commit(
  action: Action,
  local?: (progress: Progress) => Progress,
): Promise<boolean> {
  let progress = local ? local(state.progress) : state.progress;
  let settings = state.settings;
  if (action.type === "settings")
    settings = sanitizeSettings({ ...settings, ...action.patch });
  if (action.type === "import") {
    const backup = action.backup as { progress: unknown; settings: unknown };
    progress = {
      ...sanitizeProgress(backup.progress, state.progress.datasetId),
      session: null,
    };
    const imported = sanitizeSettings(backup.settings);
    settings = { ...settings };
    for (const key of ACCOUNT_FIELDS)
      Object.assign(settings, { [key]: imported[key] });
    settings.onboarded = true;
  }
  return stage(progress, settings);
}
export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  initialize() {
    if (initializing) return initializing;
    initializing = (async () => {
      try {
        const { user } = await request<{ user: Account | null }>("/auth/me");
        if (!user) {
          state = { ...state, authStatus: "guest" };
          emit();
          return;
        }
        enterAccount(user, await request<Snapshot>("/state"));
      } catch {
        const user = read<Account>(LAST_ACCOUNT_KEY);
        const key =
          user && "word-atlas:account:" + user.id + ":word-atlas-open:";
        const cached = key ? read<Snapshot>(key + "snapshot") : null;
        if (user && cached?.userId === user.id) {
          enterAccount(user, cached);
          state = {
            ...state,
            reauth: true,
            syncError:
              "账号服务暂不可用，本机草稿可继续学习；保存前请重新登录。",
          };
        } else
          state = {
            ...state,
            authStatus: "guest",
            syncError: "账号服务暂不可用，可继续使用游客模式。",
          };
        emit();
      }
    })();
    return initializing;
  },
  useDataset(datasetId: string) {
    flush();
    if (state.account) return;
    state = {
      ...state,
      progress: sanitizeProgress(read(progressKey(datasetId)), datasetId),
    };
    loadedId = datasetId;
    emit();
  },
  progress(fn: (p: Progress) => Progress) {
    const next = fn(state.progress);
    state = {
      ...state,
      progress: state.account
        ? { ...state.progress, session: next.session }
        : next,
    };
    emit();
    scheduleSave();
  },
  async settings(patch: Partial<Settings>) {
    const settings = { ...state.settings, ...patch };
    if (
      state.account &&
      Object.keys(patch).some((k) =>
        (ACCOUNT_FIELDS as readonly string[]).includes(k),
      )
    )
      stage(state.progress, settings);
    else {
      state = { ...state, settings };
      emit();
      dirty = true;
      flush();
    }
  },
  commit,
  refresh,
  save: saveAccount,
  retry: saveAccount,
  async authenticate(
    mode: "login" | "register",
    username: string,
    password: string,
  ) {
    if (state.syncBusy || authenticating)
      throw new Error("请等待当前请求结束。");
    authenticating = true;
    try {
      const response = await request<{ user: Account; snapshot: Snapshot }>(
        "/auth/" + mode,
        {
          username,
          password,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      );
      enterAccount(response.user, response.snapshot);
    } finally {
      authenticating = false;
    }
  },
  async logout() {
    if (state.syncBusy || authenticating)
      throw new Error("请等待当前请求结束。");
    flush();
    authenticating = true;
    try {
      try {
        await request("/auth/logout", {});
      } catch (error) {
        if ((error as RequestError).status !== 401) throw error;
      }
      identity += 1;
      setAccountTimezone(null);
      write(LAST_ACCOUNT_KEY, null);
      attempt = null;
      generation = 0;
      draftToken = null;
      localConflict = false;
      state = {
        ...state,
        account: null,
        authStatus: "guest",
        progress: sanitizeProgress(
          read(progressKey("word-atlas-open")),
          "word-atlas-open",
        ),
        settings: sanitizeSettings(read(SETTINGS_KEY)),
        revision: 0,
        epoch: 0,
        unsaved: false,
        pending: false,
        conflict: false,
        syncError: null,
        lastSync: null,
        reauth: false,
      };
      loadedId = "word-atlas-open";
      emit();
    } finally {
      authenticating = false;
    }
  },
  guestBackup() {
    return JSON.stringify({
      app: "word-atlas",
      version: 2,
      progress: {
        ...sanitizeProgress(
          read(progressKey("word-atlas-open")),
          "word-atlas-open",
        ),
        session: null,
      },
      settings: sanitizeSettings(read(SETTINGS_KEY)),
    });
  },
  guestCardCount() {
    return Object.keys(
      sanitizeProgress(read(progressKey("word-atlas-open")), "word-atlas-open")
        .cards,
    ).length;
  },
  async addTyping(round: TypingRound) {
    return commit({ type: "typing", roundId: newId(), round }, (p) => ({
      ...p,
      typing: [...p.typing, round].slice(-500),
    }));
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(state),
    () => select(state),
  );
}
export function bumpDay(p: Progress, patch: Partial<DayStat>): Progress {
  const k = dayKey();
  const d = p.days[k] ?? { n: 0, r: 0, c: 0, t: 0 };
  return {
    ...p,
    days: {
      ...p.days,
      [k]: {
        n: d.n + (patch.n ?? 0),
        r: d.r + (patch.r ?? 0),
        c: d.c + (patch.c ?? 0),
        t: d.t + (patch.t ?? 0),
      },
    },
  };
}
export async function toggleBookmark(id: string) {
  const saved = !state.progress.bookmarks.includes(id);
  return commit({ type: "bookmark", wordId: id, saved }, (p) => ({
    ...p,
    bookmarks: saved
      ? [id, ...p.bookmarks]
      : p.bookmarks.filter((x) => x !== id),
  }));
}
export function exportBackup() {
  flush();
  return JSON.stringify(
    {
      app: "word-atlas",
      version: 2,
      exported: new Date().toISOString(),
      progress: { ...state.progress, session: null },
      settings: state.settings,
      ...(state.account && read(pendingKey())
        ? { unconfirmedOperation: read(pendingKey()) }
        : {}),
    },
    null,
    1,
  );
}
export function previewBackup(text: string):
  | {
      ok: true;
      cards: number;
      bookmarks: number;
      data: Record<string, unknown>;
    }
  | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "文件不是有效的 JSON。" };
  }
  if (!data || typeof data !== "object")
    return { ok: false, error: "这不是词光的学习备份。" };
  const value = data as Record<string, unknown>;
  const progress = value.progress as Progress | undefined;
  if (
    value.app !== "word-atlas" ||
    value.version !== 2 ||
    !progress ||
    progress.version !== 2
  )
    return { ok: false, error: "这不是词光版本 2 的学习备份。" };
  if (progress.datasetId !== state.progress.datasetId)
    return { ok: false, error: "备份来自另一个词库，请先切换到对应词库。" };
  const clean = sanitizeProgress(progress, progress.datasetId);
  return {
    ok: true,
    cards: Object.keys(clean.cards).length,
    bookmarks: clean.bookmarks.length,
    data: value,
  };
}
export async function importBackup(
  text: string,
): Promise<{ ok: true; cards: number } | { ok: false; error: string }> {
  const preview = previewBackup(text);
  if (!preview.ok) return preview;
  if (state.account) {
    const ok = await commit({ type: "import", backup: preview.data }, (p) => ({
      ...p,
      session: null,
    }));
    return ok
      ? { ok: true, cards: preview.cards }
      : {
          ok: false,
          error: state.syncError ?? "导入未完成，请确认本机存储状态。",
        };
  }
  state = {
    ...state,
    progress: {
      ...sanitizeProgress(preview.data.progress, state.progress.datasetId),
      session: null,
    },
    settings: { ...sanitizeSettings(preview.data.settings), onboarded: true },
  };
  emit();
  dirty = true;
  flush();
  return { ok: true, cards: preview.cards };
}
export async function resetProgress() {
  const ok = await commit({ type: "reset" }, () =>
    emptyProgress(state.progress.datasetId),
  );
  if (!state.account) flush();
  return ok;
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", (event) => {
    flush();
    if (state.account && state.unsaved) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("storage", (event) => {
    if (state.account) {
      if (event.key === draftKey() || event.key === accountKey("snapshot")) {
        localConflict = true;
        state = {
          ...state,
          conflict: true,
          syncError:
            "另一标签页已修改账号进度。请先导出当前进度，再重新加载页面。",
        };
        emit();
      }
      return;
    }
    if (!event.newValue) return;
    try {
      if (event.key === SETTINGS_KEY)
        state = {
          ...state,
          settings: sanitizeSettings(JSON.parse(event.newValue)),
        };
      else if (event.key === progressKey(state.progress.datasetId))
        state = {
          ...state,
          progress: sanitizeProgress(
            JSON.parse(event.newValue),
            state.progress.datasetId,
          ),
        };
      else return;
      emit();
    } catch {
      /* Ignore invalid browser storage entries. */
    }
  });
}
