// Área da loja (franqueado): etapa 1, checklist, itens com fotos, equipamentos, envio, assinatura e versões.
import { S, html, raw, get, post, put, del, api, toast, showErr, modal, confirmBox, promptBox, lightbox, annSvg, fmtDate, fmtDT, fmtMB, cnpjMask, cpfMask, statusPill, bar, has, readForm, debounce, num, fmtN, itemStatusLabel, esc } from '../core.js';
import { uploadPhoto, openCamera, pickFiles, queued, getPosition } from '../upload.js';

// ---------- carregamento do laudo e contexto ----------
async function load(id) { const d = await get('/api/laudos/' + id); S.laudo = d; return d; }
const ctxOf = (d) => ({ laudoId: d.laudo.id, brand: d.store.brand, storeName: d.store.fantasia, storeMode: !!d.perms.storeRole || d.perms.admin || has('franqueadora') });
const issuesOf = (d, item, stage = 'submit') => d.issues.filter((i) => i.item === item && i.stage === stage);
const issueList = (list) => list.map((i) => html`<div class="issue ${i.type}"><span class="code">${i.code}</span><span>${i.msg}</span></div>`);
const locked = (d, k) => !d.perms.editItems[k];
const ITEMS = () => [...S.cat.A2.map((i) => ({ ...i, annex: 'II' })), ...S.cat.A3.map((i) => ({ ...i, annex: 'III' }))];
const ITEM = (k) => ITEMS().find((i) => i.key === k);
const reviewPill = (rv) => !rv ? '' : rv.status === 'aprovado' ? html`<span class="pill ok">Aprovado</span>` : rv.status === 'devolvido' ? html`<span class="pill err">Devolvido</span>` : rv.status === 'corrigido' ? html`<span class="pill info">Corrigido</span>` : '';
const sim = (v) => v === 'sim' || v === true;

function statusBanner(d) {
  const l = d.laudo;
  const msgs = {
    nao_iniciado: ['info', 'Comece pela Etapa 1: confira os dados e informe os boxes. O checklist é montado na hora.'],
    rascunho: ['info', 'Confira os dados da Etapa 1 e salve para liberar o checklist.'],
    aguardando_conferencia: ['warn', 'Enviado para validação. A franqueadora vai analisar item a item; se algo for devolvido, aparece aqui na sua área.'],
    em_conferencia: ['warn', 'A franqueadora está validando o laudo.'],
    devolvido: ['err', 'Devolvido com pendências: só os itens devolvidos estão abertos para correção. Os aprovados continuam travados.'],
    aprovado_coord: ['ok', 'Aprovado pela franqueadora. Segue para a revisão técnica.'],
    revisao_tecnica: ['info', 'Em revisão técnica pela franqueadora (descrição, acessibilidade e ART/RRT).'],
    liberado_assinatura: ['ok', 'Laudo 100% validado! Os documentos estão liberados para assinatura gov.br.'],
    pronto_protocolo: ['ok', 'Documentos assinados. Protocole no SCE e registre o número aqui.'],
    protocolado: ['ok', 'Protocolado no SCE. Registre a exigência ou o resultado quando receber.'],
    exigencia: ['err', 'Exigência da CET-MG: os itens afetados foram reabertos.'],
    deferido: ['ok', 'Deferido!'], indeferido: ['err', 'Indeferido.'], cancelado: ['', 'Pedido cancelado: ' + (l.cancel_reason || '')],
  };
  const m = msgs[l.status];
  return m ? html`<div class="note ${m[0]}" style="margin-bottom:14px">${statusPill(l.status, l.statusLabel)} ${m[1]}</div>` : '';
}

// ---------- seleção de loja ----------
export async function storePicker() {
  const laudos = await get('/api/my/laudos');
  const stores = S.me.stores;
  const active = (sid) => laudos.find((l) => l.store.id === sid && !['deferido', 'indeferido', 'cancelado'].includes(l.status)) || laudos.find((l) => l.store.id === sid);
  if (stores.length === 1 && active(stores[0].id)) return go('/laudo/' + active(stores[0].id).id);
  return {
    title: 'Minhas lojas', narrow: true,
    body: html`<div class="card pad0">${stores.map((s) => { const l = active(s.id); return html`<a class="irow" href="${l ? '#/laudo/' + l.id : '#/loja'}"><div class="ic">${s.fantasia[0]}</div><div class="tx"><b>${s.fantasia}</b><span>${l ? html`${l.code} · ${l.statusLabel} · ${l.progress}%` : 'Nenhum laudo solicitado pela franqueadora ainda.'}</span></div></a>`; })}</div>`,
  };
}
const go = (p) => { location.hash = '#' + p; return { redirect: true }; };

// ---------- início (B.10) ----------
export async function home(id) {
  const d = await load(id);
  if (d.laudo.status === 'nao_iniciado' && d.perms.storeRole) post(`/api/laudos/${id}/open`).catch(() => {});
  const st = d.statuses;
  const cont = Object.entries(st).filter(([, s]) => s.status !== 'completo').sort((a, b) => ({ erro: 0, parcial: 1, nao_iniciado: 2 }[a[1].status] - { erro: 0, parcial: 1, nao_iniciado: 2 }[b[1].status]));
  const pend = await queued((x) => x.url.includes(`/laudos/${id}/`));
  const steps = [['Dados', !!d.data.etapa1?.savedAt], ['Fotos e equipamentos', d.progress >= 90], ['Validação', ['aprovado_coord', 'revisao_tecnica', 'liberado_assinatura', 'pronto_protocolo', 'protocolado', 'deferido'].includes(d.laudo.status)], ['Revisão técnica', ['liberado_assinatura', 'pronto_protocolo', 'protocolado', 'deferido'].includes(d.laudo.status)], ['Assinatura', ['pronto_protocolo', 'protocolado', 'deferido'].includes(d.laudo.status)], ['Protocolo', ['protocolado', 'deferido'].includes(d.laudo.status)]];
  const lastSave = d.photos.map((p) => p.created_at).concat([d.data.etapa1?.savedAt]).filter(Boolean).sort().pop();
  return {
    title: 'Início', ctx: ctxOf(d),
    body: html`${statusBanner(d)}
    <div class="card"><div class="row between"><div><h2 style="margin:0">${d.store.fantasia}</h2><div class="small muted">${S.cat.PROCESS_TYPES[d.laudo.process_type]} · laudo ${d.laudo.code}${d.laudo.deadline ? ' · prazo ' + fmtDate(d.laudo.deadline) : ''}</div></div>
      <div style="min-width:200px;flex:1;max-width:320px"><div class="row between small"><b>${d.progress}% concluído</b><span class="muted">${lastSave ? 'salvo ' + fmtDT(lastSave) : ''}</span></div>${bar(d.progress, true)}</div></div>
      <div class="stepper" style="margin-top:12px">${steps.map(([l, ok], i) => html`<span class="${ok ? 'done' : steps.findIndex((s) => !s[1]) === i ? 'on' : ''}">${ok ? '✓ ' : ''}${l}</span>`)}</div>
      ${pend.length ? html`<div class="note warn">${pend.length} foto(s) aguardando envio neste aparelho. Mantenha a página aberta até subirem.</div>` : ''}
      <div class="row" style="margin-top:6px">
        ${!d.data.etapa1?.savedAt ? html`<a class="btn brand lg" href="#/laudo/${id}/dados">Começar: dados do processo</a>` : html`<a class="btn brand" href="#/laudo/${id}/checklist">Ver checklist</a>`}
        <a class="btn" href="/api/laudos/${id}/checklist.pdf" target="_blank">Checklist em PDF</a></div></div>
    ${d.data.etapa1?.savedAt ? html`<div class="card pad0"><div style="padding:14px 16px 4px"><h3>Continue de onde parou</h3></div>
      ${cont.length ? cont.slice(0, 12).map(([k, s]) => { const it = ITEM(k); return html`<a class="irow ${locked(d, k) ? 'locked' : ''}" href="#/laudo/${id}/item/${k}"><div class="ic ${s.status}">${s.status === 'erro' ? '!' : s.status === 'parcial' ? '◐' : it.n}</div><div class="tx"><b>Anexo ${it.annex} · ${it.n}. ${it.title}</b><span>${itemStatusLabel[s.status]}${s.photosReq ? ` · ${s.photosDone} de ${s.photosReq} fotos` : ''}${s.errors ? ` · ${s.errors} erro(s)` : ''}</span></div>${reviewPill(s.review)}<span class="muted">›</span></a>`; })
        : html`<div class="empty-state">Tudo preenchido! <a href="#/laudo/${id}/envio">Revise e envie para validação</a>.</div>`}</div>` : ''}
    ${d.laudo.status === 'devolvido' || d.laudo.status === 'exigencia' ? devolvidos(d) : ''}`,
  };
}
function devolvidos(d) {
  const dev = Object.entries(d.reviews).filter(([, r]) => r.status === 'devolvido');
  if (!dev.length) return '';
  return html`<div class="card"><h3>Itens para corrigir (${dev.length})</h3>${dev.map(([k, r]) => { const it = ITEM(k); return html`<a class="irow" href="#/laudo/${d.laudo.id}/item/${k}"><div class="ic erro">!</div><div class="tx"><b>${it.annex} · ${it.n}. ${it.title}</b><span class="e">${r.reason}${r.comment ? ' — ' + r.comment : ''}</span><span>${r.stage === 'cet' ? 'Exigência da CET-MG' : 'Devolvido pela franqueadora'} · ${fmtDT(r.at)}</span></div><span class="btn sm">Corrigir</span></a>`; })}
    <a class="btn brand" href="#/laudo/${d.laudo.id}/envio" style="margin-top:10px">Reenviar para validação</a></div>`;
}

// ---------- Etapa 1 (B.12) ----------
export async function etapa1(id) {
  const d = await load(id);
  const e1 = d.data.etapa1 || {}, em = { ...d.data.empresa };
  const s = d.store;
  const emp = { fantasia: em.fantasia ?? s.fantasia, razao: em.razao ?? s.razao, endereco: em.endereco ?? s.address, cep: em.cep ?? s.cep, repName: em.repName ?? s.rep_name, repCpf: em.repCpf ?? s.rep_cpf, repRole: em.repRole ?? s.rep_role, contactEmail: em.contactEmail ?? s.contact_email, contactPhone: em.contactPhone ?? s.contact_phone };
  const P = d.params, porte = d.porte;
  const [mn, mx] = porte ? P.porte.boxesLeves[porte] : [2, 16];
  const ro = !d.perms.editGeneral;
  const muns = await get('/api/municipios?limit=900');
  const qsa = s.cnpj_data?.qsa || [];
  return {
    title: 'Dados do processo e da empresa', ctx: ctxOf(d),
    body: html`${statusBanner(d)}<form id="f" class="split"><div>
      <div class="card"><h3>Processo</h3><div class="grid g3">
        <div><label class="f">Tipo de processo</label><input value="${S.cat.PROCESS_TYPES[d.laudo.process_type]} 🔒" readonly></div>
        <div><label class="f">Município</label><select name="empresa.municipio_ibge" ${ro ? 'disabled' : ''}>${muns.map((m) => html`<option value="${m.ibge}" ${m.ibge === s.municipio_ibge ? 'selected' : ''}>${m.name}</option>`)}</select></div>
        <div><label class="f">Porte (lista da CET-MG)</label><input value="${porte ? S.cat.PORTE_LABEL[porte] + ' porte 🔒' : '—'}" readonly title="${d.porteSource || ''}"></div>
        <div><label class="f">Boxes de veículos leves *</label><input name="etapa1.boxesLeves" type="number" min="0" value="${e1.boxesLeves ?? ''}" ${ro ? 'disabled' : ''}><div class="hint">entre ${mn} e ${mx} (${porte ? S.cat.PORTE_LABEL[porte].toLowerCase() : ''} porte)</div></div>
        <div><label class="f">Faz vistoria de pesados?</label><select name="etapa1.pesados" ${ro ? 'disabled' : ''}><option value="">Não</option><option value="1" ${e1.pesados ? 'selected' : ''}>Sim</option></select></div>
        <div><label class="f">Boxes de pesados</label><input name="etapa1.boxesPesados" type="number" min="0" value="${e1.boxesPesados || ''}" ${ro ? 'disabled' : ''}><div class="hint">até ${porte ? P.porte.boxesPesados[porte] : '?'}</div></div>
        <div><label class="f">Faz vistoria móvel?</label><select name="etapa1.movel" ${ro ? 'disabled' : ''}><option value="1" ${e1.movel !== false ? 'selected' : ''}>Sim (+1 equipamento)</option><option value="" ${e1.movel === false ? 'selected' : ''}>Não</option></select></div>
        <div><label class="f">Data prevista do pedido *</label><input type="date" name="etapa1.dataPedido" value="${e1.dataPedido || ''}" ${ro ? 'disabled' : ''}><div class="hint">Define o ano exigido da ART/RRT.</div></div>
        ${d.laudo.process_type === 'renovacao' ? html`<div><label class="f">Vencimento do credenciamento atual *</label><input type="date" name="etapa1.vencimentoAtual" value="${e1.vencimentoAtual || s.cred_expiry || ''}" ${ro ? 'disabled' : ''}></div>` : ''}
      </div>
      <label class="f" style="margin-top:12px">Equipamento de elevação utilizado</label>
      <div>${Object.entries(S.cat.ELEVACAO).map(([k, l]) => html`<label class="check"><input type="checkbox" name="etapa1.elevacao" data-multi="1" value="${k}" ${(e1.elevacao || []).includes(k) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${l}</label>`)}</div></div>
      <div class="card"><h3>Empresa ${s.cnpj_checked_at ? html`<span class="pill ok" style="margin-left:auto">✓ carregado pelo CNPJ em ${fmtDate(s.cnpj_checked_at)}</span>` : ''}</h3>
        ${s.situacao_cadastral && s.situacao_cadastral !== 'ATIVA' ? html`<div class="note err">Situação cadastral do CNPJ: ${s.situacao_cadastral}. O laudo fica bloqueado até a regularização (R26).</div>` : ''}
        <div class="grid g2">
          <div><label class="f">Razão social</label><input name="empresa.razao" value="${emp.razao || ''}" ${ro ? 'disabled' : ''}></div>
          <div><label class="f">CNPJ</label><input value="${cnpjMask(s.cnpj)}" readonly></div>
          <div><label class="f">Nome fantasia</label><input name="empresa.fantasia" value="${emp.fantasia || ''}" ${ro ? 'disabled' : ''}><div class="hint">Sem "Detran", "CET" ou "Seplag" (art. 8º §3º).</div></div>
          <div><label class="f">Endereço</label><input name="empresa.endereco" value="${emp.endereco || ''}" ${ro ? 'disabled' : ''}></div>
          <div><label class="f">Representante legal ${qsa.length ? '(QSA)' : ''}</label><input name="empresa.repName" list="qsa" value="${emp.repName || ''}" ${ro ? 'disabled' : ''}><datalist id="qsa">${qsa.map((q) => html`<option value="${q.nome}">${q.qualificacao}</option>`)}</datalist></div>
          <div><label class="f">CPF do representante</label><input name="empresa.repCpf" value="${cpfMask(emp.repCpf)}" inputmode="numeric" ${ro ? 'disabled' : ''}><div class="hint">A Receita mostra o CPF mascarado: digite o CPF completo.</div></div>
          <div><label class="f">Cargo/função</label><input name="empresa.repRole" value="${emp.repRole || ''}" ${ro ? 'disabled' : ''}></div>
          <div><label class="f">E-mail e WhatsApp do contato</label><div class="row" style="flex-wrap:nowrap"><input name="empresa.contactEmail" value="${emp.contactEmail || ''}" ${ro ? 'disabled' : ''}><input name="empresa.contactPhone" value="${emp.contactPhone || ''}" ${ro ? 'disabled' : ''}></div></div>
          <div style="grid-column:1/-1"><label class="f">Responsável técnico (engenheiro/arquiteto)</label><div class="row" style="flex-wrap:nowrap"><select name="rt_id" ${ro ? 'disabled' : ''}><option value="">Selecione</option>${d.rts.map((r) => html`<option value="${r.id}" ${r.id === d.laudo.rt_id ? 'selected' : ''}>${r.name} · ${r.council} ${r.reg_number}${r.validated ? ' ✓' : ''}</option>`)}</select>${ro ? '' : html`<a class="btn" href="#/laudo/${id}/rts">+ Cadastrar outro RT</a>`}</div><div class="hint">A franqueadora confere o registro no CREA/CAU. O RT não precisa de acesso ao sistema.</div></div>
        </div></div>
      ${ro ? '' : html`<div class="row"><button class="btn brand lg">Salvar e gerar checklist</button><button type="button" class="btn" id="geo">Usar minha localização como endereço da unidade</button></div>`}
      </div>
      <div>${d.data.etapa1?.savedAt ? html`<div class="card" style="border-color:#F5D77A;background:#FFFCEB"><h3>✓ Checklist liberado</h3><p class="small muted">Com ${e1.boxesLeves} box(es) leves${e1.pesados ? `, ${e1.boxesPesados} pesado(s)` : ''} e ${S.cat.PORTE_LABEL[porte]?.toLowerCase()} porte, você vai precisar de:</p>
        <ul class="small" style="padding-left:18px">${d.checklist.summary.map((x) => html`<li>${x}</li>`)}</ul>
        <a class="btn primary block" href="#/laudo/${id}/checklist">Ver checklist completo</a><a class="btn block" style="margin-top:6px" href="/api/laudos/${id}/checklist.pdf" target="_blank">Baixar PDF</a></div>` : html`<div class="card"><h3>Checklist</h3><p class="small muted">Salve esta etapa para o sistema montar o seu checklist personalizado (fotos, medidas, equipamentos e documentos).</p></div>`}
        ${issueList(d.issues.filter((i) => !i.item && i.stage === 'submit' && ['R01', 'R02', 'R14', 'R26', 'E01', 'E02', 'E03', 'R21'].includes(i.code)))}</div></form>`,
    mount(root) {
      const f = root.querySelector('#f');
      let geo = null;
      const g = root.querySelector('#geo');
      if (g) g.onclick = async () => { const p = await getPosition(); if (!p) return toast('Não foi possível obter a localização.', 'err'); geo = { lat: p.lat, lng: p.lng }; toast('Localização registrada: será usada para conferir o GPS das fotos.', 'ok'); };
      f.onsubmit = async (e) => {
        e.preventDefault();
        const v = readForm(f);
        v.etapa1.pesados = !!v.etapa1.pesados; v.etapa1.movel = !!v.etapa1.movel;
        try { await put(`/api/laudos/${id}/etapa1`, { etapa1: v.etapa1, empresa: v.empresa, rt_id: v.rt_id ? +v.rt_id : null, geo }); toast('Etapa 1 salva. Checklist atualizado.', 'ok'); location.hash = `#/laudo/${id}/checklist`; } catch (er) { showErr(er); }
      };
    },
  };
}

// ---------- Checklist (B.13) ----------
export async function checklist(id) {
  const d = await load(id);
  const cl = d.checklist;
  const stCls = { pronto: 'completo', parcial: 'parcial', erro: 'erro', faltando: '', pendente: '', opcional: '' };
  const royal = (d.store.brand.slug === 'royal');
  const link = (r) => r.key.startsWith('doc:') || r.key.startsWith('cert:') ? (r.key === 'doc:veracidade' ? `#/laudo/${id}/envio` : r.key.startsWith('cert:') ? `#/laudo/${id}/equipamentos` : `#/laudo/${id}/documentos`) : `#/laudo/${id}/item/${r.link || r.key}`;
  return {
    title: 'Checklist do franqueado', ctx: ctxOf(d),
    body: html`${!d.data.etapa1?.savedAt ? html`<div class="note warn">Salve a <a href="#/laudo/${id}/dados">Etapa 1</a> para montar o checklist com as quantidades da sua unidade.</div>` : ''}
    <div class="card"><div class="kicker">Checklist do franqueado</div><div class="row between"><div><b class="brand-title" style="font-size:18px">${cl.done} de ${cl.total} itens prontos</b> <span class="muted">(${cl.pct}%)</span></div><div class="row"><a class="btn sm" href="/api/laudos/${id}/checklist.pdf" target="_blank">PDF para imprimir</a><button class="btn sm" id="copyCl">Copiar link do checklist</button></div></div>${bar(cl.pct, true)}
      <div class="seg" id="flt" style="margin-top:12px"><button class="on" data-v="">Todos</button><button data-v="faltando">Faltando</button><button data-v="erro">Com erro</button><button data-v="pronto">Prontos</button></div></div>
    ${cl.blocks.map((b) => html`<div class="card pad0"><div class="row between" style="padding:16px 16px 8px;align-items:flex-end"><div><div class="kicker">Bloco ${b.id}</div><h3 class="ds-block-title brand-title">${b.title}</h3></div><span class="small muted">${b.done} de ${b.total}</span></div>
      ${b.rows.map((r) => html`<a class="irow" href="${link(r)}" data-st="${r.status}"><div class="ic ${stCls[r.status]}">${r.status === 'pronto' ? '✓' : r.status === 'erro' ? '!' : r.status === 'parcial' ? (royal ? '◆' : '◐') : ''}</div>
        <div class="tx"><b>${r.title}${r.qty ? html` <span class="pill">${r.qty}</span>` : ''}</b>${r.min ? html`<span>Mínimo: ${r.min}</span>` : ''}${r.tip ? html`<span>💡 ${r.tip}</span>` : ''}${r.progress ? html`<span>${r.progress}</span>` : ''}
        ${(r.errors || []).slice(0, 2).map((e) => html`<span class="e">${e}</span>`)}</div><span class="pill ${r.status === 'pronto' ? 'ok' : r.status === 'erro' ? 'err' : r.status === 'parcial' ? 'warn' : ''}">${itemStatusLabel[r.status] || r.status}</span></a>`)}</div>`)}`,
    mount(root) {
      const cc = root.querySelector('#copyCl');
      if (cc) cc.onclick = async () => { try { await navigator.clipboard.writeText(`Checklist do ${d.laudo.code} (${d.store.fantasia}): ${location.origin}/api/laudos/${id}/checklist.pdf`); toast('Link do checklist copiado.', 'ok'); } catch { toast('Não foi possível copiar.', 'err'); } };
      root.querySelectorAll('#flt button').forEach((b) => (b.onclick = () => {
        root.querySelectorAll('#flt button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
        const v = b.dataset.v; root.querySelectorAll('.irow').forEach((r) => (r.hidden = v && !(r.dataset.st === v || (v === 'faltando' && ['faltando', 'parcial', 'pendente'].includes(r.dataset.st)))));
      }));
    },
  };
}

// ---------- lista dos itens de um anexo ----------
export const annexList = (annex) => async (id) => {
  const d = await load(id);
  const list = (annex === 'II' ? S.cat.A2 : S.cat.A3).filter((it) => d.scope.includes(it.key));
  return {
    title: annex === 'II' ? 'Anexo II · Laudo técnico de infraestrutura' : 'Anexo III · Declaração de equipamentos', ctx: ctxOf(d),
    actions: html`<a class="btn sm hide-m" href="/api/laudos/${id}/preview/${annex === 'II' ? 'a2' : 'a3'}" target="_blank">Prévia do PDF</a>`,
    body: html`${statusBanner(d)}<div class="card pad0">${list.map((it) => { const s = d.statuses[it.key] || {}; return html`<a class="irow ${locked(d, it.key) ? 'locked' : ''}" href="#/laudo/${id}/item/${it.key}">
      <div class="ic ${s.status}">${it.n}</div><div class="tx"><b>${it.title}</b><span>${itemStatusLabel[s.status] || ''}${s.photosReq ? ` · ${s.photosDone} de ${s.photosReq} fotos` : ''}${s.errors ? ` · ${s.errors} erro(s)` : ''}${s.alerts ? ` · ${s.alerts} alerta(s)` : ''}${locked(d, it.key) ? ' · 🔒 travado' : ''}</span></div>${reviewPill(s.review)}<span class="muted">›</span></a>`; })}</div>
      ${d.scope.length < ITEMS().length && ['alteracao_endereco', 'modificacao'].includes(d.laudo.process_type) ? html`<p class="small muted">Somente os itens objeto da alteração/modificação (art. 45 §1º).</p>` : ''}`,
  };
};

// ---------- componentes de foto ----------
function photoCell(p, slot, editable, opts = {}) {
  if (!p) return html`<div class="ph empty" data-slot="${slot.slot}" data-label="${slot.label}" ${editable ? '' : 'aria-disabled="true"'}><b>+</b>${slot.label}${slot.optional ? ' (opcional)' : ''}</div>`;
  return html`<div class="ph" data-pid="${p.id}"><img loading="lazy" src="${p.thumb}" alt="${p.caption || slot.label}">${annSvg(p.annotations)}<span class="ok">✓</span>
    <div class="cap">${opts.fig ? html`<b>Figura ${String(opts.fig).padStart(2, '0')}</b> · ` : ''}${p.caption || slot.label}${p.brightness < 40 || p.sharpness < 4 ? ' ⚠' : ''}</div>
    ${editable ? html`<div class="acts"><button data-act="ann" title="Marcar na foto">✎</button><button data-act="cap" title="Editar legenda">T</button><button data-act="redo" data-slot="${slot.slot}" data-label="${slot.label}" title="Trocar">↻</button><button data-act="del" title="Excluir">×</button></div>` : ''}</div>`;
}
function bindPhotos(root, { uploadUrl, extraFields = {}, photos, editable, tipFor, onDone }) {
  const doUpload = async (cell, slot, label, src) => {
    let shot;
    if (src === 'camera') shot = await openCamera({ label, tip: tipFor && tipFor(slot) });
    else { const f = await pickFiles(); shot = f.length ? { file: f[0], source: 'upload' } : null; }
    if (!shot) return;
    cell.classList.add('uploading');
    try {
      const r = await uploadPhoto(uploadUrl, shot.file, { ...extraFields, slot, caption: label, lat: shot.lat, lng: shot.lng, source: shot.source });
      if (r.queued) { cell.classList.remove('uploading'); cell.classList.add('queued'); return; }
      (r.warnings || []).forEach((w) => toast(w, 'err'));
      toast('Foto salva.', 'ok');
      onDone();
    } catch (e) { cell.classList.remove('uploading'); showErr(e); }
  };
  const ask = (cell, slot, label) => {
    if (window.matchMedia('(max-width: 900px)').matches) { modal({ title: label, body: html`<p class="small muted">${tipFor ? tipFor(slot) : ''}</p>`, actions: [{ label: '⬆ Galeria', onClick: () => { doUpload(cell, slot, label, 'upload'); } }, { label: '📷 Câmera', cls: 'brand', onClick: () => { doUpload(cell, slot, label, 'camera'); } }] }); }
    else doUpload(cell, slot, label, 'upload');
  };
  root.querySelectorAll('.ph.empty').forEach((c) => { if (c.getAttribute('aria-disabled')) return; c.onclick = () => ask(c, c.dataset.slot, c.dataset.label); });
  root.querySelectorAll('.ph[data-pid]').forEach((c) => {
    const p = photos.find((x) => x.id === +c.dataset.pid);
    c.querySelector('img').onclick = () => lightbox(p);
    c.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const a = b.dataset.act;
      if (a === 'redo') return ask(c, b.dataset.slot, b.dataset.label);
      if (a === 'del') { if (await confirmBox('Excluir foto', 'A foto vai para a lixeira (pode ser recuperada pelo Administrador por 90 dias).', 'Excluir', 'danger')) { try { await del('/api/photos/' + p.id); onDone(); } catch (er) { showErr(er); } } return; }
      if (a === 'cap') { const v = await promptBox('Legenda da figura', 'Descrição que aparece abaixo da foto no PDF ("Figura NN / Descrição")', { value: p.caption || '' }); if (v != null) { await put('/api/photos/' + p.id, { caption: v }); onDone(); } return; }
      if (a === 'ann') annotate(p, onDone);
    }));
  });
}

// Ferramenta de marcação (seta, retângulo, texto)
function annotate(p, onDone) {
  let anns = [...(p.annotations || [])], tool = 'rect';
  const m = modal({ title: 'Marcar na foto', wide: true, body: html`<div class="row" style="margin-bottom:10px"><div class="seg" id="tools"><button class="on" data-t="rect">▭ Retângulo</button><button data-t="arrow">➜ Seta</button><button data-t="text">T Texto</button></div><button class="btn sm" id="undo">Desfazer</button><span class="small muted">Arraste na foto para indicar a trena e a medida.</span></div>
    <div class="annot-stage" id="st"><img src="${p.url}" alt=""><div id="ov"></div></div>`,
    actions: [{ label: 'Cancelar' }, { label: 'Salvar marcações', cls: 'primary', onClick: async () => { await put('/api/photos/' + p.id, { annotations: anns }); toast('Marcações salvas.', 'ok'); onDone(); } }],
    onMount: (el) => {
      const st = el.querySelector('#st'), ov = el.querySelector('#ov');
      const draw = (tmp) => { ov.innerHTML = String(annSvg(tmp ? [...anns, tmp] : anns)); };
      draw();
      el.querySelectorAll('#tools button').forEach((b) => (b.onclick = () => { el.querySelectorAll('#tools button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); tool = b.dataset.t; }));
      el.querySelector('#undo').onclick = () => { anns.pop(); draw(); };
      const pt = (e) => { const r = st.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
      let start = null, cur = null;
      st.onpointerdown = async (e) => {
        e.preventDefault(); const a = pt(e);
        if (tool === 'text') { const s = await promptBox('Texto', 'Ex.: 3,55 m', { okLabel: 'Inserir' }); if (s) { anns.push({ t: 'text', x: a.x, y: a.y, s }); draw(); } return; }
        start = a; st.setPointerCapture(e.pointerId);
      };
      st.onpointermove = (e) => { if (!start) return; const b = pt(e); cur = tool === 'rect' ? { t: 'rect', x: Math.min(start.x, b.x), y: Math.min(start.y, b.y), w: Math.abs(b.x - start.x), h: Math.abs(b.y - start.y) } : { t: 'arrow', x1: start.x, y1: start.y, x2: b.x, y2: b.y }; draw(cur); };
      st.onpointerup = () => { if (cur && (cur.w > 0.01 || cur.h > 0.01 || cur.t === 'arrow')) anns.push(cur); start = cur = null; draw(); };
    } });
  return m;
}

// Marcação na planta (Seção 7.1)
function plantPicker(d, k, onSave) {
  const plant = d.files.filter((f) => f.kind === 'planta').pop();
  if (!plant) return toast('Envie primeiro a planta/croqui do imóvel em Documentos.', 'err');
  let rect = d.data.items?.[k]?.plantRect || null;
  modal({ title: 'Marcar o item na planta', wide: true, body: html`<p class="small muted">Arraste um retângulo sobre a área deste item. O sistema gera o recorte com o destaque automaticamente.</p><div class="plant-wrap" id="pw"><img src="${plant.url}?v=image" alt="Planta" draggable="false"><div class="sel" id="sel" ${rect ? '' : 'hidden'}></div></div>`,
    actions: [{ label: 'Cancelar' }, { label: 'Salvar marcação', cls: 'primary', onClick: async () => { if (!rect) { toast('Marque a área na planta.', 'err'); return false; } await onSave(rect); } }],
    onMount: (el) => {
      const pw = el.querySelector('#pw'), sel = el.querySelector('#sel');
      const show = () => { if (!rect) return; Object.assign(sel.style, { left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.w * 100 + '%', height: rect.h * 100 + '%' }); sel.hidden = false; };
      show();
      let s = null;
      const pt = (e) => { const r = pw.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
      pw.onpointerdown = (e) => { e.preventDefault(); s = pt(e); pw.setPointerCapture(e.pointerId); };
      pw.onpointermove = (e) => { if (!s) return; const b = pt(e); rect = { x: Math.min(s.x, b.x), y: Math.min(s.y, b.y), w: Math.abs(b.x - s.x), h: Math.abs(b.y - s.y) }; show(); };
      pw.onpointerup = () => { s = null; };
    } });
}

// ---------- tela de um item (B.14 / B.16) ----------
export async function itemView(id, k) {
  const d = await load(id);
  const it = ITEM(k);
  if (!it) return go(`/laudo/${id}`);
  const editable = d.perms.editItems[k];
  const item = d.data.items?.[k] || {};
  const f = item.fields || {};
  const st = d.statuses[k] || {};
  const rv = d.reviews[k];
  const cfg = d.data.etapa1 || {};
  const isA2 = it.annex === 'II';
  const others = d.presence.filter((p) => p.item === k);
  const ro = editable ? '' : 'disabled';
  let body;
  if (isA2) body = a2Body(d, it, f, item, ro, cfg);
  else body = a3Body(d, it, f, item, ro);
  const idx = d.scope.indexOf(k), prev = d.scope[idx - 1], next = d.scope[idx + 1];
  return {
    title: `${it.annex === 'II' ? 'Anexo II' : 'Anexo III'} · ${it.n}. ${it.short}`, ctx: ctxOf(d), keepScroll: S._keepScroll,
    body: html`
    <div class="row" style="margin-bottom:10px"><span class="num-badge">${it.n}</span><h2 class="brand-title" style="margin:0;flex:1">${it.title}</h2>${reviewPill(rv)}<span class="pill ${st.status === 'completo' ? 'ok' : st.status === 'erro' ? 'err' : st.status === 'parcial' ? 'warn' : ''}">${itemStatusLabel[st.status] || ''}${st.photosReq ? ` · ${st.photosDone} de ${st.photosReq} fotos` : ''}</span></div>
    ${others.length ? html`<div class="note warn" style="margin-bottom:10px">${others.map((o) => o.name).join(', ')} também está neste item agora. Fotos nunca se sobrescrevem; nos campos vale a última alteração.</div>` : ''}
    ${rv && rv.status === 'devolvido' ? html`<div class="note err" style="margin-bottom:10px"><b>Devolvido: ${rv.reason}</b>${rv.comment ? ' — ' + rv.comment : ''}<br><span class="small">${rv.by} · ${fmtDT(rv.at)}</span></div>` : ''}
    ${!editable ? html`<div class="note" style="margin-bottom:10px">🔒 Este item está travado ${rv?.status === 'aprovado' ? '(aprovado)' : 'nesta etapa'}.</div>` : ''}
    <div class="note brand" style="margin-bottom:12px">${it.req}${it.tip ? html`<br><span class="small">💡 ${it.tip}</span>` : ''}</div>
    <div id="itemBody">${body}</div>
    <div class="card"><h3>Validação automática</h3>${issuesOf(d, k).length ? issueList(issuesOf(d, k)) : html`<div class="note ok">✓ Sem erros neste item.</div>`}
      ${issuesOf(d, k).filter((i) => i.type === 'A').length ? html`<p class="small muted" style="margin-top:8px">Alertas (amarelos) não bloqueiam, mas exigem justificativa no envio.</p>` : ''}</div>
    <div class="row between"><span>${prev ? html`<a class="btn" href="#/laudo/${id}/item/${prev}">‹ ${ITEM(prev).short}</a>` : ''}</span><span class="small muted">Tudo é salvo automaticamente. Pode sair e completar depois.</span><span>${next ? html`<a class="btn brand" href="#/laudo/${id}/item/${next}">${ITEM(next).short} ›</a>` : html`<a class="btn brand" href="#/laudo/${id}/envio">Revisar e enviar ›</a>`}</span></div>`,
    async mount(root) {
      S._keepScroll = false;
      const refresh = () => { S._keepScroll = true; import('../app.js').then((m) => m.render()); };
      post(`/api/laudos/${id}/presence`, { item: k }).catch(() => {});
      const pres = setInterval(() => { if (!document.body.contains(root)) return clearInterval(pres); post(`/api/laudos/${id}/presence`, { item: k }).catch(() => {}); }, 45000);
      // fotos do item
      bindPhotos(root.querySelector('#itemPhotos') || root, { uploadUrl: `/api/laudos/${id}/photos`, extraFields: { item: k }, photos: d.photos, editable, tipFor: () => it.tip, onDone: refresh });
      // equipamentos (A3): fotos de cada equipamento
      root.querySelectorAll('[data-eq]').forEach((box) => {
        const eq = d.equipment.find((e) => e.id === +box.dataset.eq);
        bindPhotos(box, { uploadUrl: `/api/equipment/${eq.id}/photos`, photos: eq.photos, editable, tipFor: () => 'Mostre a etiqueta legível. Evite reflexo e contraluz.', onDone: refresh });
      });
      // salvamento automático dos campos
      const form = root.querySelector('#fields');
      if (form && editable) {
        const save = debounce(async () => {
          const v = collectFields(form, k);
          try { await put(`/api/laudos/${id}/items/${k}`, v); const ind = root.querySelector('#saved'); if (ind) ind.textContent = 'salvo ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); liveValidate(root, d, k, form); } catch (e) { showErr(e); }
        }, 650);
        form.addEventListener('input', save); form.addEventListener('change', save);
        liveValidate(root, d, k, form);
        root.querySelectorAll('[data-addrow]').forEach((b) => (b.onclick = async () => { const v = collectFields(form, k); const key = b.dataset.addrow; v.fields[key] = [...(v.fields[key] || []), {}]; await put(`/api/laudos/${id}/items/${k}`, v); refresh(); }));
        root.querySelectorAll('[data-delrow]').forEach((b) => (b.onclick = async () => { const [key, i] = b.dataset.delrow.split(':'); const v = collectFields(form, k); v.fields[key].splice(+i, 1); await put(`/api/laudos/${id}/items/${k}`, v); refresh(); }));
        root.querySelectorAll('.box-tabs button').forEach((b) => (b.onclick = () => { root.querySelectorAll('.box-tabs button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); root.querySelectorAll('[data-boxpane]').forEach((p) => (p.hidden = p.dataset.boxpane !== b.dataset.box)); }));
      } else root.querySelectorAll('.box-tabs button').forEach((b) => (b.onclick = () => { root.querySelectorAll('.box-tabs button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); root.querySelectorAll('[data-boxpane]').forEach((p) => (p.hidden = p.dataset.boxpane !== b.dataset.box)); }));
      const pb = root.querySelector('#plantBtn');
      if (pb) pb.onclick = () => plantPicker(d, k, async (rect) => { const v = form ? collectFields(form, k) : {}; await put(`/api/laudos/${id}/items/${k}`, { ...v, plantRect: rect }); refresh(); });
      const na = root.querySelector('#naBtn');
      if (na) na.onclick = async () => { if (item.na) { await put(`/api/laudos/${id}/items/${k}`, { na: false }); return refresh(); } const j = await promptBox('Item não aplicável', 'Justificativa (o sistema confere se o porte exige o item)', { textarea: true }); if (j) { await put(`/api/laudos/${id}/items/${k}`, { na: true, naJust: j }); refresh(); } };
      // vídeos do Drive
      root.querySelectorAll('[data-video]').forEach((inp) => {
        const btn = inp.parentElement.querySelector('button');
        const run = async () => { btn.disabled = true; btn.textContent = 'Testando…'; try { const r = await put(`/api/laudos/${id}/videos/${k}/${inp.dataset.video}`, { url: inp.value.trim() }); const t = r.test; toast(t ? t.msg : 'Link removido.', t && t.status === 'fail' ? 'err' : 'ok'); refresh(); } catch (e) { showErr(e); btn.disabled = false; btn.textContent = 'Testar link'; } };
        btn.onclick = run;
      });
      root.querySelectorAll('[data-vupload]').forEach((b) => (b.onclick = async () => {
        const fl = await pickFiles({ accept: 'video/*' }); if (!fl.length) return;
        const fd = new FormData(); fd.append('kind', 'video'); fd.append('item', k); fd.append('file', fl[0]);
        b.disabled = true; b.textContent = 'Enviando vídeo…';
        try { const r = await api('POST', `/api/laudos/${id}/files`, fd); await put(`/api/laudos/${id}/videos/${k}/${b.dataset.vupload}`, { url: r.publicUrl }); toast('Vídeo enviado; o sistema gerou o link compartilhado.', 'ok'); refresh(); } catch (e) { showErr(e); b.disabled = false; }
      }));
      const vu = root.querySelector('#bioVideo');
      if (vu) vu.onchange = async () => { await put(`/api/laudos/${id}/items/${k}`, { videoUrl: vu.value.trim() }); refresh(); };
      root.querySelectorAll('[data-docup]').forEach((b) => (b.onclick = () => uploadDoc(id, b.dataset.docup, k, refresh)));
      root.querySelectorAll('[data-delfile]').forEach((b) => (b.onclick = async () => { if (await confirmBox('Remover documento', 'O arquivo vai para a lixeira.', 'Remover', 'danger')) { await del('/api/files/' + b.dataset.delfile).catch(showErr); refresh(); } }));
      const obs = root.querySelector('#obs');
      if (obs && editable) obs.onchange = () => put(`/api/laudos/${id}/items/${k}`, { obs: obs.value }).catch(showErr);
    },
  };
}

function collectFields(form, k) {
  const v = readForm(form);
  const out = { fields: v.fields || {}, descricao: v.descricao };
  // listas (extintores, vagas, portões)
  for (const key of ['extintores', 'vagas', 'portoes']) if (out.fields[key] && !Array.isArray(out.fields[key])) out.fields[key] = Object.keys(out.fields[key]).sort((a, b) => a - b).map((i) => out.fields[key][i]);
  return out;
}

// validação imediata no campo (ex.: largura abaixo do mínimo)
function liveValidate(root, d, k, form) {
  const D = d.params.dimensoes;
  const mark = (name, ok, msg) => { const el = form.querySelector(`[name="${name}"]`); if (!el) return; el.classList.toggle('bad', ok === false); el.classList.toggle('good', ok === true); const h = el.parentElement.querySelector('.hint.live'); if (h) h.textContent = ok === false ? msg : ''; };
  const val = (n) => num(form.querySelector(`[name="${n}"]`)?.value);
  const cfg = d.data.etapa1 || {}, T = (+cfg.boxesLeves || 0) + (cfg.pesados ? +cfg.boxesPesados || 0 : 0);
  if (k === 'a2_2') { const a = val('fields.area'), min = D.recepcaoBase + D.recepcaoPorBox * T; if (a != null) mark('fields.area', a >= min, `Abaixo do mínimo de ${fmtN(min)} m².`); const c = val('fields.cadeiras'); if (c != null) mark('fields.cadeiras', c >= T, `Mínimo ${T} cadeiras.`); }
  if (k === 'a2_3') { const a = val('fields.area'); if (a != null) mark('fields.area', a >= D.salaAdm, `Abaixo de ${fmtN(D.salaAdm)} m².`); }
  if (k === 'a2_10') { const a = val('fields.largura'); if (a != null) mark('fields.largura', a >= D.manobra, `Abaixo de ${fmtN(D.manobra)} m.`); }
  if (k === 'a2_7' || k === 'a2_8') {
    const dim = k === 'a2_7' ? D.boxLeve : D.boxPesado;
    form.querySelectorAll('[name^="fields.boxes."]').forEach((el) => {
      const [, , b, f] = el.name.split('.'); const v = num(el.value); if (v == null || !['comprimento', 'largura', 'altura'].includes(f)) return;
      const min = { comprimento: dim.c, largura: dim.l, altura: dim.h }[f];
      mark(el.name, v >= min, `${f[0].toUpperCase() + f.slice(1)} de ${fmtN(v)} m abaixo do mínimo de ${fmtN(min)} m. Confira a medida ou ajuste o box.`);
    });
  }
  if (k === 'a2_9') form.querySelectorAll('[name^="fields.portoes."]').forEach((el) => { const [, , i, f] = el.name.split('.'); if (!['largura', 'altura'].includes(f)) return; const tipo = form.querySelector(`[name="fields.portoes.${i}.tipo"]`)?.value; const dim = tipo === 'pesados' ? D.portaoPesado : D.portaoLeve; const v = num(el.value); if (v != null) mark(el.name, v >= (f === 'largura' ? dim.l : dim.h), `Mínimo ${fmtN(f === 'largura' ? dim.l : dim.h)} m.`); });
  if (k === 'a2_6') form.querySelectorAll('[name^="fields.vagas."]').forEach((el) => { const [, , , f] = el.name.split('.'); const v = num(el.value); if (v == null || !['comprimento', 'largura'].includes(f)) return; mark(el.name, v >= (f === 'comprimento' ? D.vaga.c : D.vaga.l), `Mínimo ${fmtN(f === 'comprimento' ? D.vaga.c : D.vaga.l)} m.`); });
}

const yn = (name, v, ro, label) => html`<div><label class="f">${label}</label><select name="${name}" ${ro}><option value="">—</option><option value="sim" ${v === 'sim' ? 'selected' : ''}>Sim</option><option value="nao" ${v === 'nao' ? 'selected' : ''}>Não</option></select></div>`;
const inp = (name, v, ro, label, extra = {}) => html`<div><label class="f">${label}</label><input name="${name}" value="${v ?? ''}" ${ro} inputmode="${extra.text ? 'text' : 'decimal'}" placeholder="${extra.ph || ''}"><div class="hint live err"></div>${extra.hint ? html`<div class="hint">${extra.hint}</div>` : ''}</div>`;

function plantSection(d, k, item, ro) {
  const plantOk = item.plantRect && d.files.some((f) => f.kind === 'planta');
  const own = d.photos.find((p) => p.item === k && p.slot === 'planta');
  return html`<div class="card"><h3>Planta de localização</h3><div class="row">${plantOk ? html`<span class="pill ok">✓ marcado na planta</span>` : own ? html`<span class="pill ok">✓ imagem própria</span>` : html`<span class="pill warn">pendente</span>`}
    ${ro ? '' : html`<button class="btn sm" id="plantBtn" type="button">${plantOk ? 'Refazer marcação' : 'Marcar na planta'}</button>`}<span class="small muted">ou envie uma imagem própria:</span></div>
    <div class="photos" style="margin-top:8px;grid-template-columns:repeat(auto-fill,minmax(160px,220px))">${photoCell(own, { slot: 'planta', label: 'Imagem de localização', optional: true }, !ro)}</div></div>`;
}

function a2Body(d, it, f, item, ro, cfg) {
  const k = it.key;
  const slots = slotsFor(d, k, f);
  const ph = (s) => d.photos.find((p) => p.item === k && p.slot === s.slot);
  let fig = 0;
  const grid = (list) => html`<div class="photos">${list.map((s) => photoCell(ph(s), s, !ro, { fig: ph(s) ? ++fig : 0 }))}</div>`;
  const P = d.params, D = P.dimensoes;
  let fields = '';
  if (k === 'a2_1') fields = html`<div class="grid g3">${yn('fields.backlight', f.backlight, ro, 'Backlight')}${yn('fields.acrilico', f.acrilico, ro, 'Acrílico branco')}${yn('fields.plotter', f.plotter, ro, 'Grafismo em plotter de recorte')}${yn('fields.modeloAnexoI', f.modeloAnexoI, ro, 'Modelo conforme Anexo I')}
    <div><label class="f">Local de fixação</label><select name="fields.local" ${ro}><option value="">—</option>${[['fachada', 'Fachada'], ['corredor', 'Corredor próximo à entrada'], ['porta', 'Acima da porta']].map(([v, l]) => html`<option value="${v}" ${f.local === v ? 'selected' : ''}>${l}</option>`)}</select></div>
    ${yn('fields.tombada', f.tombada, ro, 'Edificação tombada / regra municipal?')}${d.laudo.process_type === 'renovacao' ? yn('fields.placaAnterior', f.placaAnterior, ro, 'Placa do modelo anterior (troca gradual)') : ''}${yn('fields.placaDetran', f.placaDetran, ro, 'A placa tem nome/logo do Detran-MG?')}</div>
    ${sim(f.tombada) ? html`<div style="margin-top:10px"><label class="f">Justificativa (art. 19 §3º)</label><textarea name="fields.tombadaJust" ${ro}>${f.tombadaJust || ''}</textarea>${docLine(d, 'dgcv', 'Aprovação da DGCV', ro)}</div>` : ''}
    <details style="margin-top:10px"><summary class="small" style="cursor:pointer">Ver o modelo oficial da placa (Anexo I)</summary>${placaModelo()}</details>`;
  if (k === 'a2_2') fields = html`<div class="grid g4">${inp('fields.area', f.area, ro, 'Área total (m²)', { hint: `mínimo ${fmtN(D.recepcaoBase + D.recepcaoPorBox * ((+cfg.boxesLeves || 0) + (cfg.pesados ? +cfg.boxesPesados || 0 : 0)))} m²` })}${inp('fields.cadeiras', f.cadeiras, ro, 'Nº de cadeiras')}${yn('fields.bebedouro', f.bebedouro, ro, 'Bebedouro')}${yn('fields.ar', f.ar, ro, 'Ar-condicionado')}</div>`;
  if (k === 'a2_3') fields = html`<div class="grid g3">${inp('fields.area', f.area, ro, 'Área (m²)', { hint: `mínimo ${fmtN(D.salaAdm)} m²` })}${yn('fields.mobilia', f.mobilia, ro, 'Mobília')}${inp('fields.recursos', f.recursos, ro, 'Recursos tecnológicos', { text: true, ph: 'computadores, impressora…' })}</div>`;
  if (k === 'a2_4') fields = html`<div class="grid g3">${inp('fields.banheiros', f.banheiros, ro, 'Nº de banheiros', { hint: `mínimo ${d.porte ? P.porte.banheirosMin[d.porte] : '?'}` })}${inp('fields.acessiveis', f.acessiveis, ro, 'Nº de acessíveis')}${yn('fields.nbr9050', f.nbr9050, ro, 'Acessibilidade NBR 9050:2020')}</div>`;
  if (k === 'a2_5') fields = listFields('extintores', f.extintores, ro, [['tipo', 'Tipo (ex.: Pó ABC 4 kg)', 'text'], ['local', 'Local', 'text'], ['validade', 'Validade', 'date']], 'Adicionar extintor/equipamento') + docLine(d, 'incendio', 'Documentos de incêndio (AVCB/CLCB, recarga…)', ro, true);
  if (k === 'a2_6') fields = d.porte && !P.porte.vagasExigidas[d.porte] ? html`<div class="note ok">Dispensado no pequeno porte.</div>` : listFields('vagas', f.vagas, ro, [['comprimento', 'Comprimento (m)'], ['largura', 'Largura (m)'], ['coberto', 'Coberta?', 'yn']], 'Adicionar vaga') + html`<div class="hint">Exigidas: ${Math.ceil((+cfg.boxesLeves || 0) / 2)} vaga(s) de ${fmtN(D.vaga.c, 1)} × ${fmtN(D.vaga.l, 1)} m.</div>`;
  if (k === 'a2_7' || k === 'a2_8') {
    const pref = k === 'a2_7' ? 'L' : 'P', n = k === 'a2_7' ? +cfg.boxesLeves || 0 : cfg.pesados ? +cfg.boxesPesados || 0 : 0;
    const dim = k === 'a2_7' ? D.boxLeve : D.boxPesado;
    const boxes = Array.from({ length: n }, (_, i) => pref + (i + 1));
    if (!n) return html`<div class="card"><div class="note warn">Informe o número de boxes na <a href="#/laudo/${d.laudo.id}/dados">Etapa 1</a>.</div></div>`;
    const bstat = (b) => { const bs = slots.filter((s) => s.box === b); const done = bs.filter((s) => ph(s)).length; const err = d.issues.some((i) => i.item === k && i.id.includes(':' + b)); return err ? 'err' : done === bs.length ? 'ok' : ''; };
    return html`${plantSection(d, k, item, ro)}<div class="card"><h3>Fotos e medidas por box <span class="small muted" id="saved" style="margin-left:auto"></span></h3>
      <div class="box-tabs">${boxes.map((b, i) => html`<button type="button" class="${i === 0 ? 'on' : ''} ${bstat(b)}" data-box="${b}">${b.replace('L', 'Box ').replace('P', 'Pesado ')} ${bstat(b) === 'ok' ? '✓' : bstat(b) === 'err' ? '!' : ''}</button>`)}</div>
      <form id="fields" onsubmit="return false">${boxes.map((b, i) => { const bx = (f.boxes || {})[b] || {}; return html`<div data-boxpane="${b}" ${i ? 'hidden' : ''}>
        <div id="itemPhotos">${grid(slots.filter((s) => s.box === b))}</div>
        <h4 style="margin-top:14px">Medidas do ${b.replace('L', 'box ').replace('P', 'box pesado ')}</h4>
        <div class="grid g3">${inp(`fields.boxes.${b}.comprimento`, bx.comprimento, ro, `Comprimento (m) · mín. ${fmtN(dim.c)}`)}${inp(`fields.boxes.${b}.largura`, bx.largura, ro, `Largura (m) · mín. ${fmtN(dim.l)}`)}${inp(`fields.boxes.${b}.altura`, bx.altura, ro, `Altura (m) · mín. ${fmtN(dim.h)}`)}
        ${yn(`fields.boxes.${b}.coberto`, bx.coberto, ro, 'Coberto')}${inp(`fields.boxes.${b}.piso`, bx.piso, ro, 'Piso', { text: true, ph: 'Concreto' })}${k === 'a2_7' ? inp(`fields.boxes.${b}.iluminacao`, bx.iluminacao, ro, 'Iluminação/ventilação', { text: true }) : ''}</div></div>`; })}
        <label class="f" style="margin-top:12px">Descrição (opcional, vai para o PDF)</label><textarea name="descricao" ${ro} placeholder="Ex.: Boxes cobertos com piso em concreto…">${item.descricao || ''}</textarea></form></div>`;
  }
  if (k === 'a2_9') fields = listFields('portoes', f.portoes, ro, [['tipo', 'Acesso', 'sel', [['leves', 'Leves'], ['pesados', 'Pesados']]], ['largura', 'Largura (m)'], ['altura', 'Altura livre (m)'], ['boxes', 'Dá acesso a quais boxes', 'text']], 'Adicionar portão');
  if (k === 'a2_10') fields = html`<div class="grid g3">${inp('fields.largura', f.largura, ro, 'Largura mínima medida (m)', { hint: `mínimo ${fmtN(D.manobra)} m` })}</div>`;
  const naAllowed = k === 'a2_6';
  return html`${plantSection(d, k, item, ro)}
    <div class="card"><h3>Fotos coloridas</h3><div id="itemPhotos">${grid(slots)}</div>
      <div class="photos" style="margin-top:10px">${d.photos.filter((p) => p.item === k && p.slot === 'extra').map((p) => photoCell(p, { slot: 'extra', label: 'Foto complementar' }, !ro))}${ro ? '' : photoCell(null, { slot: 'extra', label: '+ foto complementar (opcional)' }, true)}</div></div>
    <div class="card"><h3>Dados e medidas <span class="small muted" id="saved" style="margin-left:auto"></span></h3><form id="fields" onsubmit="return false">${fields}
      <label class="f" style="margin-top:12px">Descrição com a medida encontrada (vai para o PDF)</label><textarea name="descricao" ${ro} placeholder="Ex.: Recepção com 14,50 m², 6 cadeiras…">${item.descricao || ''}</textarea></form>
      ${naAllowed && !ro ? html`<button class="btn sm" id="naBtn" style="margin-top:10px">${item.na ? 'Desmarcar "não aplicável"' : 'Marcar como não aplicável'}</button>` : ''}</div>`;
}
function slotsFor(d, k, f) {
  // replica as regras de slots do servidor
  const cfg = d.data.etapa1 || {};
  switch (k) {
    case 'a2_1': return [{ slot: 'frontal', label: 'Placa de frente' }, { slot: 'local', label: 'Placa no local (fachada)' }, { slot: 'backlight', label: 'Backlight aceso' }];
    case 'a2_2': return [{ slot: 'geral1', label: 'Ambiente (cadeiras)' }, { slot: 'geral2', label: 'Bebedouro e ar-condicionado' }, { slot: 'medida', label: 'Trena / medida' }];
    case 'a2_3': return [{ slot: 'geral', label: 'Mobília e recursos' }, { slot: 'medida', label: 'Trena / medida' }];
    case 'a2_4': { const n = Math.max(+f.banheiros || 0, 1); return [...Array.from({ length: n }, (_, i) => ({ slot: `banheiro${i + 1}`, label: `Banheiro ${i + 1}` })), { slot: 'acessivel', label: 'Banheiro acessível (barras, porta, giro)' }]; }
    case 'a2_5': return Array.from({ length: Math.max((f.extintores || []).length, 1) }, (_, i) => ({ slot: `ext${i + 1}`, label: `Extintor ${i + 1} (com etiqueta)` }));
    case 'a2_6': return d.porte && !d.params.porte.vagasExigidas[d.porte] ? [] : Array.from({ length: Math.max((f.vagas || []).length, Math.ceil((+cfg.boxesLeves || 0) / 2)) }, (_, i) => ({ slot: `vaga${i + 1}`, label: `Vaga ${i + 1} com trena` }));
    case 'a2_7': case 'a2_8': { const pref = k === 'a2_7' ? 'L' : 'P', n = k === 'a2_7' ? +cfg.boxesLeves || 0 : cfg.pesados ? +cfg.boxesPesados || 0 : 0; const out = []; for (let i = 1; i <= n; i++) { const b = pref + i, lb = b[0] === 'P' ? `Box pesado ${i}` : `Box ${i}`; out.push({ slot: `${b}_geral`, label: `${lb} · vista geral`, box: b }, { slot: `${b}_piso`, label: `${lb} · piso`, box: b }, { slot: `${b}_cobertura`, label: `${lb} · cobertura/iluminação`, box: b }, { slot: `${b}_trena`, label: `${lb} · trena (medidas)`, box: b }); } return out; }
    case 'a2_9': return Array.from({ length: Math.max((f.portoes || []).length, 1) }, (_, i) => ({ slot: `portao${i + 1}`, label: `Portão ${i + 1} aberto com trena` }));
    case 'a2_10': return [{ slot: 'trena', label: 'Área de circulação com trena' }];
    case 'a3_9': return [{ slot: 'evidencia', label: 'Print do reconhecimento facial no app' }];
    case 'a3_17': return [{ slot: 'speedtest', label: 'Print do teste de velocidade (opcional)', optional: true }];
    default: return [];
  }
}
function listFields(key, rows, ro, cols, addLabel) {
  rows = rows && rows.length ? rows : [{}];
  return html`<div class="stack">${rows.map((r, i) => html`<div class="grid" style="grid-template-columns:repeat(${cols.length},minmax(0,1fr)) auto;align-items:end;gap:8px">
    ${cols.map(([f, l, t, opts]) => t === 'yn' ? yn(`fields.${key}.${i}.${f}`, r[f], ro, l) : t === 'sel' ? html`<div><label class="f">${l}</label><select name="fields.${key}.${i}.${f}" ${ro}>${opts.map(([v, lb]) => html`<option value="${v}" ${r[f] === v ? 'selected' : ''}>${lb}</option>`)}</select></div>` : t === 'date' ? html`<div><label class="f">${l}</label><input type="date" name="fields.${key}.${i}.${f}" value="${r[f] || ''}" ${ro}></div>` : inp(`fields.${key}.${i}.${f}`, r[f], ro, l, { text: t === 'text' }))}
    ${ro ? html`<span></span>` : html`<button type="button" class="btn sm danger" data-delrow="${key}:${i}" title="Remover" ${rows.length < 2 ? 'disabled' : ''}>×</button>`}</div>`)}
    ${ro ? '' : html`<button type="button" class="btn sm" data-addrow="${key}">+ ${addLabel}</button>`}</div>`;
}
function docLine(d, kind, label, ro, multi) {
  const fs = d.files.filter((f) => f.kind === kind);
  return html`<div class="list-item" style="padding-left:0"><div style="flex:1"><div class="t1">${label}</div><div class="t2">${fs.length ? fs.map((f) => html`<a href="${f.url}" target="_blank">${f.name}</a> (${fmtMB(f.size)}) ${ro ? '' : html`<button class="btn link" data-delfile="${f.id}">remover</button>`} `) : 'não enviado'}</div></div>${ro ? '' : html`<button type="button" class="btn sm" data-docup="${kind}">${fs.length && !multi ? 'Trocar' : 'Enviar'}</button>`}</div>`;
}
function placaModelo() {
  return html`<div style="max-width:420px;margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:10px"><svg viewBox="0 0 600 375" width="100%" style="font-family:Montserrat,Arial,sans-serif;font-weight:700"><rect width="600" height="375" fill="#fff" stroke="#0a1432" stroke-width="6"/><rect x="0" y="0" width="600" height="120" fill="#0a1432"/><text x="300" y="72" font-size="38" fill="#fdc400" text-anchor="middle">PRESTADOR AUTORIZADO</text>
  <text x="300" y="190" font-size="30" fill="#0a1432" text-anchor="middle">Empresa de Vistoria de</text><text x="300" y="230" font-size="30" fill="#0a1432" text-anchor="middle">Identificação Veicular</text><rect x="0" y="300" width="600" height="75" fill="#fdc400"/><text x="300" y="348" font-size="26" fill="#0a1432" text-anchor="middle">trânsito.mg · Coordenadoria Estadual de Gestão de Trânsito</text></svg>
  <p class="small muted">Representação esquemática: 60 × 37,5 cm, Montserrat Bold, #0a1432 e #fdc400, acrílico branco, plotter de recorte, backlight. A arte oficial é fornecida pela franqueadora/CET-MG.</p></div>`;
}

async function uploadDoc(id, kind, item, done, extra = {}) {
  const f = await pickFiles({ accept: kind === 'planta' ? 'application/pdf,image/*' : 'application/pdf,image/*' });
  if (!f.length) return;
  const fd = new FormData(); fd.append('kind', kind); if (item) fd.append('item', item); for (const [k, v] of Object.entries(extra)) fd.append(k, v); fd.append('file', f[0]);
  try { const r = await api('POST', `/api/laudos/${id}/files`, fd); if (r.meta?.aviso) toast(r.meta.aviso, 'err'); else toast('Documento enviado.', 'ok'); done && done(r); } catch (e) { showErr(e); }
}

// ---------- Anexo III: item com equipamentos ----------
function a3Body(d, it, f, item, ro) {
  const k = it.key;
  const Q = d.quantities;
  if (!it.eqType) {
    if (k === 'a3_9') return html`<div class="card"><h3>Evidência do reconhecimento facial</h3><p class="small">Não há leitor biométrico separado: o item é atendido pelo reconhecimento facial integrado ao sistema de vistoria. Quantidade de aparelhos: <b>0</b>.</p>
      <div id="itemPhotos"><div class="photos">${slotsFor(d, k, f).map((s) => photoCell(d.photos.find((p) => p.item === k && p.slot === s.slot), s, !ro))}</div></div>
      <label class="f" style="margin-top:10px">ou link do vídeo da função (Google Drive)</label><input id="bioVideo" value="${item.videoUrl || ''}" ${ro} placeholder="https://drive.google.com/…"></div>`;
    if (k === 'a3_15') return html`<div class="card"><h3>Comprovação</h3>${docLine(d, 'contrato_rede', 'Contrato de rede estruturada (ou documento equivalente)', ro)}<form id="fields" onsubmit="return false"><label class="f">Observação</label><input name="fields.obs" value="${f.obs || ''}" ${ro} placeholder="Ex.: Cat6, 1 ponto por box"></form></div>`;
    if (k === 'a3_17') return html`<div class="card"><h3>Internet</h3>${docLine(d, 'contrato_internet', 'Contrato de internet', ro)}<form id="fields" onsubmit="return false"><div class="grid g2">${inp('fields.upload', f.upload, ro, 'Velocidade de upload (Mb/s)', { hint: `mínimo ${d.params.equipamentos.uploadMbps} Mb/s` })}${inp('fields.operadora', f.operadora, ro, 'Operadora', { text: true })}</div></form>
      <div id="itemPhotos" style="margin-top:10px"><div class="photos">${slotsFor(d, k, f).map((s) => photoCell(d.photos.find((p) => p.item === k && p.slot === s.slot), s, !ro))}</div></div></div>`;
  }
  const eqs = d.equipment.filter((e) => e.type === it.eqType && e.status !== 'baixado');
  const need = Q[it.eqType] || 0;
  const vids = item.videos || {};
  return html`<div class="card"><div class="row between"><h3 style="margin:0">Equipamentos cadastrados: ${eqs.filter((e) => e.status === 'ativo').length} de ${need} exigidos</h3><a class="btn sm" href="#/laudo/${d.laudo.id}/equipamentos?tipo=${it.eqType}">${ro ? 'Ver' : 'Cadastrar / editar'} no cadastro da loja</a></div>
    <p class="small muted">Os equipamentos ficam no cadastro permanente da loja e são reaproveitados de um laudo para o outro.${it.cal ? ' Certificados de calibração e etiqueta visível são obrigatórios.' : ''}</p>
    ${k === 'a3_3' ? docLine(d, 'doc_boroscopio', 'Documento da resolução (manual, ficha técnica ou nota fiscal ≥ 800 × 600)', ro) : ''}
    ${k === 'a3_1' ? docLine(d, 'plano_calibracao', 'Plano de calibração e verificação metrológica (quando exigido)', ro) : ''}</div>
    ${eqs.map((e) => html`<div class="card" data-eq="${e.id}"><div class="row between"><div><b>${e.subtype ? S.cat.ELEVACAO[e.subtype] : e.description}</b> · ${[e.brand, e.model].filter(Boolean).join(' ')} <span class="muted small">· patrimônio ${e.patrimonio || '—'} · série ${e.serial || '—'}${e.box ? ' · ' + (e.box === 'movel' ? 'vistoria móvel' : e.box.replace('L', 'box ').replace('P', 'box pesado ')) : ''}</span></div>${e.status !== 'ativo' ? html`<span class="pill err">${e.status}</span>` : ''}</div>
      ${e.cert ? html`<div class="small" style="margin:4px 0">Certificado ${e.cert.numero || '—'} · validade ${fmtDate(e.cert.validade)} · ${e.cert.resultado || ''}</div>` : it.cal ? html`<div class="small" style="color:var(--err)">Sem certificado de calibração</div>` : ''}
      <div class="photos" style="margin-top:8px">${(S.cat.photoSlotsEq[e.type] || []).map((s) => photoCell(e.photos.find((p) => p.slot === s.slot), s, !ro))}</div>
      ${it.video ? html`<div style="margin-top:10px"><label class="f">Link do vídeo no Google Drive (${it.eqType === 'camera_fixa' ? 'gravado pelo sistema de vistoria' : 'gravação de tela do app'})</label>
        <div class="row" style="flex-wrap:nowrap"><input data-video="${e.id}" value="${vids[e.id]?.url || ''}" ${ro} placeholder="https://drive.google.com/file/d/…"><button class="btn" type="button" ${ro}>Testar link</button>${ro ? '' : html`<button class="btn" type="button" data-vupload="${e.id}" title="Alternativa: enviar o vídeo direto">⬆</button>`}</div>
        ${vids[e.id]?.test ? html`<div class="hint ${vids[e.id].test.status === 'fail' ? 'err' : ''}">${vids[e.id].test.status === 'ok' ? '✓ ' : vids[e.id].test.status === 'fail' ? '✗ ' : '? '}${vids[e.id].test.msg} · testado ${fmtDT(vids[e.id].test.at)}</div>` : ''}
        ${vids[e.id]?.test?.status === 'fail' ? html`<div class="note err small" style="margin-top:6px">Como liberar no Drive: abra o arquivo → Compartilhar → Acesso geral → "Qualquer pessoa com o link" → Leitor → Copiar link.</div>` : ''}</div>` : ''}</div>`)}
    ${!eqs.length ? html`<div class="card empty-state">Nenhum ${it.short.toLowerCase()} cadastrado. <a href="#/laudo/${d.laudo.id}/equipamentos?tipo=${it.eqType}&novo=1">Cadastrar agora</a></div>` : ''}
    <div class="card"><label class="f">Observações do item (vão para o PDF)</label><textarea id="obs" ${ro}>${item.obs || ''}</textarea></div>`;
}

// ---------- Documentos (Bloco A) ----------
export async function documents(id) {
  const d = await load(id);
  const ed = d.perms.editGeneral || (['devolvido', 'exigencia'].includes(d.laudo.status) && d.perms.storeRole);
  const rows = S.cat.DOCS.filter((x) => x.who !== 'rt');
  return {
    title: 'Documentos (Bloco A)', ctx: ctxOf(d),
    body: html`${statusBanner(d)}<div class="card"><p class="small muted">Cada arquivo deve ter no máximo 3 MB (limite do SCE). Arquivos pesados, como vídeos, ficam no Google Drive.</p>
      ${rows.map((x) => html`${docLine(d, x.kind, x.title + (x.optional ? ' (quando exigido)' : ''), ed ? '' : 'disabled', x.kind === 'incendio')}<div class="small muted" style="margin:-6px 0 8px">${x.note}</div>`)}
      <div class="list-item" style="padding-left:0"><div style="flex:1"><div class="t1">ART/RRT do laudo</div><div class="t2">${d.files.some((f) => f.kind === 'art') ? 'anexada' : 'providenciada pelo RT e anexada pela loja ou pela franqueadora'}</div></div></div>
      <div class="list-item" style="padding-left:0"><div style="flex:1"><div class="t1">Certificados de calibração</div><div class="t2">ficam no cadastro de cada equipamento</div></div><a class="btn sm" href="#/laudo/${id}/equipamentos">Abrir equipamentos</a></div></div>
      ${d.files.some((f) => f.kind === 'planta') ? html`<div class="card"><h3>Planta enviada</h3><img src="${d.files.filter((f) => f.kind === 'planta').pop().url}?v=image" style="max-width:100%;border:1px solid var(--line);border-radius:8px" alt="Planta"><p class="small muted">Em cada item do Anexo II, use "Marcar na planta". Se a planta mudar, refaça as marcações.</p></div>` : ''}`,
    mount(root) {
      const refresh = () => import('../app.js').then((m) => m.render());
      root.querySelectorAll('[data-docup]').forEach((b) => (b.onclick = () => uploadDoc(id, b.dataset.docup, null, refresh)));
      root.querySelectorAll('[data-delfile]').forEach((b) => (b.onclick = async () => { if (await confirmBox('Remover documento', 'O arquivo vai para a lixeira.', 'Remover', 'danger')) { await del('/api/files/' + b.dataset.delfile).catch(showErr); refresh(); } }));
    },
  };
}

// ---------- Equipamentos (B.17) ----------
const SPEC_FIELDS = {
  elevacao: { elevador: [['capacidade', 'Capacidade (kg)']], macaco: [['capacidade', 'Capacidade (kg)'], ['elevacao', 'Elevação (mm)']],
    rampas: [['elevacao', 'Elevação (mm)'], ['largura', 'Largura de cada rampa (mm)'], ['plana', 'Parte plana superior (mm)'], ['inclinacao', 'Inclinação (°)'], ['carga', 'Carga por rampa (kg)'], ['protecao', 'Proteção frontal (mm)'], ['distCentros', 'Distância entre centros (m)'], ['fixacao', 'Fixação anti-deslocamento', 'yn'], ['antiderrapante', 'Antiderrapante', 'yn'], ['semQuinas', 'Sem quinas vivas', 'yn'], ['centralizado', 'Centralizado no box', 'yn']],
    fosso: [['largura', 'Largura (cm)'], ['altura', 'Altura (m)'], ['comprimento', 'Comprimento (m)'], ['protecao', 'Proteção lateral (cm)'], ['escada', 'Escada', 'yn'], ['iluminacao', 'Iluminação fixa lateral e móvel', 'yn'], ['centralizado', 'Centralizado', 'yn']] },
  camera_fixa: [['resW', 'Resolução — largura (px)'], ['resH', 'Resolução — altura (px)']], boroscopio: [['resW', 'Resolução — largura (px)'], ['resH', 'Resolução — altura (px)']],
  servidor: [['cpu', 'Processador', 'text'], ['ram', 'RAM (GB)'], ['disco', 'Disco (TB)'], ['exclusivo', 'Uso exclusivo', 'yn']], nobreak: [['va', 'Potência (VA)']], roteador: [['portas', 'Redirecionamento de portas', 'yn']],
};
export async function equipment(id) {
  const d = await load(id);
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const Q = d.quantities;
  const types = S.cat.A3.filter((i) => i.eqType);
  const ed = d.perms.storeRole && (['nao_iniciado', 'rascunho', 'em_preenchimento'].includes(d.laudo.status) || (['devolvido', 'exigencia'].includes(d.laudo.status) && Object.entries(d.reviews).some(([k, r]) => k.startsWith('a3_') && r.status === 'devolvido'))) || d.perms.admin;
  const issues = d.issues.filter((i) => i.item && i.item.startsWith('a3_') && ['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C10', 'C12', 'E12', 'R20'].includes(i.code));
  return {
    title: 'Equipamentos da loja', ctx: ctxOf(d),
    actions: ed ? html`<button class="btn brand" id="novo">+ Novo equipamento</button>` : '',
    body: html`${!ed ? html`<div class="note" style="margin-bottom:12px">🔒 Os equipamentos estão travados nesta etapa do laudo.</div>` : ''}
    ${d.laudo.parent_laudo_id ? html`<div class="note warn" style="margin-bottom:12px">Renovação: os equipamentos foram reaproveitados. Confirme que cada um continua no local; certificados vencidos bloqueiam o envio.</div>` : ''}
    ${issues.length ? html`<div class="card"><h3>Problemas encontrados</h3>${issueList(issues)}</div>` : ''}
    <div class="card pad0"><div class="tablewrap"><table class="t resp"><thead><tr><th>Tipo</th><th>Qtd.</th><th>Descrição · marca · modelo</th><th>Patrimônio</th><th>Nº de série</th><th>Box</th><th>Certificado · validade</th><th>Situação</th><th></th></tr></thead><tbody>
      ${types.map((t) => { const list = d.equipment.filter((e) => e.type === t.eqType); const ok = list.filter((e) => e.status === 'ativo').length >= (Q[t.eqType] || 0); return html`
        <tr style="background:#FAFBFC" data-type="${t.eqType}"><td colspan="9"><b>${t.n}. ${t.title}</b> <span class="pill ${ok ? 'ok' : 'err'}">${list.filter((e) => e.status === 'ativo').length} de ${Q[t.eqType] || 0}</span>${ed ? html` <button class="btn sm" data-new="${t.eqType}">+ adicionar</button>` : ''}</td></tr>
        ${list.map((e) => { const venc = e.cert?.validade && new Date(e.cert.validade) < new Date(Date.now() + d.params.calibracao.alertaDias * 86400000); return html`<tr class="click" data-edit="${e.id}"><td data-l="Tipo">${t.short}${e.subtype ? ' · ' + S.cat.ELEVACAO[e.subtype] : ''}</td><td></td><td data-l="Descrição">${[e.description, e.brand, e.model].filter(Boolean).join(' · ')}</td><td data-l="Patrimônio">${e.patrimonio || html`<span style="color:var(--err)">—</span>`}</td><td data-l="Série">${e.serial || '—'}</td><td data-l="Box">${e.box ? (e.box === 'movel' ? 'Móvel' : e.box) : '—'}</td>
          <td data-l="Certificado">${t.cal ? (e.cert?.numero ? html`${e.cert.numero} · <span style="color:${venc ? 'var(--err)' : 'inherit'}">${fmtDate(e.cert.validade)}</span>` : html`<span style="color:var(--err)">sem certificado</span>`) : '—'}</td>
          <td data-l="Situação"><span class="pill ${e.status === 'ativo' ? 'ok' : 'err'}">${{ ativo: 'Ativo', manutencao: 'Em manutenção', baixado: 'Baixado' }[e.status]}</span>${d.laudo.parent_laudo_id && (!e.confirmed_at || e.confirmed_at < d.laudo.created_at) ? html` <span class="pill warn">confirmar</span>` : ''}</td><td>${e.photos.length}/${(S.cat.photoSlotsEq[e.type] || []).length} fotos</td></tr>`; })}`; })}
    </tbody></table></div></div>`,
    mount(root) {
      const refresh = () => import('../app.js').then((m) => m.render());
      const n = root.querySelector('#novo') || document.querySelector('#novo');
      if (n) n.onclick = () => eqModal(d, null, null, refresh, ed);
      root.querySelectorAll('[data-new]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); eqModal(d, null, b.dataset.new, refresh, ed); }));
      root.querySelectorAll('[data-edit]').forEach((r) => (r.onclick = () => eqModal(d, d.equipment.find((e) => e.id === +r.dataset.edit), null, refresh, ed)));
      if (q.get('novo') && ed) eqModal(d, null, q.get('tipo'), refresh, ed);
      else if (q.get('tipo')) root.querySelector(`[data-type="${q.get('tipo')}"]`)?.scrollIntoView({ block: 'center' });
    },
  };
}
function eqModal(d, e, type, refresh, ed) {
  e = e || { type: type || 'paquimetro', specs: {}, cert: null, status: 'ativo', photos: [], files: [] };
  const boxes = [...d.boxes, 'movel'];
  const nextPat = String(Math.max(0, ...d.equipment.map((x) => +x.patrimonio || 0)) + 1).padStart(3, '0');
  const ro = ed ? '' : 'disabled';
  const specRows = (t, sub) => { const sf = t === 'elevacao' ? (SPEC_FIELDS.elevacao[sub] || []) : SPEC_FIELDS[t] || []; return sf.map(([k, l, ty]) => ty === 'yn' ? yn('specs.' + k, e.specs?.[k], ro, l) : inp('specs.' + k, e.specs?.[k], ro, l, { text: ty === 'text' })); };
  const body = () => { const t = S.cat.A3.find((i) => i.eqType === e.type); return html`<form id="ef" onsubmit="return false"><div class="grid g3">
    <div><label class="f">Tipo</label><select name="type" ${e.id ? 'disabled' : ro}>${S.cat.A3.filter((i) => i.eqType).map((i) => html`<option value="${i.eqType}" ${i.eqType === e.type ? 'selected' : ''}>${i.n}. ${i.title}</option>`)}</select></div>
    ${e.type === 'elevacao' ? html`<div><label class="f">Equipamento de elevação</label><select name="subtype" ${ro}><option value="">—</option>${Object.entries(S.cat.ELEVACAO).map(([k, l]) => html`<option value="${k}" ${e.subtype === k ? 'selected' : ''}>${l}</option>`)}</select></div>` : ''}
    ${inp('description', e.description || t.title, ro, 'Descrição', { text: true })}${inp('brand', e.brand, ro, 'Marca', { text: true })}${inp('model', e.model, ro, 'Modelo', { text: true })}
    ${inp('patrimonio', e.patrimonio || (e.id ? '' : nextPat), ro, 'Nº de patrimônio *', { text: true, hint: 'Único na unidade (sequencial por loja).' })}${t.serial ? inp('serial', e.serial, ro, 'Nº de série *', { text: true }) : ''}
    ${t.perBox || e.type === 'elevacao' ? html`<div><label class="f">Box vinculado${t.perBox ? ' *' : ''}</label><select name="box" ${ro}><option value="">—</option>${boxes.map((b) => html`<option value="${b}" ${e.box === b ? 'selected' : ''}>${b === 'movel' ? 'Vistoria móvel' : b.replace('L', 'Box ').replace('P', 'Box pesado ')}</option>`)}</select></div>` : ''}
    <div><label class="f">Situação</label><select name="status" ${ro}>${[['ativo', 'Ativo'], ['manutencao', 'Em manutenção'], ['baixado', 'Baixado']].map(([k, l]) => html`<option value="${k}" ${e.status === k ? 'selected' : ''}>${l}</option>`)}</select><div class="hint">Só "Ativo" vai para o laudo.</div></div>
    ${specRows(e.type, e.subtype)}</div>
    ${t.cal ? html`<h4 style="margin-top:14px">Certificado de calibração</h4><div class="grid g3">${inp('cert.numero', e.cert?.numero, ro, 'Nº do certificado', { text: true, hint: 'Igual ao da etiqueta.' })}${inp('cert.laboratorio', e.cert?.laboratorio, ro, 'Laboratório', { text: true })}
      <div><label class="f">Data de calibração</label><input type="date" name="cert.dataCalibracao" value="${e.cert?.dataCalibracao || ''}" ${ro}></div><div><label class="f">Validade</label><input type="date" name="cert.validade" value="${e.cert?.validade || ''}" ${ro}></div>
      ${inp('cert.faixaMax', e.cert?.faixaMax, ro, 'Faixa de medição — máximo (mm)')}<div><label class="f">Resultado</label><select name="cert.resultado" ${ro}>${['', 'Aprovado', 'Reprovado / não calibrado'].map((r) => html`<option ${e.cert?.resultado === r ? 'selected' : ''}>${r}</option>`)}</select></div></div>
      ${e.id ? html`<div class="row" style="margin-top:8px">${(e.files || []).filter((f) => f.kind === 'certificado').map((f) => html`<a href="${f.url}" target="_blank" class="small">📄 ${f.name}</a>`)}${ed ? html`<button type="button" class="btn sm" id="certUp">${(e.files || []).some((f) => f.kind === 'certificado') ? 'Trocar PDF do certificado' : 'Enviar PDF do certificado'}</button>` : ''}</div>
        ${e.cert?.ocr ? html`<div class="note ${e.cert.ocr.divergencias?.length ? 'warn' : 'ok'} small" style="margin-top:6px">Leitura automática: ${e.cert.ocr.lido ? `nº ${e.cert.ocr.numero || '?'}, validade ${fmtDate(e.cert.ocr.validade)}, faixa ${e.cert.ocr.faixaMax ? '0–' + e.cert.ocr.faixaMax + ' mm' : '?'}, ${e.cert.ocr.resultado || 'resultado não identificado'}` : e.cert.ocr.obs}${e.cert.ocr.divergencias?.length ? html`<br><b>Divergências:</b> ${e.cert.ocr.divergencias.join('; ')}` : ''}</div>` : ''}` : html`<p class="small muted">Salve o equipamento para enviar o PDF do certificado.</p>`}` : ''}
    ${e.id ? html`<h4 style="margin-top:14px">Fotos</h4><div class="photos" id="eqph">${(S.cat.photoSlotsEq[e.type] || []).map((s) => photoCell(e.photos.find((p) => p.slot === s.slot), s, !!ed))}</div>` : ''}</form>`; };
  const m = modal({ title: e.id ? `Equipamento #${e.patrimonio}` : 'Novo equipamento', wide: true, body: body(),
    actions: [...(e.id && ed ? [{ label: 'Excluir', cls: 'danger', onClick: async () => { if (!(await confirmBox('Excluir equipamento', 'Vai para a lixeira por 90 dias.', 'Excluir', 'danger'))) return false; await del('/api/equipment/' + e.id); refresh(); } }] : []),
      ...(e.id && ed && d.laudo.parent_laudo_id ? [{ label: 'Confirmar que continua no local', onClick: async () => { await put('/api/equipment/' + e.id, { confirm: true }); toast('Confirmado.', 'ok'); refresh(); } }] : []),
      { label: 'Fechar' }, ...(ed ? [{ label: e.id ? 'Salvar' : 'Salvar e enviar fotos', cls: 'primary', onClick: async (el) => {
        const v = readForm(el.querySelector('#ef'));
        const body2 = { ...v, type: e.type };
        const saved = e.id ? await put('/api/equipment/' + e.id, body2) : await post(`/api/stores/${d.store.id}/equipment`, body2);
        toast('Equipamento salvo.', 'ok');
        if (!e.id) { refresh(); setTimeout(() => eqModal({ ...d, equipment: [...d.equipment, saved] }, saved, null, refresh, ed), 300); }
        else refresh();
      } }] : [])],
    onMount: (el) => bindEq(el) });
  function bindEq(el) {
    const tsel = el.querySelector('[name=type]');
    if (tsel && !e.id) tsel.onchange = () => { e.type = tsel.value; el.querySelector('.body').innerHTML = String(body()); bindEq(el); };
    const ssel = el.querySelector('[name=subtype]');
    if (ssel) ssel.onchange = () => { Object.assign(e, readForm(el.querySelector('#ef'))); e.subtype = ssel.value; el.querySelector('.body').innerHTML = String(body()); bindEq(el); };
    const cu = el.querySelector('#certUp');
    if (cu) cu.onclick = async () => {
      const f = await pickFiles({ accept: 'application/pdf' }); if (!f.length) return;
      const fd = new FormData(); fd.append('file', f[0]); fd.append('cert', JSON.stringify(readForm(el.querySelector('#ef')).cert || {}));
      try { const r = await api('POST', `/api/equipment/${e.id}/cert`, fd); Object.assign(e, r); el.querySelector('.body').innerHTML = String(body()); bindEq(el); toast(r.cert?.ocr?.divergencias?.length ? 'Certificado lido com divergências: confira.' : 'Certificado enviado e lido.', r.cert?.ocr?.divergencias?.length ? 'err' : 'ok'); } catch (er) { showErr(er); }
    };
    const ph = el.querySelector('#eqph');
    if (ph) bindPhotos(ph, { uploadUrl: `/api/equipment/${e.id}/photos`, photos: e.photos, editable: !!ed, tipFor: () => 'Etiqueta legível, sem reflexo.', onDone: async () => { const list = await get(`/api/stores/${d.store.id}/equipment`); Object.assign(e, list.find((x) => x.id === e.id)); el.querySelector('.body').innerHTML = String(body()); bindEq(el); } });
  }
}

// ---------- Envio para conferência (B.18) ----------
export async function submit(id) {
  const d = await load(id);
  const sub = d.issues.filter((i) => i.stage === 'submit');
  const B = sub.filter((i) => i.type === 'B'), A = sub.filter((i) => i.type === 'A');
  const dev = Object.entries(d.reviews).filter(([, r]) => r.status === 'devolvido');
  const canSubmit = d.perms.submit;
  const isResub = ['devolvido', 'exigencia'].includes(d.laudo.status);
  const where = (i) => i.item ? `#/laudo/${id}/item/${i.item}` : `#/laudo/${id}/dados`;
  const fixedAll = isResub ? dev.every(([k]) => d.statuses[k]?.status === 'completo') : true;
  return {
    title: 'Envio para validação', ctx: ctxOf(d),
    body: html`${statusBanner(d)}
    <div class="grid g3" style="margin-bottom:14px"><div class="kpi"><div class="l">Erros bloqueantes</div><div class="v" style="color:${B.length ? 'var(--err)' : 'var(--ok)'}">${B.length}</div></div><div class="kpi"><div class="l">Alertas (exigem justificativa)</div><div class="v" style="color:${A.length ? 'var(--warn)' : 'var(--ok)'}">${A.length}</div></div><div class="kpi"><div class="l">Progresso</div><div class="v">${d.progress}%</div></div></div>
    ${B.length ? html`<div class="card"><h3>Erros bloqueantes (vermelho) — impedem o envio</h3>${B.map((i) => html`<a class="issue B" href="${where(i)}" style="text-decoration:none"><span class="code">${i.code}</span><span style="flex:1">${i.item ? html`<b>${ITEM(i.item)?.short}:</b> ` : ''}${i.msg}</span><span>Corrigir ›</span></a>`)}</div>` : html`<div class="note ok" style="margin-bottom:14px">✓ Nenhum erro bloqueante.</div>`}
    ${A.length ? html`<div class="card"><h3>Alertas (amarelo) — podem seguir com justificativa</h3>${A.map((i) => html`<div class="issue A" style="display:block"><div class="row"><span class="code">${i.code}</span><span style="flex:1">${i.item ? html`<b>${ITEM(i.item)?.short}:</b> ` : ''}${i.msg}</span></div>
      <input class="just" data-id="${i.id}" style="margin-top:6px;background:#fff" placeholder="Justificativa (obrigatória)" value="${d.alertsJust[i.id]?.just || ''}" ${canSubmit ? '' : 'disabled'}>${d.alertsJust[i.id]?.accepted_at ? html`<div class="small" style="color:var(--ok)">✓ aceito pela franqueadora</div>` : ''}</div>`)}</div>` : ''}
    ${isResub ? html`<div class="card"><h3>Itens devolvidos</h3>${dev.length ? dev.map(([k, r]) => html`<div class="list-item"><span class="dot ${d.statuses[k]?.status === 'completo' ? 'ok' : 'err'}"></span><div style="flex:1"><div class="t1">${ITEM(k).short}</div><div class="t2">${r.reason}</div></div><a class="btn sm" href="#/laudo/${id}/item/${k}">Abrir</a></div>`) : html`<p class="muted">—</p>`}</div>` : ''}
    ${canSubmit ? html`<div class="card"><h3>Declaração de veracidade</h3><label class="check" style="align-items:flex-start"><input type="checkbox" id="ver"> <span>Declaro, como representante legal (${d.data.empresa?.repName || d.store.rep_name}), que as informações, medidas, fotos e vídeos apresentados são verdadeiros e retratam a situação atual da unidade. Este aceite fica registrado no histórico.</span></label>
      <button class="btn brand lg block" id="send" style="margin-top:12px" ${B.length ? 'disabled' : ''}>${isResub ? 'Reenviar para validação' : 'Enviar para validação'}</button>
      ${B.length ? html`<p class="small muted center">O botão habilita quando não houver erro bloqueante.</p>` : ''}</div>`
      : ''}
    <div class="card"><h3>Prévia dos documentos</h3><div class="row"><a class="btn" target="_blank" href="/api/laudos/${id}/preview/a2">Prévia do Anexo II</a><a class="btn" target="_blank" href="/api/laudos/${id}/preview/a3">Prévia do Anexo III</a></div><p class="small muted">A versão final é gerada e travada só quando o laudo estiver 100% validado.</p></div>`,
    mount(root) {
      root.querySelectorAll('.just').forEach((i) => (i.onchange = () => post(`/api/laudos/${id}/alerts/${encodeURIComponent(i.dataset.id)}/justify`, { just: i.value }).catch(showErr)));
      const s = root.querySelector('#send');
      if (s) s.onclick = async () => {
        for (const i of root.querySelectorAll('.just')) if (!i.value.trim()) return toast('Justifique todos os alertas.', 'err');
        if (!root.querySelector('#ver').checked) return toast('Aceite a declaração de veracidade.', 'err');
        s.disabled = true;
        try { for (const i of root.querySelectorAll('.just')) await post(`/api/laudos/${id}/alerts/${encodeURIComponent(i.dataset.id)}/justify`, { just: i.value }); await post(`/api/laudos/${id}/submit`, { veracidade: true }); toast('Enviado para validação da franqueadora!', 'ok'); location.hash = `#/laudo/${id}`; } catch (e) { showErr(e); s.disabled = false; }
      };
    },
  };
}

// ---------- Assinatura, pacote SCE e protocolo (B.23, B.24) ----------
export async function signing(id) {
  const d = await load(id);
  const v = d.versions[0];
  const docs = v?.docs || {};
  const st = d.laudo.status;
  const lock = ['aprovado_coord', 'revisao_tecnica', 'liberado_assinatura'].includes(st) || st === 'em_conferencia' ? await get(`/api/laudos/${id}/sign-lock`).catch(() => null) : null;
  const pkg = ['liberado_assinatura', 'pronto_protocolo', 'protocolado', 'exigencia', 'deferido', 'indeferido'].includes(st) ? await get(`/api/laudos/${id}/package`).catch(() => null) : null;
  const docCard = (k, title, who, can) => { const x = docs[k]; if (!x) return ''; const s = x.signed && !x.signed.invalidated_at ? x.signed : null; return html`<div class="card"><div class="row between"><div><b>${title}</b><div class="small muted">Assina: ${who}${k === 'a2' ? ' · o PDF assinado pelo RT é enviado pela loja ou pela franqueadora' : ''}</div></div>${s ? html`<span class="pill ok">✓ Assinado e conferido</span>` : html`<span class="pill warn">Aguardando assinatura</span>`}</div>
    ${s ? html`<p class="small" style="margin:8px 0 0">${s.method === 'firma' ? 'Firma reconhecida' : 'Assinatura gov.br válida'} · arquivo idêntico ao gerado · signatário ${s.signer || '—'} · ${fmtDT(s.at)} · ${fmtMB(s.size)}</p><a class="btn sm" href="/api/laudos/${id}/doc/${k}?signed=1" style="margin-top:6px">Baixar assinado</a>`
      : can ? html`<div class="row" style="margin-top:10px"><a class="btn" href="/api/laudos/${id}/doc/${k}">1. Baixar PDF para assinar</a><a class="btn" href="https://assinador.iti.br/" target="_blank" rel="noopener">2. Abrir assinador gov.br ↗</a><button class="btn primary" data-up="${k}">3. Enviar PDF assinado</button>${k === 'a3' ? html`<button class="btn" data-firma="a3">Enviar via com firma reconhecida</button>` : ''}</div>
        <div class="note small" style="margin-top:8px">Assine no gov.br <b>sem abrir e salvar o arquivo em outro programa</b>. Se o arquivo for alterado, o sistema recusa.</div>
        ${S.me.demo ? html`<div class="row small" style="margin-top:6px"><span class="muted">Modo demonstração:</span><button class="btn link" data-demo="${k}">simular assinatura gov.br</button><button class="btn link" data-demo-bad="${k}">simular assinante errado</button></div>` : ''}<div id="res-${k}"></div>` : html`<p class="small muted">Aguardando o signatário.</p>`}
    <div class="small muted" style="margin-top:6px">Arquivo gerado: ${fmtMB(x.size)} · SHA-256 ${x.sha.slice(0, 20)}…</div></div>`; };
  return {
    title: 'Assinatura e protocolo', ctx: ctxOf(d),
    body: html`${statusBanner(d)}
    ${lock ? html`<div class="card"><h3>Condições para assinar (${lock.conds.filter((c) => c.ok).length} de 7)</h3>${lock.conds.map((c) => html`<div class="list-item"><span class="dot ${c.ok ? 'ok' : 'err'}"></span><div style="flex:1"><div class="t1">${c.msg}</div>${c.detail ? html`<div class="t2">${c.detail}</div>` : ''}</div></div>`)}</div>` : ''}
    ${st === 'liberado_assinatura' || st === 'pronto_protocolo' || st === 'protocolado' || st === 'deferido' ? html`<div class="note ok" style="margin-bottom:12px"><b>Laudo 100% validado.</b> Os documentos foram gerados e travados (versão ${v?.code}).</div>
      ${docCard('a2', 'Anexo II · Laudo Técnico', `${d.rt?.name} (RT) · ${d.rt?.council} ${d.rt?.reg_number}`, d.perms.signA2)}${docCard('a3', 'Anexo III · Declaração de Equipamentos', `${d.data.empresa?.repName || d.store.rep_name} (representante legal)`, d.perms.signA3)}` : ''}
    ${pkg ? html`<div class="card"><h3>Pacote para o SCE</h3><p class="small muted">Limite do SCE: 3 MB por arquivo; um Anexo não pode ser dividido. A compressão acontece antes da assinatura.</p>
      <table class="t"><tbody>${pkg.files.map((f) => html`<tr><td>${f.name}</td><td style="width:180px">${bar(f.pct)}<span class="small ${f.over ? '' : 'muted'}" style="color:${f.over ? 'var(--err)' : ''}">${fmtMB(f.size)} · ${f.pct}% do limite</span></td><td><a class="btn sm" href="${f.url}" target="_blank">Baixar</a></td></tr>`)}</tbody></table>
      ${pkg.consulta ? html`<p class="small" style="margin-top:8px">Link de consulta (originais e vídeos): <a href="${pkg.consulta}" target="_blank">${pkg.consulta}</a></p>` : ''}</div>` : ''}
    ${st === 'pronto_protocolo' && d.perms.protocol ? html`<div class="card"><h3>Registrar protocolo no SCE</h3><form id="pf" class="grid g3"><div><label class="f">Número do protocolo</label><input name="numero" required></div><div><label class="f">Data</label><input type="date" name="data" required></div><div style="align-self:end"><button class="btn brand block">Registrar protocolo</button></div></form></div>` : ''}
    ${d.laudo.protocol ? html`<div class="card"><h3>Protocolo</h3><p>Nº <b>${d.laudo.protocol.numero}</b> em ${fmtDate(d.laudo.protocol.data)} · registrado por ${d.laudo.protocol.by}</p></div>` : ''}
    ${st === 'protocolado' && (d.perms.protocol || d.perms.result) ? html`<div class="grid g2"><div class="card"><h3>Exigência da CET-MG</h3><form id="ef" class="stack"><textarea name="texto" placeholder="Texto da exigência recebida no SCE" required></textarea><div class="grid g2"><div><label class="f">Data</label><input type="date" name="data"></div><div><label class="f">Prazo para resposta</label><input type="date" name="prazo" required></div></div><button class="btn danger">Registrar exigência</button></form></div>
      <div class="card"><h3>Resultado</h3><form id="rf" class="stack"><select name="result"><option value="deferido">Deferido</option><option value="indeferido">Indeferido</option></select><input name="portaria" placeholder="Portaria de credenciamento"><div><label class="f">Validade do credenciamento</label><input type="date" name="validade"></div><textarea name="obs" placeholder="Observações / recurso"></textarea><button class="btn ok">Registrar resultado</button></form></div></div>` : ''}
    ${d.laudo.exigencia ? html`<div class="card"><h3>Exigência da CET-MG</h3><p>${d.laudo.exigencia.texto}</p><p class="small muted">Recebida ${fmtDate(d.laudo.exigencia.data)} · prazo ${fmtDate(d.laudo.exigencia.prazo)} (${Math.ceil((new Date(d.laudo.exigencia.prazo) - Date.now()) / 86400000)} dias) · itens afetados: ${(d.laudo.exigencia.items || []).map((k) => ITEM(k).short).join(', ') || 'a definir pela franqueadora/coordenador'}</p>
      ${d.perms.exigenciaItems && !(d.laudo.exigencia.items || []).length ? html`<form id="xf"><div class="grid g2">${['II', 'III'].map((a) => html`<div><h4>Anexo ${a}</h4>${(a === 'II' ? S.cat.A2 : S.cat.A3).filter((i) => d.scope.includes(i.key)).map((i) => html`<label class="check" style="display:flex;margin:4px 0"><input type="checkbox" value="${i.key}"> ${i.n}. ${i.title}</label>`)}</div>`)}</div><button class="btn danger">Reabrir só estes itens</button></form>` : ''}</div>` : ''}
    ${d.laudo.result ? html`<div class="card"><h3>${d.laudo.result.result === 'deferido' ? '✓ Deferido' : 'Indeferido'}</h3><p>${d.laudo.result.portaria || ''} ${d.laudo.result.validade ? '· válido até ' + fmtDate(d.laudo.result.validade) : ''}</p>${d.laudo.result.obs ? html`<p class="small">${d.laudo.result.obs}</p>` : ''}</div>` : ''}
    ${!lock && !pkg && !d.laudo.protocol ? html`<div class="card empty-state">A assinatura é liberada quando o laudo estiver 100% validado: validado pela franqueadora e com a revisão técnica concluída.</div>` : ''}`,
    mount(root) {
      const refresh = () => import('../app.js').then((m) => m.render());
      const showRes = (k, checks, ok) => { const el = root.querySelector('#res-' + k); if (el) el.innerHTML = String(html`<div class="note ${ok ? 'ok' : 'err'}" style="margin-top:8px">${(checks || []).map((c) => html`<div>${c.ok ? '✓' : '✗'} ${c.msg}</div>`)}</div>`); };
      root.querySelectorAll('[data-up],[data-firma]').forEach((b) => (b.onclick = async () => {
        const k = b.dataset.up || b.dataset.firma;
        const f = await pickFiles({ accept: 'application/pdf' }); if (!f.length) return;
        const fd = new FormData(); fd.append('file', f[0]); if (b.dataset.firma) fd.append('method', 'firma');
        try { const r = await api('POST', `/api/laudos/${id}/signed/${k}`, fd); toast('Documento assinado recebido e conferido.', 'ok'); showRes(k, r.checks, true); setTimeout(refresh, 1200); } catch (e) { showErr(e); showRes(k, e.data?.checks, false); }
      }));
      root.querySelectorAll('[data-demo],[data-demo-bad]').forEach((b) => (b.onclick = async () => {
        const k = b.dataset.demo || b.dataset.demoBad;
        try { const r = await post(`/api/laudos/${id}/demo-sign/${k}`, { wrongSigner: !!b.dataset.demoBad }); toast('Assinatura simulada conferida.', 'ok'); showRes(k, r.checks, true); setTimeout(refresh, 1200); } catch (e) { showErr(e); showRes(k, e.data?.checks, false); }
      }));
      const pf = root.querySelector('#pf'); if (pf) pf.onsubmit = async (e) => { e.preventDefault(); try { await post(`/api/laudos/${id}/protocol`, readForm(pf)); toast('Protocolo registrado.', 'ok'); refresh(); } catch (er) { showErr(er); } };
      const ef = root.querySelector('#ef'); if (ef) ef.onsubmit = async (e) => { e.preventDefault(); try { await post(`/api/laudos/${id}/exigencia`, readForm(ef)); toast('Exigência registrada.', 'ok'); refresh(); } catch (er) { showErr(er); } };
      const rf = root.querySelector('#rf'); if (rf) rf.onsubmit = async (e) => { e.preventDefault(); try { await post(`/api/laudos/${id}/result`, readForm(rf)); toast('Resultado registrado.', 'ok'); refresh(); } catch (er) { showErr(er); } };
      const xf = root.querySelector('#xf'); if (xf) xf.onsubmit = async (e) => { e.preventDefault(); const items = [...xf.querySelectorAll('input:checked')].map((x) => x.value); try { await post(`/api/laudos/${id}/exigencia/items`, { items }); toast('Itens reabertos.', 'ok'); refresh(); } catch (er) { showErr(er); } };
    },
  };
}

// ---------- Versões e link de consulta (B.25) ----------
export async function versions(id) {
  const d = await load(id);
  return {
    title: 'Versões do laudo e link de consulta', ctx: ctxOf(d),
    body: html`<div class="card pad0">${d.versions.length ? d.versions.map((v, i) => html`<div class="list-item" style="align-items:flex-start"><div class="ic" style="width:40px;height:40px;border-radius:8px;background:${i ? '#EEF0F4' : 'var(--ok-bg)'};display:grid;place-items:center;font-weight:700">v${v.n}</div>
      <div style="flex:1"><div class="t1">${v.code} ${i ? html`<span class="pill">substituída</span>` : html`<span class="pill ok">vigente</span>`}${v.revoked ? html` <span class="pill err">link revogado</span>` : ''}</div><div class="t2">${v.reason} · ${fmtDT(v.created_at)} · ${v.views} acesso(s)${v.has_password ? ' · com senha' : ''}${v.access_until ? ' · válido até ' + fmtDate(v.access_until) : ''}${Object.keys(v.docs).length ? ' · ' + Object.entries(v.docs).map(([k, x]) => `${k === 'a2' ? 'Anexo II' : 'Anexo III'} ${fmtMB(x.size)}${x.signed ? (x.signed.invalidated_at ? ' (assinatura invalidada)' : ' ✓ assinado') : ''}`).join(' · ') : ''}</div>
        <div class="row" style="margin-top:6px"><a class="btn sm" href="/c/${v.code}" target="_blank">Abrir consulta</a><button class="btn sm" data-qr="${v.code}">QR code</button>${d.perms.versionsManage ? html`<button class="btn sm" data-cfg="${v.id}">Acesso</button>` : ''}</div></div></div>`) : html`<div class="empty-state">As versões são criadas a cada envio, devolução, exigência e liberação para assinatura.</div>`}</div>`,
    mount(root) {
      root.querySelectorAll('[data-qr]').forEach((b) => (b.onclick = () => { const url = `${location.origin}/c/${b.dataset.qr}`; modal({ title: 'QR code da consulta', body: html`<p class="small">${url}</p><img alt="QR" style="width:220px;display:block;margin:0 auto" src="/api/qr?data=${encodeURIComponent(url)}">` }); }));
      root.querySelectorAll('[data-cfg]').forEach((b) => (b.onclick = () => modal({ title: 'Controle de acesso do link', body: html`<p class="small muted">Por padrão, aberto a quem tem o link. CPFs ficam mascarados.</p><label class="f">Senha (opcional)</label><input id="pw" type="password" placeholder="deixe vazio para sem senha"><label class="f" style="margin-top:8px">Válido até (opcional)</label><input id="until" type="date">`,
        actions: [{ label: 'Revogar e gerar novo', cls: 'danger', onClick: async () => { await put('/api/versions/' + b.dataset.cfg, { regenerate: true }); toast('Novo link gerado.', 'ok'); } }, { label: 'Salvar', cls: 'primary', onClick: async (m) => { await put('/api/versions/' + b.dataset.cfg, { password: m.querySelector('#pw').value, until: m.querySelector('#until').value }); toast('Acesso atualizado.', 'ok'); import('../app.js').then((x) => x.render()); } }] })));
    },
  };
}

export async function timeline(id) {
  const d = await load(id);
  const tl = await get(`/api/laudos/${id}/timeline`);
  return { title: 'Linha do tempo do laudo', ctx: ctxOf(d), body: html`<div class="card pad0">${tl.map((r) => html`<div class="list-item"><span class="dot info"></span><div style="flex:1"><div class="t1">${r.action}${r.item ? ' · ' + (ITEM(r.item)?.short || r.item) : ''}</div><div class="t2">${r.user_name || 'sistema'} · ${fmtDT(r.at)}${r.after && r.after.status ? ' → ' + r.after.status : ''}</div></div></div>`)}</div>` };
}

// ---------- Responsáveis técnicos (cadastro, sem acesso ao sistema) ----------
export async function rtsView(id) {
  const d = await load(id);
  return {
    title: 'Responsáveis técnicos', ctx: ctxOf(d),
    body: html`<div class="card pad0">${d.rts.map((r) => html`<div class="list-item"><div class="avatar">${r.name[0]}</div><div style="flex:1"><div class="t1">${r.name} ${r.id === d.laudo.rt_id ? html`<span class="pill info">indicado neste laudo</span>` : ''}</div><div class="t2">${r.council} ${r.reg_number} / ${r.uf} · ${r.validated ? '✓ registro validado pela franqueadora' : 'registro ainda não validado'}</div></div></div>`)}</div>
    ${d.perms.storeRole === 'loja' || d.perms.admin || has('franqueadora') ? html`<div class="card"><h3>Cadastrar novo RT</h3><p class="small muted">Pode ser um engenheiro ou arquiteto diferente por loja. Ele não acessa o sistema: os dados entram no Anexo II e a ART/RRT e o PDF assinado por ele são anexados pela loja ou pela franqueadora.</p>
      <form id="rf" class="grid g3"><div><label class="f">Nome *</label><input name="name" required></div><div><label class="f">CPF</label><input name="cpf"></div><div><label class="f">Conselho *</label><select name="council"><option>CREA</option><option>CAU</option></select></div><div><label class="f">Nº de registro *</label><input name="reg_number" required></div><div><label class="f">UF</label><input name="uf" value="MG"></div><div><label class="f">E-mail</label><input name="email" type="email"></div><div><label class="f">WhatsApp</label><input name="phone"></div><div style="align-self:end"><button class="btn brand block">Cadastrar e indicar</button></div></form></div>` : ''}`,
    mount(root) {
      const f = root.querySelector('#rf');
      if (f) f.onsubmit = async (e) => { e.preventDefault(); try { const r = await post('/api/rts', readForm(f)); if (d.perms.editGeneral && d.data.etapa1?.savedAt) { await put(`/api/laudos/${id}/etapa1`, { etapa1: d.data.etapa1, empresa: d.data.empresa || {}, rt_id: r.id }); toast('RT cadastrado e indicado no laudo.', 'ok'); } else toast('RT cadastrado. Indique-o na Etapa 1 (Dados do processo).', 'ok'); import('../app.js').then((m) => m.render()); } catch (er) { showErr(er); } };
    },
  };
}
