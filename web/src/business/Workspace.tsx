import { useState, type FormEvent } from "react";
import { Archive, ArrowUpRight, BarChart3, Check, Eye, Heart, Pencil, Plus, Send, ShieldCheck, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { Empty, ErrorBox, Loading, Modal, Tabs } from "../ui/kit";
import { request, type BusinessMeta, type Listing, type Page, type Session } from "./api";
import { BackLink, ListingCard, Pager, Results, SelectOptions } from "./components";
import Complaints from "./Complaints";
import { useBusiness } from "./session";
import { errorMessage, useLoad } from "./useLoad";

export function Favorites({ meta }: { meta: BusinessMeta }) {
  const { session, api } = useBusiness();
  const { toast } = useStore();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const data = useLoad(`favorites:${session?.user.id}:${page}`, signal => api<Page<Listing>>(`/users/me/favorites?page=${page}&per_page=12`, { signal }));
  const remove = async (id: string) => {
    setBusy(id);
    try {
      await api(`/listings/${id}/favorite`, { method: "DELETE" });
      if (data.data?.items.length === 1 && page > 1) setPage(page - 1); else data.reload();
      toast("Удалено из избранного");
    } catch (e) { toast(errorMessage(e), "err"); } finally { setBusy(""); }
  };
  return <div className="stack"><BackLink /><header className="bb-inner-heading"><h1>Избранные объявления</h1></header>
    <Results {...data} retry={data.reload} empty="В избранном пока ничего нет">
      <div className="bb-card-grid">{data.data?.items.map(item => <ListingCard key={item.id} item={item} meta={meta} pending={busy === item.id} favorite={() => void remove(item.id)} />)}</div>
    </Results>
    <Pager data={data.data} onPage={setPage} />
  </div>;
}

type Stats = { total_views: number; views_7d: number; views_30d: number; favorites_count: number };
export function Mine({ meta }: { meta: BusinessMeta }) {
  const { session, api } = useBusiness();
  const { toast } = useStore();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [archive, setArchive] = useState<Listing | null>(null);
  const [stats, setStats] = useState<Listing | null>(null);
  const data = useLoad(`mine:${session?.user.id}:${status}:${page}`, signal =>
    api<Page<Listing>>(`/listings/mine?page=${page}&per_page=12${status ? "&status=" + status : ""}`, { signal }));
  const action = async (item: Listing, command: "submit" | "archive") => {
    setBusy(item.id);
    try {
      await api(`/listings/${item.id}/${command}`, { method: "POST" });
      toast(command === "submit" ? "Объявление отправлено на модерацию" : "Объявление перенесено в архив");
      setArchive(null);
      if (status && data.data?.items.length === 1 && page > 1) setPage(page - 1); else data.reload();
    } catch (e) { toast(errorMessage(e), "err"); } finally { setBusy(""); }
  };
  return <div className="stack">
    <BackLink />
    <header className="bb-inner-heading bb-toolbar">
      <div><h1>Мои объявления</h1><p>Черновики, модерация и опубликованные предложения.</p></div>
      <Link to="/business/new" className="btn primary"><Plus size={18} /> Новое объявление</Link>
    </header>
    <label className="field bb-status-filter">Статус<select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
      <option value="">Все статусы</option><SelectOptions items={meta.listing_statuses} />
    </select></label>
    <Results {...data} retry={data.reload} empty="Объявлений с таким статусом пока нет">
      <div className="bb-list">{data.data?.items.map(item => <article className="panel bb-row" key={item.id}>
        <div className="bb-row-info"><span className={`bb-status bb-status-${item.status}`}>{meta.listing_statuses[item.status]}</span>
          <h2><Link to={`/business/listing/${item.id}`}>{item.title} <ArrowUpRight size={16} /></Link></h2>
          <p className="muted small">{[item.organization?.name, item.category?.name].filter(Boolean).join(" · ")}</p>
          {item.rejection_reason && <p className="bb-error">{item.rejection_reason}</p>}
        </div>
        <div className="bb-actions">
          {["draft", "rejected"].includes(item.status) && <button className="btn primary sm" disabled={busy === item.id} onClick={() => void action(item, "submit")}><Send size={16} /> На модерацию</button>}
          {!["archived", "blocked", "pending"].includes(item.status) && <Link className="btn secondary sm" to={`/business/edit/${item.id}`}><Pencil size={16} /> Изменить</Link>}
          <button className="btn secondary sm" onClick={() => setStats(item)}><BarChart3 size={16} /> Статистика</button>
          {!["archived", "blocked"].includes(item.status) && <button className="btn ghost sm" disabled={busy === item.id} onClick={() => setArchive(item)}><Archive size={16} /> В архив</button>}
        </div>
      </article>)}</div>
    </Results>
    <Pager data={data.data} onPage={setPage} />
    {archive && <Modal title="Перенести объявление в архив?" onClose={() => setArchive(null)}>
      <div className="bb-dialog stack"><p>«{archive.title}» исчезнет из поиска и каталога.</p>
        <button className="btn primary" disabled={busy === archive.id} onClick={() => void action(archive, "archive")}>Перенести в архив</button>
      </div>
    </Modal>}
    {stats && <Statistics id={stats.id} close={() => setStats(null)} />}
  </div>;
}

function Statistics({ id, close }: { id: string; close: () => void }) {
  const { api } = useBusiness();
  const data = useLoad(id, signal => api<Stats>(`/listings/${id}/stats`, { signal }));
  return <Modal title="Статистика объявления" onClose={close}><div className="bb-dialog">
    {data.loading ? <Loading h={160} /> : data.data ? <dl className="bb-specs">
      <div><dt><Eye size={16} /> Всего просмотров</dt><dd>{data.data.total_views}</dd></div>
      <div><dt>За 7 дней</dt><dd>{data.data.views_7d}</dd></div>
      <div><dt>За 30 дней</dt><dd>{data.data.views_30d}</dd></div>
      <div><dt><Heart size={16} /> В избранном</dt><dd>{data.data.favorites_count}</dd></div>
    </dl> : <ErrorBox text={data.error} retry={data.reload} />}
  </div></Modal>;
}

export function Moderation({ meta }: { meta: BusinessMeta }) {
  const { session } = useBusiness();
  const [tab, setTab] = useState("listings");
  if (!session?.user.platform_roles.length) return <Empty icon="shield" title="У аккаунта нет доступа к модерации" />;
  return <div className="stack"><BackLink /><header className="bb-inner-heading"><h1>Модерация объявлений</h1></header>
    {session.requires_totp ? <Totp /> : <>
      <Tabs tabs={[["listings", "Объявления"], ["complaints", "Жалобы"]]} value={tab} onChange={setTab} />
      {tab === "listings" ? <ModerationQueue /> : <Complaints meta={meta} />}
    </>}
  </div>;
}

function ModerationQueue() {
  const { session, api } = useBusiness();
  const { toast } = useStore();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState("");
  const [reject, setReject] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const queue = useLoad(`moderate:${session?.user.id}:${page}`, signal => api<Page<Listing>>(`/admin/listings?status=pending&page=${page}&per_page=12`, { signal }));
  async function moderate(item: Listing, reason?: string) {
    setBusy(item.id); setError("");
    try {
      await api(`/admin/listings/${item.id}/${reason ? "reject" : "approve"}`, { method: "POST", ...(reason && { body: { reason } }) });
      toast(reason ? "Объявление отклонено" : "Объявление опубликовано");
      setReject(null);
      if (queue.data?.items.length === 1 && page > 1) setPage(page - 1); else queue.reload();
    } catch (e) {
      if (reason) setError(errorMessage(e)); else toast(errorMessage(e), "err");
    } finally { setBusy(""); }
  }
  return <>
    <Results {...queue} retry={queue.reload} empty="Все объявления проверены">
      <div className="bb-list">{queue.data?.items.map(item => <article key={item.id} className="panel bb-row">
        <div className="bb-row-info"><span className="bb-status bb-status-pending">На модерации</span><h2>{item.title}</h2>
          <p className="bb-moderation-text">{item.description}</p>
          <p className="muted small">{item.category?.name} · {item.organization?.name || item.user?.full_name}</p>
        </div>
        <div className="bb-actions">
          <button className="btn primary sm" disabled={busy === item.id} onClick={() => void moderate(item)}><Check size={17} /> Опубликовать</button>
          <button className="btn secondary sm" disabled={busy === item.id} onClick={() => { setReject(item); setError(""); }}><X size={17} /> Отклонить</button>
        </div>
      </article>)}</div>
    </Results>
    <Pager data={queue.data} onPage={setPage} />
    {reject && <Modal title="Отклонение объявления" onClose={() => setReject(null)}><form className="bb-dialog stack" onSubmit={e => {
      e.preventDefault(); const reason = String(new FormData(e.currentTarget).get("reason") || "").trim();
      if (reason.length >= 3) void moderate(reject, reason); else setError("Укажите причину отклонения.");
    }}>
      <p>{reject.title}</p>
      <label className="field">Причина для автора<textarea name="reason" className="textarea" required minLength={3} maxLength={2000} /></label>
      {error && <p className="bb-error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy === reject.id}>Отклонить</button>
    </form></Modal>}
  </>;
}

function Totp() {
  const { api, session, setSession } = useBusiness();
  const [secret, setSecret] = useState<{ secret: string; otpauth_url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function setup() {
    setBusy(true); setError("");
    try { setSecret(await api("/auth/totp/setup", { method: "POST" })); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const code = String(new FormData(e.currentTarget).get("code") || "");
      const upgraded = await api<Session>(session?.totp_enabled ? "/auth/totp/verify" : "/auth/totp/enable", { body: { code } });
      setSession(upgraded);
      if (session) void request("/auth/logout", { body: { refresh_token: session.refresh_token } }).catch(() => {});
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="panel stack bb-totp">
    <span className="bb-category-icon"><ShieldCheck size={24} /></span>
    <h2>Подтверждение TOTP</h2>
    {!session?.totp_enabled && !secret && <>
      <p className="muted">Подключите приложение-аутентификатор для доступа к очереди модерации.</p>
      <button className="btn primary" disabled={busy} onClick={() => void setup()}>Настроить TOTP</button>
    </>}
    {secret && <><p className="muted">Отсканируйте QR-код в приложении-аутентификаторе или введите ключ вручную.</p>
      <div className="bb-qr"><QRCodeSVG value={secret.otpauth_url} size={154} /></div><code>{secret.secret}</code>
    </>}
    {(session?.totp_enabled || secret) && <form className="stack" onSubmit={send}>
      <label className="field">Код из приложения<input className="input" name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label>
      <button className="btn primary" disabled={busy}>Подтвердить</button>
    </form>}
    {error && <p className="bb-error" role="alert">{error}</p>}
  </section>;
}
