// Administração: marcas, usuários, parâmetros, porte, auditoria, lixeira e sobre.
import { S, html, get, post, put, del, api, toast, showErr, modal, confirmBox, fmtDate, fmtDT, roleLabel, readForm, has, DOMMA, DOMMA_LIGHT } from '../core.js';
import { pickFiles } from '../upload.js';

export async function brands() {
  const list = await get('/api/brands');
  const col = (n, l, v) => html`<div><label class="f">${l}</label><div class="row" style="flex-wrap:nowrap"><input type="color" name="theme.${n}" value="${v || '#000000'}" style="width:48px;padding:2px"><input value="${v || ''}" data-mirror="${n}" class="mono"></div></div>`;
  return {
    title: 'Administração de marcas',
    actions: html`<button class="btn primary" id="nova">+ Nova marca</button>`,
    body: html`<p class="small muted">Os campos e a estrutura dos Anexos II e III são iguais para todas as marcas; só muda a camada visual. Documentos já assinados ficam com a marca da época.</p>
    ${list.map((b) => html`<form class="card" data-b="${b.id}"><div class="row between"><h3 style="margin:0">${b.name}</h3><div class="row"><a class="btn sm" target="_blank" href="/api/brands/${b.id}/preview/a2">Pré-visualizar Anexo II</a><a class="btn sm" target="_blank" href="/api/brands/${b.id}/preview/a3">Pré-visualizar Anexo III</a></div></div>
      <div style="margin:12px 0;border-radius:10px;overflow:hidden;border:1px solid var(--line)"><div style="background:${b.theme.primary};color:${b.theme.headerText};padding:14px 18px;font-weight:800;font-size:20px;${b.theme.upper ? 'text-transform:uppercase' : ''}">${b.logo_dark_file ? html`<img src="/api/brands/${b.id}/logo" style="max-height:34px" alt="">` : b.theme.logoText}<span style="float:right;font-size:11px;letter-spacing:.1em">LAUDO TÉCNICO DE INFRAESTRUTURA</span></div><div class="pattern ${b.theme.pattern}" style="--brand:${b.theme.primary};--brand-accent:${b.theme.accent};--brand-bg:${b.theme.bg}"></div></div>
      <div class="grid g4"><div><label class="f">Nome da marca</label><input name="name" value="${b.name}"></div><div><label class="f">Texto do logo (sem imagem)</label><input name="theme.logoText" value="${b.theme.logoText || ''}"></div><div><label class="f">Prefixo dos códigos</label><input name="theme.codePrefix" value="${b.theme.codePrefix || ''}" maxlength="3"></div>
        <div><label class="f">Fonte de títulos (opcional)</label><input name="theme.font" value="${b.theme.font || ''}" placeholder="Verdana em tudo"></div>
        ${col('primary', 'Cor principal', b.theme.primary)}${col('accent', 'Cor de destaque', b.theme.accent)}${col('bg', 'Fundo de apoio', b.theme.bg)}${col('text', 'Texto e tabelas', b.theme.text)}
        <div><label class="f">Grafismo</label><select name="theme.pattern"><option value="grid" ${b.theme.pattern === 'grid' ? 'selected' : ''}>Faixa quadriculada (grid)</option><option value="angular" ${b.theme.pattern === 'angular' ? 'selected' : ''}>Faixa angular escalonada</option></select></div>
        <div><label class="f">Formas</label><select name="theme.shape"><option value="round" ${b.theme.shape === 'round' ? 'selected' : ''}>Cantos arredondados · número em círculo</option><option value="chamfer" ${b.theme.shape === 'chamfer' ? 'selected' : ''}>Cantos chanfrados · número em quadrado</option></select></div>
        <div><label class="f">Títulos em caixa alta</label><select name="theme.upper"><option value="">Não</option><option value="1" ${b.theme.upper ? 'selected' : ''}>Sim</option></select></div>
        <div><label class="f">Remetente (nome)</label><input name="sender.name" value="${b.sender.name || ''}"></div><div><label class="f">Remetente (e-mail)</label><input name="sender.email" value="${b.sender.email || ''}"></div></div>
      <label class="f" style="margin-top:10px">Texto da página de orientações (opcional)</label><textarea name="orientation_text" placeholder="Texto padrão da página inicial dos PDFs com os links do Drive">${b.orientation_text || ''}</textarea>
      <div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-logo="dark">Logo para fundo escuro (PNG/SVG)</button><button type="button" class="btn sm" data-logo="light">Logo para fundo claro</button><span class="spacer"></span><button class="btn primary">Salvar marca</button></div></form>`)}`,
    mount(root) {
      root.querySelectorAll('[data-mirror]').forEach((m) => { const c = m.parentElement.querySelector('input[type=color]'); c.oninput = () => (m.value = c.value); m.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(m.value)) c.value = m.value; }; });
      root.querySelectorAll('form[data-b]').forEach((f) => {
        f.onsubmit = async (e) => { e.preventDefault(); const v = readForm(f); v.theme.upper = !!v.theme.upper; for (const k of Object.keys(v.theme)) if (k.startsWith('_')) delete v.theme[k]; delete v.theme.mirror; try { await put('/api/brands/' + f.dataset.b, v); toast('Marca salva. Os próximos documentos usam a nova identidade.', 'ok'); S.me = null; import('../app.js').then((m) => m.render()); } catch (er) { showErr(er); } };
        f.querySelectorAll('[data-logo]').forEach((b) => (b.onclick = async () => { const fl = await pickFiles({ accept: 'image/png,image/svg+xml,image/jpeg' }); if (!fl.length) return; const fd = new FormData(); fd.append('variant', b.dataset.logo); fd.append('file', fl[0]); try { await api('POST', `/api/brands/${f.dataset.b}/logo`, fd); toast('Logo enviado.', 'ok'); import('../app.js').then((m) => m.render()); } catch (e) { showErr(e); } }));
      });
      root.parentElement.parentElement.querySelector('#nova').onclick = () => modal({ title: 'Nova marca', body: html`<label class="f">Nome</label><input id="n">`, actions: [{ label: 'Cancelar' }, { label: 'Criar', cls: 'primary', onClick: async (m) => { await post('/api/brands', { name: m.querySelector('#n').value, theme: { primary: '#333333', accent: '#E11D48', bg: '#F4F4F4', text: '#1A1A1A', headerText: '#FFFFFF', pattern: 'grid', shape: 'round', logoText: m.querySelector('#n').value } }); import('../app.js').then((x) => x.render()); } }] });
    },
  };
}

export async function users() {
  const [list, stores] = await Promise.all([get('/api/users'), get('/api/stores')]);
  const ROLES = ['admin', 'franqueadora', 'loja'];
  const form = (u = {}) => html`<form id="uf" class="stack"><div class="grid g3"><div><label class="f">Nome</label><input name="name" value="${u.name || ''}" required></div><div><label class="f">E-mail</label><input name="email" value="${u.email || ''}"></div><div><label class="f">WhatsApp</label><input name="phone" value="${u.phone || ''}"></div></div>
    <div><label class="f">Perfis</label>${ROLES.map((r) => html`<label class="check"><input type="checkbox" name="roles" data-multi="1" value="${r}" ${(u.roles || []).includes(r) ? 'checked' : ''}> ${roleLabel[r]}</label>`)}</div>
    <div><label class="f">Escopo — marcas (franqueadora)</label>${S.me.brands.map((b) => html`<label class="check"><input type="checkbox" name="scope.brands" data-multi="1" value="${b.id}" ${(u.scope?.brands || []).includes(b.id) ? 'checked' : ''}> ${b.name}</label>`)}<div class="hint">Vazio = todas as marcas.</div></div>

    <div><label class="f">Senha (somente Administrador)</label><input name="password" type="password" placeholder="${u.hasPassword ? 'manter a atual' : ''}"></div></form>`;
  const collect = (m) => { const v = readForm(m.querySelector('#uf')); v.scope = { brands: (v.scope?.brands || []).map(Number) }; if (!v.password) delete v.password; return v; };
  return {
    title: 'Usuários',
    actions: html`<button class="btn primary" id="novo">+ Novo usuário</button>`,
    body: html`<div class="row" style="margin-bottom:12px"><input id="q" placeholder="Buscar" style="max-width:300px"><select id="fr" style="max-width:200px"><option value="">Todos os perfis</option>${ROLES.map((r) => html`<option value="${r}">${roleLabel[r]}</option>`)}</select></div>
    <div class="card pad0"><div class="tablewrap"><table class="t resp"><thead><tr><th>Nome</th><th>Perfis</th><th>Escopo / lojas</th><th>Contato</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
    ${list.map((u) => html`<tr data-s="${(u.name + ' ' + (u.email || '')).toLowerCase()}" data-r="${u.roles.join(' ')}"><td data-l="Nome"><b>${u.name}</b></td><td data-l="Perfis">${u.roles.map((r) => html`<span class="pill">${roleLabel[r]}</span> `)}</td>
      <td data-l="Escopo" class="small">${u.stores.map((s) => s.fantasia).join(', ') || (u.scope?.brands?.length ? 'Marcas: ' + u.scope.brands.map((b) => S.me.brands.find((x) => x.id === b)?.name).join(', ') : u.roles.includes('franqueadora') ? 'Todas as marcas' : '—')}</td>
      <td data-l="Contato" class="small">${[u.email, u.phone].filter(Boolean).join(' · ')}</td><td data-l="Último acesso" class="small">${fmtDT(u.last_access_at)}</td><td data-l="Situação">${u.active ? html`<span class="pill ok">ativo</span>` : html`<span class="pill err">inativo</span>`}</td>
      <td class="nowrap"><button class="btn sm" data-ed="${u.id}">Editar</button>${u.link ? html` <button class="btn sm" data-link="${u.link}">Link</button> <button class="btn sm" data-as="${u.id}" title="Agir em nome deste perfil">Entrar como</button>` : ''}</td></tr>`)}
    </tbody></table></div></div>`,
    mount(root) {
      const page = root.parentElement.parentElement;
      const filt = () => { const q = root.querySelector('#q').value.toLowerCase(), r = root.querySelector('#fr').value; root.querySelectorAll('tbody tr').forEach((tr) => (tr.hidden = (q && !tr.dataset.s.includes(q)) || (r && !tr.dataset.r.split(' ').includes(r)))); };
      root.querySelector('#q').oninput = filt; root.querySelector('#fr').onchange = filt;
      page.querySelector('#novo').onclick = () => modal({ title: 'Novo usuário', wide: true, body: form(), actions: [{ label: 'Cancelar' }, { label: 'Criar', cls: 'primary', onClick: async (m) => { const r = await post('/api/users', collect(m)); if (r.link) modal({ title: 'Usuário criado', body: html`<p>Link pessoal de acesso:</p><input readonly value="${r.link}">` }); import('../app.js').then((x) => x.render()); } }] });
      root.querySelectorAll('[data-ed]').forEach((b) => (b.onclick = () => { const u = list.find((x) => x.id === +b.dataset.ed); modal({ title: 'Editar ' + u.name, wide: true, body: form(u), actions: [{ label: u.active ? 'Desativar' : 'Reativar', cls: 'danger', onClick: async () => { await put('/api/users/' + u.id, { active: !u.active }); import('../app.js').then((x) => x.render()); } }, { label: 'Cancelar' }, { label: 'Salvar', cls: 'primary', onClick: async (m) => { await put('/api/users/' + u.id, collect(m)); toast('Usuário salvo.', 'ok'); import('../app.js').then((x) => x.render()); } }] }); }));
      root.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => modal({ title: 'Link pessoal', body: html`<input readonly value="${b.dataset.link}" onclick="this.select()"><p class="small muted">Não encaminhe a terceiros. Use "Revogar" no cadastro da loja para gerar um novo.</p>` })));
      root.querySelectorAll('[data-as]').forEach((b) => (b.onclick = async () => { if (!(await confirmBox('Entrar como este usuário', 'Você vai agir em nome deste perfil neste navegador. A ação fica registrada na auditoria. Para voltar, saia e entre de novo como Administrador.', 'Entrar como'))) return; await post(`/api/users/${b.dataset.as}/act-as`); S.me = null; location.hash = '#/'; location.reload(); }));
    },
  };
}

const PARAM_LABELS = {
  'porte.limitePequeno': 'Pequeno porte até (habitantes)', 'porte.limiteMedio': 'Médio porte até (habitantes)',
  'dimensoes.recepcaoBase': 'Recepção — base (m²)', 'dimensoes.recepcaoPorBox': 'Recepção — acréscimo por box (m²)', 'dimensoes.salaAdm': 'Sala de administração (m²)', 'dimensoes.manobra': 'Área de manobra (m)',
  'calibracao.validadeMeses': 'Validade padrão da calibração (meses)', 'calibracao.alertaDias': 'Alerta de calibração vencendo (dias)',
  'arquivos.fotoMinPx': 'Resolução mínima da foto (px, maior lado)', 'arquivos.gpsRaioM': 'Raio do GPS (m)', 'arquivos.fotoIdadeMaxDias': 'Idade máxima da foto (dias)', 'arquivos.sceLimiteMB': 'Limite do SCE (MB)', 'arquivos.sceAlvoMB': 'Alvo de compressão (MB)', 'arquivos.videoMaxMB': 'Upload de vídeo — tamanho máximo (MB)', 'arquivos.brilhoMin': 'Brilho mínimo (0–255)', 'arquivos.nitidezMin': 'Nitidez mínima',
  'prazos.renovacaoAntecedenciaDias': 'Renovação até X dias antes (art. 36)', 'prazos.renovacaoAutoDias': 'Criar renovação automática X dias antes', 'prazos.lembreteParadoDias': 'Lembrete de laudo parado (dias)', 'prazos.lembreteAssinaturaDias': 'Lembrete de assinatura (dias)',
  'equipamentos.servidorRam': 'Servidor — RAM mínima (GB)', 'equipamentos.servidorDisco': 'Servidor — disco mínimo (TB)', 'equipamentos.nobreakVA': 'Nobreak mínimo (VA)', 'equipamentos.uploadMbps': 'Internet — upload mínimo (Mb/s)',
};
const EQ_NAMES = { elevacao: 'Equipamento de elevação', camera_fixa: 'Câmera fixa', boroscopio: 'Câmera móvel (boroscópio)', smartphone: 'Tablet/smartphone', paquimetro: 'Paquímetro digital', profundimetro: 'Profundímetro digital', trena5: 'Trena de 5 m', trena50: 'Trena de 50 m', engate: 'Verificador de engate', espessura: 'Medidor de espessura de camadas', lanterna_uv: 'Lanterna UV', servidor: 'Computador servidor', nobreak: 'Nobreak', roteador: 'Roteador' };
for (const [k, n] of Object.entries(EQ_NAMES)) PARAM_LABELS['equipamentos.calibracao.' + k] = 'Exige certificado de calibração — ' + n;
function flatten(o, p = '') { const out = {}; for (const [k, v] of Object.entries(o)) { if (k.startsWith('_')) continue; const key = p ? p + '.' + k : k; if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v, key)); else out[key] = v; } return out; }
export async function params() {
  const d = await get('/api/admin/params');
  const flat = flatten(d.current);
  const groups = {};
  for (const [k, v] of Object.entries(flat)) (groups[k.split('.')[0]] = groups[k.split('.')[0]] || []).push([k, v]);
  const gl = { porte: 'Porte', dimensoes: 'Dimensões mínimas', equipamentos: 'Equipamentos', calibracao: 'Calibração', arquivos: 'Arquivos e fotos', prazos: 'Prazos e lembretes' };
  return {
    title: 'Parâmetros das regras',
    body: html`<div class="note" style="margin-bottom:12px">Os valores do motor de validação ficam aqui, nunca no código. Salvar cria uma <b>nova versão</b>: laudos já em andamento continuam na versão em que nasceram. Versão atual: <b>v${d.current._version}</b>.</div>
    <form id="pf">${Object.entries(groups).map(([g, rows]) => html`<div class="card"><h3>${gl[g] || g}</h3><div class="grid g3">${rows.map(([k, v]) => html`<div><label class="f">${PARAM_LABELS[k] || k.split('.').slice(1).join(' › ')}</label>${typeof v === 'boolean' ? html`<select name="${k}" data-t="boolean"><option value="sim" ${v ? 'selected' : ''}>Sim</option><option value="não" ${v ? '' : 'selected'}>Não</option></select>` : html`<input name="${k}" value="${Array.isArray(v) ? v.join(', ') : v}" data-t="${Array.isArray(v) ? 'arr' : typeof v}">`}</div>`)}</div></div>`)}
    <div class="card row"><input id="lab" placeholder="Nome da versão (ex.: Portaria CET-MG nº XXXX/2026)" style="max-width:420px"><button class="btn primary">Salvar como nova versão</button></div></form>
    <div class="card"><h3>Histórico de versões</h3>${d.versions.map((v) => html`<div class="list-item"><b>v${v.version}</b><span style="flex:1">${v.label}</span><span class="small muted">${fmtDT(v.created_at)}</span></div>`)}</div>`,
    mount(root) {
      root.querySelector('#pf').onsubmit = async (e) => {
        e.preventDefault();
        const data = {};
        root.querySelectorAll('#pf [name]').forEach((i) => {
          const t = i.dataset.t; let v = i.value.trim();
          v = t === 'number' ? Number(v.replace(',', '.')) : t === 'boolean' ? /^s|true|1/i.test(v) : t === 'arr' ? v.split(',').map((x) => (isNaN(+x) ? x.trim() : +x)) : v;
          const ks = i.name.split('.'); let c = data; ks.slice(0, -1).forEach((k) => { c[k] = c[k] || {}; c = c[k]; }); c[ks[ks.length - 1]] = v;
        });
        try { const r = await post('/api/admin/params', { data, label: root.querySelector('#lab').value }); toast(`Versão v${r.version} criada.`, 'ok'); S.cat = null; import('../app.js').then((m) => m.render()); } catch (er) { showErr(er); }
      };
    },
  };
}

export async function porte() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const list = await get('/api/admin/municipios?' + q.toString());
  const P = (p) => (p ? S.cat.PORTE_LABEL[p] : '—');
  return {
    title: 'Porte dos municípios',
    body: html`<div class="grid g2" style="margin-bottom:12px"><div class="card"><h3>Lista da CET-MG (oficial)</h3><p class="small muted">Planilha CSV com colunas <code>municipio;porte</code> (ou <code>ibge;porte</code>). Atualize quando a CET publicar nova lista: as lojas afetadas e a franqueadora são avisadas.</p><button class="btn" data-imp="cet">Importar lista da CET-MG</button></div>
      <div class="card"><h3>Tabela IBGE (conferência)</h3><p class="small muted">CSV com <code>ibge;municipio;pop2022;pop2024</code>. Usada para conferir a lista da CET e como reserva. Critério: pequeno até 100 mil, médio até 500 mil, grande acima.</p><button class="btn" data-imp="ibge">Importar tabela IBGE</button></div></div>
    <div class="row" style="margin-bottom:10px"><input id="q" placeholder="Buscar município" value="${q.get('q') || ''}" style="max-width:260px"><div class="seg">${[['', 'Todos (853)'], ['lojas', 'Com lojas'], ['atencao', 'Atenção (perto do limite)'], ['divergente', 'CET × IBGE divergente'], ['override', 'Ajustados']].map(([v, l]) => html`<button data-f="${v}" class="${(q.get('filter') || '') === v ? 'on' : ''}">${l}</button>`)}</div></div>
    <div class="card pad0"><div class="tablewrap"><table class="t resp"><thead><tr><th>Município</th><th>IBGE</th><th>Pop. 2022</th><th>Pop. 2024</th><th>Porte IBGE</th><th>Porte CET</th><th>Ajuste Admin</th><th>Oficial</th><th>Lojas</th><th></th></tr></thead><tbody>
    ${list.slice(0, 400).map((m) => html`<tr><td data-l="Município"><b>${m.name}</b>${m.atencao ? html` <span class="pill warn" title="${m.mudaConformeBase ? 'Muda de porte conforme a base (Censo 2022 × Estimativa 2024)' : 'A menos de 5% do limite'}">atenção</span>` : ''}${m.divergente ? html` <span class="pill err">divergente</span>` : ''}</td><td data-l="IBGE" class="mono">${m.ibge}</td>
      <td data-l="Pop. 2022">${m.pop2022 ? m.pop2022.toLocaleString('pt-BR') : '—'}</td><td data-l="Pop. 2024">${m.pop2024 ? m.pop2024.toLocaleString('pt-BR') : '—'}</td><td data-l="IBGE">${P(m.porte_ibge)}</td><td data-l="CET">${P(m.porte_cet)}</td><td data-l="Ajuste">${m.porte_override ? html`<span title="${m.override_reason}">${P(m.porte_override)}</span>` : '—'}</td><td data-l="Oficial"><b>${P(m.porte_oficial || 'pequeno')}</b></td><td data-l="Lojas">${m.stores || ''}</td>
      <td><button class="btn sm" data-ov="${m.ibge}" data-n="${m.name}" data-p="${m.porte_override || ''}">Alterar</button></td></tr>`)}
    </tbody></table></div>${list.length > 400 ? html`<p class="small muted" style="padding:10px">Mostrando 400 de ${list.length}. Use a busca.</p>` : ''}</div>
    <p class="small muted">Atenção ao nome: o "porte" da Receita Federal (ME, EPP) é o da empresa e não tem relação com o porte do município. Populações da demonstração são aproximadas: importe a tabela oficial do IBGE e a lista da CET-MG.</p>`,
    mount(root) {
      const set = (k, v) => { const p = new URLSearchParams(location.hash.split('?')[1] || ''); if (v) p.set(k, v); else p.delete(k); location.hash = '#/admin/porte?' + p; };
      root.querySelector('#q').onchange = (e) => set('q', e.target.value);
      root.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => set('filter', b.dataset.f)));
      root.querySelectorAll('[data-ov]').forEach((b) => (b.onclick = () => modal({ title: 'Alterar porte de ' + b.dataset.n, body: html`<p class="small">Vale para todas as lojas do município, nos laudos novos. Laudos já assinados não mudam. Laudos em andamento têm as regras reaplicadas e as lojas são avisadas.</p><select id="p"><option value="">Sem ajuste (usar CET/IBGE)</option>${['pequeno', 'medio', 'grande'].map((p) => html`<option value="${p}" ${b.dataset.p === p ? 'selected' : ''}>${S.cat.PORTE_LABEL[p]}</option>`)}</select><label class="f" style="margin-top:8px">Justificativa *</label><textarea id="j"></textarea>`,
        actions: [{ label: 'Cancelar' }, { label: 'Salvar', cls: 'primary', onClick: async (m) => { await put('/api/admin/municipios/' + b.dataset.ov, { porte: m.querySelector('#p').value, reason: m.querySelector('#j').value }); toast('Porte alterado.', 'ok'); import('../app.js').then((x) => x.render()); } }] })));
      root.querySelectorAll('[data-imp]').forEach((b) => (b.onclick = async () => { const f = await pickFiles({ accept: '.csv,text/csv' }); if (!f.length) return; try { const r = await post('/api/admin/municipios/import', { kind: b.dataset.imp, csv: await f[0].text() }); modal({ title: 'Importação concluída', body: html`<p>${r.ok} linha(s) importada(s); ${r.changed || 0} município(s) mudaram de porte.</p>${r.errors.slice(0, 20).map((e) => html`<div class="issue B">${e}</div>`)}` }); } catch (e) { showErr(e); } }));
    },
  };
}

export async function audit() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = await get('/api/admin/audit?' + q.toString());
  return {
    title: 'Auditoria e logs',
    body: html`<form id="af" class="card"><div class="grid g4"><div><label class="f">De</label><input type="date" name="from" value="${q.get('from') || ''}"></div><div><label class="f">Até</label><input type="date" name="to" value="${q.get('to') || ''}"></div><div><label class="f">Usuário</label><input name="user" value="${q.get('user') || ''}"></div><div><label class="f">Ação</label><input name="action" value="${q.get('action') || ''}" placeholder="ex.: foto, conferencia, acesso"></div>
      <div><label class="f">Perfil</label><select name="role"><option value="">Todos</option>${Object.entries(roleLabel).map(([k, l]) => html`<option value="${k}" ${q.get('role') === k ? 'selected' : ''}>${l}</option>`)}</select></div><div><label class="f">Loja (id)</label><input name="store" value="${q.get('store') || ''}"></div><div><label class="f">Laudo (id)</label><input name="laudo" value="${q.get('laudo') || ''}"></div>
      <div style="align-self:end" class="row"><button class="btn primary">Filtrar</button><a class="btn" href="/api/admin/audit?${q.toString()}&format=csv">Exportar (Excel)</a></div></div></form>
    ${d.security.length ? html`<div class="card"><h3>Alertas de segurança</h3>${d.security.map((s) => html`<div class="issue A">${fmtDT(s.at)} · ${s.user_name}: ${JSON.parse(s.after || '{}').motivo} <a href="#/admin/usuarios">revogar link</a></div>`)}</div>` : ''}
    <div class="note small" style="margin-bottom:10px">Registros imutáveis: ninguém pode editar ou apagar, nem o Administrador. Esta consulta também foi registrada. CPFs mascarados.</div>
    <div class="card pad0"><div class="tablewrap"><table class="t"><thead><tr><th>Data e hora</th><th>Quem</th><th>Perfil · acesso</th><th>Ação</th><th>Onde</th><th>Antes → depois</th><th>Aparelho · IP</th></tr></thead><tbody>
    ${d.rows.map((r) => html`<tr><td class="nowrap small">${fmtDT(r.at)}</td><td>${r.user_name || 'sistema'}</td><td class="small">${roleLabel[r.role] || r.role || ''} · ${r.via || ''}</td><td><span class="pill">${r.action}</span></td><td class="small">${[r.entity && `${r.entity} ${r.entity_id || ''}`, r.store_id && 'loja ' + r.store_id, r.laudo_id && 'laudo ' + r.laudo_id, r.item].filter(Boolean).join(' · ')}</td>
      <td class="small mono" style="max-width:360px;word-break:break-all">${r.before ? html`<del style="color:var(--err)">${String(r.before).slice(0, 140)}</del><br>` : ''}${String(r.after || '').slice(0, 220)}</td><td class="small muted" style="max-width:180px">${String(r.ua || '').slice(0, 60)} · ${r.ip || ''}</td></tr>`)}
    </tbody></table></div></div>`,
    mount(root) { root.querySelector('#af').onsubmit = (e) => { e.preventDefault(); const p = new URLSearchParams(); for (const [k, v] of Object.entries(readForm(e.target))) if (v) p.set(k, v); location.hash = '#/admin/auditoria?' + p; }; },
  };
}

export async function trash() {
  const list = await get('/api/admin/trash');
  return {
    title: 'Lixeira',
    body: html`<p class="small muted">Tudo o que é apagado fica aqui por 90 dias e pode ser restaurado. Depois disso é excluído de vez, exceto laudos assinados e protocolados, que ficam arquivados.</p>
    <div class="card pad0">${list.length ? list.map((t) => html`<div class="list-item"><span class="pill">${t.entity}</span><div style="flex:1"><div class="t1">${t.label}</div><div class="t2">apagado por ${t.deleted_by_name || '—'} em ${fmtDT(t.deleted_at)} · exclusão definitiva em ${fmtDate(new Date(new Date(t.deleted_at).getTime() + 90 * 86400000).toISOString())}</div></div><button class="btn sm" data-r="${t.id}">Restaurar</button></div>`) : html`<div class="empty-state">Lixeira vazia.</div>`}</div>`,
    mount(root) { root.querySelectorAll('[data-r]').forEach((b) => (b.onclick = async () => { try { await post(`/api/admin/trash/${b.dataset.r}/restore`); toast('Restaurado.', 'ok'); import('../app.js').then((m) => m.render()); } catch (e) { showErr(e); } })); },
  };
}

export function about() {
  return {
    title: 'Sobre o sistema', narrow: true,
    body: html`<div class="card"><h2>Projeto Técnico DETRAN MG</h2><p>Versão 2.1 · sistema web (navegador), sem app de loja. No celular, use "Adicionar à tela inicial" para criar um atalho.</p>
      <p>Montagem do Laudo Técnico de Infraestrutura (Anexo II) e da Declaração de Requisitos de Equipamentos (Anexo III) para as ECVs das redes Auto Visão e Royal em Minas Gerais, conforme a Portaria CET-MG nº 01524/2025 (altera a Portaria CET-MG nº 1.290/2023).</p>
      <hr><p class="small muted">Desenvolvido por</p><p><img class="domma-logo lg" src="/brand/domma/logo-fundo-claro.png" alt="Domma Tecnologia"></p><p class="small">Suporte: suporte@domma.com.br</p></div>`,
  };
}
