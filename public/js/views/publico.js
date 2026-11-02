// Telas de acesso e página pública de consulta.
import { S, html, get, post, api, toast, showErr, fmtDate, fmtDT, fmtMB, cnpjMask, applyBrand, brandBar, DOMMA, esc } from '../core.js';

const authShell = (right) => html`<div class="auth">
  <div class="l"><div style="display:flex;align-items:center;gap:10px;font-weight:700"><i style="width:22px;height:22px;border-radius:6px;background:var(--yellow);display:inline-block"></i>Laudo ECV</div>
    <h1>Sistema de Laudo Técnico ECV</h1><p>Montagem do Laudo Técnico de Infraestrutura (Anexo II) e da Declaração de Equipamentos (Anexo III) — Portaria CET-MG nº 01524/2025.</p>
    <div class="brands">${(S.me?.brands || []).map((b) => html`<span style="color:${b.theme.accent}">${b.name}</span>`)}</div>
    <div class="dev">Desenvolvido por<b>${DOMMA} Domma Tecnologia</b></div></div>
  <div class="r">${right}</div></div>`;

export function adminLogin() {
  if (S.me && S.me.user) { location.hash = '#/'; return { redirect: true }; }
  return { title: 'Entrar', body: authShell(html`<div class="card" id="box">
      <h2>Acesso do Administrador</h2>
      <p class="muted small">O sistema é interno: só o Administrador usa senha. Franqueados, equipe, coordenadores e engenheiros entram pelo link pessoal recebido.</p>
      <form id="f1" class="stack"><div><label class="f">E-mail</label><input name="email" type="email" autocomplete="username" required></div>
      <div><label class="f">Senha</label><input name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn primary block lg">Entrar</button></form>
      <hr><a href="#/pedir-link">Perdi meu link de acesso</a></div>`),
    mount(root) {
      const f1 = root.querySelector('#f1');
      f1.onsubmit = async (e) => {
        e.preventDefault();
        try {
          await post('/api/auth/admin-login', { email: f1.email.value, password: f1.password.value });
          S.me = null; location.hash = '#/';
        } catch (er) { showErr(er); }
      };
    } };
}

export function requestLink() {
  return { title: 'Pedir novo link', body: html`<div style="min-height:100vh;display:flex;align-items:center;padding:16px"><div class="card mobile-card" style="width:100%">
    <h2>Pedir novo link de acesso</h2>
    <p class="muted">Informe o CNPJ da loja ou o seu WhatsApp. Enviamos um novo link apenas para os contatos <b>já cadastrados</b>.</p>
    <form id="f" class="stack"><input name="q" placeholder="CNPJ ou WhatsApp com DDD" required inputmode="numeric"><button class="btn primary block lg">Enviar link</button></form>
    <div id="msg"></div><hr><a href="#/login" class="small">Sou administrador</a>
    <div class="small muted" style="margin-top:24px">Desenvolvido por ${DOMMA} <b>Domma Tecnologia</b></div></div></div>`,
    mount(root) {
      root.querySelector('#f').onsubmit = async (e) => {
        e.preventDefault();
        try { const r = await post('/api/auth/request-link', { cnpjOrPhone: e.target.q.value }); root.querySelector('#msg').innerHTML = String(html`<div class="note ok" style="margin-top:12px">${r.msg}</div>`); } catch (er) { showErr(er); }
      };
    } };
}
export const invalidLink = () => ({ title: 'Link inválido', body: html`<div style="min-height:100vh;display:flex;align-items:center;padding:16px"><div class="card mobile-card"><h2>Este link não é mais válido</h2><p>O link pode ter sido revogado ou substituído por um novo. Peça um novo link: ele será enviado ao WhatsApp ou e-mail já cadastrados.</p><a class="btn primary block" href="#/pedir-link">Pedir novo link</a></div></div>` });
export const expired = () => ({ title: 'Acesso', body: html`<div style="min-height:100vh;display:flex;align-items:center;padding:16px"><div class="card mobile-card"><h2>Acesso expirado neste aparelho</h2><p>Abra novamente o seu link pessoal (WhatsApp ou e-mail) para continuar de onde parou.</p><a class="btn primary block" href="#/pedir-link">Não tenho o link</a><p class="small"><a href="#/login">Sou administrador</a></p></div></div>` });

export async function firstAccess() {
  if (!S.me.user) { location.hash = '#/login'; return { redirect: true }; }
  const laudos = await get('/api/my/laudos').catch(() => []);
  const store = S.me.stores[0];
  const brand = store ? S.me.brands.find((b) => b.id === store.brand_id) : null;
  const l = laudos.find((x) => !['deferido', 'indeferido', 'cancelado'].includes(x.status));
  const u = S.me.user;
  return { bare: true, brand, title: 'Primeiro acesso', body: html`
    ${brand ? brandBar(brand, 'Primeiro acesso') : ''}
    <div class="content narrow" style="margin:0 auto">
      <div class="card">
        <h2>Olá, ${u.name.split(' ')[0]}!</h2>
        <p>Você entrou pelo seu <b>link pessoal</b>. Não há senha: este link é a sua chave de acesso, por isso <b>não o encaminhe</b>. Neste aparelho você continuará conectado.</p>
        <div class="grid g2" style="margin:12px 0">
          <div><label class="f">Nome</label><input value="${u.name}" readonly></div>
          <div><label class="f">Contato cadastrado</label><input value="${[u.phone, u.email].filter(Boolean).join(' · ')}" readonly></div>
          ${store ? html`<div><label class="f">Unidade</label><input value="${store.fantasia}" readonly></div>` : ''}
          ${l ? html`<div><label class="f">Pedido da franqueadora</label><input value="${S.cat.PROCESS_TYPES[l.process_type]}${l.deadline ? ' · prazo ' + fmtDate(l.deadline) : ''}" readonly></div>` : ''}
        </div>
        <div class="note brand">Termos de uso e privacidade (LGPD): os dados pessoais (nome, CPF, contato, fotos da unidade) são tratados para montar e protocolar o laudo junto à CET-MG, com registro de acesso e histórico. Você pode pedir a exportação ou exclusão dos seus dados ao Administrador.</div>
        <label class="check" style="margin:14px 0"><input type="checkbox" id="ok"> Li e aceito os termos de uso e a política de privacidade.</label>
        <button class="btn brand block lg" id="go" disabled>Entrar</button>
        <p class="small muted" style="margin-top:12px">Os dados estão errados? Fale com a franqueadora.</p>
      </div>
      <p class="small muted center">Desenvolvido por ${DOMMA} <b>Domma Tecnologia</b></p>
    </div>`,
    mount(root) {
      const ok = root.querySelector('#ok'), b = root.querySelector('#go');
      ok.onchange = () => (b.disabled = !ok.checked);
      b.onclick = async () => { await post('/api/me/accept-terms'); S.me = null; location.hash = '#/'; };
    } };
}

// ---------- Página pública de consulta (B.26) ----------
export async function consulta(app, code, pw) {
  let d;
  try { d = await api('GET', `/api/public/${encodeURIComponent(code)}${pw ? '?pw=' + encodeURIComponent(pw) : ''}`); }
  catch (e) {
    if (e.status === 401) {
      app.innerHTML = String(html`<div style="min-height:100vh;display:flex;align-items:center;padding:16px"><div class="card mobile-card" style="width:100%"><h2>Consulta protegida</h2><p class="muted">Informe a senha de acesso deste link.</p><form id="f" class="stack"><input type="password" name="pw" required><button class="btn primary block">Abrir</button></form></div></div>`);
      app.querySelector('#f').onsubmit = (ev) => { ev.preventDefault(); consulta(app, code, ev.target.pw.value); };
      return;
    }
    app.innerHTML = String(html`<div style="min-height:100vh;display:flex;align-items:center;padding:16px"><div class="card mobile-card"><h2>Link de consulta indisponível</h2><p>${e.message}</p></div></div>`);
    return;
  }
  applyBrand({ ...d.brand, slug: d.brand.theme.pattern === 'angular' ? 'royal' : 'autovisao' });
  document.title = `Consulta ${d.code}`;
  const sig = (k, label) => { const x = d.docs[k]; if (!x) return ''; return html`<div class="list-item"><div style="flex:1"><div class="t1">${label}</div><div class="t2">${x.signed ? (x.signed.invalidated ? 'Assinatura invalidada (laudo reaberto)' : `Assinado por ${x.signed.signer || '—'} · ${x.signed.method === 'firma' ? 'firma reconhecida' : 'gov.br'} · ${fmtDT(x.signed.at)}`) : 'Aguardando assinatura'} · SHA-256 ${x.sha.slice(0, 16)}…</div></div>
    ${x.signed ? html`<a class="btn sm" href="${x.signed.url}" target="_blank">PDF assinado</a>` : html`<a class="btn sm" href="${x.url}" target="_blank">PDF gerado</a>`}</div>`; };
  app.innerHTML = String(html`${brandBar(d.brand, 'Consulta do laudo')}
  <div class="content narrow" style="margin:0 auto">
    <div class="note ${d.current ? 'ok' : 'warn'}"><b>${d.current ? '✓ Versão vigente' : 'Versão substituída'}</b> · ${d.code} · gerada em ${fmtDT(d.created_at)}${d.current ? '' : html` — a versão vigente é <a href="/c/${d.currentCode}">${d.currentCode}</a>`}</div>
    <div class="card" style="margin-top:12px"><h3>${d.store.fantasia}</h3>
      <table class="t"><tbody>
        <tr><td class="muted">Razão social</td><td>${d.store.razao}</td></tr><tr><td class="muted">CNPJ</td><td>${cnpjMask(d.store.cnpj)}</td></tr>
        <tr><td class="muted">Município · porte</td><td>${d.store.municipio} · ${d.store.porte || '—'}</td></tr><tr><td class="muted">Processo</td><td>${d.laudo.process} · situação: ${d.laudo.status}</td></tr>
        <tr><td class="muted">Representante legal</td><td>${d.rep.name} · CPF ${d.rep.cpf}</td></tr>${d.rt ? html`<tr><td class="muted">Responsável técnico</td><td>${d.rt.name} · ${d.rt.council} ${d.rt.reg} · CPF ${d.rt.cpf}</td></tr>` : ''}
      </tbody></table></div>
    <div class="card"><h3>Documentos e assinaturas</h3>${!Object.keys(d.docs).length ? html`<p class="small muted">Esta versão registra o conteúdo enviado (${d.reason}). Os PDFs finais são gerados na liberação para assinatura.</p>` : ''}${sig('a2', 'Anexo II — Laudo Técnico de Infraestrutura')}${sig('a3', 'Anexo III — Declaração de Requisitos de Equipamentos')}
      <hr><form id="vf" class="row"><span class="small muted">Conferir autenticidade de um PDF:</span><input type="file" name="file" accept="application/pdf" style="max-width:260px"><button class="btn sm">Conferir</button></form><div id="vr"></div></div>
    ${d.videos.length ? html`<div class="card"><h3>Vídeos (Google Drive)</h3>${d.videos.map((v) => html`<div class="list-item"><div style="flex:1">${v.label}</div><a class="btn sm" href="${v.url}" target="_blank" rel="noopener">Abrir vídeo</a></div>`)}</div>` : ''}
    ${d.attachments.length ? html`<div class="card"><h3>Anexos</h3>${d.attachments.map((a) => html`<div class="list-item"><div style="flex:1">${a.name}</div><a class="btn sm" href="${a.url}" target="_blank">Abrir</a></div>`)}</div>` : ''}
    <div class="card"><h3>Fotos originais em alta resolução (${d.photos.length})</h3><div class="photos">${d.photos.map((p) => html`<a class="ph" href="${p.url}" target="_blank"><img loading="lazy" src="${p.url}${p.url.includes('?') ? '&' : '?'}v=small" alt=""><div class="cap">${p.caption}</div></a>`)}</div></div>
    <p class="small muted center">CPFs e dados pessoais mascarados (LGPD). Cada abertura desta página é registrada.<br>Desenvolvido por ${DOMMA} <b>Domma Tecnologia</b></p>
  </div>`);
  app.querySelector('#vf').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { const r = await api('POST', `/api/public/${encodeURIComponent(code)}/verify${pw ? '?pw=' + encodeURIComponent(pw) : ''}`, fd); app.querySelector('#vr').innerHTML = String(html`<div class="note ${r.authentic ? 'ok' : 'err'}" style="margin-top:8px">${r.authentic ? `Autêntico: o arquivo confere com o ${r.doc === 'a2' ? 'Anexo II' : 'Anexo III'} registrado nesta versão.` : 'Não confere: este arquivo não corresponde aos documentos registrados nesta versão.'}</div>`); } catch (er) { showErr(er); }
  };
}
