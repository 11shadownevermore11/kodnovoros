import { useMemo, useState, type FormEvent } from "react";
import { Save, Send } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useStore } from "../store";
import { ErrorBox, Loading } from "../ui/kit";
import { BackLink, flatten, optionValues, SelectOptions } from "./components";
import type { Attribute, BusinessMeta, Category, Listing, Organization } from "./api";
import { useBusiness } from "./session";
import { errorMessage, useLoad } from "./useLoad";

function text(value: unknown): string {
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

function AttributeInput({ attr, value, change }: { attr: Attribute; value: unknown; change: (value: unknown) => void }) {
  const label = attr.name + (attr.unit ? `, ${attr.unit}` : "") + (attr.is_required ? " *" : "");
  const options = optionValues(attr);
  if (attr.type === "range") {
    const range = (value || {}) as { from?: number; to?: number };
    return <fieldset className="bb-range"><legend>{label}</legend><div className="bb-field-grid">
      {(["from", "to"] as const).map(key => <label className="field" key={key}>{key === "from" ? "От" : "До"}
        <input className="input" type="number" step="any" value={text(range[key])} onChange={e => {
          const next = { ...range, [key]: e.target.value === "" ? undefined : Number(e.target.value) };
          change(next.from == null && next.to == null ? undefined : next);
        }} />
      </label>)}
    </div></fieldset>;
  }
  return <label className="field">{label}
    {attr.type === "enum" && <select className="select" required={attr.is_required} value={text(value)} onChange={e => change(e.target.value || undefined)}>
      <option value="">Выберите вариант</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>}
    {attr.type === "multi_enum" && <select className="select bb-multi" multiple required={attr.is_required} value={Array.isArray(value) ? value : []} onChange={e => change(Array.from(e.target.selectedOptions, o => o.value))}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>}
    {attr.type === "bool" && <select className="select" required={attr.is_required} value={value == null ? "" : String(value)} onChange={e => change(e.target.value ? e.target.value === "true" : undefined)}>
      <option value="">Не указано</option><option value="true">Да</option><option value="false">Нет</option>
    </select>}
    {["number", "string", "date"].includes(attr.type) && <input className="input" required={attr.is_required} type={attr.type === "string" ? "text" : attr.type}
      maxLength={2000} step={attr.type === "number" ? "any" : undefined} value={attr.type === "date" ? text(value).slice(0, 10) : text(value)}
      onChange={e => change(e.target.value === "" ? undefined : attr.type === "number" ? Number(e.target.value) : e.target.value)} />}
  </label>;
}

export default function ListingForm({ categories, meta }: { categories: Category[]; meta: BusinessMeta }) {
  const { id } = useParams();
  const { api, session } = useBusiness();
  const existing = useLoad(`edit:${id ?? ""}:${session?.user.id}`, signal => id ? api<Listing>("/listings/" + id, { signal }) : Promise.resolve(null));
  const orgs = useLoad("orgs:" + session?.user.id, signal => api<Organization[]>("/organizations/mine", { signal }));
  if (existing.loading || orgs.loading) return <Loading h={420} />;
  if (existing.error || orgs.error) return <ErrorBox text={existing.error || orgs.error} retry={() => { existing.reload(); orgs.reload(); }} />;
  return <Editor key={id || "new"} categories={categories} meta={meta} item={existing.data} organizations={orgs.data || []} />;
}

function Editor({ categories, meta, item, organizations }: { categories: Category[]; meta: BusinessMeta; item: Listing | null; organizations: Organization[] }) {
  const navigate = useNavigate();
  const { api } = useBusiness();
  const { toast } = useStore();
  const [id, setId] = useState(item?.id);
  const [form, setForm] = useState({
    title: item?.title || "", description: item?.description || "", category_id: item?.category?.id || "",
    type: item?.type || "", region: item?.region || "", city: item?.city || "", address: item?.address || "",
    price: text(item?.price), price_unit: item?.price_unit || "", organization_id: item?.organization?.id || "",
    contact_phone: item?.contacts?.phone || "", contact_telegram: item?.contacts?.telegram || "",
    contact_max: item?.contacts?.max_contact || "", currency: item?.currency || "RUB", negotiable: item?.negotiable || false,
  });
  const [attributes, setAttributes] = useState(item?.attributes || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = useMemo(() => flatten(categories), [categories]);
  const selected = options.find(c => c.id === form.category_id);
  const types = Object.fromEntries(Object.entries(meta.listing_types).filter(([key]) => !selected?.allowed_types.length || selected.allowed_types.includes(key)));
  const set = (field: keyof typeof form, value: string | boolean) => setForm(old => ({ ...old, [field]: value }));

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const send = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "submit";
    setBusy(true); setError("");
    let saved = false;
    try {
      const { organization_id, ...fields } = form;
      const attributesToSend = Object.fromEntries((selected?.effective || []).filter(a => attributes[a.key] !== undefined).map(a => [a.key, attributes[a.key]]));
      for (const attr of selected?.effective || []) {
        const value = attributesToSend[attr.key] as { from?: number; to?: number } | undefined;
        if (attr.type === "range" && (value?.from == null && value?.to == null) && attr.is_required) throw new Error(`Укажите диапазон «${attr.name}»`);
      }
      if (fields.title.trim().length < 5 || fields.description.trim().length < 10) throw new Error("Укажите название от 5 символов и описание от 10 символов.");
      const body = {
        ...fields, title: fields.title.trim(), description: fields.description.trim(),
        price: form.price === "" ? null : Number(form.price), city: form.city.trim() || null,
        address: form.address.trim() || null, price_unit: form.price_unit.trim() || null, attributes: attributesToSend,
        contact_phone: form.contact_phone.trim() || null, contact_telegram: form.contact_telegram.trim() || null, contact_max: form.contact_max.trim() || null,
        ...(!id && { organization_id: organization_id || null }),
      };
      const listing = await api<Listing>(id ? "/listings/" + id : "/listings", { method: id ? "PATCH" : "POST", body });
      saved = true;
      setId(listing.id);
      if (send && ["draft", "rejected"].includes(listing.status)) await api(`/listings/${listing.id}/submit`, { method: "POST" });
      toast(send || listing.status === "pending" ? "Объявление отправлено на модерацию" : "Черновик сохранён");
      navigate("/business/mine");
    } catch (e) {
      setError((saved ? "Черновик сохранён. Отправка на модерацию не завершилась. " : "") + errorMessage(e));
    } finally { setBusy(false); }
  }

  return <div className="bb-edit">
    <BackLink />
    <header className="bb-inner-heading"><h1>{item ? "Редактирование объявления" : "Новое объявление"}</h1><p>После модерации предложение появится в общей выдаче.</p></header>
    <form className="panel bb-editor" onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>Основное</legend>
        <label className="field">Название *<input className="input" required minLength={5} maxLength={255} value={form.title} onChange={e => set("title", e.target.value)} placeholder="Например, склад 300 м² в Донецке" /></label>
        <div className="bb-field-grid">
          <label className="field">Категория *<select className="select" required value={form.category_id} onChange={e => {
            const value = e.target.value;
            setForm(old => ({ ...old, category_id: value, type: "" }));
            setAttributes({});
          }}><option value="">Выберите категорию</option>{options.map(c => <option value={c.id} key={c.id}>{c.label}</option>)}</select></label>
          <label className="field">Тип объявления *<select className="select" required disabled={!selected} value={form.type} onChange={e => set("type", e.target.value)}>
            <option value="">Выберите тип</option><SelectOptions items={types} /></select></label>
          <label className="field">Регион *<select className="select" required value={form.region} onChange={e => set("region", e.target.value)}><option value="">Выберите регион</option><SelectOptions items={meta.regions} /></select></label>
          <label className="field">Город<input className="input" maxLength={128} value={form.city} onChange={e => set("city", e.target.value)} /></label>
        </div>
        <label className="field">Адрес<input className="input" maxLength={512} value={form.address} onChange={e => set("address", e.target.value)} /></label>
        <label className="field">Описание *<textarea className="textarea" required minLength={10} maxLength={20000} value={form.description} onChange={e => set("description", e.target.value)} rows={5} /></label>
      </fieldset>
      {!!selected?.effective.length && <fieldset disabled={busy}><legend>Характеристики</legend>
        <div className="bb-field-grid">{selected.effective.map(attr => <AttributeInput key={attr.key} attr={attr} value={attributes[attr.key]}
          change={value => setAttributes(old => ({ ...old, [attr.key]: value }))} />)}</div>
      </fieldset>}
      <fieldset disabled={busy}><legend>Цена и контакты</legend>
        <div className="bb-field-grid">
          <label className="field">Цена, {form.currency === "RUB" ? "₽" : form.currency}<input className="input" type="number" min={0} max={999999999999} step="0.01" value={form.price} onChange={e => set("price", e.target.value)} /></label>
          <label className="field">Единица цены<input className="input" maxLength={32} placeholder="мес., шт., смена" value={form.price_unit} onChange={e => set("price_unit", e.target.value)} /></label>
          {!item && <label className="field">От чьего имени<select className="select" disabled={!!id} value={form.organization_id} onChange={e => set("organization_id", e.target.value)}>
            <option value="">Частное лицо</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select></label>}
          <label className="field">Телефон<input className="input" type="tel" maxLength={20} value={form.contact_phone} onChange={e => set("contact_phone", e.target.value)} /></label>
          <label className="field">Telegram<input className="input" placeholder="@username" maxLength={128} value={form.contact_telegram} onChange={e => set("contact_telegram", e.target.value)} /></label>
          <label className="field">MAX<input className="input" maxLength={128} value={form.contact_max} onChange={e => set("contact_max", e.target.value)} /></label>
        </div>
        <label className="check"><input type="checkbox" checked={form.negotiable} onChange={e => set("negotiable", e.target.checked)} />Цена обсуждается</label>
        <p className="muted small">Контакты увидят только пользователи, вошедшие в BizBoard.</p>
      </fieldset>
      {error && <p className="bb-error" role="alert">{error}</p>}
      <div className="bb-actions">
        <button className="btn primary" type="submit" value="submit" disabled={busy}><Send size={17} /> {busy ? "Сохраняем…" : "Отправить на модерацию"}</button>
        {(!item || ["draft", "rejected"].includes(item.status)) && <button className="btn secondary" type="submit" value="draft" disabled={busy}><Save size={17} /> Сохранить черновик</button>}
      </div>
    </form>
  </div>;
}
