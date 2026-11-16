import { useState, type FormEvent } from "react";
import { ArrowUpRight, Building2, MapPin, Plus, Search, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "../store";
import { Empty, ErrorBox, Loading, Modal } from "../ui/kit";
import type { BusinessMeta, Organization, Page } from "./api";
import { BackLink, Pager, Results, SelectOptions } from "./components";
import { useBusiness } from "./session";
import { errorMessage, useLoad } from "./useLoad";

export function OrganizationDirectory({ meta }: { meta: BusinessMeta }) {
  const { api } = useBusiness();
  const [query, setQuery] = useState({ q: "", region: "", page: 1 });
  const params = new URLSearchParams({ ...query, page: String(query.page), per_page: "12" });
  if (!query.region) params.delete("region");
  const data = useLoad("companies:" + params, signal => api<Page<Organization>>("/public/organizations?" + params, { signal, auth: false }));
  return <div className="stack"><BackLink /><header className="bb-inner-heading"><h1>Каталог компаний</h1><p>Найдите поставщика или партнёра в регионе.</p></header>
    <form className="bb-filter bb-org-search" onSubmit={e => {
      e.preventDefault(); const form = new FormData(e.currentTarget);
      setQuery({ q: String(form.get("q") || "").trim(), region: String(form.get("region") || ""), page: 1 });
    }}>
      <label className="field">Название<input className="input" type="search" name="q" maxLength={200} placeholder="Поиск компании" /></label>
      <label className="field">Регион<select className="select" name="region"><option value="">Все регионы</option><SelectOptions items={meta.regions} /></select></label>
      <button className="btn primary"><Search size={17} /> Найти</button>
    </form>
    <Results {...data} retry={data.reload} empty="Компании по этому запросу не найдены">
      <div className="bb-card-grid">{data.data?.items.map(org => <Link className="panel bb-company stack" key={org.id} to={`/business/organizations/${org.slug}`}>
        <div className="bb-toolbar"><span className="bb-category-icon"><Building2 size={22} /></span><ArrowUpRight size={18} /></div>
        <h2>{org.name}</h2><CompanyFacts org={org} meta={meta} />
        {org.description && <p className="bb-card-description">{org.description}</p>}
      </Link>)}</div>
    </Results>
    <Pager data={data.data} onPage={page => setQuery(old => ({ ...old, page }))} />
  </div>;
}

function CompanyFacts({ org, meta }: { org: Organization; meta: BusinessMeta }) {
  return <div className="bb-facts">
    <span><MapPin size={16} />{meta.regions[org.region]}</span>
    <span>{meta.org_types[org.type]}</span>
    {org.verification_level !== "none" && <span><ShieldCheck size={17} />{org.verification_label || meta.verification_levels[org.verification_level]}</span>}
  </div>;
}

export function OrganizationDetails({ meta }: { meta: BusinessMeta }) {
  const { slug } = useParams();
  const { api } = useBusiness();
  const data = useLoad("company:" + slug, signal => api<Organization>("/public/organizations/" + encodeURIComponent(slug || ""), { signal, auth: false }));
  if (data.loading) return <Loading h={250} />;
  if (!data.data) return <ErrorBox text={data.error} retry={data.reload} />;
  const org = data.data;
  return <div className="stack"><Link to="/business/organizations" className="bb-back">← Каталог компаний</Link>
    <section className="panel bb-detail-main stack"><span className="bb-category-icon"><Building2 size={24} /></span>
      <h1>{org.name}</h1><CompanyFacts org={org} meta={meta} />{org.description && <p className="bb-moderation-text">{org.description}</p>}
      <Link className="btn primary" to={`/business?organization_id=${org.id}#business-catalog`}>Объявления компании <ArrowUpRight size={17} /></Link>
    </section>
  </div>;
}

export function MyOrganizations({ meta }: { meta: BusinessMeta }) {
  const { session, api } = useBusiness();
  const [modal, setModal] = useState<{ org?: Organization } | null>(null);
  const data = useLoad("my-companies:" + session?.user.id, signal => api<Organization[]>("/organizations/mine", { signal }));
  return <div className="stack"><BackLink /><header className="bb-inner-heading bb-toolbar">
    <div><h1>Мои компании</h1><p>Публикуйте объявления от имени организации.</p></div>
    <button className="btn primary" onClick={() => setModal({})}><Plus size={18} /> Добавить компанию</button>
  </header>
    {data.loading ? <Loading h={180} /> : data.error ? <ErrorBox text={data.error} retry={data.reload} /> : data.data?.length ? <div className="bb-list">
      {data.data.map(org => <article className="panel bb-row" key={org.id}><div className="bb-row-info">
        <h2><Link to={`/business/organizations/${org.slug}`}>{org.name} <ArrowUpRight size={16} /></Link></h2>
        <CompanyFacts org={org} meta={meta} />
        {org.plan && <p className="muted small">{org.plan.name} · {org.active_listings_count || 0} из {org.plan.max_active_listings} активных объявлений</p>}
      </div>
        {["none", "phone"].includes(org.verification_level) && <button className="btn secondary" onClick={() => setModal({ org })}><ShieldCheck size={17} /> Подтвердить ИНН</button>}
      </article>)}
    </div> : <Empty icon="building-2" title="Вы пока не добавили компанию" />}
    {modal && <CompanyForm meta={meta} org={modal.org} close={() => setModal(null)} done={() => { setModal(null); data.reload(); }} />}
  </div>;
}

function CompanyForm({ meta, org, close, done }: { meta: BusinessMeta; org?: Organization; close: () => void; done: () => void }) {
  const { api } = useBusiness();
  const { toast } = useStore();
  const [type, setType] = useState(org?.type || "legal_entity");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const length = type === "legal_entity" ? 10 : 12;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const form = new FormData(e.currentTarget);
    const read = (key: string) => String(form.get(key) || "").trim();
    try {
      if (org) await api(`/organizations/${org.id}/verification/inn`, { body: { inn: read("inn") } });
      else {
        if (read("name").length < 2) throw new Error("Введите название от 2 символов.");
        await api("/organizations", { body: {
          name: read("name"), type, region: read("region"), description: read("description") || null, inn: read("inn") || null,
        } });
      }
      toast(org ? "ИНН проверен" : "Компания добавлена"); done();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title={org ? "Подтверждение ИНН" : "Новая компания"} onClose={close}>
    <form className="bb-dialog stack" onSubmit={submit}>
      {!org && <>
        <label className="field">Название<input className="input" name="name" required minLength={2} maxLength={255} /></label>
        <label className="field">Форма<select className="select" value={type} onChange={e => setType(e.target.value)}><SelectOptions items={meta.org_types} /></select></label>
        <label className="field">Регион<select className="select" name="region" required><option value="">Выберите регион</option><SelectOptions items={meta.regions} /></select></label>
        <label className="field">Описание<textarea className="textarea" name="description" maxLength={5000} /></label>
      </>}
      <label className="field">ИНН ({length} цифр)<input className="input" name="inn" autoComplete="off" inputMode="numeric" defaultValue={org?.inn}
        pattern={`[0-9]{${length}}`} required={!!org} maxLength={length} /></label>
      {error && <p className="bb-error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{org ? "Проверить ИНН" : "Добавить компанию"}</button>
    </form>
  </Modal>;
}
