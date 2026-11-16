import { useState, type FormEvent } from "react";
import { ArrowUpRight, Flag } from "lucide-react";
import { useStore } from "../store";
import { Modal } from "../ui/kit";
import type { BusinessMeta, Page } from "./api";
import { Pager, Results, SelectOptions } from "./components";
import { useBusiness } from "./session";
import { errorMessage, useLoad } from "./useLoad";

interface Complaint {
  id: string;
  listing_id: string | null;
  reason: string;
  comment: string | null;
  status: string;
  resolution: string | null;
}

export default function Complaints({ meta }: { meta: BusinessMeta }) {
  const { api, session } = useBusiness();
  const { toast } = useStore();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("new");
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = useLoad(`complaints:${session?.user.id}:${page}:${status}`, signal =>
    api<Page<Complaint>>(`/admin/complaints?status=${status}&page=${page}&per_page=12`, { signal }));
  async function resolve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected || busy) return;
    const form = new FormData(e.currentTarget);
    const resolution = String(form.get("resolution") || "").trim();
    if (resolution.length < 3) { setError("Опишите решение от 3 символов."); return; }
    setBusy(true); setError("");
    try {
      await api(`/admin/complaints/${selected.id}/resolve`, { body: { resolution, status: form.get("decision") } });
      setSelected(null);
      toast("Решение по жалобе сохранено");
      if (data.data?.items.length === 1 && page > 1) setPage(page - 1); else data.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <div className="stack">
    <label className="field bb-status-filter">Статус жалобы<select className="select" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><SelectOptions items={meta.complaint_statuses} /></select></label>
    <Results {...data} retry={data.reload} empty="Жалоб с таким статусом пока нет">
      <div className="bb-list">{data.data?.items.map(item => <article key={item.id} className="panel bb-row">
        <div className="bb-row-info">
          <span className="bb-status"><Flag size={13} />&nbsp;{meta.complaint_statuses[item.status]}</span>
          <h2>{meta.complaint_reasons[item.reason] || item.reason}</h2>
          {item.comment && <p className="bb-moderation-text">{item.comment}</p>}
          {item.resolution && <p className="muted">Решение · {item.resolution}</p>}
          {item.listing_id && <a className="bb-back" href={`/business/listing/${item.listing_id}`} target="_blank" rel="noreferrer">Открыть объявление <ArrowUpRight size={15} /></a>}
        </div>
        {["new", "in_review"].includes(item.status) && <button className="btn secondary sm" onClick={() => { setError(""); setSelected(item); }}>Рассмотреть</button>}
      </article>)}</div>
    </Results>
    <Pager data={data.data} onPage={setPage} />
    {selected && <Modal title="Решение по жалобе" onClose={() => { if (!busy) setSelected(null); }}>
      <form className="bb-dialog stack" onSubmit={resolve}>
        <label className="field">Решение<select className="select" name="decision"><option value="resolved">Отметить решённой</option><option value="rejected">Отклонить жалобу</option></select></label>
        <label className="field">Комментарий<textarea className="textarea" name="resolution" required minLength={3} maxLength={2000} /></label>
        {error && <p className="bb-error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>Сохранить решение</button>
      </form>
    </Modal>}
  </div>;
}
