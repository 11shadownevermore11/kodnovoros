import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { BusinessError, request, type Session } from "./api";

const SESSION_KEY = "bizboard.session.v1";

function storedSession(): Session | null {
  try {
    const item = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    return item?.user?.id && item.access_token && item.refresh_token ? item : null;
  } catch { return null; }
}

interface ApiOptions { method?: string; body?: object; signal?: AbortSignal; auth?: boolean }
interface SessionContext {
  session: Session | null;
  setSession: (session: Session | null) => void;
  logout: () => Promise<void>;
  api: <T>(path: string, options?: ApiOptions) => Promise<T>;
}

const Context = createContext<SessionContext | null>(null);
export function useBusiness() { return useContext(Context)!; }

export function BusinessSession({ children }: { children: ReactNode }) {
  const [session, update] = useState(storedSession);
  const current = useRef(session);
  const refresh = useRef<{ from: Session; promise: Promise<Session> } | null>(null);

  const setSession = useCallback((value: Session | null) => {
    current.current = value;
    update(value);
    try {
      if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch { /* Session remains available in this tab. */ }
  }, []);

  const api = useCallback(async <T,>(path: string, { auth = true, ...options }: ApiOptions = {}) => {
    const original = auth ? current.current : null;
    try {
      return await request<T>(path, { ...options, token: original?.access_token });
    } catch (error) {
      if (!original || !(error instanceof BusinessError) || error.status !== 401 || options.signal?.aborted) throw error;
      const retry = async (next: Session) => request<T>(path, { ...options, token: next.access_token });
      const latest = current.current;
      if (latest !== original) {
        if (latest?.user.id === original.user.id) return retry(latest);
        throw error;
      }
      if (refresh.current?.from !== original) {
        const promise = request<Session>("/auth/refresh", { body: { refresh_token: original.refresh_token } })
          .then(next => {
            if (current.current !== original) {
              void request("/auth/logout", { body: { refresh_token: next.refresh_token } }).catch(() => {});
              throw new BusinessError("Сессия изменилась. Повторите действие.", 401);
            }
            setSession(next);
            return next;
          }).catch((failure: unknown) => {
            if (current.current === original && failure instanceof BusinessError && [400, 401, 403, 404, 409, 410].includes(failure.status)) {
              setSession(null);
              throw new BusinessError("Сессия истекла. Войдите снова.", 401);
            }
            throw failure;
          }).finally(() => {
            if (refresh.current?.from === original) refresh.current = null;
          });
        refresh.current = { from: original, promise };
      }
      return retry(await refresh.current.promise);
    }
  }, [setSession]);

  const logout = useCallback(async () => {
    const previous = current.current;
    setSession(null);
    if (previous) await request("/auth/logout", { body: { refresh_token: previous.refresh_token } });
  }, [setSession]);

  return <Context.Provider value={{ session, setSession, api, logout }}>{children}</Context.Provider>;
}
