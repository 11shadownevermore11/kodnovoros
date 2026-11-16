import type { ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, BriefcaseBusiness, ChevronLeft, ChevronRight, Eye, Factory, Handshake, Heart, MapPin, Megaphone, PackageOpen, ShieldCheck, Store, Truck, Warehouse } from "lucide-react";
import { Link } from "react-router-dom";
import { Empty, ErrorBox, Loading } from "../ui/kit";
import type { Attribute, BusinessMeta, Category, Listing, Page } from "./api";

const icons = {
  oborudovanie: Factory, "kommercheskaya-nedvizhimost": Warehouse, "transport-i-spectehnika": Truck,
  "reklama-i-marketing": Megaphone, "uslugi-dlya-biznesa": BriefcaseBusiness, "logistika-i-perevozki": Truck,
  "tovary-i-syryo-opt": PackageOpen, "gotovyy-biznes-i-franshizy": Handshake,
};

export function CategoryIcon({ slug, size = 21 }: { slug?: string; size?: number }) {
  const Icon = icons[slug as keyof typeof icons] || Store;
  return <Icon size={size} strokeWidth={1.65} />;
}

export function flatten(categories: Category[], path = "", inherited: Attribute[] = [], root?: string): (Category & { label: string; effective: Attribute[]; root: string })[] {
  return categories.flatMap(cat => {
    const label = path ? path + " / " + cat.name : cat.name;
    const effective = [...new Map([...inherited, ...cat.attributes].map(attr => [attr.key, attr])).values()];
    const top = root || cat.slug;
    return [{ ...cat, label, effective, root: top }, ...flatten(cat.children, label, effective, top)];
  });
}

export function optionValues(attribute: Attribute) {
  return attribute.options.map(item => typeof item === "object"
    ? { value: String(item.value), label: item.label ?? String(item.value) }
    : { value: String(item), label: String(item) });
}

export function SelectOptions({ items }: { items: Record<string, string> }) {
  return <>{Object.entries(items).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</>;
}

export function price(listing: Listing) {
  if (listing.price == null) return "По договорённости";
  try {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: listing.currency, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(listing.price);
  } catch { return `${listing.price.toLocaleString("ru-RU")} ${listing.currency}`; }
}

export function ListingCard({ item, meta, root, favorite, pending }: {
  item: Listing; meta: BusinessMeta; root?: string; favorite: () => void; pending: boolean;
}) {
  const name = item.organization?.name || item.user?.full_name || "Частное лицо";
  return <article className={`bb-card ${item.is_highlight ? "bb-highlight" : ""}`}>
    <div className="bb-card-head">
      <span className="bb-category-icon"><CategoryIcon slug={root || item.category?.slug} /></span>
      <div className="bb-card-tags">
        <span className="bb-tag">{meta.listing_types[item.type] || item.type}</span>
        {item.is_top && <span className="bb-tag bb-top">Топ</span>}
      </div>
      <button type="button" className="bb-icon-btn" aria-label={item.is_favorite ? "Убрать из избранного" : "В избранное"}
        aria-pressed={item.is_favorite} disabled={pending} onClick={favorite}><Heart size={19} fill={item.is_favorite ? "currentColor" : "none"} /></button>
    </div>
    <div className="bb-card-body">
      <p className="bb-overline">{item.category?.name}</p>
      <h3><Link to={`/business/listing/${item.id}`}>{item.title}</Link></h3>
      <p className="bb-card-description">{item.description}</p>
      <p className="bb-price">{price(item)}{item.price != null && item.price_unit && <small> / {item.price_unit}</small>}</p>
    </div>
    <div className="bb-card-foot">
      <span title={name}>
        {item.organization?.verification_level && item.organization.verification_level !== "none" && <ShieldCheck size={16} />}
        {name}
      </span>
      <span><MapPin size={15} />{item.city || meta.regions[item.region]}</span>
    </div>
  </article>;
}

export function Results<T>({ data, loading, error, retry, empty, children }: {
  data?: Page<T> | null; loading: boolean; error?: string; retry: () => void; empty: string; children: ReactNode;
}) {
  if (loading) return <div className="bb-card-grid" aria-busy="true">{[1, 2, 3].map(i => <Loading key={i} h={232} />)}</div>;
  if (error) return <ErrorBox text={error} retry={retry} />;
  if (!data?.items.length) return <Empty icon="briefcase" title={empty} />;
  return <>{children}</>;
}

export function Pager({ data, onPage }: { data?: Page<unknown> | null; onPage: (page: number) => void }) {
  if (!data || data.pages <= 1) return null;
  return <nav className="bb-pager" aria-label="Страницы списка">
    <button className="btn secondary" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)} aria-label="Предыдущая"><ChevronLeft size={18} /></button>
    <span>{data.page} из {data.pages}</span>
    <button className="btn secondary" disabled={data.page >= data.pages} onClick={() => onPage(data.page + 1)} aria-label="Следующая"><ChevronRight size={18} /></button>
  </nav>;
}

export function BackLink() { return <Link to="/business" className="bb-back"><ArrowLeft size={17} /> Все объявления</Link>; }

export function ListingFacts({ item, meta }: { item: Listing; meta: BusinessMeta }) {
  return <div className="bb-facts">
    <span><MapPin size={16} />{[meta.regions[item.region], item.city, item.address].filter(Boolean).join(" · ")}</span>
    <span><Eye size={17} />{item.views_count.toLocaleString("ru-RU")}</span>
  </div>;
}

export function BannerLink() {
  return <Link className="bb-portal-link container" to="/business">
    <span className="bb-category-icon"><BriefcaseBusiness size={24} /></span>
    <span><strong>Биржа для бизнеса</strong><small>Оборудование, коммерческие помещения, услуги и партнёры</small></span>
    <span className="bb-portal-cta">Открыть BizBoard <ArrowUpRight size={18} /></span>
  </Link>;
}
