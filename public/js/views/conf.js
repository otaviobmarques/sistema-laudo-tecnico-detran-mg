// Validação pela franqueadora (B.19, B.20) e revisão técnica (B.22), também feita pela franqueadora.
import { S, html, get, post, put, api, toast, showErr, modal, confirmBox, lightbox, annSvg, fmtDate, fmtDT, fmtMB, statusPill, brandPill, bar, has, readForm, esc } from '../core.js';
import { pickFiles } from '../upload.js';

const ITEMS = () => [...S.cat.A2.map((i) => ({ ...i, annex: 'II' })), ...S.cat.A3.map((i) => ({ ...i, annex: 'III' }))];
const ITEM = (k) => ITEMS().find((i) => i.key === k);
const FIELD_LABEL = { area: 'Área (m²)', cadeiras: 'Cadeiras', bebedouro: 'Bebedouro', ar: 'Ar-condicionado', mobilia: 'Mobília', recursos: 'Recursos', banheiros: 'Banheiros', acessiveis: 'Acessíveis', nbr9050: 'NBR 9050', largura: 'Largura (m)', backlight: 'Backlight', acrilico: 'Acrílico branco', plotter: 'Plotter de recorte', modeloAnexoI: 'Modelo Anexo I', local: 'Local', upload: 'Upload (Mb/s)', operadora: 'Operadora', descricao: 'Descrição', fotos: 'Fotos', equipamento: 'Equipamento' };
const show = (v) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : v === 'sim' ? 'Sim' : v === 'nao' ? 'Não' : String(v));

export async function queue(kind) {
  const st = kind === 'devolvidos' ? 'devolvidos' : kind === 'aprovados' ? 'aprovados' : '';
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const list = await get('/api/queue?' + new URLSearchParams({ ...(st ? { status: st } : {}), ...(q.get('mine') ? { mine: 1 } : {}) }));
  return {
    title: kind === 'devolvidos' ? 'Devolvidos à loja' : kind === 'aprovados' ? 'Laudos validados' : 'Fila de validação',
    body: html`<div class="row" style="margin-bottom:12px"><span class="spacer"></span><span class="small muted">Do mais antigo para o mais novo.</span></div>
    <div class="card pad0"><div class="tablewrap"><table class="t resp"><thead><tr><th>Loja</th><th>Marca</th><th>Laudo</th><th>Situação</th><th>Enviado em</th><th>Prazo</th><th>Validação</th><th></th></tr></thead><tbody>
    ${list.length ? list.map((l) => html`<tr class="click" data-id="${l.id}"><td data-l="Loja"><b>${l.store.fantasia}</b><div class="small muted">${l.store.municipio}</div></td><td data-l="Marca">${brandPill(l.store.brand, l.store.brand_slug)}</td>
      <td data-l="Laudo">${l.code} · v${l.version}${l.isResubmission ? html` <span class="pill info">reenvio${l.corrected ? ` · ${l.corrected} corrigido(s)` : ''}</span>` : ''}</td><td data-l="Situação">${statusPill(l.status, l.statusLabel)}</td><td data-l="Enviado">${fmtDT(l.submitted_at)}</td><td data-l="Prazo">${fmtDate(l.deadline)}</td>
      <td data-l="Validação">${l.alerts ? html`<span class="pill warn">${l.alerts} alerta(s)</span>` : html`<span class="pill ok">sem alertas</span>`}</td><td><a class="btn sm primary" href="#/${kind ? 'laudo' : l.status === 'revisao_tecnica' ? 'revisao' : 'conferencia'}/${l.id}">${kind ? 'Abrir' : l.status === 'revisao_tecnica' ? 'Revisão técnica' : 'Validar'}</a></td></tr>`) : html`<tr><td colspan="8" class="empty-state">Nada na fila.</td></tr>`}
    </tbody></table></div></div>`,
    mount(root) {
      root.querySelectorAll('tr[data-id]').forEach((r) => (r.ondblclick = () => (location.hash = `#/${kind ? 'laudo' : 'conferencia'}/${r.dataset.id}`)));
    },
  };
}

function measuresTable(d, k) {
  const f = d.data.items?.[k]?.fields || {};
  const rows = [];
  for (const [key, v] of Object.entries(f)) {
    if (key === 'boxes') for (const [b, x] of Object.entries(v)) rows.push([b.replace('L', 'Box ').replace('P', 'Box pesado '), `${x.comprimento || '?'} × ${x.largura || '?'} × ${x.altura || '?'} m · coberto ${show(x.coberto)} · piso ${x.piso || '—'}`]);
    else if (Array.isArray(v)) v.forEach((x, i) => rows.push([`${key} ${i + 1}`, Object.values(x).map(show).join(' · ')]));
    else rows.push([FIELD_LABEL[key] || key, show(v)]);
  }
  if (d.data.items?.[k]?.descricao) rows.push(['Descrição', d.data.items[k].descricao]);
  return rows.length ? html`<table class="t"><tbody>${rows.map(([a, b]) => html`<tr><td class="muted" style="width:40%">${a}</td><td><b>${b}</b></td></tr>`)}</tbody></table>` : html`<p class="small muted">Sem campos neste item.</p>`;
}
function photosOf(d, k) {
  const it = ITEM(k);
  if (it.eqType) return d.equipment.filter((e) => e.type === it.eqType).flatMap((e) => e.photos.map((p) => ({ ...p, caption: `#${e.patrimonio} · ${p.caption}` })));
  return d.photos.filter((p) => p.item === k);
}

export async function review(id) {
  const d = await get('/api/laudos/' + id);
  if (d.perms.review && d.laudo.status === 'aguardando_conferencia') await post(`/api/laudos/${id}/start-review`).catch(() => {});
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const cur = q.get('item') || d.scope.find((k) => !d.reviews[k] || !['aprovado'].includes(d.reviews[k].status)) || d.scope[0];
  const it = ITEM(cur);
  const rv = d.reviews[cur];
  const iss = d.issues.filter((i) => i.item === cur && i.stage === 'submit');
  const ph = photosOf(d, cur);
  const pill = (k) => { const r = d.reviews[k]; const has = d.issues.some((i) => i.item === k && i.stage === 'submit'); return r?.status === 'aprovado' ? html`<span class="pill ok">Aprovado</span>` : r?.status === 'devolvido' ? html`<span class="pill err">Devolvido</span>` : r?.status === 'corrigido' ? html`<span class="pill info">Corrigido</span>` : has ? html`<span class="pill warn">Alerta</span>` : html`<span class="pill">Pendente</span>`; };
  const cnt = (a) => d.scope.filter((k) => ITEM(k).annex === a);
  const appr = (a) => cnt(a).filter((k) => d.reviews[k]?.status === 'aprovado').length;
  const diff = d.diff?.changes?.[cur];
  const gps = (p) => (p.lat ? `GPS ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : 'sem GPS');
  const eqs = it.eqType ? d.equipment.filter((e) => e.type === it.eqType) : [];
  const can = d.perms.review;
  return {
    title: `Validação · ${d.store.fantasia} · ${S.cat.PROCESS_TYPES[d.laudo.process_type]}`,
    body: html`<div class="row" style="margin-bottom:10px">${statusPill(d.laudo.status, d.laudo.statusLabel)}<span class="small muted">${d.laudo.code} · v${d.laudo.version} · ${d.porte ? S.cat.PORTE_LABEL[d.porte] + ' porte' : ''} · ${d.data.etapa1?.boxesLeves || 0} leves${d.data.etapa1?.pesados ? ' + ' + d.data.etapa1.boxesPesados + ' pesado(s)' : ''}</span><span class="spacer"></span>
      <a class="btn sm" target="_blank" href="/api/laudos/${id}/preview/a2">Prévia Anexo II</a><a class="btn sm" target="_blank" href="/api/laudos/${id}/preview/a3">Prévia Anexo III</a>${can ? html`<button class="btn sm primary" id="finish">Concluir validação</button>` : ''}</div>
    ${d.diff && Object.keys(d.diff.changes).length ? html`<div class="note info" style="margin-bottom:10px">Reenvio: ${Object.keys(d.diff.changes).length} item(ns) mudaram em relação à v${d.diff.from}: ${Object.keys(d.diff.changes).map((k) => ITEM(k)?.short).join(', ')}.</div>` : ''}
    <div class="grid" style="grid-template-columns:250px minmax(0,1fr);align-items:start" id="cgrid">
      <div class="card pad0" style="position:sticky;top:70px">
        ${['II', 'III'].map((a) => html`<div style="padding:10px 12px 4px" class="small muted"><b>ANEXO ${a}</b> · ${appr(a)} de ${cnt(a).length} aprovados</div>
          ${cnt(a).map((k) => html`<a class="list-item click" style="padding:7px 12px;${k === cur ? 'background:#EAF1FF' : ''}" href="#/conferencia/${id}?item=${k}"><span style="flex:1;font-size:13px">${ITEM(k).n}. ${ITEM(k).short}${d.diff?.changes?.[k] ? ' •' : ''}</span>${pill(k)}</a>`)}`)}
      </div>
      <div class="card">
        <div class="row between"><h2 style="margin:0">${it.n}. ${it.title}</h2>${iss.length ? html`<span class="pill ${iss.some((i) => i.type === 'B') ? 'err' : 'warn'}">Validação automática: ${iss.length} ponto(s)</span>` : html`<span class="pill ok">Validação automática: atende</span>`}</div>
        <p class="small muted">${it.req}</p>
        ${rv ? html`<div class="note ${rv.status === 'aprovado' ? 'ok' : rv.status === 'devolvido' ? 'err' : 'info'} small" style="margin-bottom:10px">${rv.status === 'corrigido' ? 'Corrigido pela loja após devolução' : rv.status === 'aprovado' ? 'Aprovado' : 'Devolvido'}${rv.reason ? ': ' + rv.reason : ''}${rv.comment ? ' — ' + rv.comment : ''} · ${rv.by} · ${fmtDT(rv.at)}</div>` : ''}
        ${diff ? html`<div class="card diff" style="background:#F7FAFF"><b>Antes × depois (v${d.diff.from} → v${d.laudo.version})</b>${diff.map((c) => html`<div>${FIELD_LABEL[c.field] || c.field}: <del>${show(c.before)}</del> → <ins>${show(c.after)}</ins></div>`)}</div>` : ''}
        <div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:14px;margin-top:10px" id="detail">
          <div>${ph.length ? html`<div class="ph" style="aspect-ratio:4/3" id="main" data-pid="${ph[0].id}"><img src="${ph[0].url}?v=pdf" alt="">${annSvg(ph[0].annotations)}<div class="cap" id="mainCap">${ph[0].caption} · ${fmtDT(ph[0].taken_at)} · ${gps(ph[0])}</div></div>
            <div class="photos" style="grid-template-columns:repeat(auto-fill,minmax(80px,1fr));margin-top:8px">${ph.map((p, i) => html`<div class="ph" data-thumb="${i}" style="cursor:pointer;${i === 0 ? 'outline:2px solid var(--info)' : ''}"><img src="${p.thumb}" alt=""></div>`)}</div>` : html`<div class="empty-state">Sem fotos.</div>`}</div>
          <div>${it.annex === 'II' || !it.eqType ? measuresTable(d, cur) : html`<table class="t"><thead><tr><th>Patrim.</th><th>Série</th><th>Box</th><th>Certificado</th></tr></thead><tbody>${eqs.map((e) => html`<tr><td>${e.patrimonio}</td><td>${e.serial || '—'}</td><td>${e.box || '—'}</td><td>${e.cert ? html`${e.cert.numero} · ${fmtDate(e.cert.validade)} ${(e.files || []).filter((f) => f.kind === 'certificado').map((f) => html`<a href="${f.url}" target="_blank">PDF</a>`)}${e.cert.ocr?.divergencias?.length ? html`<div class="small" style="color:var(--warn)">OCR: ${e.cert.ocr.divergencias.join('; ')}</div>` : ''}` : '—'}</td></tr>`)}</tbody></table>
            ${it.video ? html`<h4 style="margin-top:10px">Vídeos</h4>${eqs.map((e) => { const v = d.data.items?.[cur]?.videos?.[e.id]; return html`<div class="small">#${e.patrimonio}: ${v ? html`<a href="${v.url}" target="_blank" rel="noopener">abrir vídeo</a> · ${v.test?.status === 'ok' ? '✓ público' : v.test?.status === 'fail' ? '✗ pede login' : '? não testado'}` : '—'}</div>`; })}` : ''}`}
            ${d.files.filter((f) => ({ a3_3: 'doc_boroscopio', a3_15: 'contrato_rede', a3_17: 'contrato_internet', a2_5: 'incendio', a2_1: 'dgcv' })[cur] === f.kind).map((f) => html`<div class="small" style="margin-top:6px">📄 <a href="${f.url}" target="_blank">${f.name}</a> (${fmtMB(f.size)})</div>`)}
            <h4 style="margin-top:12px">Validação automática</h4>
            ${iss.length ? iss.map((i) => html`<div class="issue ${i.type}" style="display:block"><span class="code">${i.code}</span> ${i.msg}
              ${i.type === 'A' ? html`<div class="small" style="margin-top:4px">Justificativa da loja: <i>${d.alertsJust[i.id]?.just || '—'}</i></div>${d.alertsJust[i.id]?.accepted_at ? html`<div class="small" style="color:var(--ok)">✓ aceito por ${d.alertsJust[i.id].accepted_by}: ${d.alertsJust[i.id].accept_just}</div>` : can ? html`<button class="btn sm" data-accept="${i.id}" style="margin-top:4px">Aceitar alerta</button>` : ''}` : ''}</div>`) : html`<div class="note ok small">Sem erros ou alertas.</div>`}
          </div></div>
        ${can ? html`<hr><div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:8px"><div><label class="f">Motivo da devolução</label><select id="reason"><option value="">Selecione</option>${S.cat.returnReasons.map((r) => html`<option>${r}</option>`)}</select></div><div><label class="f">Comentário para a loja</label><input id="comment" placeholder="Ex.: Refazer a foto da largura do box 2 com a trena legível."></div></div>
          <label class="check small" style="margin-top:8px"><input type="checkbox" id="onPhoto"> Comentário sobre a foto em destaque</label>
          <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn danger" id="ret">Devolver item</button><button class="btn ok" id="appr">Aprovar item</button><button class="btn" id="apprAll">Aprovar todos sem alerta</button></div>` : ''}
      </div></div>`,
    mount(root) {
      const g = root.querySelector('#cgrid'); if (window.matchMedia('(max-width: 900px)').matches) { g.style.gridTemplateColumns = '1fr'; root.querySelector('#detail').style.gridTemplateColumns = '1fr'; }
      let mainIdx = 0;
      root.querySelectorAll('[data-thumb]').forEach((t) => (t.onclick = () => {
        mainIdx = +t.dataset.thumb; const p = ph[mainIdx];
        const m = root.querySelector('#main'); m.dataset.pid = p.id; m.querySelector('img').src = p.url + '?v=pdf'; m.querySelector('svg')?.remove(); m.insertAdjacentHTML('beforeend', String(annSvg(p.annotations)));
        root.querySelector('#mainCap').textContent = `${p.caption} · ${fmtDT(p.taken_at)} · ${gps(p)}`;
        root.querySelectorAll('[data-thumb]').forEach((x) => (x.style.outline = '')); t.style.outline = '2px solid var(--info)';
      }));
      const mm = root.querySelector('#main img'); if (mm) mm.onclick = () => lightbox(ph[mainIdx]);
      const next = () => { const i = d.scope.indexOf(cur); const n = d.scope.slice(i + 1).find((k) => d.reviews[k]?.status !== 'aprovado') || d.scope[i + 1]; location.hash = `#/conferencia/${id}${n ? '?item=' + n : ''}`; };
      const dec = async (decision) => {
        const reason = root.querySelector('#reason').value, comment = root.querySelector('#comment').value;
        if (decision === 'devolver' && !reason) return toast('Escolha o motivo da devolução.', 'err');
        try { await post(`/api/laudos/${id}/review/${cur}`, { decision, reason, comment, photoId: root.querySelector('#onPhoto')?.checked ? ph[mainIdx]?.id : null }); toast(decision === 'aprovar' ? 'Item aprovado.' : 'Item devolvido.', 'ok'); next(); } catch (e) { showErr(e); }
      };
      const a = root.querySelector('#appr'); if (a) a.onclick = () => dec('aprovar');
      const r = root.querySelector('#ret'); if (r) r.onclick = () => dec('devolver');
      const aa = root.querySelector('#apprAll'); if (aa) aa.onclick = async () => { try { const x = await post(`/api/laudos/${id}/approve-clean`); toast(`${x.approved} item(ns) aprovado(s) em lote.`, 'ok'); import('../app.js').then((m) => m.render()); } catch (e) { showErr(e); } };
      root.querySelectorAll('[data-accept]').forEach((b) => (b.onclick = () => modal({ title: 'Aceitar alerta', body: html`<p class="small">O alerta fica registrado como aceito formalmente, com a sua justificativa.</p><textarea id="j" placeholder="Justificativa do aceite"></textarea>`,
        actions: [{ label: 'Cancelar' }, { label: 'Aceitar', cls: 'primary', onClick: async (m) => { await post(`/api/laudos/${id}/alerts/${encodeURIComponent(b.dataset.accept)}/accept`, { just: m.querySelector('#j').value }); toast('Alerta aceito.', 'ok'); import('../app.js').then((x) => x.render()); } }] })));
      const f = root.querySelector('#finish'); if (f) f.onclick = async () => {
        const dev = Object.values(d.reviews).filter((x) => x.status === 'devolvido').length;
        if (!(await confirmBox('Concluir validação', dev ? `${dev} item(ns) devolvido(s): os itens ficam abertos para a loja corrigir, com o motivo, na área dela. Avise a loja pelo link dela.` : 'Todos os itens aprovados: o laudo segue para a revisão técnica (descrição, acessibilidade e ART/RRT).', 'Concluir'))) return;
        try { const r = await post(`/api/laudos/${id}/finish-review`); toast('Validação concluída.', 'ok'); location.hash = r.laudo.status === 'revisao_tecnica' ? `#/revisao/${id}` : '#/fila'; } catch (e) { showErr(e); }
      };
    },
  };
}

// ---------- RT ----------
export async function rtList() {
  const list = await get('/api/rt/laudos');
  return {
    title: 'Meus laudos (responsável técnico)',
    body: html`<div class="card pad0">${list.length ? list.map((l) => html`<a class="irow" href="#/revisao/${l.id}"><div class="ic">${l.store.fantasia[0]}</div><div class="tx"><b>${l.store.fantasia}</b><span>${l.code} · ${S.cat.PROCESS_TYPES[l.process_type]} · ${l.store.municipio}</span></div>${statusPill(l.status, l.statusLabel)}<span class="muted">›</span></a>`) : html`<div class="empty-state">Nenhum laudo atribuído a você ainda. Você recebe o laudo depois da aprovação do coordenador.</div>`}</div>`,
  };
}

export async function rtReview(id) {
  const d = await get('/api/laudos/' + id);
  const rv = d.data.rtReview || {};
  const art = d.files.filter((f) => f.kind === 'art').pop();
  const can = d.perms.rtReview;
  const ano = (d.data.etapa1?.dataPedido ? new Date(d.data.etapa1.dataPedido) : new Date()).getFullYear();
  return {
    title: `Revisão técnica · ${d.store.fantasia}`,
    body: html`<div class="row" style="margin-bottom:10px">${statusPill(d.laudo.status, d.laudo.statusLabel)}<span class="small muted">${d.laudo.code} · ${d.porte ? S.cat.PORTE_LABEL[d.porte] + ' porte' : ''}</span><span class="spacer"></span><a class="btn sm" target="_blank" href="/api/laudos/${id}/preview/a2">Prévia do Anexo II</a>${['liberado_assinatura', 'pronto_protocolo', 'protocolado'].includes(d.laudo.status) ? html`<a class="btn sm primary" href="#/laudo/${id}/assinatura" id="goSign">Assinar Anexo II</a>` : ''}</div>
    ${!can && d.laudo.status !== 'liberado_assinatura' ? html`<div class="note" style="margin-bottom:12px">${['aguardando_conferencia', 'em_conferencia', 'em_preenchimento', 'devolvido'].includes(d.laudo.status) ? 'A revisão técnica fica disponível depois que todos os itens forem validados.' : 'Revisão técnica concluída.'}</div>` : ''}
    <div class="split"><div>
      <div class="card"><h3>Descrição técnica das instalações e dimensionamentos</h3>
        <textarea id="desc" rows="12" ${can ? '' : 'disabled'} placeholder="Use o texto-base com as medidas declaradas e complete.">${rv.descricao || ''}</textarea>
        ${can ? html`<div class="row" style="margin-top:8px"><button class="btn sm" id="base">Inserir texto-base com as medidas declaradas</button><span class="small muted" id="saved"></span></div>` : ''}</div>
      <div class="card"><h3>Declaração de acessibilidade (obrigatória)</h3><p class="small">Declaro que as instalações atendem à ABNT NBR 9050:2020, à Lei nº 13.146/2015, à Lei nº 10.048/2000, à Lei nº 10.098/2000 e à Convenção Internacional sobre os Direitos das Pessoas com Deficiência (art. 34 §16, "a").</p>
        <label class="check"><input type="checkbox" id="acc" ${rv.acessibilidade ? 'checked' : ''} ${can ? '' : 'disabled'}> Confirmo a declaração de acessibilidade</label></div>
      <div class="card"><h3>Itens validados</h3>${d.scope.map((k) => html`<div class="list-item"><span class="dot ${d.reviews[k]?.status === 'aprovado' ? 'ok' : d.reviews[k]?.status === 'devolvido' ? 'err' : ''}"></span><span style="flex:1">${ITEM(k).annex} · ${ITEM(k).n}. ${ITEM(k).title}</span>${can ? html`<label class="check small"><input type="checkbox" class="dev" value="${k}"> devolver</label>` : ''}</div>`)}
        ${can ? html`<div class="row" style="margin-top:8px"><select id="rr" style="max-width:280px"><option value="">Motivo</option>${S.cat.returnReasons.map((r) => html`<option>${r}</option>`)}</select><input id="rc" placeholder="Comentário" style="max-width:300px"><button class="btn danger" id="ret">Devolver itens marcados à loja</button></div>` : ''}</div>
    </div><div>
      <div class="card"><h3>ART / RRT do engenheiro ou arquiteto</h3>${art ? html`<p class="small">📄 <a href="${art.url}" target="_blank">${art.name}</a> · ano ${art.meta.ano} · nº ${art.meta.numero || '—'}</p>${+art.meta.ano !== ano ? html`<div class="note err small">A ART/RRT precisa ser de ${ano} (ano do pedido).</div>` : html`<div class="note ok small">✓ Emitida no ano do pedido (${ano}).</div>`}${art.meta.aviso ? html`<div class="note warn small" style="margin-top:6px">${art.meta.aviso}</div>` : ''}` : html`<p class="small muted">Não anexada.</p>`}
        ${can ? html`<form id="af" class="stack" style="margin-top:8px"><div class="grid g2"><div><label class="f">Ano de emissão</label><input name="ano" value="${ano}" required></div><div><label class="f">Nº da ART/RRT</label><input name="numero"></div></div><button class="btn">Anexar ART/RRT (PDF)</button></form>` : ''}</div>
      ${can ? html`<div class="card"><button class="btn primary block lg" id="conclude">Concluir revisão técnica</button><p class="small muted">Se tudo estiver 100% validado, o sistema gera e trava os PDFs finais e libera a assinatura gov.br.</p><div id="conds"></div></div>` : ''}
    </div></div>`,
    mount(root) {
      const desc = root.querySelector('#desc'), acc = root.querySelector('#acc');
      const save = async () => { try { await put(`/api/laudos/${id}/rt-review`, { descricao: desc.value, acessibilidade: acc.checked }); const s = root.querySelector('#saved'); if (s) s.textContent = 'salvo ' + new Date().toLocaleTimeString('pt-BR'); } catch (e) { showErr(e); } };
      if (can) { desc.onchange = save; acc.onchange = save; }
      const b = root.querySelector('#base'); if (b) b.onclick = async () => { const r = await get(`/api/laudos/${id}/rt-base`); desc.value = r.text + (desc.value ? '\n\n' + desc.value : ''); save(); };
      const af = root.querySelector('#af'); if (af) af.onsubmit = async (e) => {
        e.preventDefault(); const f = await pickFiles({ accept: 'application/pdf' }); if (!f.length) return;
        const fd = new FormData(); for (const [k, v] of Object.entries(readForm(af))) fd.append(k, v); fd.append('kind', 'art'); fd.append('file', f[0]);
        try { const r = await api('POST', `/api/laudos/${id}/files`, fd); toast(r.meta?.aviso || 'ART/RRT anexada.', r.meta?.aviso ? 'err' : 'ok'); import('../app.js').then((m) => m.render()); } catch (er) { showErr(er); }
      };
      const ret = root.querySelector('#ret'); if (ret) ret.onclick = async () => {
        const items = [...root.querySelectorAll('.dev:checked')].map((x) => ({ item: x.value, reason: root.querySelector('#rr').value, comment: root.querySelector('#rc').value }));
        if (!items.length) return toast('Marque os itens a devolver.', 'err'); if (!items[0].reason) return toast('Escolha o motivo.', 'err');
        try { await post(`/api/laudos/${id}/rt-return`, { items }); toast('Itens devolvidos à loja.', 'ok'); location.hash = '#/fila'; } catch (e) { showErr(e); }
      };
      const c = root.querySelector('#conclude'); if (c) c.onclick = async () => {
        await save(); c.disabled = true; c.textContent = 'Validando e gerando PDFs…';
        try { const r = await post(`/api/laudos/${id}/rt-conclude`); toast(`Revisão concluída. Documentos gerados (${r.version}).`, 'ok'); location.hash = `#/laudo/${id}/assinatura`; }
        catch (e) { c.disabled = false; c.textContent = 'Concluir revisão técnica'; showErr(e); if (e.data?.conds) root.querySelector('#conds').innerHTML = String(html`${e.data.conds.map((x) => html`<div class="list-item"><span class="dot ${x.ok ? 'ok' : 'err'}"></span><div style="flex:1"><div class="t1 small">${x.msg}</div>${x.detail ? html`<div class="t2">${x.detail}</div>` : ''}</div></div>`)}`); }
      };
      const gs = root.querySelector('#goSign'); if (gs) gs.onclick = (e) => { e.preventDefault(); location.hash = `#/laudo/${id}/assinatura`; };
    },
  };
}
