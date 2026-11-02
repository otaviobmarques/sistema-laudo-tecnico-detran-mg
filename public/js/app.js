// Roteador e layout do sistema.
import { S, html, raw, esc, get, post, api, toast, showErr, has, isStoreUser, applyBrand, brandBar, initials, roleLabel, DOMMA } from './core.js';
import * as P from './views/painel.js';
import * as LJ from './views/loja.js';
import * as CF from './views/conf.js';
import * as AD from './views/admin.js';
import * as PB from './views/publico.js';
import { flushQueue, queueSize } from './upload.js';

const routes = [
  [/^\/login$/, PB.adminLogin, { public: true, bare: true }],
  [/^\/pedir-link$/, PB.requestLink, { public: true, bare: true }],
  [/^\/acesso-invalido$/, PB.invalidLink, { public: true, bare: true }],
  [/^\/acesso-expirado$/, PB.expired, { public: true, bare: true }],
  [/^\/primeiro-acesso$/, PB.firstAccess, { bare: true }],
  [/^\/$/, home],
  [/^\/painel$/, P.dashboard],
  [/^\/lojas$/, P.stores],
  [/^\/lojas\/nova$/, P.storeForm],
  [/^\/lojas\/(\d+)$/, P.storeForm],
  [/^\/importar$/, P.importStores],
  [/^\/solicitar$/, P.requestFill],
  [/^\/matriz$/, P.matrix],
  [/^\/relatorios$/, P.reports],
  [/^\/loja$/, LJ.storePicker],
  [/^\/laudo\/(\d+)$/, LJ.home],
  [/^\/laudo\/(\d+)\/dados$/, LJ.etapa1],
  [/^\/laudo\/(\d+)\/checklist$/, LJ.checklist],
  [/^\/laudo\/(\d+)\/anexo2$/, LJ.annexList('II')],
  [/^\/laudo\/(\d+)\/anexo3$/, LJ.annexList('III')],
  [/^\/laudo\/(\d+)\/item\/(a[23]_\d+)$/, LJ.itemView],
  [/^\/laudo\/(\d+)\/documentos$/, LJ.documents],
  [/^\/laudo\/(\d+)\/envio$/, LJ.submit],
  [/^\/laudo\/(\d+)\/assinatura$/, LJ.signing],
  [/^\/laudo\/(\d+)\/versoes$/, LJ.versions],
  [/^\/laudo\/(\d+)\/historico$/, LJ.timeline],
  [/^\/laudo\/(\d+)\/equipamentos$/, LJ.equipment],
  [/^\/laudo\/(\d+)\/rts$/, LJ.rtsView],
  [/^\/fila$/, CF.queue],
  [/^\/fila\/(devolvidos|aprovados)$/, CF.queue],
  [/^\/conferencia\/(\d+)$/, CF.review],
  [/^\/revisao\/(\d+)$/, CF.rtReview],
  [/^\/admin\/marcas$/, AD.brands],
  [/^\/admin\/usuarios$/, AD.users],
  [/^\/admin\/parametros$/, AD.params],
  [/^\/admin\/porte$/, AD.porte],
  [/^\/admin\/auditoria$/, AD.audit],
  [/^\/admin\/lixeira$/, AD.trash],
  [/^\/sobre$/, AD.about],
];

async function home() {
  if (!S.me.user) return go('/login');
  if (has('admin') || has('franqueadora')) return go('/painel');
  return go('/loja');
}
export const go = (p) => { if (location.hash === '#' + p) render(); else location.hash = '#' + p; return { redirect: true }; };

// --------- navegação lateral ---------
// Perfis: Administrador, Franqueadora (cria lojas, analisa e valida) e Loja (preenche).
function navItems(ctx) {
  const items = [];
  const sec = (t) => items.push({ sec: t });
  const it = (href, label, count) => items.push({ href, label, count });
  if (ctx && ctx.laudoId && (isStoreUser() || ctx.storeMode)) {
    const id = ctx.laudoId;
    sec(isStoreUser() ? 'Minha loja' : 'Loja');
    it(`/laudo/${id}`, 'Início'); it(`/laudo/${id}/dados`, 'Dados do processo'); it(`/laudo/${id}/checklist`, 'Checklist');
    it(`/laudo/${id}/anexo2`, 'Anexo II · Infraestrutura'); it(`/laudo/${id}/anexo3`, 'Anexo III · Equipamentos'); it(`/laudo/${id}/documentos`, 'Documentos');
    it(`/laudo/${id}/envio`, 'Envio para validação'); it(`/laudo/${id}/assinatura`, 'Assinatura e protocolo');
    sec('Cadastros');
    it(`/laudo/${id}/equipamentos`, 'Equipamentos da loja'); it(`/laudo/${id}/rts`, 'Responsável técnico'); it(`/laudo/${id}/versoes`, 'Versões e consulta');
    if (isStoreUser() && S.me.stores.length > 1) it('/loja', 'Trocar de loja');
    if (!isStoreUser()) { sec('Franqueadora'); it(`/conferencia/${id}`, 'Validar este laudo'); it('/painel', 'Voltar ao painel'); }
    return items;
  }
  if (has('franqueadora') || has('admin')) {
    sec('Painel'); it('/painel', 'Visão geral'); it('/lojas', 'Lojas'); it('/solicitar', 'Solicitar preenchimento');
    it('/matriz', 'Matriz de pendências'); it('/relatorios', 'Relatórios');
    sec('Validação'); it('/fila', 'Fila de validação'); it('/fila/devolvidos', 'Devolvidos à loja'); it('/fila/aprovados', 'Validados');
  }
  if (has('admin')) { sec('Administração'); it('/admin/marcas', 'Marcas'); it('/admin/usuarios', 'Usuários'); it('/admin/parametros', 'Parâmetros das regras'); it('/admin/porte', 'Porte dos municípios'); it('/admin/auditoria', 'Auditoria e logs'); it('/admin/lixeira', 'Lixeira'); }
  sec('Sistema'); it('/sobre', 'Sobre o sistema');
  return items;
}

function layout(view, ctx) {
  const path = location.hash.slice(1) || '/';
  const nav = navItems(ctx);
  const brand = ctx && ctx.brand;
  const u = S.me.user;
  const onStore = brand && (isStoreUser() || ctx.storeMode);
  applyBrand(onStore ? brand : null);
  const sideNav = nav.map((n) => n.sec ? html`<div class="sec">${n.sec}</div>` : html`<a class="nav ${path === n.href || (n.href !== '/' && n.href.split('/').length > 2 && path.startsWith(n.href + '/') && !nav.some((m) => m.href && m.href !== n.href && path.startsWith(m.href) && m.href.length > n.href.length)) ? 'on' : ''}" href="#${n.href}">${n.label}${n.count ? html`<span class="count">${n.count}</span>` : ''}</a>`);
  const bottom = onStore && ctx.laudoId ? html`<nav class="bottomnav">${[['', '⌂', 'Início'], ['/checklist', '☑', 'Checklist'], ['/anexo2', '▣', 'Laudo'], ['/equipamentos', '⚙', 'Equipam.'], ['/envio', '➤', 'Enviar']].map(([p, i, l]) => html`<a href="#/laudo/${ctx.laudoId}${p}" class="${path === `/laudo/${ctx.laudoId}${p}` ? 'on' : ''}"><span>${i}</span>${l}</a>`)}</nav>` : '';
  return html`
  <div class="shell">
    <aside class="side">
      <div class="logo"><i></i>Projeto Técnico<br>DETRAN MG</div>
      ${sideNav}
      <div class="grow"></div>
      <div class="dev">Desenvolvido por<b>${DOMMA} Domma</b></div>
    </aside>
    <div class="main">
      ${!S.online ? html`<div class="offline">Sem internet — as fotos tiradas ficam guardadas neste aparelho e sobem quando a conexão voltar. Mantenha a página aberta.</div>` : ''}
      ${onStore ? html`<div class="brandwrap">${brandBar(brand, html`${ctx.storeName || ''}<br>${view.title || ''}`, true)}</div>` : ''}
      <header class="topbar">
        <button class="burger" aria-label="Menu">☰</button>
        <h1>${view.title || ''}</h1>
        ${view.actions || ''}
        <div class="who"><span class="hide-m">${u.name} · ${u.roles.map((r) => roleLabel[r]).join(', ')}${u.via && u.via.startsWith('admin:') ? ' (como Admin)' : ''}</span><div class="avatar" title="${u.name}">${initials(u.name)}</div>
          <button class="btn sm" id="logout" title="Sair deste aparelho">Sair</button></div>
      </header>
      <main class="content ${view.narrow ? 'narrow' : ''}" id="view">${view.body}</main>
    </div>
  </div>${bottom}`;
}

let renderSeq = 0;
export async function render() {
  const seq = ++renderSeq;
  const path = (location.hash.slice(1) || '/').split('?')[0];
  const app = document.getElementById('app');
  if (location.pathname.startsWith('/c/')) { await PB.consulta(app, decodeURIComponent(location.pathname.slice(3))); return; }
  if (!S.cat) S.cat = await get('/api/catalog').catch(() => null);
  if (!S.me) S.me = await get('/api/me', { quiet: true });
  let match = null;
  for (const [re, fn, opt] of routes) { const m = path.match(re); if (m) { match = { fn, opt: opt || {}, params: m.slice(1) }; break; } }
  if (!match) { app.innerHTML = '<div class="empty-state">Página não encontrada. <a href="#/">Voltar</a></div>'; return; }
  if (!match.opt.public && !S.me.user) { location.hash = '#/login'; return; }
  if (S.me.user && !S.me.user.terms && !match.opt.public && path !== '/primeiro-acesso' && !has('admin')) { location.hash = '#/primeiro-acesso'; return; }
  document.body.classList.remove('drawer');
  document.querySelectorAll('.modal-bg, .lightbox').forEach((m) => m.remove());
  try {
    const view = await match.fn(...match.params);
    if (seq !== renderSeq || !view || view.redirect) return;
    document.title = (view.title ? view.title + ' · ' : '') + 'Projeto Técnico DETRAN MG';
    if (match.opt.bare || view.bare) { applyBrand(view.brand || null); app.innerHTML = String(view.body); }
    else app.innerHTML = String(layout(view, view.ctx));
    const root = document.getElementById('view') || app;
    app.querySelectorAll('.burger').forEach((b) => (b.onclick = () => document.body.classList.toggle('drawer')));
    const lo = document.getElementById('logout');
    if (lo) lo.onclick = async () => { await post('/api/auth/logout'); S.me = null; location.hash = '#/login'; };
    if (view.mount) await view.mount(root);
    window.scrollTo(0, view.keepScroll ? window.scrollY : 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    console.error(e);
    app.innerHTML = String(html`<div class="content"><div class="card"><h2>Não foi possível abrir esta página</h2><p class="muted">${e.message}</p><a class="btn" href="#/">Voltar ao início</a></div></div>`);
  }
}

window.addEventListener('hashchange', render);
window.addEventListener('online', () => { S.online = true; flushQueue().then(() => render()); });
window.addEventListener('offline', () => { S.online = false; toast('Você está sem internet. As fotos ficam guardadas e sobem depois.', 'err'); });
window.addEventListener('beforeunload', (e) => { if (queueSize() > 0) { e.preventDefault(); e.returnValue = 'Ainda há fotos aguardando envio.'; } });
setInterval(() => { if (navigator.onLine && queueSize() > 0) flushQueue(); }, 15000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
