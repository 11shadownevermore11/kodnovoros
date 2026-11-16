import { useEffect, useState } from "react";
import { ArrowUpRight, BriefcaseBusiness, Send, ShieldCheck } from "lucide-react";
import { Modal } from "../ui/kit";
import { BusinessError, request, type LoginOptions, type Session, type TelegramLogin } from "./api";
import { useBusiness } from "./session";
import { errorMessage } from "./useLoad";

export default function SignIn({ options, close, done }: { options: LoginOptions; close: () => void; done: (session: Session) => void }) {
  const { setSession } = useBusiness();
  const [login, setLogin] = useState<TelegramLogin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!login) return;
    const controller = new AbortController();
    const deadline = Date.now() + login.expires_in * 1000;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() >= deadline) {
        setError("Ссылка устарела. Начните вход заново.");
        setLogin(null);
        return;
      }
      try {
        const result = await request<{ status: string; tokens?: Session }>("/auth/telegram/poll", {
          body: { token: login.token }, signal: controller.signal,
        });
        if (result.status === "confirmed" && result.tokens) {
          setSession(result.tokens);
          done(result.tokens);
          return;
        }
        setError("");
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(errorMessage(e));
        if (e instanceof BusinessError && [403, 404, 409, 410].includes(e.status)) {
          setLogin(null);
          return;
        }
      }
      timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 1500);
    return () => { clearTimeout(timer); controller.abort(); };
    // The login session owns one polling loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login, setSession]);

  async function start(role?: "seller" | "moderator") {
    setError(""); setBusy(true);
    try {
      if (role) {
        const session = await request<Session>("/auth/demo", { body: { role } });
        setSession(session);
        done(session);
      } else {
        const loginSession = await request<TelegramLogin>("/auth/telegram/start", { method: "POST" });
        setLogin(loginSession);
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return <Modal title="Вход в BizBoard" onClose={close}>
    <div className="bb-dialog stack">
      {login ? <>
        <p>Откройте бота, нажмите «Запустить» и поделитесь своим контактом. Страница обновится после подтверждения.</p>
        <a className="btn primary" href={login.login_url} target="_blank" rel="noopener noreferrer"><Send size={18} /> Открыть Telegram <ArrowUpRight size={16} /></a>
        <button className="btn secondary" onClick={() => { setLogin(null); setError(""); }}>Начать заново</button>
      </> : <>
        <p className="muted">Войдите, чтобы увидеть контакты, сохранить предложения или разместить объявление.</p>
        {options.telegram && <button className="btn primary" disabled={busy} onClick={() => void start()}><Send size={18} /> Войти через Telegram</button>}
        {options.demo && <>
          <p className="bb-note">Демо-режим. Вход создаёт отдельный тестовый профиль.</p>
          <button className="btn primary" disabled={busy} onClick={() => void start("seller")}><BriefcaseBusiness size={18} /> Войти как предприниматель</button>
          <button className="btn secondary" disabled={busy} onClick={() => void start("moderator")}><ShieldCheck size={18} /> Войти как модератор</button>
        </>}
        {!options.telegram && !options.demo && <p className="bb-note" role="status">Для входа администратору площадки нужно подключить Telegram-бота.</p>}
      </>}
      {error && <p className="bb-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
