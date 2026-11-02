// Fluxo do laudo: permissões, status, versões, trava de assinatura e documentos finais.
const crypto = require('crypto');
const { one, all, run, insert, update, now, J, S, token } = require('./db');
const C = require('./catalog');
const R = require('./rules');
const { audit, notify, saveFile, testDriveLink } = require('./services');
const { buildChecklist } = require('./checklist');

const STATUS = {
  nao_iniciado: { n: 0, label: 'Não iniciado' }, rascunho: { n: 1, label: 'Rascunho' }, em_preenchimento: { n: 2, label: 'Em preenchimento' },
  aguardando_conferencia: { n: 3, label: 'Aguardando conferência' }, em_conferencia: { n: 4, label: 'Em conferência' },
  devolvido: { n: 5, label: 'Devolvido com pendências' }, aprovado_coord: { n: 6, label: 'Aprovado pelo coordenador' },
  revisao_tecnica: { n: 7, label: 'Em revisão técnica' }, liberado_assinatura: { n: 8, label: 'Liberado para assinatura' },
  pronto_protocolo: { n: 9, label: 'Pronto para protocolo' }, protocolado: { n: 10, label: 'Protocolado no SCE' },
  exigencia: { n: 11, label: 'Exigência da CET-MG' }, deferido: { n: 12, label: 'Deferido' }, indeferido: { n: 12, label: 'Indeferido' },
  cancelado: { n: -1, label: 'Cancelado' },
};
const ACTIVE = Object.keys(STATUS).filter((s) => !['deferido', 'indeferido', 'cancelado'].includes(s));
const roles = (u) => (u ? J(u.roles, []) : []);
const has = (u, r) => roles(u).includes(r);
const isAdmin = (u) => has(u, 'admin');

function scopeOf(u) { return J(u.scope, {}) || {}; }
function storeIdsForUser(u) {
  if (!u) return [];
  if (isAdmin(u) || has(u, 'diretoria')) return all('SELECT id FROM stores WHERE deleted_at IS NULL').map((r) => r.id);
  const ids = new Set();
  if (has(u, 'franqueadora') || has(u, 'coordenador')) {
    const sc = scopeOf(u);
    let rows = all('SELECT id, brand_id, coordinator_id FROM stores WHERE deleted_at IS NULL');
    if (has(u, 'franqueadora')) rows.filter((s) => !sc.brands || !sc.brands.length || sc.brands.includes(s.brand_id)).forEach((s) => ids.add(s.id));
    if (has(u, 'coordenador')) rows.filter((s) => s.coordinator_id === u.id || (sc.stores || []).includes(s.id) || (sc.brands && sc.brands.includes(s.brand_id) && !has(u, 'franqueadora') && sc.coordAllBrand)).forEach((s) => ids.add(s.id));
  }
  for (const r of all('SELECT store_id FROM store_users WHERE user_id=?', u.id)) ids.add(r.store_id);
  if (has(u, 'rt')) {
    const rt = one('SELECT id FROM rts WHERE user_id=?', u.id);
    if (rt) for (const r of all('SELECT store_id FROM laudos WHERE rt_id=? AND deleted_at IS NULL', rt.id)) ids.add(r.store_id);
  }
  return [...ids];
}
function canSeeStore(u, storeId) { return storeIdsForUser(u).includes(storeId); }
function canSeeLaudo(u, laudo) {
  if (!laudo) return false;
  if (isAdmin(u) || has(u, 'diretoria') || has(u, 'franqueadora')) return canSeeStore(u, laudo.store_id);
  if (has(u, 'rt')) { const rt = one('SELECT id FROM rts WHERE user_id=?', u.id); if (rt && laudo.rt_id === rt.id) return true; }
  return canSeeStore(u, laudo.store_id);
}
function storeRole(u, storeId) {
  const r = one('SELECT kind FROM store_users WHERE store_id=? AND user_id=?', storeId, u.id);
  return r ? r.kind : null; // 'loja' | 'colaborador'
}
function blocksOf(u, storeId) {
  if (storeRole(u, storeId) !== 'colaborador') return ['A', 'B', 'C'];
  return J(u.blocks, ['A', 'B', 'C']);
}
const blockOfItem = (item) => (item.startsWith('a2_') ? 'B' : item.startsWith('a3_') || item.startsWith('eq') ? 'C' : 'A');

// Edição pela loja: em preenchimento tudo; devolvido/exigência só os itens devolvidos.
function canEditItem(u, laudo, item) {
  if (isAdmin(u)) return true;
  const sr = storeRole(u, laudo.store_id);
  if (!sr) return false;
  if (sr === 'colaborador' && item && !blocksOf(u, laudo.store_id).includes(blockOfItem(item))) return false;
  if (['nao_iniciado', 'rascunho', 'em_preenchimento'].includes(laudo.status)) return true;
  if (['devolvido', 'exigencia'].includes(laudo.status)) {
    if (!item) return false;
    const rv = J(laudo.reviews, {})[item];
    return !!rv && rv.status === 'devolvido';
  }
  return false;
}
function canEditGeneral(u, laudo) {
  if (isAdmin(u)) return true;
  return storeRole(u, laudo.store_id) === 'loja' && ['nao_iniciado', 'rascunho', 'em_preenchimento'].includes(laudo.status);
}

function touch(laudoId, extra = {}) { update('laudos', laudoId, { updated_at: now(), last_activity_at: now(), ...extra }); }

function setStatus(req, laudo, status, extra = {}) {
  const before = laudo.status;
  update('laudos', laudo.id, { status, updated_at: now(), last_activity_at: now(), ...extra });
  audit(req, 'laudo.status', { entity: 'laudo', entityId: laudo.id, storeId: laudo.store_id, laudoId: laudo.id, before: { status: before }, after: { status, ...(extra.sub_status ? { sub_status: extra.sub_status } : {}) } });
}

function laudoCode(store, processType) {
  const brand = one('SELECT * FROM brands WHERE id=?', store.brand_id);
  const pre = (J(brand?.theme, {}).codePrefix || (brand?.slug || 'XX').slice(0, 2)).toUpperCase();
  const p = { credenciamento: 'C', renovacao: 'R', alteracao_endereco: 'A', modificacao: 'M' }[processType] || 'X';
  const yy = String(new Date().getFullYear()).slice(2);
  let code = `${pre}${p}-${yy}-${String(store.id).padStart(4, '0')}`, i = 1;
  while (one('SELECT id FROM laudos WHERE code=?', code)) code = `${pre}${p}-${yy}-${String(store.id).padStart(4, '0')}${String.fromCharCode(65 + i++ - 1)}`;
  return code;
}

function createLaudo(req, store, { process_type, deadline, scope_items, parent }) {
  const active = one(`SELECT id, code FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${ACTIVE.map(() => '?').join(',')})`, store.id, ...ACTIVE);
  if (active) throw Object.assign(new Error(`A loja ${store.fantasia} já tem o laudo ${active.code} em andamento. Conclua ou cancele antes de abrir outro.`), { status: 409 });
  const params = R.getParams();
  let data = { items: {}, empresa: {} };
  let rt_id = store.rt_id || null;
  const prev = parent || (process_type !== 'credenciamento' ? one("SELECT * FROM laudos WHERE store_id=? AND status='deferido' AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", store.id) : null);
  if (prev) {
    // Renovação/alteração: reaproveita dados, boxes e campos (fotos precisam ser novas)
    const pd = J(prev.data, {});
    data = { etapa1: { ...pd.etapa1, savedAt: null, dataPedido: null, vencimentoAtual: store.cred_expiry || null }, empresa: pd.empresa || {}, items: {} };
    for (const [k, v] of Object.entries(pd.items || {})) data.items[k] = { fields: v.fields, descricao: v.descricao, plantRect: v.plantRect, videos: v.videos };
    rt_id = prev.rt_id || rt_id;
  }
  if (process_type === 'renovacao' && store.cred_expiry) { data.etapa1 = data.etapa1 || {}; data.etapa1.vencimentoAtual = store.cred_expiry; }
  const id = insert('laudos', {
    store_id: store.id, code: laudoCode(store, process_type), process_type, scope_items: scope_items && scope_items.length ? S(scope_items) : null,
    deadline, status: 'nao_iniciado', version: 0, data: S(data), reviews: S({}), alerts_just: S({}), rt_id,
    coordinator_id: store.coordinator_id, params_version: params._version || null, requested_by: req.user ? req.user.id : null,
    created_at: now(), updated_at: now(), last_activity_at: now(), parent_laudo_id: prev ? prev.id : null,
  });
  audit(req, 'laudo.solicitar', { entity: 'laudo', entityId: id, storeId: store.id, laudoId: id, after: { process_type, deadline, scope_items } });
  return id;
}

// ---------- Versões ----------
function snapshot(laudoId) {
  const ctx = R.buildContext(laudoId);
  return {
    data: ctx.data, reviews: ctx.reviews, alertsJust: ctx.alertsJust, status: ctx.laudo.status,
    photos: ctx.photos.map((p) => ({ id: p.id, item: p.item, slot: p.slot, sha: p.sha, caption: p.caption })),
    equipment: ctx.equipment.map((e) => ({ id: e.id, type: e.type, serial: e.serial, patrimonio: e.patrimonio, box: e.box, specs: e.specs, cert: e.cert, status: e.status, photos: e.photosArr.map((p) => p.sha) })),
    files: ctx.files.map((f) => ({ id: f.id, kind: f.kind, sha: f.sha, name: f.original_name })),
    porte: ctx.porte, rt_id: ctx.laudo.rt_id,
  };
}
function makeVersion(req, laudoId, reason) {
  const laudo = one('SELECT * FROM laudos WHERE id=?', laudoId);
  const n = (laudo.version || 0) + 1;
  const code = `${laudo.code}-v${n}`;
  // a versão anterior passa a ser "substituída" (continua abrindo)
  const id = insert('versions', { laudo_id: laudoId, n, code, reason, snapshot: S(snapshot(laudoId)), public_token: token(9), docs: S({}), created_at: now(), created_by: req.user ? req.user.id : null });
  update('laudos', laudoId, { version: n });
  audit(req, 'versao.criar', { entity: 'version', entityId: id, storeId: laudo.store_id, laudoId, after: { n, code, reason } });
  return { id, n, code };
}
function currentVersion(laudoId) { return one('SELECT * FROM versions WHERE laudo_id=? ORDER BY n DESC LIMIT 1', laudoId); }

// Diferenças entre a versão atual do conteúdo e a última versão enviada (antes × depois)
function diffSinceLastVersion(laudoId) {
  const v = currentVersion(laudoId);
  if (!v) return {};
  const prev = J(v.snapshot, {}), cur = snapshot(laudoId);
  const out = {};
  const keys = new Set([...Object.keys(prev.data?.items || {}), ...Object.keys(cur.data?.items || {})]);
  for (const k of keys) {
    const a = prev.data?.items?.[k] || {}, b = cur.data?.items?.[k] || {};
    const changes = [];
    const fa = a.fields || {}, fb = b.fields || {};
    for (const f of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (JSON.stringify(fa[f]) !== JSON.stringify(fb[f])) changes.push({ field: f, before: fa[f], after: fb[f] });
    if ((a.descricao || '') !== (b.descricao || '')) changes.push({ field: 'descricao', before: a.descricao, after: b.descricao });
    const pa = (prev.photos || []).filter((p) => p.item === k).map((p) => p.sha), pb = cur.photos.filter((p) => p.item === k).map((p) => p.sha);
    const added = pb.filter((s) => !pa.includes(s)).length, removed = pa.filter((s) => !pb.includes(s)).length;
    if (added || removed) changes.push({ field: 'fotos', before: `${pa.length} foto(s)`, after: `${pb.length} foto(s) (+${added} / −${removed})` });
    if (changes.length) out[k] = changes;
  }
  // equipamentos
  for (const e of cur.equipment) {
    const pe = (prev.equipment || []).find((x) => x.id === e.id);
    const item = C.A3.find((i) => i.eqType === e.type)?.key;
    if (!item) continue;
    if (!pe) (out[item] = out[item] || []).push({ field: 'equipamento', before: '—', after: `novo #${e.patrimonio}` });
    else if (JSON.stringify(pe) !== JSON.stringify(e)) (out[item] = out[item] || []).push({ field: 'equipamento', before: `#${pe.patrimonio}`, after: `#${e.patrimonio} alterado` });
  }
  return out;
}

// ---------- Trava de assinatura (Seção 10.3) ----------
async function signLock(laudoId, { revalidate = false } = {}) {
  const sum = R.summarize(laudoId);
  const { ctx, issues } = sum;
  const scope = C.itemsInScope(ctx.laudo, ctx.cfg).map((i) => i.key);
  const reviews = ctx.reviews;
  const notApproved = scope.filter((k) => !reviews[k] || reviews[k].status !== 'aprovado');
  const rv = ctx.data.rtReview || {};
  const blockers = issues.filter((i) => i.type === 'B');
  const openAlerts = issues.filter((i) => i.type === 'A' && !(ctx.alertsJust[i.id] && ctx.alertsJust[i.id].accepted_at));
  const art = ctx.files.filter((f) => f.kind === 'art').pop();
  const artMeta = art ? J(art.meta, {}) : {};
  const ano = (ctx.cfg.dataPedido ? new Date(ctx.cfg.dataPedido) : new Date()).getFullYear();
  // links do Drive
  let linksOk = true, linkMsgs = [];
  for (const k of ['a3_2', 'a3_4']) {
    const vids = ctx.data.items?.[k]?.videos || {};
    for (const e of ctx.equipment.filter((x) => x.type === C.ITEM[k].eqType && x.status === 'ativo')) {
      const v = vids[e.id];
      if (!v || !v.url) { linksOk = false; linkMsgs.push(`${C.ITEM[k].short} #${e.patrimonio}: sem link`); continue; }
      if (revalidate) { v.test = await testDriveLink(v.url); }
      if (!v.test || v.test.status !== 'ok') { linksOk = false; linkMsgs.push(`${C.ITEM[k].short} #${e.patrimonio}: ${v.test ? v.test.msg : 'não testado'}`); }
    }
  }
  if (revalidate) { const d = J(one('SELECT data FROM laudos WHERE id=?', laudoId).data, {}); for (const k of ['a3_2', 'a3_4']) if (ctx.data.items?.[k]?.videos) { d.items = d.items || {}; d.items[k] = { ...(d.items[k] || {}), videos: ctx.data.items[k].videos }; } update('laudos', laudoId, { data: S(d) }); }
  const dataPedido = ctx.cfg.dataPedido ? new Date(ctx.cfg.dataPedido) : new Date();
  const calBad = ctx.equipment.filter((e) => C.EQ_TYPES[e.type]?.cal && e.status === 'ativo' && (!e.cert || !e.cert.validade || new Date(e.cert.validade) < dataPedido));
  const conds = [
    { n: 1, ok: notApproved.length === 0, msg: 'Todos os itens do Anexo II e do Anexo III aprovados pelo coordenador.', detail: notApproved.length ? `${notApproved.length} item(ns) sem aprovação: ${notApproved.map((k) => C.ITEM[k].short).join(', ')}` : '' },
    { n: 2, ok: !!rv.concludedAt && !Object.values(reviews).some((r) => r.status === 'devolvido'), msg: 'Revisão técnica do RT concluída, sem itens devolvidos.', detail: rv.concludedAt ? '' : 'Revisão do RT não concluída.' },
    { n: 3, ok: blockers.length === 0, msg: 'Zero erros bloqueantes no motor de validação.', detail: blockers.length ? blockers.slice(0, 5).map((b) => `${b.code}: ${b.msg}`).join(' | ') : '' },
    { n: 4, ok: openAlerts.length === 0, msg: 'Zero alertas em aberto (corrigidos ou aceitos pelo coordenador com justificativa).', detail: openAlerts.length ? `${openAlerts.length} alerta(s) sem aceite do coordenador.` : '' },
    { n: 5, ok: !!art && +artMeta.ano === ano, msg: `ART/RRT anexada e emitida em ${ano}.`, detail: !art ? 'ART/RRT não anexada.' : +artMeta.ano !== ano ? `ART/RRT de ${artMeta.ano}.` : '' },
    { n: 6, ok: linksOk, msg: 'Links do Drive revalidados e acessíveis sem login.', detail: linkMsgs.slice(0, 4).join(' | ') },
    { n: 7, ok: calBad.length === 0, msg: 'Certificados de calibração válidos na data prevista do pedido.', detail: calBad.length ? calBad.map((e) => `${C.EQ_TYPES[e.type].short} #${e.patrimonio}`).join(', ') : '' },
  ];
  return { ok: conds.every((c) => c.ok), conds, sum };
}

// Gera e trava os PDFs finais (Seção 10.4, passo 1)
async function generateFinalDocs(req, laudoId, baseUrl) {
  const { generateWithinLimit } = require('./pdf');
  const v = makeVersion(req, laudoId, 'Liberação para assinatura');
  const ver = one('SELECT * FROM versions WHERE id=?', v.id);
  const consultaUrl = `${baseUrl}/c/${ver.code}`;
  const sum = R.summarize(laudoId);
  const docs = {};
  for (const [k, annex] of [['a2', 'II'], ['a3', 'III']]) {
    const scopeHas = C.itemsInScope(sum.ctx.laudo, sum.ctx.cfg).some((i) => i.annex === annex);
    if (!scopeHas) continue;
    const r = await generateWithinLimit(sum.ctx, annex, { consultaUrl, versionCode: ver.code, versionN: ver.n });
    if (!r.ok) {
      const e = new Error(`Anexo ${annex} ficou com ${(r.size / 1048576).toFixed(2)} MB mesmo na compressão máxima (limite ${sum.ctx.params.arquivos.sceAlvoMB} MB). Itens mais pesados: ${r.heavy.map(([it, s]) => `${C.ITEM[it]?.short || it} (${(s / 1048576).toFixed(1)} MB)`).join(', ')}. O Administrador deve marcar fotos complementares para ficar só no link de consulta.`);
      e.status = 422; e.heavy = r.heavy; throw e;
    }
    const file = saveFile(r.buf, 'pdf');
    const sha = crypto.createHash('sha256').update(r.buf).digest('hex');
    docs[k] = { file, sha, size: r.buf.length, length: r.buf.length, level: r.level, generated_at: now(), signed: null };
    audit(req, 'documento.gerar', { entity: 'version', entityId: v.id, laudoId, after: { doc: k, sha, size: r.buf.length, compressao: r.level } });
  }
  update('versions', v.id, { docs: S(docs) });
  return { version: one('SELECT * FROM versions WHERE id=?', v.id), docs };
}

function invalidateSignatures(req, laudoId, reason) {
  const v = currentVersion(laudoId);
  if (!v) return;
  const docs = J(v.docs, {});
  let changed = false;
  for (const d of Object.values(docs)) if (d.signed) { d.signed.invalidated_at = now(); d.signed.invalid_reason = reason; changed = true; }
  if (changed) { update('versions', v.id, { docs: S(docs) }); audit(req, 'assinatura.invalidar', { laudoId, after: { reason } }); }
}

function brandOfStore(store) { return one('SELECT * FROM brands WHERE id=?', store.brand_id); }

function laudoListRow(l) {
  const store = one('SELECT s.*, b.name brand_name, b.slug brand_slug, m.name municipio FROM stores s LEFT JOIN brands b ON b.id=s.brand_id LEFT JOIN municipalities m ON m.ibge=s.municipio_ibge WHERE s.id=?', l.store_id);
  let progress = 0, blockers = 0, alerts = 0;
  try { const sm = R.summarize(l.id); const cl = buildChecklist(sm); progress = cl.pct; blockers = sm.blockers.length; alerts = sm.alerts.length; } catch {}
  const coord = l.coordinator_id ? one('SELECT name FROM users WHERE id=?', l.coordinator_id) : null;
  return { id: l.id, code: l.code, status: l.status, statusLabel: STATUS[l.status]?.label, sub_status: l.sub_status, process_type: l.process_type, deadline: l.deadline, version: l.version,
    store: { id: store.id, fantasia: store.fantasia, brand: store.brand_name, brand_slug: store.brand_slug, municipio: store.municipio }, progress, blockers, alerts,
    submitted_at: l.submitted_at, last_activity_at: l.last_activity_at, created_at: l.created_at, coordinator: coord?.name };
}

module.exports = { STATUS, ACTIVE, roles, has, isAdmin, storeIdsForUser, canSeeStore, canSeeLaudo, storeRole, blocksOf, blockOfItem, canEditItem, canEditGeneral, touch, setStatus, createLaudo, makeVersion, currentVersion, snapshot, diffSinceLastVersion, signLock, generateFinalDocs, invalidateSignatures, brandOfStore, laudoListRow, notify };
