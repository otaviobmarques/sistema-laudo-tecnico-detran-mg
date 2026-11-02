// Núcleo do front-end: estado, API, templates, layout, modais e utilidades.
export const S = { me: null, cat: null, route: null, laudo: null, online: navigator.onLine };

// ---------- templates seguros ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const fv = (x) => (x == null || x === false ? '' : Array.isArray(x) ? x.map(fv).join('') : x instanceof Raw ? x.s : esc(x));
export const html = (str, ...v) => new Raw(str.reduce((a, s, i) => a + s + (i < v.length ? fv(v[i]) : ''), ''));
export const raw = (s) => new Raw(String(s));

// ---------- API ----------
export async function api(method, url, body, { quiet } = {}) {
  const opt = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opt.body = body;
  else if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch (e) { const er = new Error('Sem conexão com a internet.'); er.offline = true; throw er; }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    const e = new Error((data && data.error) || `Erro ${r.status}`);
    Object.assign(e, { status: r.status, data });
    if (r.status === 401 && !quiet && !url.includes('/auth/') && !url.includes('/public/')) { S.me = null; location.hash = '#/acesso-expirado'; }
    throw e;
  }
  return data;
}
export const get = (u, o) => api('GET', u, undefined, o);
export const post = (u, b) => api('POST', u, b ?? {});
export const put = (u, b) => api('PUT', u, b ?? {});
export const del = (u) => api('DELETE', u);

// ---------- formatação ----------
export const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('pt-BR') : '—');
export const fmtDT = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtMB = (b) => (b == null ? '—' : b > 1048576 ? (b / 1048576).toFixed(2).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export const cnpjMask = (c) => String(c || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2}).*/, '$1.$2.$3/$4-$5');
export const cpfMask = (c) => String(c || '').replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2}).*/, '$1.$2.$3-$4');
export const initials = (n) => String(n || '?').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
export const daysFrom = (d) => Math.floor((Date.now() - new Date(d)) / 86400000);
export const roleLabel = { admin: 'Administrador', franqueadora: 'Franqueadora', loja: 'Loja', coordenador: 'Franqueadora', diretoria: 'Franqueadora', rt: 'Responsável técnico', colaborador: 'Loja' };
export const has = (r) => { if (!S.me || !S.me.user) return false; const rs = S.me.user.roles; if (['coordenador', 'diretoria'].includes(r)) return rs.includes('franqueadora'); if (['rt', 'colaborador'].includes(r)) return false; return rs.includes(r); };
export const isStoreUser = () => S.me && S.me.stores && S.me.stores.length > 0 && !has('admin') && !has('franqueadora') && !has('coordenador');

export function statusPill(st, label) {
  const cls = { nao_iniciado: '', rascunho: '', em_preenchimento: 'info', aguardando_conferencia: 'warn', em_conferencia: 'warn', devolvido: 'err', aprovado_coord: 'ok', revisao_tecnica: 'info', liberado_assinatura: 'warn', pronto_protocolo: 'ok', protocolado: 'ok', exigencia: 'err', deferido: 'ok', indeferido: 'err', cancelado: '' }[st] || '';
  return html`<span class="pill ${cls}">${label || (S.cat && S.cat.STATUS[st] ? S.cat.STATUS[st].label : st)}</span>`;
}
export const brandPill = (name, slug) => html`<span class="pill ${slug === 'royal' ? 'royal' : 'av'}">${name}</span>`;
export const bar = (pct, big) => html`<div class="bar ${big ? 'big' : ''}"><i style="width:${Math.max(0, Math.min(100, pct || 0))}%"></i></div>`;
export const itemStatusLabel = { completo: 'Completo', parcial: 'Parcial', erro: 'Com erro', nao_iniciado: 'Não iniciado', pronto: 'Pronto', faltando: 'Faltando', pendente: 'Pendente', opcional: 'Opcional' };

// ---------- toasts e modais ----------
export function toast(msg, type = '') {
  let w = document.querySelector('.toast-wrap');
  if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; w.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6500 : 3500);
}
export function showErr(e) {
  let msg = e.message || String(e);
  const issues = e.data && e.data.issues;
  if (issues && issues.length) msg += ' ' + issues.slice(0, 2).map((i) => i.msg).join(' ');
  toast(msg, 'err');
}
export function modal({ title, body, actions = [], wide, onMount, onClose }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = String(html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><header><h2>${title}</h2><button class="x" aria-label="Fechar">×</button></header><div class="body">${body}</div>${actions.length ? html`<footer>${actions.map((a, i) => html`<button class="btn ${a.cls || ''}" data-i="${i}">${a.label}</button>`)}</footer>` : ''}</div>`);
  const close = () => { bg.remove(); onClose && onClose(); };
  bg.querySelector('.x').onclick = close;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  bg.querySelectorAll('footer button').forEach((b) => (b.onclick = async () => {
    const a = actions[+b.dataset.i];
    if (!a.onClick) return close();
    b.disabled = true;
    try { const r = await a.onClick(bg.querySelector('.modal'), close); if (r !== false) close(); } catch (e) { showErr(e); } finally { b.disabled = false; }
  }));
  const onKey = (e) => { if (e.key === 'Escape' && document.body.contains(bg)) { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  onMount && onMount(bg.querySelector('.modal'), close);
  return { el: bg.querySelector('.modal'), close };
}
export const confirmBox = (title, text, okLabel = 'Confirmar', cls = 'primary') => new Promise((res) => {
  modal({ title, body: html`<p>${text}</p>`, actions: [{ label: 'Cancelar', onClick: () => res(false) }, { label: okLabel, cls, onClick: () => res(true) }], onClose: () => res(false) });
});
export const promptBox = (title, label, { placeholder = '', textarea = false, value = '', okLabel = 'Salvar' } = {}) => new Promise((res) => {
  modal({ title, body: html`<label class="f">${label}</label>${textarea ? html`<textarea id="pb" placeholder="${placeholder}">${value}</textarea>` : html`<input id="pb" placeholder="${placeholder}" value="${value}">`}`,
    actions: [{ label: 'Cancelar', onClick: () => res(null) }, { label: okLabel, cls: 'primary', onClick: (m) => { const v = m.querySelector('#pb').value.trim(); if (!v) { toast('Preencha o campo.', 'err'); return false; } res(v); } }],
    onMount: (m) => setTimeout(() => m.querySelector('#pb').focus(), 50), onClose: () => res(null) });
});

export function lightbox(photo) {
  const d = document.createElement('div'); d.className = 'lightbox';
  d.innerHTML = String(html`<button class="close">×</button><div class="wrap"><img src="${photo.url}" alt="">${annSvg(photo.annotations)}</div><div class="meta">${photo.caption || ''} · ${photo.width}×${photo.height} px · ${fmtMB(photo.size)} · ${photo.source === 'camera' ? 'câmera do sistema' : 'upload'} · ${fmtDT(photo.taken_at)}${photo.lat ? html` · GPS ${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)}` : ''}</div>`);
  d.onclick = (e) => { if (e.target === d || e.target.classList.contains('close')) d.remove(); };
  document.body.appendChild(d);
}
export function annSvg(anns) {
  if (!anns || !anns.length) return '';
  const parts = anns.map((a) => {
    if (a.t === 'rect') return `<rect x="${a.x * 100}" y="${a.y * 100}" width="${a.w * 100}" height="${a.h * 100}" fill="none" stroke="#FFD400" stroke-width="0.8"/>`;
    if (a.t === 'arrow') return `<line x1="${a.x1 * 100}" y1="${a.y1 * 100}" x2="${a.x2 * 100}" y2="${a.y2 * 100}" stroke="#FFD400" stroke-width="0.8" marker-end="url(#ah)"/>`;
    if (a.t === 'text') return `<text x="${a.x * 100}" y="${a.y * 100}" font-size="4.2" fill="#FFD400" stroke="#000" stroke-width="0.25" paint-order="stroke" font-family="sans-serif" font-weight="700">${esc(a.s)}</text>`;
    return '';
  }).join('');
  return raw(`<svg class="ann" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><marker id="ah" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#FFD400"/></marker></defs>${parts}</svg>`);
}

// ---------- formulários ----------
export function readForm(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.disabled && !el.dataset.keep) return;
    let v;
    if (el.type === 'checkbox') { if (el.dataset.multi) { const k = el.name; out[k] = out[k] || []; if (el.checked) out[k].push(el.value); return; } v = el.checked; }
    else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
    else v = el.value;
    setPath(out, el.name, v);
  });
  return out;
}
function setPath(o, p, v) { const ks = p.split('.'); let c = o; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks[ks.length - 1]] = v; }
export function debounce(fn, ms = 700) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const num = (v) => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const fmtN = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));

// ---------- tema da marca ----------
// Tema da marca da loja (Direção Visual Auto Visão v1.0 / Royal v1.0)
export function applyBrand(brand) {
  const b = document.body;
  b.classList.remove('store', 'royal', 'autovisao');
  ['--brand', '--brand-accent', '--brand-bg', '--brand-text', '--font-brand', '--faixa'].forEach((v) => b.style.removeProperty(v));
  if (!brand) return;
  const t = brand.theme || {};
  b.classList.add('store', brand.slug || (t.shape === 'chamfer' ? 'royal' : 'autovisao'));
  b.style.setProperty('--brand', t.primary || '#333');
  b.style.setProperty('--brand-accent', t.accent || '#333');
  b.style.setProperty('--brand-bg', t.bg || '#F4F4F4');
  b.style.setProperty('--brand-text', t.headerText || '#fff');
  if (t.font) b.style.setProperty('--font-brand', `"${t.font}", var(--font)`);
  if (t.faixa) b.style.setProperty('--faixa', `url("${t.faixa}")`);
}
export function brandLogo(brand, onDark = true) {
  const t = (brand && brand.theme) || {};
  if (brand && brand.logo_dark_file && onDark) return html`<img src="/api/brands/${brand.id}/logo" alt="${brand.name}">`;
  const src = onDark ? t.logoDark : t.logoLight;
  return src ? html`<img src="${src}" alt="${brand.name}">` : html`<div class="bname">${t.logoText || brand?.name}<small>${t.logoSub || ''}</small></div>`;
}
export function brandBar(brand, ctx, menu) {
  const t = (brand && brand.theme) || {};
  return html`<div class="brandbar">${menu ? html`<button class="burger" aria-label="Menu" style="color:var(--brand-text);margin-left:-6px">☰</button>` : ''}${brandLogo(brand, true)}<div class="ctx">${ctx || ''}</div></div><div class="pattern ${t.faixa ? 'faixa' : t.pattern || 'grid'}"></div>`;
}

// Logotipo oficial Domma Tecnologia (Design System Domma): versão para fundo escuro e para fundo claro
export const DOMMA = raw('<img class="domma-logo" src="/brand/domma/logo-fundo-escuro.png" alt="Domma Tecnologia">');
export const DOMMA_LIGHT = raw('<img class="domma-logo" src="/brand/domma/logo-fundo-claro.png" alt="Domma Tecnologia">');
