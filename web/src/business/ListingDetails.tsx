import { useState, type FormEvent } from "react";
import { Flag, Heart, LockKeyhole, Phone, Send, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store";
import { ErrorBox, Loading, Modal } from "../ui/kit";
import type { BusinessMeta, Category, Listing } from "./api";
import { BackLink, CategoryIcon, flatten, ListingFacts, optionValues, price, SelectOptions } from "./components";
import { useBusiness } from "./session";
import { errorMessage, useLoad } from "./useLoad";

export default function ListingDetails({ meta, categories, signIn }: { meta: BusinessMeta; categories: Category[]; signIn: () => void }) {
  const { id } = useParams();
  const { session, api } = useBusiness();
  const { toast } = useStore();
  const listing = useLoad(`detail:${id}:${session?.user.id || ""}`, signal => api<Listing>("/listings/" + id, { signal }));
  const [favorite, setFavorite] = useState<{ id: string; userId: string; value: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [complaint, setComplaint] = useState(false);
  const item = listing.data;
  if (listing.loading) return <Loading h={360} />;
  if (!item) return <><BackLink /><ErrorBox text={listing.error} retry={listing.reload} /></>;

  const isFavorite = favorite?.id === item.id && favorite.userId === session?.user.id ? favorite.value : item.is_favorite;
  const category = flatten(categories).find(c => c.id === item.category?.id);
  const contact = item.contacts;
  const telegram = contact?.telegram?.replace(/^https:\/\/t\.me\//i, "").replace(/^@/, "");
  const phone = contact?.phone?.replace(/[^+0-9]/g, "");
  const owner = item.organization?.name || item.user?.full_name || "Частное лицо";

  async function toggle() {
    if (!session) { signIn(); return; }
    setBusy(true);
    try {
      await api("/listings/" + id + "/favorite", { method: isFavorite ? "DELETE" : "POST" });
      setFavorite({ id: id!, userId: session.user.id, value: !isFavorite });
      toast(isFavorite ? "Удалено из избранного" : "Добавлено в избранное");
    } catch (e) { toast(errorMessage(e), "err"); }
    finally { setBusy(false); }
  }

  return <>
    <BackLink />
    <div className="bb-detail">
      <article className="panel bb-detail-main stack">
        <span className="bb-category-icon"><CategoryIcon slug={category?.root} size={26} /></span>
        <div className="bb-card-tags"><span className="bb-tag">{meta.listing_types[item.type]}</span>{item.category && <span className="bb-tag">{item.category.name}</span>}
          {item.status !== "active" && <span className="bb-tag bb-top">{meta.listing_statuses[item.status]}</span>}
        </div>
        <h1>{item.title}</h1>
        <ListingFacts item={item} meta={meta} />
        <section className="bb-detail-section"><h2>Описание</h2><p>{item.description}</p></section>
        {!!Object.keys(item.attributes).length && <section className="bb-detail-section"><h2>Характеристики</h2><dl className="bb-specs">
          {Object.entries(item.attributes).map(([key, value]) => {
            if (value == null) return null;
            const attr = category?.effective.find(a => a.key === key);
            const options = attr ? optionValues(attr) : [];
            const label = (val: unknown) => options.find(o => o.value === String(val))?.label || String(val);
            const displayed = typeof value === "boolean" ? (value ? "Да" : "Нет") : Array.isArray(value) ? value.map(label).join(", ")
              : typeof value === "object" ? [("from" in value ? value.from : undefined), ("to" in value ? value.to : undefined)].filter(v => v != null).join(" — ") : label(value);
            return <div key={key}><dt>{attr?.name || key}</dt><dd>{displayed}{attr?.unit && " " + attr.unit}</dd></div>;
          })}
        </dl></section>}
      </article>
      <aside className="panel bb-contact stack">
        <div><p className="bb-price">{price(item)}{item.price != null && item.price_unit && <small> / {item.price_unit}</small>}</p>{item.negotiable && item.price != null && <p className="muted small">Цена обсуждается</p>}</div>
        <div className="bb-contact-owner">
          {item.organization ? <Link to={`/business/organizations/${item.organization.slug}`}>{owner}</Link> : <b>{owner}</b>}
          {item.organization && item.organization.verification_level !== "none" && <small><ShieldCheck size={15} /> {meta.verification_levels[item.organization.verification_level]}</small>}
        </div>
        {!item.contacts_available ? <>
          <button className="btn primary" onClick={signIn}><LockKeyhole size={17} /> Показать контакты</button>
          <p className="muted small">Доступны после входа в BizBoard.</p>
        </> : <>
          {phone && <a className="btn primary" href={"tel:" + phone}><Phone size={18} /> {contact?.phone}</a>}
          {telegram && (/^[a-zA-Z0-9_]{3,64}$/.test(telegram) ? <a className="btn secondary" href={"https://t.me/" + telegram} target="_blank" rel="noreferrer"><Send size={17} /> @{telegram}</a> : <p>Telegram: {contact?.telegram}</p>)}
          {contact?.max_contact && <p>MAX: {contact.max_contact}</p>}
          {!phone && !telegram && !contact?.max_contact && <p className="muted small">Автор не указал контакты.</p>}
        </>}
        <button className="btn secondary" aria-pressed={isFavorite} disabled={busy} onClick={() => void toggle()}><Heart size={18} fill={isFavorite ? "currentColor" : "none"} /> {isFavorite ? "В избранном" : "В избранное"}</button>
        {item.user?.id !== session?.user.id && <button className="btn ghost sm" onClick={() => session ? setComplaint(true) : signIn()}><Flag size={16} /> Пожаловаться</button>}
      </aside>
    </div>
    {complaint && <Complaint id={item.id} meta={meta} close={() => setComplaint(false)} />}
  </>;
}

function Complaint({ id, meta, close }: { id: string; meta: BusinessMeta; close: () => void }) {
  const { api } = useBusiness();
  const { toast } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const data = new FormData(e.currentTarget);
    try {
      await api(`/listings/${id}/complaints`, { body: { reason: data.get("reason"), comment: data.get("comment") } });
      toast("Жалоба передана модераторам"); close();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <Modal title="Жалоба на объявление" onClose={close}><form className="bb-dialog stack" onSubmit={submit}>
    <label className="field">Причина<select className="select" name="reason" required><option value="">Выберите причину</option><SelectOptions items={meta.complaint_reasons} /></select></label>
    <label className="field">Комментарий<textarea className="textarea" name="comment" maxLength={2000} /></label>
    {error && <p className="bb-error" role="alert">{error}</p>}
    <button className="btn primary" disabled={busy}>Отправить жалобу</button>
  </form></Modal>;
}
