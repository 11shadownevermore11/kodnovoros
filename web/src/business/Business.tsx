import { useEffect, useState, type ReactNode } from "react";
import { BriefcaseBusiness, Building2, Heart, LayoutList, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { Empty, ErrorBox, Loading } from "../ui/kit";
import { request, type BusinessMeta, type Category, type LoginOptions, type Session } from "./api";
import Board from "./Board";
import ListingDetails from "./ListingDetails";
import ListingForm from "./ListingForm";
import { MyOrganizations, OrganizationDetails, OrganizationDirectory } from "./Organizations";
import { BusinessSession, useBusiness } from "./session";
import SignIn from "./SignIn";
import { Favorites, Mine, Moderation } from "./Workspace";
import { errorMessage, useLoad } from "./useLoad";

export default function Business() {
  return <BusinessSession><BusinessRoutes /></BusinessSession>;
}

function BusinessRoutes() {
  const { session, logout } = useBusiness();
  const { toast } = useStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [login, setLogin] = useState<{ next?: string } | null>(null);
  const state = useLoad("market-config", async signal => {
    const [meta, categories, options] = await Promise.all([
      request<BusinessMeta>("/meta", { signal }),
      request<Category[]>("/catalog/categories", { signal }),
      request<LoginOptions>("/auth/web-options", { signal }),
    ]);
    return { meta, categories, options };
  });
  useEffect(() => {
    if (location.hash === "#business-catalog" && state.data) document.getElementById("business-catalog")?.scrollIntoView();
  }, [location.hash, location.pathname, state.data]);

  const start = (next?: string) => {
    if (session && next) navigate(next); else if (!session) setLogin({ next });
  };
  const afterLogin = (account: Session) => {
    if (login?.next) navigate(login.next);
    else if (account.user.platform_roles.length && state.data?.options.demo) navigate("/business/moderation");
    setLogin(null);
  };
  const guarded = (content: ReactNode) => session ? content : <div className="panel bb-login-required">
    <span className="bb-category-icon"><BriefcaseBusiness size={23} /></span>
    <h1>Войдите в BizBoard</h1>
    <p className="muted">Для этого раздела нужен аккаунт BizBoard.</p>
    <button className="btn primary" onClick={() => start()}><LogIn size={17} /> Войти</button>
  </div>;

  return <div className="container bb-page">
    <div className="bb-subnav">
      <nav aria-label="Разделы BizBoard">
        <NavLink end to="/business"><BriefcaseBusiness size={17} /> Биржа</NavLink>
        <NavLink to="/business/organizations"><Building2 size={17} /> Компании</NavLink>
        <NavLink to="/business/favorites"><Heart size={17} /> Избранное</NavLink>
        {session && <><NavLink to="/business/mine"><LayoutList size={17} /> Мои объявления</NavLink>
          <NavLink to="/business/company"><Building2 size={17} /> Мои компании</NavLink></>}
        {!!session?.user.platform_roles.length && <NavLink to="/business/moderation"><ShieldCheck size={17} /> Модерация</NavLink>}
      </nav>
      {session ? <div className="bb-account"><span>{session.user.full_name}</span>
        <button className="btn ghost sm" aria-label="Выйти из BizBoard" onClick={() => void logout().catch(e => toast(errorMessage(e), "err"))}><LogOut size={17} /> Выйти</button>
      </div> : <button className="btn secondary sm" disabled={!state.data} onClick={() => start()}><LogIn size={17} /> Вход в BizBoard</button>}
    </div>
    {state.loading ? <Loading h={440} /> : !state.data ? <ErrorBox text={state.error} retry={state.reload} /> : <Routes>
      <Route index element={<Board {...state.data} demo={state.data.options.demo} start={start} />} />
      <Route path="listing/:id" element={<ListingDetails {...state.data} signIn={() => start()} />} />
      <Route path="new" element={guarded(<ListingForm {...state.data} />)} />
      <Route path="edit/:id" element={guarded(<ListingForm {...state.data} />)} />
      <Route path="favorites" element={guarded(<Favorites meta={state.data.meta} />)} />
      <Route path="mine" element={guarded(<Mine meta={state.data.meta} />)} />
      <Route path="company" element={guarded(<MyOrganizations meta={state.data.meta} />)} />
      <Route path="organizations" element={<OrganizationDirectory meta={state.data.meta} />} />
      <Route path="organizations/:slug" element={<OrganizationDetails meta={state.data.meta} />} />
      <Route path="moderation" element={guarded(<Moderation meta={state.data.meta} />)} />
      <Route path="*" element={<Empty title="Страница BizBoard не найдена"><Link className="btn secondary" to="/business">На биржу</Link></Empty>} />
    </Routes>}
    {login && state.data && <SignIn options={state.data.options} close={() => setLogin(null)} done={afterLogin} />}
  </div>;
}
