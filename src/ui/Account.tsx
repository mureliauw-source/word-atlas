import { useState, type FormEvent } from "react";
import { importBackup, previewBackup, store, useStore } from "../store/store";
import { toast } from "./Toast";

export function AccountPanel() {
  const account = useStore((s) => s.account);
  const busy = useStore((s) => s.syncBusy);
  const pending = useStore((s) => s.pending);
  const unsaved = useStore((s) => s.unsaved);
  const conflict = useStore((s) => s.conflict);
  const lastSync = useStore((s) => s.lastSync);
  const syncError = useStore((s) => s.syncError);
  const reauth = useStore((s) => s.reauth);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working) return;
    if (!reauth && mode === "register" && password !== repeat) {
      setError("两次输入的密码不一致。");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await store.authenticate(
        reauth ? "login" : mode,
        reauth ? account!.username : username,
        password,
      );
      setPassword("");
      setRepeat("");
      toast(
        reauth || mode === "login"
          ? store.get().unsaved
            ? "已登录，本机未保存草稿已恢复"
            : "已登录，账号进度已加载"
          : "账号已创建。原有游客进度仍保留，可按需导入。",
        "ok",
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const migrate = async () => {
    const text = store.guestBackup();
    const preview = previewBackup(text);
    if (!preview.ok) return toast(preview.error, "warn");
    if (
      !confirm(
        `将本机游客的 ${preview.cards} 个词、${preview.bookmarks} 个收藏导入“${account!.username}”的本机草稿。这会替换当前本机进度；点击“保存到账号”后才会提交。建议先导出备份。继续？`,
      )
    )
      return;
    const result = await importBackup(text);
    toast(
      result.ok
        ? `已导入 ${result.cards} 个词到本机草稿，请点击“保存到账号”`
        : result.error,
      result.ok ? "ok" : "warn",
    );
  };
  return (
    <section className="panel account-panel" aria-label="账号与同步">
      <div className="account-heading">
        <div>
          <p className="eyebrow">账号与同步</p>
          <h2>{account ? account.username : "让你的星空，随你同行"}</h2>
        </div>
        <span className="chip">{account ? "账号模式" : "游客模式"}</span>
      </div>
      {account && (
        <>
          <p className="muted">
            学习进度、收藏和学习设置先保存在当前浏览器。点击“保存到账号”后，其他设备才能读取这些修改。外观和播放偏好保留在当前设备。
          </p>
          <p className="account-status" role="status">
            {busy
              ? "正在连接账号服务…"
              : syncError
                ? syncError
                : pending
                  ? "上次保存结果尚未确认，草稿已保留，请手动重试保存"
                  : unsaved
                    ? "本机有未保存到账号的修改"
                    : `已保存到账号${lastSync ? ` · ${new Date(lastSync).toLocaleString()}` : ""}`}{" "}
            · 统计时区：{account.timezone}
          </p>
          <div className="data-actions">
            <button
              className="btn btn-primary"
              disabled={busy || working || !unsaved || conflict || reauth}
              onClick={async () => {
                const ok = await store.save();
                toast(
                  ok
                    ? store.get().unsaved
                      ? "本次提交已保存，之后的修改仍需再次保存"
                      : "完整进度和学习设置已保存到账号"
                    : (store.get().syncError ?? "保存未完成，本机草稿已保留"),
                  ok ? "ok" : "warn",
                );
              }}
            >
              {pending ? "重试保存到账号" : "保存到账号"}
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || working}
              onClick={async () => {
                if (
                  (unsaved || pending) &&
                  !confirm(
                    "读取账号进度会替换当前本机草稿。请先导出备份；上次未确认的保存也可能已经生效。仍要继续读取吗？",
                  )
                )
                  return;
                const ok = await store.refresh(true);
                toast(
                  ok
                    ? "已读取账号最新进度"
                    : (store.get().syncError ?? "读取失败，本机草稿已保留"),
                  ok ? "ok" : "warn",
                );
              }}
            >
              读取账号进度
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || working}
              onClick={() => void migrate()}
            >
              导入本机游客进度
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || working}
              onClick={async () => {
                if (
                  unsaved &&
                  !confirm(
                    "还有未保存到账号的修改。退出后草稿仍保留在当前浏览器，其他设备看不到；建议先保存或导出备份。继续退出吗？",
                  )
                )
                  return;
                setWorking(true);
                try {
                  await store.logout();
                  setError(null);
                  toast("已退出账号，恢复本机游客进度");
                } catch (failure) {
                  setError((failure as Error).message);
                } finally {
                  setWorking(false);
                }
              }}
            >
              退出账号
            </button>
          </div>
        </>
      )}
      {(!account || reauth) && (
        <>
          {!account && (
            <>
              <p className="muted">
                游客可以直接注册。注册后，学习进度可保存在账号中，并在其他设备登录使用；原有导入、导出功能继续保留。
              </p>
              <div
                className="segmented account-tabs"
                aria-label="选择登录或注册"
              >
                <button
                  type="button"
                  className={mode === "register" ? "is-on" : ""}
                  onClick={() => {
                    setMode("register");
                    setError(null);
                  }}
                >
                  注册账号
                </button>
                <button
                  type="button"
                  className={mode === "login" ? "is-on" : ""}
                  onClick={() => {
                    setMode("login");
                    setError(null);
                  }}
                >
                  已有账号登录
                </button>
              </div>
            </>
          )}
          <form className="account-form" onSubmit={submit}>
            <label>
              用户名
              <input
                autoComplete="username"
                minLength={3}
                maxLength={32}
                required
                value={reauth ? account!.username : username}
                disabled={working || reauth}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="3–32 位文字、数字或下划线"
              />
            </label>
            <label>
              密码
              <input
                type="password"
                autoComplete={
                  mode === "register" && !reauth
                    ? "new-password"
                    : "current-password"
                }
                minLength={10}
                maxLength={128}
                required
                value={password}
                disabled={working}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 10 位"
              />
            </label>
            {mode === "register" && !reauth && (
              <label>
                确认密码
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={10}
                  maxLength={128}
                  required
                  value={repeat}
                  disabled={working}
                  onChange={(event) => setRepeat(event.target.value)}
                />
              </label>
            )}
            <button
              className="btn btn-primary"
              type="submit"
              disabled={working || busy}
            >
              {working
                ? "正在处理…"
                : reauth || mode === "login"
                  ? "登录账号"
                  : "创建账号"}
            </button>
          </form>
          <p className="muted account-footnote">
            登录和手动保存需要联网，已加载的学习内容可先保存在本机。目前开放注册，当前版本暂不提供密码找回功能，请妥善保管密码，或联系管理员邮箱：
            <a href="mailto:mure@qq.com">mure@qq.com</a>。
          </p>
        </>
      )}
      {error && (
        <p className="warn-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
