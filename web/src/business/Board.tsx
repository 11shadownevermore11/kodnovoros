import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUpRight, BriefcaseBusiness, Building2, Plus, Search, SlidersHorizontal } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { CategoryIcon, flatten, ListingCard, optionValues, Pager, Results, SelectOptions } from "./components";
import type { Attribute, BusinessMeta, Category, Listing, Page } from "./api";
import { useBusiness } from "./session";
import { errorMessage, useLoad } from "./useLoad";

const filters = ["q", "category_id", "region", "type", "price_min", "price_max", "sort", "organization_id"] as const;

export function CatalogFilters({ categories, meta }: { categories: Category[]; meta: BusinessMeta }) {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState(() => Object.fromEntries(params));
  const [advanced, setAdvanced] = useState(() => [...params.keys()].some(key => key.startsWith("attr.") || key.startsWith("price_")));
  const options = flatten(categories);
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(draft)) if (value.trim()) next.set(key, value.trim());
    setParams(next);
  };
  const update = (key: string, value: string) => setDraft(values => ({ ...values, [key]: value }));
  const setCategory = (category_id: string) => setDraft(values => ({
    ...Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith("attr."))), category_id,
  }));
  const attrs = options.find(category => category.id === draft.category_id)?.effective.filter(a => a.is_filterable) || [];
  return <form className="bb-filter" onSubmit={apply} aria-label="Фильтры объявлений">
    <div className="bb-search">
      <label><Search size={21} /><input type="search" aria-label="Поиск по объявлениям" placeholder="Например, упаковка или склад" value={draft.q || ""} maxLength={200} onChange={e => update("q", e.target.value)} /></label>
      <button type="submit" className="btn primary">Найти</button>
    </div>
    <div className="bb-filter-row">
      <label className="field">Категория<select className="select" value={draft.category_id || ""} onChange={e => setCategory(e.target.value)}>
        <option value="">Все категории</option>{options.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select></label>
      <label className="field">Регион<select className="select" value={draft.region || ""} onChange={e => update("region", e.target.value)}><option value="">Все регионы</option><SelectOptions items={meta.regions} /></select></label>
      <label className="field">Тип объявления<select className="select" value={draft.type || ""} onChange={e => update("type", e.target.value)}><option value="">Все типы</option><SelectOptions items={meta.listing_types} /></select></label>
      <button type="button" className="btn secondary bb-filter-more" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={17} /> Фильтры</button>
    </div>
    {advanced && <div className="bb-filter-row bb-filter-advanced">
      {["price_min", "price_max"].map((key, i) => <label className="field" key={key}>{i ? "Цена до" : "Цена от"}<input className="input" type="number" min="0" step="any" value={draft[key] || ""} onChange={e => update(key, e.target.value)} /></label>)}
      {attrs.filter(a => !["multi_enum", "range"].includes(a.type)).map(a => <AttributeFilter key={a.key} attr={a} draft={draft} update={update} />)}
    </div>}
    {(params.size > Number(params.has("page"))) && <div className="bb-filter-reset"><button className="btn ghost sm" type="button" onClick={() => { setDraft({}); setParams({}); }}>Сбросить фильтры</button></div>}
  </form>;
}

function AttributeFilter({ attr, draft, update }: { attr: Attribute; draft: Record<string,string>; update: (key: string, value: string) => void }) {
  const key = "attr." + attr.key;
  const name = attr.unit ? `${attr.name}, ${attr.unit}` : attr.name;
  if (attr.type === "number") return <>{["min", "max"].map((bound, i) => <label key={bound} className="field">{name} {i ? "до" : "от"}<input className="input" type="number" step="any" value={draft[key + "." + bound] || ""} onChange={e => update(key + "." + bound, e.target.value)} /></label>)}</>;
  return <label className="field">{name}{attr.type === "enum" || attr.type === "bool" ?
    <select className="select" value={draft[key] || ""} onChange={e => update(key, e.target.value)}><option value="">Любое значение</option>
      {(attr.type === "bool" ? [{value:"true", label:"Да"}, {value:"false", label:"Нет"}] : optionValues(attr)).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select> : <input className="input" type={attr.type === "date" ? "date" : "text"} value={draft[key] || ""} onChange={e => update(key, e.target.value)} />}</label>;
}

export default function Board({ meta, categories, demo, start }: {
  meta: BusinessMeta; categories: Category[]; demo: boolean; start: (next?: string) => void;
}) {
  const { api, session } = useBusiness();
  const { toast } = useStore();
  const [params, setParams] = useSearchParams();
  const [pending, setPending] = useState("");
  const query = new URLSearchParams([...params].filter(([key]) => filters.some(k => k === key) || key.startsWith("attr.") || key === "page"));
  query.set("per_page", "12");
  const results = useLoad(`board:${session?.user.id ?? ""}:${query}`, signal => api<Page<Listing>>("/listings?" + query, { signal }));
  const tree = flatten(categories);
  const select = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (key !== "page") next.delete("page");
    if (key === "category_id") for (const attr of [...next.keys()]) if (attr.startsWith("attr.")) next.delete(attr);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
  };
  async function favorite(item: Listing) {
    if (!session) { start(); return; }
    setPending(item.id);
    try {
      await api(`/listings/${item.id}/favorite`, { method: item.is_favorite ? "DELETE" : "POST" });
      results.reload();
      toast(item.is_favorite ? "Удалено из избранного" : "Добавлено в избранное");
    } catch (e) { toast(errorMessage(e), "err"); }
    finally { setPending(""); }
  }
  const filterKey = new URLSearchParams([...params].filter(([key]) => key !== "page")).toString();
  return <>
    <section className="bb-hero">
      <img src="/img/bizboard-hero.webp" alt="" width="900" height="606" fetchPriority="high" />
      <div className="bb-hero-content">
        <span className="bb-hero-brand"><BriefcaseBusiness size={17} /> BizBoard{demo && <span>Демо</span>}</span>
        <h1>Биржа для<br />бизнеса</h1>
        <p>Найдите помещение, оборудование или подрядчика. Разместите своё предложение и находите партнёров в регионе.</p>
        <div className="bb-actions">
          <button className="btn primary" onClick={() => start("/business/new")}><Plus size={19} /> Разместить объявление</button>
          <a className="bb-hero-secondary" href="#business-catalog">К объявлениям <ArrowDown size={17} /></a>
        </div>
      </div>
      <Link to="/business/organizations" className="bb-hero-link"><Building2 size={20} /><span>Каталог компаний</span><ArrowUpRight size={17} /></Link>
    </section>

    <section className="bb-categories" aria-label="Популярные категории">
      {categories.map(c => <button key={c.id} type="button" aria-pressed={params.get("category_id") === c.id}
        onClick={() => select("category_id", params.get("category_id") === c.id ? "" : c.id)}>
        <span className="bb-category-icon"><CategoryIcon slug={c.slug} /></span><span>{c.name}</span>
      </button>)}
    </section>

    <section id="business-catalog" className="bb-results">
      <CatalogFilters key={filterKey} categories={categories} meta={meta} />
      <div className="bb-results-head">
        <div><h2>Объявления</h2>{results.data && <p className="muted" aria-live="polite">Найдено {results.data.total.toLocaleString("ru-RU")}</p>}</div>
        <label className="field">Сортировка<select className="select" value={params.get("sort") || "date"} onChange={e => select("sort", e.target.value)}>
          <option value="date">Сначала новые</option><option value="relevance">По релевантности</option><option value="price_asc">Сначала дешевле</option><option value="price_desc">Сначала дороже</option>
        </select></label>
      </div>
      <Results {...results} retry={results.reload} empty="По вашему запросу ничего не найдено">
        <div className="bb-card-grid">{results.data?.items.map(item =>
          <ListingCard key={item.id} item={item} meta={meta} root={tree.find(c => c.id === item.category?.id)?.root} favorite={() => void favorite(item)} pending={pending === item.id} />)}</div>
      </Results>
      <Pager data={results.data} onPage={page => { select("page", String(page)); document.getElementById("business-catalog")?.scrollIntoView(); }} />
    </section>
  </>;
}
