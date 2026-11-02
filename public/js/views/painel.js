// Painel da Franqueadora: visão geral, lojas, cadastro, importação, solicitação, matriz e notificações.
import { S, html, raw, get, post, put, toast, showErr, modal, confirmBox, fmtDate, fmtDT, cnpjMask, statusPill, brandPill, bar, has, readForm, esc } from '../core.js';

const porteL = (p) => (p ? S.cat.PORTE_LABEL[p] : '—');

export async function dashboard() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = await get('/api/dashboard?' + q.toString());
  const c = d.counts;
  const opt = (list, val, key = 'id', lab = 'name') => list.map((x) => html`<option value="${x[key]}" ${String(val) === String(x[key]) ? 'selected' : ''}>${x[lab]}</option>`);
  const canAct = has('franqueadora') || has('admin');
  return {
    title: 'Visão geral',
    actions: canAct ? html`<a class="btn yellow hide-m" href="#/solicitar">+ Solicitar preenchimento</a>` : '',
    body: html`
    <div class="row" style="margin-bottom:14px">
      <select id="fb" style="max-width:190px"><option value="">Marca: todas</option>${opt(d.filters.brands, q.get('brand'))}</select>
      <select id="fc" style="max-width:220px"><option value="">Coordenador: todos</option>${opt(d.filters.coordinators, q.get('coord'))}</select>
      <select id="fm" style="max-width:220px"><option value="">Município: todos</option>${opt(d.filters.municipios, q.get('mun'), 'ibge')}</select>
    </div>
    <div class="kpis">
      ${[['Lojas ativas', c.lojas, ''], ['Não iniciado', c.nao_iniciado, '#5B6275'], ['Em preenchimento', c.em_preenchimento, 'var(--info)'], ['Em conferência', c.em_conferencia, '#6D28D9'], ['Devolvido', c.devolvido, 'var(--err)'], ['Liberado p/ assinatura', c.liberado_assinatura, 'var(--warn)'], ['Protocolado', c.protocolado, 'var(--ok)'], ['Deferido (sem pedido)', c.deferido, 'var(--ok)']]
        .map(([l, v, col]) => html`<div class="kpi"><div class="l">${l}</div><div class="v" style="color:${col || 'inherit'}">${v}</div></div>`)}
    </div>
    <div class="split">
      <div class="card pad0">
        <div class="row between" style="padding:14px 16px"><h3 style="margin:0">Quem está faltando</h3>${canAct ? html`<button class="btn sm" id="cobrarSel">Cobrar selecionados</button>` : ''}</div>
        <div class="tablewrap"><table class="t resp"><thead><tr>${canAct ? html`<th></th>` : ''}<th>Loja</th><th>Marca</th><th>Município · porte</th><th>Situação</th><th>Checklist</th><th>Parado há</th><th></th></tr></thead><tbody>
          ${d.missing.length ? d.missing.map((m) => html`<tr>${canAct ? html`<td><input type="checkbox" class="sel" value="${m.store.id}"></td>` : ''}
            <td data-l="Loja"><b>${m.store.fantasia}</b><div class="small muted">${m.code}</div></td><td data-l="Marca">${brandPill(m.store.brand, m.store.brand_slug)}</td>
            <td data-l="Município">${m.store.municipio} · ${porteL(m.porte)}</td><td data-l="Situação">${statusPill(m.status, m.statusLabel)}${m.status === 'nao_iniciado' && !m.linkOpened ? html`<div class="small muted">link não aberto</div>` : ''}</td>
            <td data-l="Checklist" style="min-width:110px">${bar(m.progress)}<span class="small muted">${m.progress}%</span></td><td data-l="Parado há">${m.idleDays} dia(s)</td>
            <td>${canAct ? html`<button class="btn sm" data-cobrar="${m.store.id}">Cobrar</button>` : ''}</td></tr>`) : html`<tr><td colspan="8" class="empty-state">Nenhuma loja parada ou sem iniciar. 🎉</td></tr>`}
        </tbody></table></div>
      </div>
      <div>
        <div class="card"><h3>Alertas</h3>
          ${d.alerts.venc.filter((a) => a.dias <= 90).length ? html`<div class="note err" style="margin-bottom:8px"><b>${d.alerts.venc.filter((a) => a.dias <= 90).length}</b> credenciamento(s) vencem em menos de 90 dias: ${d.alerts.venc.filter((a) => a.dias <= 90).map((a) => `${a.store} (${a.dias} d)`).join(', ')}</div>` : ''}
          ${d.alerts.venc.filter((a) => a.dias > 90).length ? html`<div class="note warn" style="margin-bottom:8px">${d.alerts.venc.filter((a) => a.dias > 90).map((a) => `${a.store}: vence em ${a.dias} dias`).join(' · ')}</div>` : ''}
          ${d.alerts.calib.length ? html`<div class="note warn" style="margin-bottom:8px"><b>${d.alerts.calib.length}</b> certificado(s) de calibração vencem em 30 dias.</div>` : ''}
          ${d.alerts.drive.length ? html`<div class="note warn" style="margin-bottom:8px"><b>${d.alerts.drive.length}</b> link(s) do Drive sem acesso público.</div>` : ''}
          ${d.alerts.exig.map((x) => html`<div class="note err" style="margin-bottom:8px">Exigência CET-MG · ${x.store}: prazo ${fmtDate(x.prazo)} (${x.dias} dia(s))</div>`)}
          ${!d.alerts.venc.length && !d.alerts.calib.length && !d.alerts.drive.length && !d.alerts.exig.length ? html`<p class="muted small">Sem alertas.</p>` : ''}
        </div>
        <div class="card"><h3>Motivos de devolução (30 dias)</h3>
          ${d.reasons.length ? html`<table class="t"><tbody>${d.reasons.map(([r, n]) => html`<tr><td>${r}</td><td class="right"><b>${n}</b></td></tr>`)}</tbody></table>` : html`<p class="muted small">Nenhuma devolução no período.</p>`}
          ${d.avgReviewHours != null ? html`<p class="small muted" style="margin-top:10px">Tempo médio de conferência: <b>${d.avgReviewHours < 48 ? d.avgReviewHours.toFixed(1) + ' h' : (d.avgReviewHours / 24).toFixed(1) + ' dias'}</b></p>` : ''}
        </div>
      </div>
    </div>`,
    mount(root) {
      const upd = () => { const p = new URLSearchParams(); for (const [id, k] of [['fb', 'brand'], ['fc', 'coord'], ['fm', 'mun']]) { const v = root.querySelector('#' + id).value; if (v) p.set(k, v); } location.hash = '#/painel?' + p; };
      root.querySelectorAll('#fb,#fc,#fm').forEach((s) => (s.onchange = upd));
      const cobrar = async (ids) => { for (const id of ids) await post(`/api/stores/${id}/send-link`, { channel: 'whatsapp', kind: 'cobranca' }).catch(showErr); toast(`Cobrança enviada para ${ids.length} loja(s).`, 'ok'); };
      root.querySelectorAll('[data-cobrar]').forEach((b) => (b.onclick = () => cobrar([b.dataset.cobrar])));
      const cs = root.querySelector('#cobrarSel');
      if (cs) cs.onclick = () => { const ids = [...root.querySelectorAll('.sel:checked')].map((x) => x.value); if (!ids.length) return toast('Selecione as lojas.', 'err'); cobrar(ids); };
    },
  };
}

export async function stores() {
  const list = await get('/api/stores');
  const canAct = has('franqueadora') || has('admin');
  return {
    title: 'Lojas',
    actions: canAct ? html`<a class="btn hide-m" href="#/importar">Importar planilha</a><a class="btn primary" href="#/lojas/nova">+ Cadastrar loja</a>` : '',
    body: html`
    <div class="row" style="margin-bottom:12px"><input id="q" placeholder="Buscar por nome, CNPJ ou município" style="max-width:340px">
      <select id="fb" style="max-width:170px"><option value="">Todas as marcas</option>${S.me.brands.map((b) => html`<option value="${b.id}">${b.name}</option>`)}</select>
      <span class="spacer"></span>${canAct ? html`<button class="btn" id="reqSel">Solicitar preenchimento dos selecionados</button>` : ''}<a class="btn" href="/api/reports/stores.csv">Exportar (Excel)</a></div>
    <div class="card pad0"><div class="tablewrap"><table class="t resp"><thead><tr>${canAct ? html`<th><input type="checkbox" id="all"></th>` : ''}<th>Loja</th><th>Marca</th><th>CNPJ</th><th>Município · porte</th><th>Franqueado</th><th>Processo em andamento</th><th>Link</th><th></th></tr></thead><tbody>
      ${list.map((s) => html`<tr data-s="${[s.fantasia, s.cnpj, s.municipio?.name].join(' ').toLowerCase()}" data-b="${s.brand_id}">
        ${canAct ? html`<td><input type="checkbox" class="sel" value="${s.id}"></td>` : ''}
        <td data-l="Loja"><b>${s.fantasia}</b>${s.status !== 'ativa' ? html` <span class="pill">${s.status}</span>` : ''}${s.situacao_cadastral && s.situacao_cadastral !== 'ATIVA' ? html` <span class="pill err">CNPJ ${s.situacao_cadastral}</span>` : ''}</td>
        <td data-l="Marca">${brandPill(s.brand?.name, s.brand?.slug)}</td><td data-l="CNPJ" class="nowrap">${cnpjMask(s.cnpj)}</td>
        <td data-l="Município">${s.municipio?.name || '—'} · ${porteL(s.porte)}</td><td data-l="Franqueado">${s.franchisee?.name || html`<span class="muted">—</span>`}</td>
        <td data-l="Processo">${s.laudo ? html`<a href="#/laudo/${s.laudo.id}">${s.laudo.code}</a> ${statusPill(s.laudo.status, s.laudo.statusLabel)}<div style="max-width:120px">${bar(s.laudo.progress)}</div>` : s.lastLaudo ? html`<span class="muted small">Último: ${s.lastLaudo.statusLabel}</span>` : html`<span class="muted">—</span>`}</td>
        <td data-l="Link">${s.franchisee ? (s.franchisee.link_opened_at ? html`<span class="pill ok">aberto</span>` : html`<span class="pill">não aberto</span>`) : '—'}</td>
        <td class="nowrap">${canAct ? html`<a class="btn sm" href="#/lojas/${s.id}">Editar</a> <button class="btn sm" data-link="${s.id}">Enviar link</button>` : ''}</td></tr>`)}
    </tbody></table></div></div>`,
    mount(root) {
      const filt = () => { const q = root.querySelector('#q').value.toLowerCase(), b = root.querySelector('#fb').value; root.querySelectorAll('tbody tr').forEach((tr) => (tr.hidden = (q && !tr.dataset.s.includes(q)) || (b && tr.dataset.b !== b))); };
      root.querySelector('#q').oninput = filt; root.querySelector('#fb').onchange = filt;
      const all = root.querySelector('#all'); if (all) all.onchange = () => root.querySelectorAll('tr:not([hidden]) .sel').forEach((c) => (c.checked = all.checked));
      const rs = root.querySelector('#reqSel'); if (rs) rs.onclick = () => { const ids = [...root.querySelectorAll('.sel:checked')].map((x) => x.value); if (!ids.length) return toast('Selecione as lojas.', 'err'); location.hash = '#/solicitar?ids=' + ids.join(','); };
      root.querySelectorAll('[data-link]').forEach((b) => (b.onclick = () => sendLinkModal(b.dataset.link)));
    },
  };
}

export function sendLinkModal(storeId) {
  modal({ title: 'Enviar link de acesso', body: html`<p>O link é pessoal e abre direto na área da loja, sem senha. A mensagem usa a identidade da marca da loja.</p>
    <div class="seg" id="ch"><button class="on" data-v="whatsapp">WhatsApp</button><button data-v="email">E-mail</button><button data-v="copy">Copiar link</button></div><div id="out" style="margin-top:12px"></div>`,
    actions: [{ label: 'Fechar' }, { label: 'Enviar', cls: 'primary', onClick: async (m) => {
      const ch = m.querySelector('#ch .on').dataset.v;
      const r = await post(`/api/stores/${storeId}/send-link`, { channel: ch });
      if (ch === 'copy') { await navigator.clipboard?.writeText(r.link).catch(() => {}); m.querySelector('#out').innerHTML = String(html`<label class="f">Link copiado:</label><input readonly value="${r.link}" onclick="this.select()">`); return false; }
      toast('Link enviado.', 'ok');
    } }],
    onMount: (m) => m.querySelectorAll('#ch button').forEach((b) => (b.onclick = () => { m.querySelectorAll('#ch button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); })) });
}

export async function storeForm(id) {
  const [s, users, muns] = await Promise.all([id ? get('/api/stores/' + id) : null, get('/api/users').catch(() => []), get('/api/municipios?limit=900')]);
  const coords = users.filter((u) => u.roles.includes('coordenador'));
  const v = s || { status: 'ativa' };
  const fr = s?.franchisee || {};
  const qsa = (s?.cnpj_data?.qsa) || [];
  return {
    title: s ? `Loja · ${s.fantasia}` : 'Cadastro de loja', narrow: false,
    body: html`<form id="f" class="split">
      <div>
        <div class="card"><h3>Empresa ${s?.cnpj_checked_at ? html`<span class="pill ok" style="margin-left:auto">✓ carregado pelo CNPJ em ${fmtDate(s.cnpj_checked_at)} · ${s.cnpj_source}</span>` : ''}</h3>
          <div class="grid g2">
            <div><label class="f">CNPJ *</label><div class="row" style="flex-wrap:nowrap"><input name="cnpj" value="${cnpjMask(v.cnpj)}" placeholder="00.000.000/0000-00" required ${s ? 'readonly' : ''}><button type="button" class="btn" id="cnpjBtn">${s ? 'Atualizar pelo CNPJ' : 'Consultar'}</button></div><div class="hint" id="cnpjHint"></div></div>
            <div><label class="f">Situação cadastral (Receita)</label><input name="situacao_cadastral" value="${v.situacao_cadastral || ''}" readonly data-keep="1"></div>
            <div><label class="f">Razão social *</label><input name="razao" value="${v.razao || ''}" required></div>
            <div><label class="f">Nome fantasia *</label><input name="fantasia" value="${v.fantasia || ''}" required><div class="hint">Não pode conter Detran, CET ou Seplag (art. 8º §3º).</div></div>
            <div style="grid-column:1/-1"><label class="f">Endereço completo</label><input name="address" value="${v.address || ''}"></div>
            <div><label class="f">CEP</label><input name="cep" value="${v.cep || ''}"></div>
            <div><label class="f">Município (MG) *</label><select name="municipio_ibge" required><option value="">Selecione</option>${muns.map((m) => html`<option value="${m.ibge}" ${m.ibge === v.municipio_ibge ? 'selected' : ''}>${m.name}</option>`)}</select></div>
          </div></div>
        <div class="card"><h3>Representante legal</h3>
          ${qsa.length ? html`<label class="f">Quadro de sócios (QSA da Receita)</label><div class="row" style="margin-bottom:10px">${qsa.map((q) => html`<button type="button" class="btn sm" data-qsa="${q.nome}" data-q="${q.qualificacao}">${q.nome} · ${q.qualificacao}</button>`)}</div>` : ''}
          <div class="grid g3"><div><label class="f">Nome</label><input name="rep_name" value="${v.rep_name || ''}"></div><div><label class="f">CPF (completo)</label><input name="rep_cpf" value="${v.rep_cpf || ''}" placeholder="A Receita mostra o CPF mascarado"></div><div><label class="f">Cargo/função</label><input name="rep_role" value="${v.rep_role || ''}"></div></div></div>
        <div class="card"><h3>Franqueado (recebe o link pessoal)</h3>
          <div class="grid g3"><div><label class="f">Nome *</label><input name="franchisee_name" value="${fr.name || ''}"></div><div><label class="f">E-mail</label><input name="franchisee_email" type="email" value="${fr.email || ''}"></div><div><label class="f">WhatsApp</label><input name="franchisee_phone" value="${fr.phone || ''}"></div></div>
          ${s && fr.id ? html`<div class="row" style="margin-top:10px"><span class="small muted">Link ${fr.link_opened_at ? 'aberto em ' + fmtDT(fr.link_opened_at) : 'ainda não aberto'} · último acesso ${fmtDT(fr.last_access_at)}</span><span class="spacer"></span><button type="button" class="btn sm" id="sendLink">Enviar link</button><button type="button" class="btn sm danger" id="revoke">Revogar e gerar novo link</button></div>` : ''}
        </div>
      </div>
      <div>
        <div class="card"><h3>Rede</h3>
          <div class="stack"><div><label class="f">Marca *</label><select name="brand_id" required><option value="">Selecione</option>${S.me.brands.map((b) => html`<option value="${b.id}" ${b.id === v.brand_id ? 'selected' : ''}>${b.name}</option>`)}</select><div class="hint">Define a identidade visual de tudo o que a loja recebe.</div></div>
          <div><label class="f">Coordenador</label><select name="coordinator_id"><option value="">—</option>${coords.map((c) => html`<option value="${c.id}" ${c.id === v.coordinator_id ? 'selected' : ''}>${c.name}</option>`)}</select></div>
          <div><label class="f">Vencimento do credenciamento</label><input type="date" name="cred_expiry" value="${v.cred_expiry || ''}"></div>
          <div><label class="f">Situação da loja</label><select name="status">${[['ativa', 'Ativa'], ['implantacao', 'Em implantação'], ['inativa', 'Inativa']].map(([k, l]) => html`<option value="${k}" ${v.status === k ? 'selected' : ''}>${l}</option>`)}</select></div>
          <div><label class="f">Pasta da loja no Google Drive</label><input name="drive_folder" value="${v.drive_folder || ''}" placeholder="https://drive.google.com/drive/folders/…"><div class="hint">Sugestão: Vídeos / Fotos em alta / Certificados.</div></div></div></div>
        <div class="card"><h3>Porte do município</h3>
          <p style="margin:0"><b style="font-size:18px">${porteL(s?.porte)}</b> <span class="small muted">${s?.porteSource || 'definido pelo município'}</span></p>
          <p class="small muted">Lista da CET-MG (oficial); tabela IBGE como conferência. Só o Administrador altera, com justificativa.</p>
          ${s && has('admin') ? html`<button type="button" class="btn sm" id="porte">Alterar porte desta loja</button>` : ''}</div>
        <div class="card"><button class="btn primary block lg">Salvar loja</button>${s ? html`<p class="small muted" style="margin-top:8px">Laudo: ${s.laudo ? html`<a href="#/laudo/${s.laudo.id}">${s.laudo.code}</a> · ${s.laudo.statusLabel}` : 'nenhum em andamento'}</p>` : ''}
          ${s && !s.laudo ? html`<a class="btn block" href="#/solicitar?ids=${s.id}">Solicitar preenchimento</a>` : ''}</div>
      </div></form>`,
    mount(root) {
      const f = root.querySelector('#f');
      let cnpjData = null;
      const fill = (r) => {
        const d = r.data;
        cnpjData = { cnpj_data: d, cnpj_source: r.source, cnpj_checked_at: r.at };
        f.razao.value = d.razao || ''; if (!f.fantasia.value) f.fantasia.value = d.fantasia || '';
        f.situacao_cadastral.value = d.situacao || '';
        f.address.value = [d.logradouro, d.numero, d.complemento, d.bairro, d.municipio && `${d.municipio}/${d.uf}`].filter(Boolean).join(', ');
        f.cep.value = d.cep || '';
        if (r.municipio) f.municipio_ibge.value = r.municipio.ibge;
        if (!f.franchisee_email.value && d.email) f.franchisee_email.placeholder = 'Receita: ' + d.email;
        const h = root.querySelector('#cnpjHint');
        h.className = 'hint ' + (r.outOfMG || (d.situacao && d.situacao.toUpperCase() !== 'ATIVA') ? 'err' : '');
        h.textContent = `Fonte: ${r.source}.` + (r.outOfMG ? ' Atenção: município fora de MG.' : '') + (d.situacao && d.situacao.toUpperCase() !== 'ATIVA' ? ` Situação ${d.situacao}: o laudo ficará bloqueado (R26).` : '') + (d.qsa?.length ? ` Sócios: ${d.qsa.map((q) => q.nome).join(', ')}.` : '');
        if (d.qsa?.length && !f.rep_name.value) { f.rep_name.value = d.qsa[0].nome; f.rep_role.value = d.qsa[0].qualificacao || ''; }
      };
      root.querySelector('#cnpjBtn').onclick = async () => {
        try {
          if (s) { await post(`/api/stores/${s.id}/refresh-cnpj`); toast('Dados atualizados pela Receita.', 'ok'); location.reload(); return; }
          const r = await get('/api/cnpj/' + f.cnpj.value.replace(/\D/g, '')); fill(r); toast('Dados carregados pelo CNPJ.', 'ok');
        } catch (e) { showErr(e); }
      };
      root.querySelectorAll('[data-qsa]').forEach((b) => (b.onclick = () => { f.rep_name.value = b.dataset.qsa; f.rep_role.value = b.dataset.q; f.rep_cpf.focus(); }));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const body = { ...readForm(f), ...(cnpjData || {}) };
        body.cnpj = body.cnpj.replace(/\D/g, '');
        try { const r = s ? await put('/api/stores/' + s.id, body) : await post('/api/stores', body); toast('Loja salva.', 'ok'); location.hash = '#/lojas/' + r.id; } catch (er) { showErr(er); }
      };
      const sl = root.querySelector('#sendLink'); if (sl) sl.onclick = () => sendLinkModal(s.id);
      const rv = root.querySelector('#revoke'); if (rv) rv.onclick = async () => { if (!(await confirmBox('Revogar link', 'O link atual deixa de funcionar e todos os aparelhos conectados saem. Um novo link será gerado.', 'Revogar', 'danger'))) return; const r = await post(`/api/users/${fr.id}/revoke-link`); modal({ title: 'Novo link gerado', body: html`<p>Envie o novo link ao franqueado:</p><input readonly value="${r.link}">` }); };
      const pb = root.querySelector('#porte'); if (pb) pb.onclick = () => porteModal(s);
    },
  };
}
function porteModal(s) {
  modal({ title: 'Alterar porte da loja', body: html`<p class="small">Vale para os laudos novos; laudos já assinados não mudam. Com laudo em andamento, as regras são reaplicadas e a loja é avisada.</p>
    <label class="f">Porte</label><select id="p"><option value="">Usar o do município</option>${['pequeno', 'medio', 'grande'].map((p) => html`<option value="${p}" ${s.porte_override === p ? 'selected' : ''}>${S.cat.PORTE_LABEL[p]}</option>`)}</select>
    <label class="f" style="margin-top:10px">Justificativa *</label><textarea id="j" placeholder="Ex.: decisão da CET-MG publicada em…"></textarea>`,
    actions: [{ label: 'Cancelar' }, { label: 'Salvar', cls: 'primary', onClick: async (m) => { await put(`/api/stores/${s.id}/porte`, { porte: m.querySelector('#p').value, reason: m.querySelector('#j').value }); toast('Porte alterado.', 'ok'); location.reload(); } }] });
}

export function importStores() {
  const tpl = 'cnpj;marca;nome_fantasia;municipio;coordenador_email;franqueado;franqueado_email;franqueado_whatsapp;vencimento\n00.000.000/0001-00;Auto Visão;Auto Visão Exemplo;Alfenas;alexandre@franqueadora.com.br;Nome do Franqueado;email@exemplo.com;(35) 99999-0000;31/12/2026';
  return {
    title: 'Importação de lojas por planilha',
    body: html`<div class="card"><h3>1. Baixe o modelo, preencha e envie</h3>
      <p class="small muted">Formato CSV (Excel → Salvar como → CSV separado por ponto e vírgula). O sistema consulta o CNPJ de cada linha e completa os dados que faltarem. Lojas já cadastradas são atualizadas sem duplicar.</p>
      <div class="row"><a class="btn" download="modelo-lojas.csv" href="data:text/csv;charset=utf-8,${encodeURIComponent('﻿' + tpl)}">Baixar modelo</a><input type="file" id="file" accept=".csv,text/csv" style="max-width:320px"></div>
      <label class="f" style="margin-top:12px">…ou cole o conteúdo aqui</label><textarea id="csv" rows="6" class="mono" placeholder="${tpl}"></textarea>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="prev">Pré-visualizar</button></div></div>
      <div id="out"></div>`,
    mount(root) {
      const ta = root.querySelector('#csv');
      root.querySelector('#file').onchange = async (e) => { ta.value = await e.target.files[0].text(); };
      root.querySelector('#prev').onclick = async () => {
        try {
          const r = await post('/api/stores/import', { csv: ta.value });
          const out = root.querySelector('#out');
          out.innerHTML = String(html`<div class="card"><h3>2. Confira antes de importar</h3><div class="row" style="margin-bottom:10px"><span class="pill ok">${r.counts.novo} novas</span><span class="pill info">${r.counts.atualizar} atualizar</span><span class="pill err">${r.counts.erro} com erro</span></div>
            <div class="tablewrap"><table class="t"><thead><tr><th>Linha</th><th>Ação</th><th>CNPJ</th><th>Loja</th><th>Marca</th><th>Município</th><th>Franqueado</th><th>Erros</th></tr></thead><tbody>
            ${r.preview.map((p) => html`<tr><td>${p.line}</td><td><span class="pill ${p.action === 'erro' ? 'err' : p.action === 'novo' ? 'ok' : 'info'}">${p.action}</span></td><td class="nowrap">${cnpjMask(p.cnpj)}</td><td>${p.fantasia}</td><td>${p.brand || '—'}</td><td>${p.municipio || '—'}</td><td>${p.franchisee_name}</td><td class="small" style="color:var(--err)">${p.errors.join('; ')}</td></tr>`)}
            </tbody></table></div><div class="row" style="margin-top:12px"><button class="btn primary" id="go" ${r.counts.novo + r.counts.atualizar ? '' : 'disabled'}>Importar ${r.counts.novo + r.counts.atualizar} linha(s) válida(s)</button></div></div>`);
          out.querySelector('#go').onclick = async (ev) => {
            ev.target.disabled = true; ev.target.textContent = 'Importando (consultando CNPJs)…';
            try { const res = await post('/api/stores/import', { csv: ta.value, commit: true }); toast(`${res.results.filter((x) => x.ok).length} loja(s) importada(s).`, 'ok'); location.hash = '#/lojas'; } catch (er) { showErr(er); ev.target.disabled = false; }
          };
        } catch (e) { showErr(e); }
      };
    },
  };
}

export async function requestFill() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const pre = (q.get('ids') || '').split(',').filter(Boolean);
  const list = await get('/api/stores');
  const groups = (annex) => (annex === 'II' ? S.cat.A2 : S.cat.A3);
  return {
    title: 'Solicitar preenchimento e enviar link',
    body: html`<div class="split"><div>
      <div class="card"><h3>Lojas</h3><input id="q" placeholder="Filtrar" style="margin-bottom:8px">
        <div style="max-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px">${list.map((s) => html`<label class="list-item" style="cursor:pointer" data-s="${s.fantasia.toLowerCase()}"><input type="checkbox" class="sel" value="${s.id}" ${pre.includes(String(s.id)) ? 'checked' : ''} ${s.laudo ? 'disabled' : ''}>
          <div style="flex:1"><div class="t1">${s.fantasia}</div><div class="t2">${s.brand?.name} · ${s.municipio?.name || '—'} · ${porteL(s.porte)}${s.laudo ? ` · já tem ${s.laudo.code} (${s.laudo.statusLabel})` : ''}</div></div></label>`)}</div></div>
      <div class="card"><h3>Processo</h3>
        <div class="grid g2"><div><label class="f">Tipo de processo *</label><select id="pt">${Object.entries(S.cat.PROCESS_TYPES).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></div>
          <div><label class="f">Prazo para a loja</label><input type="date" id="dl"></div></div>
        <div id="scope" hidden style="margin-top:12px"><div class="note">Alteração de endereço / modificação (art. 45 §1º): escolha os itens que entram no documento. O checklist e o PDF saem só com esses tópicos, mantendo a numeração original.</div>
          <div class="grid g2" style="margin-top:10px">${['II', 'III'].map((a) => html`<div><h4>Anexo ${a}</h4>${groups(a).map((it) => html`<label class="check" style="display:flex;margin:6px 0"><input type="checkbox" class="sc" value="${it.key}"> ${it.n}. ${it.title}</label>`)}</div>`)}</div></div></div>
      </div><div>
      <div class="card"><h3>Envio</h3><label class="f">Canal</label>
        <div class="seg" id="ch"><button class="on" data-v="whatsapp">WhatsApp</button><button data-v="email">E-mail</button><button data-v="none">Só criar (copiar depois)</button></div>
        <h4 style="margin-top:16px">Prévia da mensagem</h4><div id="prev" class="note brand small"></div>
        <button class="btn yellow block lg" id="go" style="margin-top:14px">Criar pedido e enviar</button>
        <p class="small muted">O laudo de cada loja nasce como "Não iniciado", com o checklist já montado.</p></div>
      </div></div>`,
    mount(root) {
      const pt = root.querySelector('#pt'), sc = root.querySelector('#scope');
      const upd = () => {
        sc.hidden = !['alteracao_endereco', 'modificacao'].includes(pt.value);
        const first = list.find((s) => root.querySelector(`.sel[value="${s.id}"]`)?.checked);
        const dl = root.querySelector('#dl').value;
        root.querySelector('#prev').innerHTML = String(html`<b>${first?.brand?.name || 'Marca'} · ${S.cat.PROCESS_TYPES[pt.value]} da unidade ${first?.fantasia || '[loja]'}</b><br>Olá, ${(first?.franchisee?.name || '[franqueado]').split(' ')[0]}! A ${first?.brand?.name || '[marca]'} solicitou o preenchimento do laudo de ${S.cat.PROCESS_TYPES[pt.value].toLowerCase()} da unidade ${first?.fantasia || '[loja]'}${dl ? ' até ' + fmtDate(dl) : ''}. Seu checklist já está pronto. Acesse pelo link pessoal (não encaminhe): <u>link pessoal</u>`);
      };
      root.querySelectorAll('input,select').forEach((e) => e.addEventListener('change', upd)); upd();
      root.querySelector('#q').oninput = (e) => root.querySelectorAll('[data-s]').forEach((l) => (l.hidden = !l.dataset.s.includes(e.target.value.toLowerCase())));
      root.querySelectorAll('#ch button').forEach((b) => (b.onclick = () => { root.querySelectorAll('#ch button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); }));
      root.querySelector('#go').onclick = async () => {
        const ids = [...root.querySelectorAll('.sel:checked')].map((x) => +x.value);
        if (!ids.length) return toast('Selecione ao menos uma loja.', 'err');
        try {
          const r = await post('/api/laudos/request', { storeIds: ids, process_type: pt.value, deadline: root.querySelector('#dl').value || null, scope_items: [...root.querySelectorAll('.sc:checked')].map((x) => x.value), channel: root.querySelector('#ch .on').dataset.v });
          const ok = r.filter((x) => x.ok).length, bad = r.filter((x) => !x.ok);
          toast(`${ok} pedido(s) criado(s).`, 'ok');
          if (bad.length) modal({ title: 'Algumas lojas não foram incluídas', body: html`${bad.map((b) => html`<div class="issue B">${b.error}</div>`)}` });
          else location.hash = '#/painel';
        } catch (e) { showErr(e); }
      };
    },
  };
}

export async function matrix() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const d = await get('/api/matrix?' + q.toString());
  const lab = { falta: 'Falta', parcial: 'Parcial', erro: 'Com erro', enviado: 'Enviado', devolvido: 'Devolvido', aprovado: 'Aprovado' };
  return {
    title: 'Matriz de pendências',
    body: html`<div class="row" style="margin-bottom:12px"><select id="fb" style="max-width:200px"><option value="">Todas as marcas</option>${S.me.brands.map((b) => html`<option value="${b.id}" ${q.get('brand') == b.id ? 'selected' : ''}>${b.name}</option>`)}</select>
      <div class="legend">${Object.entries(lab).map(([k, l]) => html`<span><i class="c ${k}" style="background:${{ falta: '#ECEEF2', parcial: '#FDE9B5', erro: '#F9C2C2', enviado: '#C7DBFB', devolvido: '#F28B8B', aprovado: '#8FD7A6' }[k]}"></i>${l}</span>`)}</div><span class="spacer"></span><button class="btn" id="exp">Exportar (Excel)</button></div>
    <div class="card pad0"><div class="tablewrap"><table class="t matrix"><thead><tr><th>Loja</th><th>Situação</th>${d.columns.map((c) => html`<th class="v" title="${c.title}">${c.label}</th>`)}</tr></thead><tbody>
      ${d.rows.map((r) => html`<tr><td class="nowrap"><b>${r.laudo ? html`<a href="#/laudo/${r.laudo.id}">${r.store.fantasia}</a>` : r.store.fantasia}</b></td><td>${r.laudo ? statusPill(r.laudo.status, r.laudo.statusLabel) : html`<span class="muted small">sem pedido</span>`}</td>
        ${d.columns.map((c) => html`<td class="c ${r.cells[c.key] || ''}" title="${c.title}: ${lab[r.cells[c.key]] || '—'}"></td>`)}</tr>`)}
    </tbody></table></div></div>`,
    mount(root) {
      root.querySelector('#fb').onchange = (e) => (location.hash = '#/matriz' + (e.target.value ? '?brand=' + e.target.value : ''));
      root.querySelector('#exp').onclick = () => {
        const rows = [['Loja', 'Situação', ...d.columns.map((c) => c.title)], ...d.rows.map((r) => [r.store.fantasia, r.laudo?.statusLabel || 'sem pedido', ...d.columns.map((c) => lab[r.cells[c.key]] || '')])];
        const csv = '﻿' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'matriz-pendencias.csv'; a.click();
      };
    },
  };
}

export async function outbox() {
  const list = await get('/api/admin/outbox');
  return {
    title: 'Notificações enviadas',
    body: html`<div class="note" style="margin-bottom:12px">Sem provedor de WhatsApp/e-mail configurado, as mensagens ficam registradas aqui (envio simulado). Configure o provedor oficial para envio real (Seção 16).</div>
    <div class="card pad0">${list.map((m) => html`<details class="list-item" style="display:block"><summary style="cursor:pointer;display:flex;gap:10px;align-items:center"><span class="pill ${m.channel === 'whatsapp' ? 'ok' : m.channel === 'sms' ? 'warn' : 'info'}">${m.channel}</span><b style="flex:1">${m.subject}</b><span class="small muted">${m.to_name || ''} ${m.to_addr} · ${fmtDT(m.at)}</span></summary>
      <pre style="white-space:pre-wrap;font-family:inherit;background:#F7F8FA;padding:10px;border-radius:8px;margin:8px 0 0">${m.body}</pre></details>`)}</div>`,
  };
}

export function reports() {
  return {
    title: 'Relatórios e exportações',
    body: html`<div class="grid g2">
      <div class="card"><h3>Lojas</h3><p class="small muted">Status, % do checklist, prazo e coordenador.</p><a class="btn" href="/api/reports/stores.csv">Baixar (Excel/CSV)</a></div>
      <div class="card"><h3>Vencimentos</h3><p class="small muted">Credenciamentos e calibrações nos próximos dias.</p><div class="row">${[30, 60, 90, 180].map((d) => html`<a class="btn sm" href="/api/reports/expiry.csv?days=${d}">${d} dias</a>`)}</div></div>
      <div class="card"><h3>Matriz de pendências</h3><p class="small muted">Itens dos Anexos II e III por loja.</p><a class="btn" href="#/matriz">Abrir matriz</a></div>
      <div class="card"><h3>Motivos de devolução e tempo de conferência</h3><p class="small muted">Ranking dos motivos e tempo médio, por marca e coordenador.</p><a class="btn" href="#/painel">Ver no painel</a></div></div>`,
  };
}
