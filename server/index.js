// Sistema de Laudo Técnico ECV — servidor web.
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { db, one, all, run, insert, update, now, J, S, token, tx } = require('./db');
const C = require('./catalog');
const R = require('./rules');
const L = require('./laudo');
const SV = require('./services');
const { buildChecklist } = require('./checklist');
const PDF = require('./pdf');
const SIG = require('./signature');

const DEMO = process.env.DEMO_MODE !== '0';
const PORT = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: 'text/csv', limit: '10mb' }));
app.use(cookieParser());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 250 * 1024 * 1024 } });

const baseUrl = (req) => process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
const err = (status, msg, extra) => Object.assign(new Error(msg), { status, ...extra });
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const checkPw = (pw, h) => { if (!h) return false; const [salt] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(hashPw(pw, salt)), Buffer.from(h)); };
const maskCpf = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 11 ? `***.${d.slice(3, 6)}.***-**` : '—'; };
const linkFor = (req, u) => `${baseUrl(req)}/a/${u.token}`;

// ---------------- Sessão ----------------
app.use((req, res, next) => {
  const sid = req.cookies.sid;
  if (sid) {
    const s = one('SELECT * FROM sessions WHERE id=?', sid);
    if (s && !s.pending_2fa) {
      const u = one('SELECT * FROM users WHERE id=? AND active=1 AND deleted_at IS NULL', s.user_id);
      if (u) { req.user = u; req.via = s.via; req.sessionRow = s; if (!s.last_seen || Date.now() - new Date(s.last_seen) > 60000) run('UPDATE sessions SET last_seen=? WHERE id=?', now(), sid); }
    }
  }
  next();
});
function newSession(req, res, user, via) {
  const id = token(24);
  insert('sessions', { id, user_id: user.id, via, ua: String(req.headers['user-agent'] || '').slice(0, 200), ip: req.ip, created_at: now(), last_seen: now() });
  res.cookie('sid', id, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 1000 * 60 * 60 * 24 * 365 });
  update('users', user.id, { last_access_at: now() });
}
const need = (...rs) => (req, res, next) => {
  if (!req.user) return next(err(401, 'Acesso expirado. Abra novamente o seu link pessoal.'));
  if (rs.length && !rs.some((r) => L.has(req.user, r)) && !L.isAdmin(req.user)) return next(err(403, 'Seu perfil não permite esta ação.'));
  next();
};
const getLaudo = (req, id) => {
  const l = one('SELECT * FROM laudos WHERE id=? AND deleted_at IS NULL', id);
  if (!l) throw err(404, 'Laudo não encontrado.');
  if (!L.canSeeLaudo(req.user, l)) throw err(403, 'Você não tem acesso a este laudo.');
  return l;
};
const getStore = (req, id) => {
  const s = one('SELECT * FROM stores WHERE id=? AND deleted_at IS NULL', id);
  if (!s) throw err(404, 'Loja não encontrada.');
  if (!L.canSeeStore(req.user, s.id)) throw err(403, 'Você não tem acesso a esta loja.');
  return s;
};
const requireStoreEditor = (req, storeId) => { if (!L.isAdmin(req.user) && L.storeRole(req.user, storeId) !== 'loja') throw err(403, 'Somente o franqueado da loja pode fazer isso.'); };

// ---------------- Acesso por link / Administrador ----------------
app.get('/a/:token', (req, res) => {
  const u = one('SELECT * FROM users WHERE token=? AND deleted_at IS NULL', req.params.token);
  if (!u || !u.active) return res.redirect('/#/acesso-invalido');
  if (!u.link_opened_at) update('users', u.id, { link_opened_at: now() });
  newSession(req, res, u, 'link');
  req.user = u; req.via = 'link';
  SV.audit(req, 'acesso.link', { entity: 'user', entityId: u.id });
  // alerta de segurança: link aberto em muitos aparelhos
  const devices = one("SELECT COUNT(DISTINCT ua) n FROM sessions WHERE user_id=? AND via='link' AND created_at > ?", u.id, new Date(Date.now() - 7 * 86400000).toISOString()).n;
  if (devices >= 4) SV.audit(req, 'seguranca.alerta', { entity: 'user', entityId: u.id, after: { motivo: `Link aberto em ${devices} aparelhos diferentes em 7 dias` } });
  res.redirect(u.terms_accepted_at ? '/#/' : '/#/primeiro-acesso');
});

const loginFails = new Map(); // tentativas erradas por IP (proteção contra força bruta)
app.post('/api/auth/admin-login', (req, res) => {
  const { email, password } = req.body || {};
  const key = req.ip, f = loginFails.get(key);
  if (f && f.n >= 10 && Date.now() - f.at < 15 * 60000) throw err(429, 'Muitas tentativas incorretas. Aguarde 15 minutos e tente de novo.');
  const u = one('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1 AND deleted_at IS NULL', String(email || ''));
  if (!u || !L.isAdmin(u) || !checkPw(String(password || ''), u.password_hash)) { SV.audit({ ...req, publicActor: email }, 'acesso.admin.falha', { after: { email } }); const g = f && Date.now() - f.at < 15 * 60000 ? f : { n: 0 }; loginFails.set(key, { n: g.n + 1, at: Date.now() }); throw err(401, 'E-mail ou senha incorretos.'); }
  loginFails.delete(key);
  newSession(req, res, u, 'senha');
  req.user = u; req.via = 'senha';
  SV.audit(req, 'acesso.admin', { entity: 'user', entityId: u.id });
  res.json({ ok: true });
});
app.post('/api/auth/request-link', (req, res) => {
  const q = String(req.body.cnpjOrPhone || '').replace(/\D/g, '');
  let users = [];
  if (q.length === 14) {
    const s = one('SELECT * FROM stores WHERE cnpj=? AND deleted_at IS NULL', q);
    if (s) users = all("SELECT u.* FROM users u JOIN store_users su ON su.user_id=u.id WHERE su.store_id=? AND su.kind='loja' AND u.active=1", s.id);
  } else if (q.length >= 10) {
    users = all('SELECT * FROM users WHERE active=1 AND deleted_at IS NULL').filter((u) => String(u.phone || '').replace(/\D/g, '').endsWith(q.slice(-10)) && !L.isAdmin(u));
  }
  for (const u of users) {
    const brandStore = one('SELECT s.brand_id, s.id FROM store_users su JOIN stores s ON s.id=su.store_id WHERE su.user_id=? LIMIT 1', u.id);
    const ch = u.phone ? 'whatsapp' : 'email';
    SV.notify({ channel: ch, to: u.phone || u.email, toName: u.name, subject: 'Seu link de acesso', body: `Olá, ${u.name.split(' ')[0]}! Aqui está o seu link pessoal de acesso ao Laudo ECV:\n${linkFor(req, u)}\nNão encaminhe este link: ele é pessoal.`, brandId: brandStore?.brand_id, storeId: brandStore?.id, kind: 'novo_link' });
    if (u.email && ch !== 'email') SV.notify({ channel: 'email', to: u.email, toName: u.name, subject: 'Seu link de acesso', body: `Link pessoal: ${linkFor(req, u)}`, brandId: brandStore?.brand_id, kind: 'novo_link' });
    SV.audit({ ...req, user: u, via: 'pedido' }, 'acesso.pedido_link', { entity: 'user', entityId: u.id });
  }
  SV.audit({ ...req, publicActor: 'público' }, 'acesso.pedido_link.consulta', { after: { q: q.slice(0, 4) + '…', encontrados: users.length } });
  res.json({ ok: true, msg: 'Se o dado informado estiver cadastrado, enviamos um novo link para o WhatsApp e o e-mail já cadastrados.' });
});
app.post('/api/auth/logout', (req, res) => { if (req.cookies.sid) run('DELETE FROM sessions WHERE id=?', req.cookies.sid); res.clearCookie('sid'); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null, demo: DEMO });
  const u = req.user;
  const stores = all('SELECT s.id, s.fantasia, s.brand_id, su.kind FROM store_users su JOIN stores s ON s.id=su.store_id WHERE su.user_id=? AND s.deleted_at IS NULL', u.id);
  const rt = one('SELECT * FROM rts WHERE user_id=?', u.id);
  const brands = all('SELECT id, slug, name, theme, logo_file, logo_dark_file FROM brands WHERE deleted_at IS NULL').map((b) => ({ ...b, theme: J(b.theme, {}) }));
  res.json({ demo: DEMO, user: { id: u.id, name: u.name, email: u.email, phone: u.phone, roles: L.roles(u), via: req.via, terms: !!u.terms_accepted_at, blocks: J(u.blocks, null) }, stores, rt, brands });
});
app.post('/api/me/accept-terms', need(), (req, res) => {
  update('users', req.user.id, { terms_accepted_at: now() });
  SV.audit(req, 'lgpd.aceite_termos', { entity: 'user', entityId: req.user.id });
  res.json({ ok: true });
});

// ---------------- Catálogo e parâmetros ----------------
app.get('/api/catalog', (req, res) => {
  res.json({ A2: C.A2, A3: C.A3, ELEVACAO: C.ELEVACAO, DOCS: C.DOCS, PROCESS_TYPES: C.PROCESS_TYPES, PORTE_LABEL: C.PORTE_LABEL, STATUS: L.STATUS,
    params: R.getParams(), photoSlotsEq: Object.fromEntries(Object.keys(C.EQ_TYPES).map((t) => [t, C.equipmentPhotoSlots(t)])),
    returnReasons: ['Foto ilegível', 'Medida não visível na foto', 'Medida abaixo do mínimo', 'Certificado não corresponde ao equipamento', 'Certificado vencido', 'Placa fora do padrão', 'Foto repetida ou de outro local', 'Documento ausente ou ilegível', 'Número de série/patrimônio divergente', 'Outro'] });
});
app.get('/api/municipios', need(), (req, res) => {
  const q = R.norm(req.query.q || '');
  const rows = all('SELECT * FROM municipalities ORDER BY name');
  res.json(rows.filter((m) => !q || R.norm(m.name).includes(q)).slice(0, +req.query.limit || 900).map((m) => ({ ...m, porte_ibge: C.porteFromPop(m.pop2024 || m.pop2022) })));
});

// ---------------- CNPJ ----------------
app.get('/api/cnpj/:cnpj', need('franqueadora', 'loja', 'admin'), async (req, res) => {
  const c = req.params.cnpj.replace(/\D/g, '');
  if (!R.validCNPJ(c)) throw err(400, 'CNPJ inválido (dígito verificador).');
  try {
    const r = await SV.lookupCnpj(c);
    SV.audit(req, 'cnpj.consulta', { entity: 'cnpj', entityId: c, after: { fonte: r.source } });
    const mun = r.data.ibge ? one('SELECT * FROM municipalities WHERE ibge=?', r.data.ibge) : one('SELECT * FROM municipalities WHERE lower(name)=lower(?)', r.data.municipio || '');
    res.json({ ...r, municipio: mun || null, outOfMG: r.data.uf && r.data.uf !== 'MG', at: now() });
  } catch (e) {
    SV.audit(req, 'integracao.falha', { entity: 'cnpj', entityId: c, after: { erro: e.message, detalhes: e.details } });
    throw err(502, e.message);
  }
});
function applyCnpj(store, r) {
  const d = r.data;
  const mun = d.ibge ? one('SELECT ibge FROM municipalities WHERE ibge=?', d.ibge) : one('SELECT ibge FROM municipalities WHERE lower(name)=lower(?)', d.municipio || '');
  return {
    razao: d.razao, fantasia: store.fantasia || d.fantasia, situacao_cadastral: d.situacao,
    address: [d.logradouro, d.numero, d.complemento, d.bairro, `${d.municipio}/${d.uf}`].filter(Boolean).join(', '), cep: d.cep,
    municipio_ibge: mun ? mun.ibge : store.municipio_ibge, cnpj_data: S(d), cnpj_checked_at: now(), cnpj_source: r.source,
  };
}

// ---------------- Lojas (Franqueadora) ----------------
function storeRow(s) {
  const b = one('SELECT id, name, slug FROM brands WHERE id=?', s.brand_id);
  const m = one('SELECT * FROM municipalities WHERE ibge=?', s.municipio_ibge);
  const p = R.storePorte(s);
  const coord = s.coordinator_id ? one('SELECT id, name FROM users WHERE id=?', s.coordinator_id) : null;
  const fr = one("SELECT u.id, u.name, u.email, u.phone, u.link_opened_at, u.last_access_at, u.active FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja' LIMIT 1", s.id);
  const laudo = one(`SELECT * FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${L.ACTIVE.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, s.id, ...L.ACTIVE);
  const last = one('SELECT * FROM laudos WHERE store_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', s.id);
  return { ...s, cnpj_data: J(s.cnpj_data), brand: b, municipio: m, porte: p.porte, porteSource: p.source, coordinator: coord, franchisee: fr,
    laudo: laudo ? L.laudoListRow(laudo) : null, lastLaudo: last && !laudo ? { id: last.id, code: last.code, status: last.status, statusLabel: L.STATUS[last.status]?.label } : null };
}
app.get('/api/stores', need('franqueadora', 'coordenador', 'diretoria', 'admin'), (req, res) => {
  const ids = L.storeIdsForUser(req.user);
  if (!ids.length) return res.json([]);
  res.json(all(`SELECT * FROM stores WHERE deleted_at IS NULL AND id IN (${ids.join(',')}) ORDER BY fantasia`).map(storeRow));
});
app.get('/api/stores/:id', need(), (req, res) => res.json(storeRow(getStore(req, +req.params.id))));
async function upsertStore(req, body, existing) {
  const cnpj = String(body.cnpj || '').replace(/\D/g, '');
  if (!R.validCNPJ(cnpj)) throw err(400, 'CNPJ inválido.');
  if (!body.brand_id) throw err(400, 'Selecione a marca da loja.');
  const dup = one('SELECT id FROM stores WHERE cnpj=? AND deleted_at IS NULL', cnpj);
  if (dup && (!existing || dup.id !== existing.id)) throw err(409, 'Já existe uma loja com este CNPJ.');
  const fields = {
    brand_id: +body.brand_id, cnpj, razao: body.razao, fantasia: body.fantasia, address: body.address, cep: body.cep,
    municipio_ibge: body.municipio_ibge, situacao_cadastral: body.situacao_cadastral || (existing && existing.situacao_cadastral) || null,
    coordinator_id: body.coordinator_id ? +body.coordinator_id : null, status: body.status || 'ativa', cred_expiry: body.cred_expiry || null,
    rep_name: body.rep_name, rep_cpf: body.rep_cpf ? String(body.rep_cpf).replace(/\D/g, '') : null, rep_role: body.rep_role,
    contact_email: body.contact_email, contact_phone: body.contact_phone, drive_folder: body.drive_folder || null,
  };
  if (body.cnpj_data) Object.assign(fields, { cnpj_data: S(body.cnpj_data), cnpj_checked_at: body.cnpj_checked_at || now(), cnpj_source: body.cnpj_source });
  let id;
  if (existing) { update('stores', existing.id, fields); id = existing.id; SV.audit(req, 'loja.editar', { entity: 'store', entityId: id, storeId: id, before: existing, after: fields }); }
  else { id = insert('stores', { ...fields, created_at: now() }); SV.audit(req, 'loja.criar', { entity: 'store', entityId: id, storeId: id, after: fields }); }
  // franqueado (usuário com link pessoal)
  if (body.franchisee_name && (body.franchisee_email || body.franchisee_phone)) {
    let fu = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", id);
    const ph = String(body.franchisee_phone || '').replace(/\D/g, '');
    if (!fu) fu = all('SELECT * FROM users WHERE deleted_at IS NULL').find((u) => (body.franchisee_email && u.email && u.email.toLowerCase() === body.franchisee_email.toLowerCase()) || (ph && String(u.phone || '').replace(/\D/g, '') === ph));
    if (fu) {
      update('users', fu.id, { name: body.franchisee_name, email: body.franchisee_email || fu.email, phone: body.franchisee_phone || fu.phone, roles: S([...new Set([...J(fu.roles, []), 'loja'])]) });
    } else {
      const uid = insert('users', { name: body.franchisee_name, email: body.franchisee_email, phone: body.franchisee_phone, roles: S(['loja']), token: token(), active: 1, created_at: now(), invited_by: req.user.id });
      fu = { id: uid };
      SV.audit(req, 'usuario.criar', { entity: 'user', entityId: uid, storeId: id, after: { name: body.franchisee_name, perfil: 'loja' } });
    }
    run("INSERT OR IGNORE INTO store_users (store_id, user_id, kind) VALUES (?,?, 'loja')", id, fu.id);
  }
  return id;
}
app.post('/api/stores', need('franqueadora', 'admin'), async (req, res) => { const id = await upsertStore(req, req.body); res.json(storeRow(one('SELECT * FROM stores WHERE id=?', id))); });
app.put('/api/stores/:id', need('franqueadora', 'admin'), async (req, res) => { const s = getStore(req, +req.params.id); await upsertStore(req, { ...s, ...req.body }, s); res.json(storeRow(one('SELECT * FROM stores WHERE id=?', s.id))); });
app.post('/api/stores/:id/refresh-cnpj', need('franqueadora', 'loja', 'admin'), async (req, res) => {
  const s = getStore(req, +req.params.id);
  const r = await SV.lookupCnpj(s.cnpj).catch((e) => { throw err(502, e.message); });
  const f = applyCnpj(s, r);
  update('stores', s.id, f);
  SV.audit(req, 'cnpj.atualizar', { entity: 'store', entityId: s.id, storeId: s.id, before: { razao: s.razao, address: s.address, situacao: s.situacao_cadastral }, after: { razao: f.razao, address: f.address, situacao: f.situacao_cadastral, fonte: r.source } });
  if (f.situacao_cadastral && R.norm(f.situacao_cadastral) !== 'ativa') notifyFranqueadora(req, s, `CNPJ de ${s.fantasia} com situação ${f.situacao_cadastral}`, `A consulta do CNPJ ${s.cnpj} retornou situação "${f.situacao_cadastral}". O laudo fica bloqueado até a regularização.`);
  res.json(storeRow(one('SELECT * FROM stores WHERE id=?', s.id)));
});
app.put('/api/stores/:id/porte', need('admin'), (req, res) => {
  const s = getStore(req, +req.params.id);
  if (!req.body.reason) throw err(400, 'Informe a justificativa da alteração de porte.');
  update('stores', s.id, { porte_override: req.body.porte || null, porte_override_reason: req.body.reason });
  SV.audit(req, 'porte.alterar_loja', { entity: 'store', entityId: s.id, storeId: s.id, before: { porte: s.porte_override }, after: { porte: req.body.porte, justificativa: req.body.reason } });
  porteChangedNotify(req, [s.id], req.body.porte);
  res.json({ ok: true });
});
function notifyFranqueadora(req, store, subject, body) {
  for (const u of all('SELECT * FROM users WHERE active=1 AND deleted_at IS NULL')) if (L.has(u, 'franqueadora') && L.storeIdsForUser(u).includes(store.id)) SV.notify({ channel: 'email', to: u.email, toName: u.name, subject, body, brandId: store.brand_id, storeId: store.id, kind: 'alerta' });
}
function porteChangedNotify(req, storeIds, porte) {
  for (const sid of storeIds) {
    const s = one('SELECT * FROM stores WHERE id=?', sid);
    const l = one(`SELECT * FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${L.ACTIVE.map(() => '?').join(',')})`, sid, ...L.ACTIVE);
    const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", sid);
    const msg = `O porte do município da loja ${s.fantasia} foi alterado para ${C.PORTE_LABEL[porte] || 'o padrão'}. ${l ? 'As regras do laudo em andamento (boxes, vagas, banheiros e cobertura do box pesado) foram reaplicadas: confira o checklist.' : ''}`;
    if (fr) SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: 'Porte do município alterado', body: msg, brandId: s.brand_id, storeId: sid, kind: 'porte' });
    notifyFranqueadora(req, s, 'Porte alterado: ' + s.fantasia, msg);
  }
}
app.post('/api/stores/:id/send-link', need('franqueadora', 'admin'), (req, res) => {
  const s = getStore(req, +req.params.id);
  const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", s.id);
  if (!fr) throw err(400, 'Cadastre o franqueado (nome e WhatsApp/e-mail) antes de enviar o link.');
  const brand = L.brandOfStore(s);
  const l = one(`SELECT * FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${L.ACTIVE.map(() => '?').join(',')}) ORDER BY id DESC`, s.id, ...L.ACTIVE);
  const ch = req.body.channel || 'whatsapp';
  const body = req.body.message || `Olá, ${fr.name.split(' ')[0]}! A ${brand.name} solicitou o preenchimento do ${l ? C.PROCESS_TYPES[l.process_type].toLowerCase() : 'laudo'} da unidade ${s.fantasia}${l && l.deadline ? ` até ${new Date(l.deadline).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''}.\nAcesse pelo seu link pessoal (não encaminhe):\n${linkFor(req, fr)}`;
  if (ch === 'copy') { SV.audit(req, 'link.copiar', { entity: 'user', entityId: fr.id, storeId: s.id }); return res.json({ ok: true, link: linkFor(req, fr) }); }
  SV.notify({ channel: ch, to: ch === 'email' ? fr.email : fr.phone, toName: fr.name, subject: `${brand.name} · Laudo da unidade ${s.fantasia}`, body, brandId: s.brand_id, storeId: s.id, laudoId: l?.id, kind: req.body.kind || 'convite' });
  SV.audit(req, req.body.kind === 'cobranca' ? 'cobranca.enviar' : 'link.enviar', { entity: 'user', entityId: fr.id, storeId: s.id, after: { canal: ch } });
  res.json({ ok: true, link: linkFor(req, fr) });
});
app.post('/api/users/:id/revoke-link', need('franqueadora', 'admin', 'loja'), (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', +req.params.id);
  if (!u) throw err(404, 'Usuário não encontrado.');
  if (!L.isAdmin(req.user) && !L.has(req.user, 'franqueadora')) {
    // franqueado pode revogar colaborador da própria loja
    const ok = all("SELECT store_id FROM store_users WHERE user_id=? AND kind='colaborador'", u.id).some((r) => L.storeRole(req.user, r.store_id) === 'loja');
    if (!ok) throw err(403, 'Sem permissão.');
  }
  if (L.isAdmin(u) && !L.isAdmin(req.user)) throw err(403, 'Sem permissão.');
  const t = token();
  update('users', u.id, { token: t, link_opened_at: null });
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  SV.audit(req, 'link.revogar', { entity: 'user', entityId: u.id });
  res.json({ ok: true, link: `${baseUrl(req)}/a/${t}` });
});

// Importação por planilha (B.7)
function parseCsv(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = (l) => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === sep && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  const head = split(lines[0]).map((h) => R.norm(h).replace(/[^a-z0-9]+/g, '_'));
  return lines.slice(1).map((l) => { const v = split(l); return Object.fromEntries(head.map((h, i) => [h, v[i] || ''])); });
}
app.post('/api/stores/import', need('franqueadora', 'admin'), async (req, res) => {
  const rows = parseCsv(req.body.csv);
  const brands = all('SELECT * FROM brands WHERE deleted_at IS NULL');
  const coords = all('SELECT * FROM users WHERE deleted_at IS NULL').filter((u) => L.has(u, 'coordenador'));
  const preview = rows.map((r, i) => {
    const cnpj = String(r.cnpj || '').replace(/\D/g, '');
    const brand = brands.find((b) => R.norm(b.name) === R.norm(r.marca) || b.slug === R.norm(r.marca));
    const mun = r.municipio ? one('SELECT * FROM municipalities WHERE lower(name)=lower(?)', r.municipio) : null;
    const errors = [];
    if (!R.validCNPJ(cnpj)) errors.push('CNPJ inválido');
    if (!brand) errors.push('Marca não encontrada');
    if (r.municipio && !mun) errors.push('Município não encontrado em MG');
    const exists = one('SELECT id, fantasia FROM stores WHERE cnpj=? AND deleted_at IS NULL', cnpj);
    const dupInFile = rows.findIndex((x) => String(x.cnpj || '').replace(/\D/g, '') === cnpj) !== i;
    if (dupInFile) errors.push('CNPJ repetido na planilha');
    const coord = coords.find((u) => u.email && R.norm(u.email) === R.norm(r.coordenador_email || r.coordenador));
    return { line: i + 2, cnpj, fantasia: r.nome_fantasia || r.nome || r.loja || '', brand: brand?.name, brand_id: brand?.id, municipio: mun?.name, municipio_ibge: mun?.ibge,
      coordinator_id: coord?.id, coordinator: coord?.name, franchisee_name: r.franqueado || r.franqueado_nome || '', franchisee_email: r.franqueado_email || r.email || '', franchisee_phone: r.franqueado_whatsapp || r.whatsapp || '',
      cred_expiry: toIsoDate(r.vencimento || r.vencimento_credenciamento), action: errors.length ? 'erro' : exists ? 'atualizar' : 'novo', existingId: exists?.id, errors };
  });
  if (!req.body.commit) return res.json({ preview, counts: { novo: preview.filter((p) => p.action === 'novo').length, atualizar: preview.filter((p) => p.action === 'atualizar').length, erro: preview.filter((p) => p.action === 'erro').length } });
  const results = [];
  for (const p of preview.filter((x) => x.action !== 'erro')) {
    const existing = p.existingId ? one('SELECT * FROM stores WHERE id=?', p.existingId) : null;
    let body = { ...(existing || {}), ...p, brand_id: p.brand_id, fantasia: p.fantasia || existing?.fantasia, municipio_ibge: p.municipio_ibge || existing?.municipio_ibge };
    try {
      const r = await SV.lookupCnpj(p.cnpj);
      body = { ...body, ...applyCnpj(body, r), fantasia: body.fantasia || r.data.fantasia, cnpj_data: r.data, cnpj_source: r.source };
    } catch { /* completa manualmente depois */ }
    try { const id = await upsertStore(req, body, existing); results.push({ line: p.line, id, ok: true }); } catch (e) { results.push({ line: p.line, ok: false, error: e.message }); }
  }
  SV.audit(req, 'loja.importar', { after: { linhas: rows.length, importadas: results.filter((r) => r.ok).length } });
  res.json({ results });
});
function toIsoDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

// ---------------- Solicitação de preenchimento (B.8, B.9) ----------------
app.post('/api/laudos/request', need('franqueadora', 'admin'), (req, res) => {
  const { storeIds = [], process_type, deadline, scope_items, channel = 'whatsapp', send = true } = req.body;
  if (!C.PROCESS_TYPES[process_type]) throw err(400, 'Escolha o tipo de processo.');
  if (['alteracao_endereco', 'modificacao'].includes(process_type) && !(scope_items && scope_items.length)) throw err(400, 'Escolha os itens objeto da alteração/modificação (art. 45 §1º).');
  const out = [];
  for (const sid of storeIds) {
    const s = getStore(req, +sid);
    try {
      const id = L.createLaudo(req, s, { process_type, deadline, scope_items });
      out.push({ storeId: s.id, laudoId: id, ok: true });
      if (send && channel !== 'none') {
        const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", s.id);
        if (fr) {
          const brand = L.brandOfStore(s);
          SV.notify({ channel: channel === 'email' ? 'email' : 'whatsapp', to: channel === 'email' ? fr.email : fr.phone || fr.email, toName: fr.name, subject: `${brand.name} · ${C.PROCESS_TYPES[process_type]} da unidade ${s.fantasia}`,
            body: `Olá, ${fr.name.split(' ')[0]}! A ${brand.name} solicitou o preenchimento do laudo de ${C.PROCESS_TYPES[process_type].toLowerCase()} da unidade ${s.fantasia}${deadline ? ` até ${new Date(deadline).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}` : ''}.\nSeu checklist já está pronto. Acesse pelo link pessoal (não encaminhe):\n${linkFor(req, fr)}`,
            brandId: s.brand_id, storeId: s.id, laudoId: id, kind: 'convite' });
        }
      }
    } catch (e) { out.push({ storeId: s.id, ok: false, error: e.message }); }
  }
  res.json(out);
});
app.post('/api/laudos/:id/cancel', need('franqueadora', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!req.body.reason) throw err(400, 'Informe o motivo do cancelamento.');
  L.setStatus(req, l, 'cancelado', { cancel_reason: req.body.reason });
  res.json({ ok: true });
});

// ---------------- Painel (B.4) e Matriz (B.27) ----------------
app.get('/api/dashboard', need('franqueadora', 'coordenador', 'diretoria', 'admin'), (req, res) => {
  const ids = L.storeIdsForUser(req.user);
  let stores = ids.length ? all(`SELECT * FROM stores WHERE deleted_at IS NULL AND id IN (${ids.join(',')})`) : [];
  const { brand, coord, mun } = req.query;
  if (brand) stores = stores.filter((s) => String(s.brand_id) === String(brand));
  if (coord) stores = stores.filter((s) => String(s.coordinator_id) === String(coord));
  if (mun) stores = stores.filter((s) => s.municipio_ibge === mun);
  const active = stores.filter((s) => s.status === 'ativa');
  const P = R.getParams();
  const counts = { lojas: active.length, nao_iniciado: 0, em_preenchimento: 0, em_conferencia: 0, devolvido: 0, liberado_assinatura: 0, protocolado: 0, deferido: 0 };
  const missing = [], alerts = { venc: [], calib: [], drive: [], exig: [], parados: [] };
  const reasons = {};
  for (const s of active) {
    const l = one(`SELECT * FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${L.ACTIVE.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 1`, s.id, ...L.ACTIVE);
    const lastDef = one("SELECT * FROM laudos WHERE store_id=? AND status='deferido' ORDER BY id DESC LIMIT 1", s.id);
    if (l) {
      const st = l.status;
      if (['nao_iniciado'].includes(st)) counts.nao_iniciado++;
      else if (['rascunho', 'em_preenchimento'].includes(st)) counts.em_preenchimento++;
      else if (['aguardando_conferencia', 'em_conferencia', 'aprovado_coord', 'revisao_tecnica'].includes(st)) counts.em_conferencia++;
      else if (['devolvido', 'exigencia'].includes(st)) counts.devolvido++;
      else if (['liberado_assinatura', 'pronto_protocolo'].includes(st)) counts.liberado_assinatura++;
      else if (st === 'protocolado') counts.protocolado++;
      const row = L.laudoListRow(l);
      const idle = Math.floor((Date.now() - new Date(l.last_activity_at || l.created_at)) / 86400000);
      const fr = one("SELECT u.link_opened_at FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", s.id);
      if (['nao_iniciado', 'rascunho', 'em_preenchimento', 'devolvido', 'exigencia'].includes(st) && (st === 'nao_iniciado' || idle >= P.prazos.lembreteParadoDias || st === 'devolvido'))
        missing.push({ ...row, idleDays: idle, linkOpened: !!fr?.link_opened_at, porte: R.storePorte(s).porte });
      if (st === 'exigencia') { const ex = J(l.exigencia, {}); if (ex.prazo) alerts.exig.push({ store: s.fantasia, laudoId: l.id, prazo: ex.prazo, dias: Math.ceil((new Date(ex.prazo) - Date.now()) / 86400000) }); }
      const d = J(l.data, {});
      for (const k of ['a3_2', 'a3_4']) for (const v of Object.values(d.items?.[k]?.videos || {})) if (v.test && v.test.status === 'fail') alerts.drive.push({ store: s.fantasia, laudoId: l.id });
    } else if (lastDef) counts.deferido++;
    if (s.cred_expiry) { const dd = Math.ceil((new Date(s.cred_expiry) - Date.now()) / 86400000); if (dd <= 180) alerts.venc.push({ store: s.fantasia, storeId: s.id, date: s.cred_expiry, dias: dd }); }
    for (const e of all("SELECT * FROM equipment WHERE store_id=? AND deleted_at IS NULL AND status='ativo'", s.id)) {
      const ct = J(e.cert); if (ct && ct.validade) { const dd = Math.ceil((new Date(ct.validade) - Date.now()) / 86400000); if (dd <= 30) alerts.calib.push({ store: s.fantasia, storeId: s.id, equip: `${C.EQ_TYPES[e.type]?.short} #${e.patrimonio}`, dias: dd }); }
    }
    for (const l2 of all('SELECT reviews FROM laudos WHERE store_id=? AND deleted_at IS NULL', s.id)) for (const r of Object.values(J(l2.reviews, {}))) for (const h of r.history || []) if (h.decision === 'devolver' && Date.now() - new Date(h.at) < 30 * 86400000) reasons[h.reason] = (reasons[h.reason] || 0) + 1;
  }
  missing.sort((a, b) => (a.status === 'nao_iniciado' ? -1 : 0) - (b.status === 'nao_iniciado' ? -1 : 0) || b.idleDays - a.idleDays);
  // tempo de conferência
  const times = all("SELECT a.laudo_id, a.at, a.after FROM audit a WHERE a.action='laudo.status' ORDER BY a.id");
  const by = {};
  for (const t of times) { const st = J(t.after, {}).status; (by[t.laudo_id] = by[t.laudo_id] || []).push({ st, at: t.at }); }
  const conf = [];
  for (const arr of Object.values(by)) for (let i = 0; i < arr.length; i++) if (arr[i].st === 'aguardando_conferencia') { const nx = arr.slice(i + 1).find((x) => ['devolvido', 'revisao_tecnica', 'aprovado_coord'].includes(x.st)); if (nx) conf.push((new Date(nx.at) - new Date(arr[i].at)) / 3600000); }
  res.json({ counts, missing, alerts, reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 6), avgReviewHours: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : null,
    filters: { brands: all('SELECT id, name FROM brands WHERE deleted_at IS NULL'), coordinators: all('SELECT id, name, roles FROM users WHERE deleted_at IS NULL').filter((u) => J(u.roles, []).includes('coordenador')).map((u) => ({ id: u.id, name: u.name })),
      municipios: [...new Set(stores.map((s) => s.municipio_ibge))].map((i) => one('SELECT ibge, name FROM municipalities WHERE ibge=?', i)).filter(Boolean) } });
});
app.get('/api/matrix', need('franqueadora', 'coordenador', 'diretoria', 'admin'), (req, res) => {
  const ids = L.storeIdsForUser(req.user);
  const rows = [];
  for (const s of ids.length ? all(`SELECT * FROM stores WHERE deleted_at IS NULL AND status='ativa' AND id IN (${ids.join(',')}) ORDER BY fantasia`) : []) {
    if (req.query.brand && String(s.brand_id) !== String(req.query.brand)) continue;
    const l = one('SELECT * FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status<>\'cancelado\' ORDER BY id DESC LIMIT 1', s.id);
    if (!l) { rows.push({ store: { id: s.id, fantasia: s.fantasia }, laudo: null, cells: {} }); continue; }
    const sm = R.summarize(l.id);
    const cells = {};
    for (const [k, st] of Object.entries(sm.statuses)) {
      const rv = sm.ctx.reviews[k];
      cells[k] = rv?.status === 'aprovado' ? 'aprovado' : rv?.status === 'devolvido' ? 'devolvido' : st.status === 'completo' ? 'enviado' : st.status === 'erro' ? 'erro' : st.status === 'parcial' ? 'parcial' : 'falta';
    }
    const cal = sm.ctx.equipment.filter((e) => C.EQ_TYPES[e.type]?.cal);
    cells.calibracao = cal.length && cal.every((e) => e.cert && new Date(e.cert.validade) > new Date()) ? 'aprovado' : cal.length ? 'erro' : 'falta';
    cells.art = sm.ctx.files.some((f) => f.kind === 'art') ? 'enviado' : 'falta';
    const v = L.currentVersion(l.id), docs = v ? J(v.docs, {}) : {};
    cells.assinaturas = docs.a2?.signed && docs.a3?.signed && !docs.a2.signed.invalidated_at ? 'aprovado' : docs.a2?.signed || docs.a3?.signed ? 'parcial' : 'falta';
    rows.push({ store: { id: s.id, fantasia: s.fantasia }, laudo: { id: l.id, code: l.code, status: l.status, statusLabel: L.STATUS[l.status].label }, cells });
  }
  res.json({ columns: [...C.ALL_ITEMS.map((i) => ({ key: i.key, label: `${i.annex}.${i.n}`, title: i.title })), { key: 'calibracao', label: 'Calib.', title: 'Calibrações' }, { key: 'art', label: 'ART', title: 'ART/RRT' }, { key: 'assinaturas', label: 'Assin.', title: 'Assinaturas' }], rows });
});

// ---------------- Laudo: leitura completa ----------------
const photoOut = (p) => ({ id: p.id, item: p.item, slot: p.slot, url: `/f/p/${p.id}`, thumb: `/f/p/${p.id}?v=small`, caption: p.caption, width: p.width, height: p.height, size: p.size,
  taken_at: p.taken_at, lat: p.lat, lng: p.lng, source: p.source, is_color: p.is_color, brightness: p.brightness, sharpness: p.sharpness, essential: p.essential, annotations: J(p.annotations, []), created_at: p.created_at, uploaded_by: p.uploaded_by });
const fileOut = (f) => ({ id: f.id, kind: f.kind, item: f.item, name: f.original_name, size: f.size, mime: f.mime, url: `/f/d/${f.id}`, meta: J(f.meta, {}), equipment_id: f.equipment_id, laudo_id: f.laudo_id, created_at: f.created_at });

function laudoPayload(req, l) {
  const sum = R.summarize(l.id);
  const { ctx } = sum;
  const checklist = buildChecklist(sum);
  const store = ctx.store, brand = L.brandOfStore(store);
  const u = req.user;
  const editItems = {};
  for (const it of C.ALL_ITEMS) editItems[it.key] = L.canEditItem(u, l, it.key);
  const versions = all('SELECT * FROM versions WHERE laudo_id=? ORDER BY n DESC', l.id).map((v) => ({ id: v.id, n: v.n, code: v.code, reason: v.reason, created_at: v.created_at, views: v.views, revoked: v.revoked, has_password: !!v.access_password, access_until: v.access_until,
    docs: Object.fromEntries(Object.entries(J(v.docs, {})).map(([k, d]) => [k, { size: d.size, sha: d.sha, level: d.level, generated_at: d.generated_at, signed: d.signed ? { at: d.signed.at, by: d.signed.by, method: d.signed.method, invalidated_at: d.signed.invalidated_at, signer: d.signed.signer, size: d.signed.size } : null }])) }));
  const rtRole = (() => { if (!L.has(u, 'rt')) return false; const rt = one('SELECT id FROM rts WHERE user_id=?', u.id); return rt && rt.id === l.rt_id; })();
  const isCoord = L.has(u, 'coordenador') && (L.isAdmin(u) || store.coordinator_id === u.id || L.canSeeStore(u, store.id));
  const sr = L.storeRole(u, store.id);
  const rts = all('SELECT * FROM rts WHERE deleted_at IS NULL ORDER BY name').map((r) => ({ id: r.id, name: r.name, council: r.council, reg_number: r.reg_number, uf: r.uf, validated: !!r.validated_at }));
  const presence = all('SELECT p.item, u.name, p.user_id FROM presence p JOIN users u ON u.id=p.user_id WHERE p.laudo_id=? AND p.at > ? AND p.user_id<>?', l.id, new Date(Date.now() - 90000).toISOString(), u.id);
  const showDiff = ['aguardando_conferencia', 'em_conferencia'].includes(l.status) && l.version > 1;
  const prevVersion = showDiff ? one('SELECT * FROM versions WHERE laudo_id=? AND n=?', l.id, l.version - 1) : null;
  return {
    laudo: { id: l.id, code: l.code, status: l.status, statusLabel: L.STATUS[l.status]?.label, sub_status: l.sub_status, process_type: l.process_type, deadline: l.deadline, version: l.version,
      scope_items: J(l.scope_items, null), created_at: l.created_at, submitted_at: l.submitted_at, protocol: J(l.protocol), result: J(l.result), exigencia: J(l.exigencia), cancel_reason: l.cancel_reason, parent_laudo_id: l.parent_laudo_id, rt_id: l.rt_id },
    store: { ...store, cnpj_data: J(store.cnpj_data), brand: { ...brand, theme: J(brand.theme, {}) } },
    porte: ctx.porte, porteSource: ctx.porteSource, municipio: ctx.municipio, params: ctx.params,
    data: ctx.data, reviews: ctx.reviews, alertsJust: ctx.alertsJust,
    issues: sum.issues, statuses: sum.statuses, progress: checklist.pct, checklist,
    photos: ctx.photos.map(photoOut), files: ctx.files.map(fileOut),
    equipment: ctx.equipment.map((e) => ({ ...e, photos: e.photosArr.map(photoOut), photosArr: undefined, files: ctx.files.filter((f) => f.equipment_id === e.id).map(fileOut) })),
    rt: ctx.rt ? { ...ctx.rt, cpf: L.isAdmin(u) || isCoord || rtRole ? ctx.rt.cpf : maskCpf(ctx.rt.cpf) } : null, rts,
    quantities: C.quantities(ctx.cfg), boxes: C.boxesList(ctx.cfg), scope: C.itemsInScope(l, ctx.cfg).map((i) => i.key),
    versions, presence,
    diff: showDiff ? { from: prevVersion ? prevVersion.n : null, changes: diffVersions(prevVersion, one('SELECT * FROM versions WHERE laudo_id=? AND n=?', l.id, l.version)) } : null,
    perms: {
      admin: L.isAdmin(u), storeRole: sr, blocks: L.blocksOf(u, store.id),
      editGeneral: L.canEditGeneral(u, l), editItems,
      submit: (L.isAdmin(u) || sr === 'loja') && ['rascunho', 'em_preenchimento', 'devolvido', 'exigencia'].includes(l.status),
      review: (isCoord || L.isAdmin(u)) && ['aguardando_conferencia', 'em_conferencia'].includes(l.status),
      validateRt: isCoord || L.isAdmin(u),
      rtReview: (rtRole || L.isAdmin(u)) && l.status === 'revisao_tecnica',
      signA2: (rtRole || L.isAdmin(u)) && l.status === 'liberado_assinatura',
      signA3: (sr === 'loja' || L.isAdmin(u)) && l.status === 'liberado_assinatura',
      protocol: (sr === 'loja' || L.isAdmin(u) || L.has(u, 'franqueadora')) && ['pronto_protocolo', 'protocolado', 'exigencia'].includes(l.status),
      exigenciaItems: (L.has(u, 'franqueadora') || isCoord || L.isAdmin(u)) && l.status === 'exigencia',
      cancel: L.has(u, 'franqueadora') || L.isAdmin(u),
      result: (L.has(u, 'franqueadora') || L.isAdmin(u) || sr === 'loja') && l.status === 'protocolado',
      versionsManage: sr === 'loja' || L.has(u, 'franqueadora') || L.isAdmin(u),
    },
  };
}
function diffVersions(a, b) {
  if (!a || !b) return {};
  const pa = J(a.snapshot, {}), pb = J(b.snapshot, {});
  const out = {};
  for (const k of new Set([...Object.keys(pa.data?.items || {}), ...Object.keys(pb.data?.items || {})])) {
    const x = pa.data?.items?.[k] || {}, y = pb.data?.items?.[k] || {}, ch = [];
    const fx = x.fields || {}, fy = y.fields || {};
    for (const f of new Set([...Object.keys(fx), ...Object.keys(fy)])) if (JSON.stringify(fx[f]) !== JSON.stringify(fy[f])) ch.push({ field: f, before: fx[f], after: fy[f] });
    const sa = (pa.photos || []).filter((p) => p.item === k).map((p) => p.sha), sb = (pb.photos || []).filter((p) => p.item === k).map((p) => p.sha);
    const add = sb.filter((s) => !sa.includes(s)).length, rem = sa.filter((s) => !sb.includes(s)).length;
    if (add || rem) ch.push({ field: 'fotos', before: `${sa.length} foto(s)`, after: `${sb.length} foto(s) (+${add} / −${rem})` });
    if (ch.length) out[k] = ch;
  }
  for (const e of pb.equipment || []) {
    const pe = (pa.equipment || []).find((x) => x.id === e.id), item = C.A3.find((i) => i.eqType === e.type)?.key;
    if (item && (!pe || JSON.stringify(pe) !== JSON.stringify(e))) (out[item] = out[item] || []).push({ field: 'equipamento', before: pe ? `#${pe.patrimonio}` : '—', after: `#${e.patrimonio}${pe ? ' alterado' : ' novo'}` });
  }
  return out;
}
app.get('/api/laudos/:id', need(), (req, res) => res.json(laudoPayload(req, getLaudo(req, +req.params.id))));
app.get('/api/my/laudos', need(), (req, res) => {
  const ids = L.storeIdsForUser(req.user);
  const rows = ids.length ? all(`SELECT * FROM laudos WHERE deleted_at IS NULL AND store_id IN (${ids.join(',')}) ORDER BY id DESC`) : [];
  res.json(rows.map(L.laudoListRow));
});

// ---------------- Etapa 1 ----------------
app.put('/api/laudos/:id/etapa1', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!L.canEditGeneral(req.user, l) && !(['devolvido', 'exigencia'].includes(l.status) && L.isAdmin(req.user))) throw err(403, 'A Etapa 1 só pode ser alterada enquanto o laudo está em preenchimento.');
  const data = J(l.data, {});
  const before = { etapa1: data.etapa1, empresa: data.empresa, rt_id: l.rt_id };
  const e1 = req.body.etapa1 || {};
  data.etapa1 = { ...(data.etapa1 || {}), boxesLeves: +e1.boxesLeves || 0, pesados: !!e1.pesados, boxesPesados: e1.pesados ? +e1.boxesPesados || 0 : 0, movel: e1.movel !== false,
    elevacao: Array.isArray(e1.elevacao) ? e1.elevacao.filter((x) => C.ELEVACAO[x]) : [], dataPedido: e1.dataPedido || null, vencimentoAtual: e1.vencimentoAtual || data.etapa1?.vencimentoAtual || null, savedAt: now() };
  const em = req.body.empresa || {};
  data.empresa = { ...(data.empresa || {}), fantasia: em.fantasia, razao: em.razao, endereco: em.endereco, cep: em.cep, repName: em.repName, repCpf: String(em.repCpf || '').replace(/\D/g, ''), repRole: em.repRole, contactEmail: em.contactEmail, contactPhone: em.contactPhone, cnpj: l.store_id && one('SELECT cnpj FROM stores WHERE id=?', l.store_id).cnpj };
  if (req.body.geo && req.body.geo.lat) data.geo = req.body.geo;
  const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  if (em.municipio_ibge && em.municipio_ibge !== store.municipio_ibge && one('SELECT ibge FROM municipalities WHERE ibge=?', em.municipio_ibge)) update('stores', store.id, { municipio_ibge: em.municipio_ibge });
  update('stores', store.id, { rep_name: data.empresa.repName, rep_cpf: data.empresa.repCpf, rep_role: data.empresa.repRole, fantasia: em.fantasia || store.fantasia, rt_id: req.body.rt_id || store.rt_id });
  const status = ['nao_iniciado', 'rascunho'].includes(l.status) ? 'em_preenchimento' : l.status;
  update('laudos', l.id, { data: S(data), rt_id: req.body.rt_id ? +req.body.rt_id : l.rt_id, updated_at: now(), last_activity_at: now() });
  if (status !== l.status) L.setStatus(req, l, status);
  SV.audit(req, 'etapa1.salvar', { entity: 'laudo', entityId: l.id, laudoId: l.id, storeId: l.store_id, before, after: { etapa1: data.etapa1, empresa: data.empresa, rt_id: req.body.rt_id } });
  if (!before.etapa1?.savedAt) {
    const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", l.store_id);
    if (fr) SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: 'Checklist liberado', body: `Seu checklist do laudo ${l.code} está pronto. Abra o sistema para ver tudo o que precisa reunir: ${linkFor(req, fr)}`, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'checklist' });
  }
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/laudos/:id/open', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (l.status === 'nao_iniciado' && L.storeRole(req.user, l.store_id)) L.setStatus(req, l, 'rascunho');
  res.json({ ok: true });
});

// ---------------- Itens (salvamento automático) ----------------
app.put('/api/laudos/:id/items/:item', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const k = req.params.item;
  if (!C.ITEM[k]) throw err(400, 'Item inválido.');
  if (!L.canEditItem(req.user, l, k)) throw err(403, 'Este item está travado (aprovado ou fora de edição).');
  const data = J(l.data, {});
  data.items = data.items || {};
  const before = data.items[k] || {};
  const allowed = ['fields', 'descricao', 'na', 'naJust', 'plantRect', 'obs', 'videoUrl'];
  const next = { ...before };
  for (const f of allowed) if (f in req.body) next[f] = req.body[f];
  data.items[k] = next;
  update('laudos', l.id, { data: S(data), updated_at: now(), last_activity_at: now() });
  if (['nao_iniciado', 'rascunho'].includes(l.status)) L.setStatus(req, l, 'em_preenchimento');
  SV.audit(req, 'item.salvar', { entity: 'laudo', entityId: l.id, laudoId: l.id, storeId: l.store_id, item: k, before: pick(before, allowed), after: pick(next, allowed) });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o && k in o).map((k) => [k, o[k]]));
app.post('/api/laudos/:id/presence', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  run('INSERT OR REPLACE INTO presence (laudo_id, item, user_id, at) VALUES (?,?,?,?)', l.id, req.body.item || '-', req.user.id, now());
  res.json(all('SELECT p.item, u.name FROM presence p JOIN users u ON u.id=p.user_id WHERE p.laudo_id=? AND p.item=? AND p.user_id<>? AND p.at > ?', l.id, req.body.item || '-', req.user.id, new Date(Date.now() - 90000).toISOString()));
});

// ---------------- Fotos ----------------
app.post('/api/laudos/:id/photos', need(), upload.single('file'), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const { item, slot } = req.body;
  if (!C.ITEM[item]) throw err(400, 'Item inválido.');
  if (!L.canEditItem(req.user, l, item)) throw err(403, 'Este item está travado.');
  if (!req.file) throw err(400, 'Envie a foto.');
  res.json(await savePhoto(req, { laudoId: l.id, storeId: l.store_id, item, slot }));
});
async function savePhoto(req, { laudoId, storeId, item, slot }) {
  let info;
  try { info = await SV.storePhoto(req.file.buffer); } catch { throw err(400, 'Arquivo de imagem inválido. Envie JPG, PNG ou HEIC convertido.'); }
  if (!info.isColor) throw err(422, 'A foto parece estar em preto e branco. O Anexo II exige fotos coloridas.');
  // mesma foto (hash) em outro item é bloqueada já no envio
  const dup = one('SELECT id, item, slot FROM photos WHERE sha=? AND deleted_at IS NULL AND (laudo_id=? OR item LIKE \'eq:%\') AND NOT (item=? AND slot=?)', info.sha, laudoId, item, slot);
  if (dup) throw err(422, 'Esta mesma foto já foi usada em outro item ou posição. Tire uma foto específica para este ponto.');
  const warnings = [];
  const P = R.getParams().arquivos;
  if (info.brightness < P.brilhoMin) warnings.push('Foto escura: prefira um local mais iluminado.');
  if (info.brightness > P.brilhoMax) warnings.push('Foto muito clara/estourada.');
  if (info.sharpness < P.nitidezMin) warnings.push('A foto parece tremida ou desfocada.');
  if (Math.max(info.width, info.height) < P.fotoMinPx) warnings.push(`Resolução baixa (${info.width}×${info.height}); o mínimo sugerido é ${P.fotoMinPx} px no maior lado.`);
  // substitui a foto anterior do mesmo slot (a anterior fica na lixeira/histórico)
  const prev = slot && slot !== 'extra' ? one('SELECT * FROM photos WHERE ' + (laudoId ? 'laudo_id=?' : 'laudo_id IS NULL AND ?=?') + ' AND item=? AND slot=? AND deleted_at IS NULL', ...(laudoId ? [laudoId] : [1, 1]), item, slot) : null;
  if (prev) { update('photos', prev.id, { deleted_at: now() }); insert('trash', { entity: 'photo', entity_id: prev.id, label: `Foto substituída (${prev.caption || prev.slot})`, deleted_at: now(), deleted_by: req.user.id }); }
  const id = insert('photos', {
    laudo_id: laudoId || null, item, slot: slot || 'extra', file: info.file, pdf_file: info.pdf_file, small_file: info.small_file, sha: info.sha, dhash: info.dhash,
    width: info.width, height: info.height, size: info.size, is_color: info.isColor ? 1 : 0, brightness: info.brightness, sharpness: info.sharpness,
    taken_at: req.body.taken_at || now(), lat: req.body.lat ? +req.body.lat : null, lng: req.body.lng ? +req.body.lng : null, source: req.body.source || 'upload',
    caption: req.body.caption || null, essential: slot === 'extra' ? 0 : 1, uploaded_by: req.user.id, created_at: now(),
  });
  if (laudoId) L.touch(laudoId);
  const lau = laudoId ? one('SELECT * FROM laudos WHERE id=?', laudoId) : null;
  if (lau && ['nao_iniciado', 'rascunho'].includes(lau.status)) L.setStatus(req, lau, 'em_preenchimento');
  SV.audit(req, prev ? 'foto.trocar' : 'foto.enviar', { entity: 'photo', entityId: id, laudoId, storeId, item, before: prev ? { id: prev.id, sha: prev.sha } : undefined, after: { slot, sha: info.sha, w: info.width, h: info.height, origem: req.body.source, lat: req.body.lat, lng: req.body.lng } });
  return { photo: photoOut(one('SELECT * FROM photos WHERE id=?', id)), warnings };
}
app.put('/api/photos/:id', need(), (req, res) => {
  const p = one('SELECT * FROM photos WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!p) throw err(404, 'Foto não encontrada.');
  const l = p.laudo_id ? getLaudo(req, p.laudo_id) : null;
  const upd = {};
  if ('essential' in req.body) { if (!L.isAdmin(req.user)) throw err(403, 'Só o Administrador decide fotos que vão só para o link.'); upd.essential = +req.body.essential; }
  else {
    if (l && !L.canEditItem(req.user, l, p.item)) throw err(403, 'Este item está travado.');
    if (!l) { const eq = one('SELECT * FROM equipment WHERE id=?', +p.item.slice(3)); getStore(req, eq.store_id); }
    if ('caption' in req.body) upd.caption = String(req.body.caption || '').slice(0, 200);
    if ('annotations' in req.body) upd.annotations = S(req.body.annotations);
  }
  update('photos', p.id, upd);
  SV.audit(req, 'foto.editar', { entity: 'photo', entityId: p.id, laudoId: p.laudo_id, item: p.item, before: pick(p, Object.keys(upd)), after: upd });
  res.json(photoOut(one('SELECT * FROM photos WHERE id=?', p.id)));
});
app.delete('/api/photos/:id', need(), (req, res) => {
  const p = one('SELECT * FROM photos WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!p) throw err(404, 'Foto não encontrada.');
  if (p.laudo_id) { const l = getLaudo(req, p.laudo_id); if (!L.canEditItem(req.user, l, p.item)) throw err(403, 'Este item está travado.'); }
  else { const eq = one('SELECT * FROM equipment WHERE id=?', +p.item.slice(3)); getStore(req, eq.store_id); requireStoreEditorOrCollab(req, eq.store_id); }
  update('photos', p.id, { deleted_at: now() });
  insert('trash', { entity: 'photo', entity_id: p.id, label: `Foto ${p.caption || p.slot} (${p.item})`, deleted_at: now(), deleted_by: req.user.id });
  SV.audit(req, 'foto.excluir', { entity: 'photo', entityId: p.id, laudoId: p.laudo_id, item: p.item, before: { sha: p.sha, slot: p.slot } });
  res.json({ ok: true });
});
function requireStoreEditorOrCollab(req, storeId) {
  if (L.isAdmin(req.user)) return;
  const r = L.storeRole(req.user, storeId);
  if (!r) throw err(403, 'Sem permissão.');
  if (r === 'colaborador' && !L.blocksOf(req.user, storeId).includes('C')) throw err(403, 'O franqueado não liberou o bloco de equipamentos para você.');
}

// ---------------- Arquivos / documentos ----------------
app.post('/api/laudos/:id/files', need(), upload.single('file'), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const kind = req.body.kind;
  if (!req.file) throw err(400, 'Envie o arquivo.');
  const okKinds = ['planta', 'art', 'plano_calibracao', 'doc_boroscopio', 'contrato_rede', 'contrato_internet', 'incendio', 'dgcv', 'protocolo', 'exigencia', 'video', 'outro'];
  if (!okKinds.includes(kind)) throw err(400, 'Tipo de documento inválido.');
  const rtRole = L.has(req.user, 'rt') && one('SELECT id FROM rts WHERE user_id=?', req.user.id)?.id === l.rt_id;
  if (kind === 'art') { if (!rtRole && !L.isAdmin(req.user)) throw err(403, 'A ART/RRT é anexada pelo responsável técnico.'); if (!['revisao_tecnica'].includes(l.status) && !L.isAdmin(req.user)) throw err(403, 'A ART/RRT é anexada na revisão técnica.'); }
  else if (['protocolo', 'exigencia'].includes(kind)) { if (!L.storeRole(req.user, l.store_id) && !L.isAdmin(req.user) && !L.has(req.user, 'franqueadora')) throw err(403, 'Sem permissão.'); }
  else {
    const itemFor = { doc_boroscopio: 'a3_3', contrato_rede: 'a3_15', contrato_internet: 'a3_17', incendio: 'a2_5', dgcv: 'a2_1', plano_calibracao: 'a3_1', video: req.body.item }[kind];
    const can = itemFor ? L.canEditItem(req.user, l, itemFor) : L.canEditGeneral(req.user, l) || (kind === 'planta' && ['devolvido', 'exigencia'].includes(l.status) && Object.values(J(l.reviews, {})).some((r) => r.status === 'devolvido') && L.storeRole(req.user, l.store_id));
    if (!can) throw err(403, 'Este documento está travado nesta etapa.');
  }
  const P = R.getParams().arquivos;
  if (kind === 'video' && req.file.size > P.videoMaxMB * 1048576) throw err(413, `Vídeo acima de ${P.videoMaxMB} MB. Prefira o link do Google Drive.`);
  if (kind !== 'video' && req.file.size > P.sceLimiteMB * 1048576 && !['planta'].includes(kind)) throw err(413, `Arquivo acima de ${P.sceLimiteMB} MB, limite do SCE. Comprima o PDF antes de enviar.`);
  const ext = path.extname(req.file.originalname || '').slice(1).toLowerCase() || 'bin';
  const rel = SV.saveFile(req.file.buffer, ext);
  const meta = {};
  if (kind === 'planta') {
    const img = req.file.mimetype === 'application/pdf' || ext === 'pdf' ? SV.pdfToPng(req.file.buffer) : req.file.buffer;
    if (!img) throw err(422, 'Não foi possível ler a planta. Envie em PDF ou imagem (JPG/PNG).');
    const png = await require('sharp')(img).rotate().resize(2400, 2400, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    meta.image = SV.saveFile(png, 'png');
  }
  if (kind === 'art') {
    meta.ano = +req.body.ano || null; meta.numero = req.body.numero || null; meta.registro = req.body.registro || null;
    const text = ext === 'pdf' ? SV.pdfText(req.file.buffer) : '';
    if (text) {
      const years = [...new Set((text.match(/\b20\d{2}\b/g) || []).map(Number))];
      meta.anosNoTexto = years;
      if (meta.ano && years.length && !years.includes(meta.ano)) meta.aviso = `O ano informado (${meta.ano}) não aparece no texto da ART/RRT (${years.join(', ')}).`;
    }
  }
  if (kind === 'video') meta.publicToken = token(10);
  if (['protocolo', 'exigencia'].includes(kind)) Object.assign(meta, req.body.meta ? J(req.body.meta, {}) : {});
  // um arquivo por tipo (exceto incêndio/outro/vídeo): o anterior vai para a lixeira
  if (!['incendio', 'outro', 'video', 'exigencia'].includes(kind)) {
    for (const old of all('SELECT * FROM files WHERE laudo_id=? AND kind=? AND deleted_at IS NULL', l.id, kind)) { update('files', old.id, { deleted_at: now() }); insert('trash', { entity: 'file', entity_id: old.id, label: `${kind}: ${old.original_name}`, deleted_at: now(), deleted_by: req.user.id }); }
  }
  const id = insert('files', { laudo_id: l.id, store_id: l.store_id, kind, item: req.body.item || null, file: rel, original_name: req.file.originalname, mime: req.file.mimetype, size: req.file.size, sha: SV.sha256(req.file.buffer), meta: S(meta), uploaded_by: req.user.id, created_at: now() });
  L.touch(l.id);
  SV.audit(req, 'documento.enviar', { entity: 'file', entityId: id, laudoId: l.id, storeId: l.store_id, item: req.body.item, after: { kind, name: req.file.originalname, size: req.file.size, ...meta } });
  const f = fileOut(one('SELECT * FROM files WHERE id=?', id));
  if (kind === 'video') f.publicUrl = `${baseUrl(req)}/v/${meta.publicToken}`;
  res.json(f);
});
app.delete('/api/files/:id', need(), (req, res) => {
  const f = one('SELECT * FROM files WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!f) throw err(404, 'Arquivo não encontrado.');
  if (f.laudo_id) { const l = getLaudo(req, f.laudo_id); if (!L.canEditGeneral(req.user, l) && !L.isAdmin(req.user) && !(f.kind === 'art' && l.status === 'revisao_tecnica')) throw err(403, 'Documento travado nesta etapa.'); }
  else { getStore(req, f.store_id); requireStoreEditorOrCollab(req, f.store_id); }
  update('files', f.id, { deleted_at: now() });
  insert('trash', { entity: 'file', entity_id: f.id, label: `${f.kind}: ${f.original_name}`, deleted_at: now(), deleted_by: req.user.id });
  SV.audit(req, 'documento.excluir', { entity: 'file', entityId: f.id, laudoId: f.laudo_id, before: { kind: f.kind, name: f.original_name } });
  res.json({ ok: true });
});

// ---------------- Vídeos / links do Drive ----------------
app.put('/api/laudos/:id/videos/:item/:eqId', need(), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const k = req.params.item;
  if (!L.canEditItem(req.user, l, k)) throw err(403, 'Este item está travado.');
  const data = J(l.data, {});
  data.items = data.items || {};
  data.items[k] = data.items[k] || {};
  const vids = data.items[k].videos = data.items[k].videos || {};
  const url = String(req.body.url || '').trim();
  const test = url ? await SV.testDriveLink(url) : null;
  const before = vids[req.params.eqId];
  if (url) vids[req.params.eqId] = { url, test }; else delete vids[req.params.eqId];
  update('laudos', l.id, { data: S(data), updated_at: now(), last_activity_at: now() });
  SV.audit(req, 'video.link', { entity: 'laudo', entityId: l.id, laudoId: l.id, item: k, before, after: vids[req.params.eqId] });
  if (test && test.status === 'fail') SV.audit(req, 'integracao.drive_sem_acesso', { laudoId: l.id, item: k, after: { url, msg: test.msg } });
  res.json({ test, payload: laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)) });
});
app.post('/api/laudos/:id/videos/retest', need(), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const data = J(l.data, {});
  for (const k of ['a3_2', 'a3_4']) for (const v of Object.values(data.items?.[k]?.videos || {})) v.test = await SV.testDriveLink(v.url);
  update('laudos', l.id, { data: S(data) });
  SV.audit(req, 'video.revalidar', { laudoId: l.id });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/drive/test', need(), async (req, res) => res.json(await SV.testDriveLink(req.body.url)));

// ---------------- Equipamentos (cadastro permanente, B.17) ----------------
const eqOut = (e) => {
  const photos = all('SELECT * FROM photos WHERE item=? AND deleted_at IS NULL', 'eq:' + e.id).map(photoOut);
  const files = all('SELECT * FROM files WHERE equipment_id=? AND deleted_at IS NULL', e.id).map(fileOut);
  return { ...e, specs: J(e.specs, {}), cert: J(e.cert, null), photos, files };
};
app.get('/api/stores/:id/equipment', need(), (req, res) => { const s = getStore(req, +req.params.id); res.json(all('SELECT * FROM equipment WHERE store_id=? AND deleted_at IS NULL ORDER BY type, box, id', s.id).map(eqOut)); });
function eqEditable(req, storeId) {
  requireStoreEditorOrCollab(req, storeId);
  if (L.isAdmin(req.user)) return;
  const l = one(`SELECT * FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${L.ACTIVE.map(() => '?').join(',')})`, storeId, ...L.ACTIVE);
  if (l && !['nao_iniciado', 'rascunho', 'em_preenchimento'].includes(l.status)) {
    const rv = J(l.reviews, {});
    const devolvidoEq = Object.entries(rv).some(([k, r]) => k.startsWith('a3_') && r.status === 'devolvido');
    if (!(['devolvido', 'exigencia'].includes(l.status) && devolvidoEq)) throw err(403, `O laudo ${l.code} está em "${L.STATUS[l.status].label}": os equipamentos ficam travados até uma devolução do Anexo III.`);
  }
}
app.post('/api/stores/:id/equipment', need(), (req, res) => {
  const s = getStore(req, +req.params.id);
  eqEditable(req, s.id);
  const b = req.body;
  if (!C.EQ_TYPES[b.type]) throw err(400, 'Tipo de equipamento inválido.');
  const id = insert('equipment', { store_id: s.id, type: b.type, subtype: b.subtype || null, description: b.description || C.EQ_TYPES[b.type].title, brand: b.brand, model: b.model, serial: b.serial, patrimonio: b.patrimonio, box: b.box || null, specs: S(b.specs || {}), cert: b.cert ? S(b.cert) : null, status: b.status || 'ativo', confirmed_at: now(), created_at: now(), updated_at: now() });
  SV.audit(req, 'equipamento.criar', { entity: 'equipment', entityId: id, storeId: s.id, after: b });
  res.json(eqOut(one('SELECT * FROM equipment WHERE id=?', id)));
});
app.put('/api/equipment/:id', need(), (req, res) => {
  const e = one('SELECT * FROM equipment WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!e) throw err(404, 'Equipamento não encontrado.');
  getStore(req, e.store_id); eqEditable(req, e.store_id);
  const b = req.body, upd = {};
  for (const k of ['subtype', 'description', 'brand', 'model', 'serial', 'patrimonio', 'box', 'status']) if (k in b) upd[k] = b[k] === '' ? null : b[k];
  if ('specs' in b) upd.specs = S(b.specs);
  if ('cert' in b) upd.cert = S({ ...(J(e.cert, {}) || {}), ...b.cert });
  if (b.confirm) upd.confirmed_at = now();
  upd.updated_at = now();
  update('equipment', e.id, upd);
  SV.audit(req, b.confirm ? 'equipamento.confirmar' : 'equipamento.editar', { entity: 'equipment', entityId: e.id, storeId: e.store_id, before: pick({ ...e, specs: J(e.specs), cert: J(e.cert) }, Object.keys(b)), after: b });
  res.json(eqOut(one('SELECT * FROM equipment WHERE id=?', e.id)));
});
app.delete('/api/equipment/:id', need(), (req, res) => {
  const e = one('SELECT * FROM equipment WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!e) throw err(404, 'Equipamento não encontrado.');
  getStore(req, e.store_id); eqEditable(req, e.store_id);
  update('equipment', e.id, { deleted_at: now() });
  insert('trash', { entity: 'equipment', entity_id: e.id, label: `${C.EQ_TYPES[e.type]?.short} #${e.patrimonio}`, deleted_at: now(), deleted_by: req.user.id });
  SV.audit(req, 'equipamento.excluir', { entity: 'equipment', entityId: e.id, storeId: e.store_id, before: e });
  res.json({ ok: true });
});
app.post('/api/equipment/:id/photos', need(), upload.single('file'), async (req, res) => {
  const e = one('SELECT * FROM equipment WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!e) throw err(404, 'Equipamento não encontrado.');
  getStore(req, e.store_id); eqEditable(req, e.store_id);
  if (!req.file) throw err(400, 'Envie a foto.');
  const l = one(`SELECT id FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${L.ACTIVE.map(() => '?').join(',')})`, e.store_id, ...L.ACTIVE);
  // fotos do equipamento são do cadastro (laudo_id nulo), mas o laudo ativo é usado para a checagem de repetição
  const r = await savePhotoEq(req, e, l ? l.id : 0);
  res.json(r);
});
async function savePhotoEq(req, e, laudoId) {
  const slot = req.body.slot;
  let info;
  try { info = await SV.storePhoto(req.file.buffer); } catch { throw err(400, 'Arquivo de imagem inválido.'); }
  if (!info.isColor) throw err(422, 'A foto parece estar em preto e branco. Envie uma foto colorida.');
  const dup = one('SELECT id FROM photos WHERE sha=? AND deleted_at IS NULL AND NOT (item=? AND slot=?) AND (laudo_id=? OR item LIKE \'eq:%\')', info.sha, 'eq:' + e.id, slot, laudoId);
  if (dup) throw err(422, 'Esta mesma foto já foi usada em outro lugar. Tire uma foto específica.');
  const prev = one('SELECT * FROM photos WHERE item=? AND slot=? AND deleted_at IS NULL', 'eq:' + e.id, slot);
  if (prev) update('photos', prev.id, { deleted_at: now() });
  const label = C.equipmentPhotoSlots(e.type).find((s) => s.slot === slot)?.label || slot;
  const id = insert('photos', { laudo_id: null, item: 'eq:' + e.id, slot, file: info.file, pdf_file: info.pdf_file, small_file: info.small_file, sha: info.sha, dhash: info.dhash, width: info.width, height: info.height, size: info.size,
    is_color: 1, brightness: info.brightness, sharpness: info.sharpness, taken_at: req.body.taken_at || now(), lat: req.body.lat ? +req.body.lat : null, lng: req.body.lng ? +req.body.lng : null, source: req.body.source || 'upload', caption: label, essential: 1, uploaded_by: req.user.id, created_at: now() });
  update('equipment', e.id, { confirmed_at: now(), updated_at: now() });
  SV.audit(req, prev ? 'foto.trocar' : 'foto.enviar', { entity: 'photo', entityId: id, storeId: e.store_id, item: 'eq:' + e.id, after: { slot, sha: info.sha } });
  const warnings = [];
  const P = R.getParams().arquivos;
  if (info.brightness < P.brilhoMin) warnings.push('Foto escura.');
  if (info.sharpness < P.nitidezMin) warnings.push('A foto parece desfocada — confira se a etiqueta está legível.');
  return { photo: photoOut(one('SELECT * FROM photos WHERE id=?', id)), warnings };
}
// Certificado de calibração com leitura automática (Seção 8.2)
app.post('/api/equipment/:id/cert', need(), upload.single('file'), async (req, res) => {
  const e = one('SELECT * FROM equipment WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!e) throw err(404, 'Equipamento não encontrado.');
  getStore(req, e.store_id); eqEditable(req, e.store_id);
  const cert = { ...(J(e.cert, {}) || {}), ...(req.body.cert ? J(req.body.cert, {}) : {}) };
  if (req.file) {
    if (req.file.size > 3 * 1048576) throw err(413, 'Certificado acima de 3 MB (limite do SCE).');
    for (const old of all("SELECT * FROM files WHERE equipment_id=? AND kind='certificado' AND deleted_at IS NULL", e.id)) update('files', old.id, { deleted_at: now() });
    const rel = SV.saveFile(req.file.buffer, 'pdf');
    const text = SV.pdfText(req.file.buffer);
    const ocr = readCertificate(text, e, cert);
    cert.ocr = ocr;
    for (const k of ['numero', 'validade', 'dataCalibracao', 'faixaMax', 'resultado', 'laboratorio']) if (!cert[k] && ocr[k]) cert[k] = ocr[k];
    insert('files', { store_id: e.store_id, equipment_id: e.id, kind: 'certificado', file: rel, original_name: req.file.originalname, mime: req.file.mimetype, size: req.file.size, sha: SV.sha256(req.file.buffer), meta: S({ ocr }), uploaded_by: req.user.id, created_at: now() });
  }
  update('equipment', e.id, { cert: S(cert), updated_at: now() });
  SV.audit(req, 'certificado.enviar', { entity: 'equipment', entityId: e.id, storeId: e.store_id, after: cert });
  res.json(eqOut(one('SELECT * FROM equipment WHERE id=?', e.id)));
});
function readCertificate(text, e, cert) {
  const t = String(text || '');
  const out = { lido: !!t.trim(), divergencias: [] };
  if (!out.lido) { out.obs = 'PDF sem texto legível (imagem). Confira os dados manualmente.'; return out; }
  const n = t.match(/certificado\s*(?:de calibra[cç][aã]o)?\s*(?:n[º°o.]*|número)\s*[:\-]?\s*([A-Z0-9][A-Z0-9.\-\/]{2,})/i);
  if (n) out.numero = n[1];
  const dates = [...t.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map((m) => `${m[3]}-${m[2]}-${m[1]}`).sort();
  if (dates.length) { out.dataCalibracao = dates[0]; if (dates.length > 1) out.validade = dates[dates.length - 1]; }
  const v = t.match(/validade[^0-9]{0,20}(\d{2})\/(\d{2})\/(\d{4})/i); if (v) out.validade = `${v[3]}-${v[2]}-${v[1]}`;
  const fx = t.match(/(?:faixa|capacidade|intervalo)[^0-9]{0,30}0\s*(?:a|-|–|até)\s*([\d.,]+)\s*(mm|cm|m)\b/i);
  if (fx) { let val = parseFloat(fx[1].replace(/\./g, '').replace(',', '.')); if (fx[2] === 'm') val *= 1000; if (fx[2] === 'cm') val *= 10; out.faixaMax = Math.round(val); }
  if (/reprovad|n[aã]o calibrad|n[aã]o ligou|n[aã]o conforme/i.test(t)) out.resultado = 'Reprovado / não calibrado';
  else if (/aprovad|conforme/i.test(t)) out.resultado = 'Aprovado';
  const lab = t.match(/(?:laborat[óo]rio|emitido por)\s*[:\-]?\s*([^\n]{4,60})/i); if (lab) out.laboratorio = lab[1].trim();
  if (e.serial && !t.replace(/\s/g, '').includes(String(e.serial).replace(/\s/g, ''))) out.divergencias.push(`nº de série ${e.serial} não aparece no certificado`);
  if (cert.numero && out.numero && R.norm(cert.numero).replace(/\W/g, '') !== R.norm(out.numero).replace(/\W/g, '')) out.divergencias.push(`número informado ${cert.numero} ≠ lido ${out.numero}`);
  const it = C.EQ_TYPES[e.type];
  if (it?.faixaMin && out.faixaMax && out.faixaMax < it.faixaMin) out.divergencias.push(`faixa 0–${out.faixaMax} mm não cobre ${it.faixaMin / 1000} m`);
  const words = { trena5: /trena/i, trena50: /trena/i, paquimetro: /paqu[ií]metro/i, profundimetro: /profund[ií]metro|medidor de profundidade/i, espessura: /espessura|camadas/i };
  if (words[e.type] && !words[e.type].test(t)) out.divergencias.push('o tipo de equipamento não aparece no certificado');
  return out;
}

// ---------------- Responsáveis técnicos ----------------
app.get('/api/rts', need(), (req, res) => res.json(all('SELECT * FROM rts WHERE deleted_at IS NULL ORDER BY name').map((r) => ({ ...r, cpf: L.isAdmin(req.user) || L.has(req.user, 'coordenador') ? r.cpf : maskCpf(r.cpf) }))));
app.post('/api/rts', need('loja', 'franqueadora', 'admin'), (req, res) => {
  const b = req.body;
  if (!b.name || !b.reg_number || !b.council) throw err(400, 'Informe nome, conselho (CREA/CAU) e número de registro.');
  if (b.cpf && !R.validCPF(b.cpf)) throw err(400, 'CPF do RT inválido.');
  if (!b.email && !b.phone) throw err(400, 'Informe e-mail ou WhatsApp para enviar o convite ao RT.');
  const uid = insert('users', { name: b.name, email: b.email, phone: b.phone, cpf: String(b.cpf || '').replace(/\D/g, ''), roles: S(['rt']), token: token(), active: 1, created_at: now(), invited_by: req.user.id });
  const id = insert('rts', { user_id: uid, name: b.name, cpf: String(b.cpf || '').replace(/\D/g, ''), council: b.council, reg_number: b.reg_number, uf: b.uf || 'MG', email: b.email, phone: b.phone, created_at: now() });
  SV.audit(req, 'rt.criar', { entity: 'rt', entityId: id, after: { ...b, cpf: maskCpf(b.cpf) } });
  res.json(one('SELECT * FROM rts WHERE id=?', id));
});
app.post('/api/rts/:id/validate', need('coordenador', 'admin'), (req, res) => {
  const r = one('SELECT * FROM rts WHERE id=?', +req.params.id);
  if (!r) throw err(404, 'RT não encontrado.');
  update('rts', r.id, req.body.undo ? { validated_by: null, validated_at: null } : { validated_by: req.user.id, validated_at: now() });
  SV.audit(req, req.body.undo ? 'rt.desvalidar' : 'rt.validar', { entity: 'rt', entityId: r.id, after: { registro: r.reg_number, conselho: r.council, consulta: req.body.note } });
  res.json({ ok: true });
});

// ---------------- Equipe da loja (colaboradores, B.11) ----------------
app.get('/api/stores/:id/team', need(), (req, res) => {
  const s = getStore(req, +req.params.id);
  res.json(all('SELECT u.id, u.name, u.email, u.phone, u.blocks, u.active, u.link_opened_at, u.last_access_at, su.kind FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND u.deleted_at IS NULL', s.id).map((u) => ({ ...u, blocks: J(u.blocks, ['A', 'B', 'C']) })));
});
app.post('/api/stores/:id/team', need(), (req, res) => {
  const s = getStore(req, +req.params.id);
  requireStoreEditor(req, s.id);
  const b = req.body;
  if (!b.name || !(b.phone || b.email)) throw err(400, 'Informe nome e WhatsApp ou e-mail do colaborador.');
  const uid = insert('users', { name: b.name, email: b.email, phone: b.phone, roles: S(['colaborador']), blocks: S(b.blocks && b.blocks.length ? b.blocks : ['B']), token: token(), active: 1, created_at: now(), invited_by: req.user.id });
  run("INSERT INTO store_users (store_id, user_id, kind) VALUES (?,?,'colaborador')", s.id, uid);
  const u = one('SELECT * FROM users WHERE id=?', uid);
  const brand = L.brandOfStore(s);
  SV.notify({ channel: b.phone ? 'whatsapp' : 'email', to: b.phone || b.email, toName: b.name, subject: `${brand.name} · convite para ajudar no laudo`, body: `Olá, ${b.name.split(' ')[0]}! ${req.user.name} convidou você para ajudar no laudo da unidade ${s.fantasia}. Seu link pessoal:\n${linkFor(req, u)}`, brandId: s.brand_id, storeId: s.id, kind: 'convite_colaborador' });
  SV.audit(req, 'colaborador.convidar', { entity: 'user', entityId: uid, storeId: s.id, after: { name: b.name, blocks: b.blocks } });
  res.json({ ok: true, link: linkFor(req, u) });
});
app.put('/api/stores/:id/team/:uid', need(), (req, res) => {
  const s = getStore(req, +req.params.id);
  requireStoreEditor(req, s.id);
  const su = one("SELECT * FROM store_users WHERE store_id=? AND user_id=? AND kind='colaborador'", s.id, +req.params.uid);
  if (!su) throw err(404, 'Colaborador não encontrado.');
  const upd = {};
  if ('blocks' in req.body) upd.blocks = S(req.body.blocks);
  if ('active' in req.body) upd.active = req.body.active ? 1 : 0;
  update('users', su.user_id, upd);
  if (upd.active === 0) run('DELETE FROM sessions WHERE user_id=?', su.user_id);
  SV.audit(req, 'colaborador.editar', { entity: 'user', entityId: su.user_id, storeId: s.id, after: req.body });
  res.json({ ok: true });
});

// ---------------- Alertas: justificativa (loja) e aceite (coordenador) ----------------
app.post('/api/laudos/:id/alerts/:issueId/justify', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!L.storeRole(req.user, l.store_id) && !L.isAdmin(req.user)) throw err(403, 'Sem permissão.');
  const aj = J(l.alerts_just, {});
  const id = req.params.issueId;
  aj[id] = { ...(aj[id] || {}), just: String(req.body.just || '').slice(0, 1000), by: req.user.name, at: now(), accepted_at: null };
  update('laudos', l.id, { alerts_just: S(aj) });
  SV.audit(req, 'alerta.justificar', { laudoId: l.id, after: { alerta: id, just: req.body.just } });
  res.json({ ok: true });
});
app.post('/api/laudos/:id/alerts/:issueId/accept', need('coordenador', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!req.body.just) throw err(400, 'Registre a justificativa do aceite.');
  const aj = J(l.alerts_just, {});
  const id = req.params.issueId;
  aj[id] = { ...(aj[id] || {}), accepted_at: req.body.undo ? null : now(), accepted_by: req.user.name, accept_just: req.body.just };
  update('laudos', l.id, { alerts_just: S(aj) });
  SV.audit(req, 'alerta.aceitar', { laudoId: l.id, after: { alerta: id, just: req.body.just } });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});

// ---------------- Envio para conferência (B.18) ----------------
app.post('/api/laudos/:id/submit', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!L.isAdmin(req.user) && L.storeRole(req.user, l.store_id) !== 'loja') throw err(403, 'Somente o franqueado (representante legal) pode enviar para conferência.');
  if (!['rascunho', 'em_preenchimento', 'devolvido', 'exigencia'].includes(l.status)) throw err(409, 'O laudo não está em preenchimento.');
  const sum = R.summarize(l.id);
  if (sum.blockers.length) throw err(422, `Há ${sum.blockers.length} erro(s) bloqueante(s). Corrija antes de enviar.`, { issues: sum.blockers });
  const aj = J(l.alerts_just, {});
  const unjust = sum.alerts.filter((a) => !aj[a.id] || !aj[a.id].just);
  if (unjust.length) throw err(422, `Justifique os ${unjust.length} alerta(s) antes de enviar.`, { issues: unjust });
  if (!req.body.veracidade) throw err(422, 'É preciso aceitar a declaração de veracidade (regra R28).');
  const reviews = J(l.reviews, {});
  // reenvio: os itens devolvidos voltam como "corrigido" para nova análise
  for (const [k, r] of Object.entries(reviews)) if (r.status === 'devolvido') { r.status = 'corrigido'; r.corrected_at = now(); }
  const data = J(l.data, {});
  data.veracidade = { by: req.user.name, userId: req.user.id, at: now(), ip: req.ip, text: 'Declaro, como representante legal, que as informações, medidas, fotos e vídeos apresentados são verdadeiros e retratam a situação atual da unidade.' };
  update('laudos', l.id, { data: S(data), reviews: S(reviews), submitted_at: now() });
  if (l.status === 'exigencia' || J(l.exigencia)) L.invalidateSignatures(req, l.id, 'Reenvio após exigência/devolução');
  L.setStatus(req, l, 'aguardando_conferencia');
  const v = L.makeVersion(req, l.id, l.status === 'devolvido' ? 'Reenvio após devolução' : l.status === 'exigencia' ? 'Correção de exigência da CET-MG' : 'Envio para conferência');
  SV.audit(req, 'lgpd.declaracao_veracidade', { laudoId: l.id, storeId: l.store_id, after: data.veracidade });
  const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  const coord = store.coordinator_id ? one('SELECT * FROM users WHERE id=?', store.coordinator_id) : null;
  if (coord) SV.notify({ channel: 'email', to: coord.email, toName: coord.name, subject: `Laudo ${l.code} aguardando conferência`, body: `${store.fantasia} enviou o laudo ${l.code} (v${v.n}) para conferência.\n${baseUrl(req)}/#/conferencia/${l.id}`, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'conferencia' });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});

// ---------------- Conferência do coordenador (B.19, B.20) ----------------
app.get('/api/queue', need('coordenador', 'admin'), (req, res) => {
  const ids = L.storeIdsForUser(req.user);
  const st = req.query.status ? [req.query.status] : ['aguardando_conferencia', 'em_conferencia'];
  if (req.query.status === 'devolvidos') st.splice(0, 1, 'devolvido', 'exigencia');
  if (req.query.status === 'aprovados') st.splice(0, 1, 'aprovado_coord', 'revisao_tecnica', 'liberado_assinatura', 'pronto_protocolo', 'protocolado', 'deferido');
  const rows = ids.length ? all(`SELECT * FROM laudos WHERE deleted_at IS NULL AND store_id IN (${ids.join(',')}) AND status IN (${st.map(() => '?').join(',')}) ORDER BY submitted_at`, ...st) : [];
  res.json(rows.filter((l) => !req.query.mine || l.coordinator_id === req.user.id).map((l) => {
    const r = L.laudoListRow(l);
    const rv = J(l.reviews, {});
    r.corrected = Object.values(rv).filter((x) => x.status === 'corrigido').length;
    r.isResubmission = l.version > 1;
    return r;
  }));
});
app.post('/api/laudos/:id/start-review', need('coordenador', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (l.status === 'aguardando_conferencia') L.setStatus(req, l, 'em_conferencia');
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
function setReview(req, l, item, decision, reason, comment, stage = 'coord', photoId) {
  const rv = J(l.reviews, {});
  const prev = rv[item] || { history: [] };
  const entry = { decision, reason: reason || null, comment: comment || null, by: req.user.name, userId: req.user.id, at: now(), stage, photoId: photoId || null };
  rv[item] = { ...prev, status: decision === 'aprovar' ? 'aprovado' : 'devolvido', reason: entry.reason, comment: entry.comment, by: entry.by, at: entry.at, stage, photoId: entry.photoId, history: [...(prev.history || []), entry] };
  update('laudos', l.id, { reviews: S(rv), updated_at: now() });
  l.reviews = S(rv);
  SV.audit(req, decision === 'aprovar' ? 'conferencia.aprovar' : 'conferencia.devolver', { laudoId: l.id, storeId: l.store_id, item, after: { reason, comment, stage } });
}
app.post('/api/laudos/:id/review/:item', need('coordenador', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!['aguardando_conferencia', 'em_conferencia'].includes(l.status)) throw err(409, 'O laudo não está em conferência.');
  if (l.status === 'aguardando_conferencia') L.setStatus(req, l, 'em_conferencia');
  const { decision, reason, comment, photoId } = req.body;
  if (decision === 'devolver' && !reason) throw err(400, 'Informe o motivo da devolução.');
  setReview(req, l, req.params.item, decision, reason, comment, 'coord', photoId);
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/laudos/:id/approve-clean', need('coordenador', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!['aguardando_conferencia', 'em_conferencia'].includes(l.status)) throw err(409, 'O laudo não está em conferência.');
  if (l.status === 'aguardando_conferencia') L.setStatus(req, l, 'em_conferencia');
  const sum = R.summarize(l.id);
  const rv = J(l.reviews, {});
  let n = 0;
  for (const k of Object.keys(sum.statuses)) {
    if (rv[k] && rv[k].status === 'aprovado') continue;
    if (rv[k] && rv[k].status === 'devolvido') continue;
    if (sum.issues.some((i) => i.item === k)) continue;
    setReview(req, l, k, 'aprovar', null, 'Aprovado em lote (sem alertas)');
    n++;
  }
  res.json({ approved: n, payload: laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)) });
});
app.post('/api/laudos/:id/finish-review', need('coordenador', 'admin'), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!['aguardando_conferencia', 'em_conferencia'].includes(l.status)) throw err(409, 'O laudo não está em conferência.');
  const sum = R.summarize(l.id);
  const rv = J(l.reviews, {});
  const scope = Object.keys(sum.statuses);
  const dev = scope.filter((k) => rv[k]?.status === 'devolvido');
  const pend = scope.filter((k) => !rv[k] || !['aprovado', 'devolvido'].includes(rv[k].status));
  if (!dev.length && pend.length) throw err(422, `Ainda há ${pend.length} item(ns) sem decisão: ${pend.map((k) => C.ITEM[k].short).join(', ')}.`);
  const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", l.store_id);
  if (dev.length) {
    L.setStatus(req, l, 'devolvido');
    L.makeVersion(req, l.id, 'Devolvido com pendências');
    const list = dev.map((k) => `• ${C.ITEM[k].annex === 'II' ? 'Anexo II' : 'Anexo III'}, item ${C.ITEM[k].n} (${C.ITEM[k].short}): ${rv[k].reason}${rv[k].comment ? ' — ' + rv[k].comment : ''}\n  ${baseUrl(req)}/#/laudo/${l.id}/item/${k}`).join('\n');
    if (fr) SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: `Laudo ${l.code} devolvido com pendências`, body: `O coordenador devolveu ${dev.length} item(ns) para correção:\n${list}\nSó esses itens estão abertos; o restante continua aprovado.`, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'devolucao' });
    if (fr && fr.email) SV.notify({ channel: 'email', to: fr.email, toName: fr.name, subject: `Laudo ${l.code} devolvido com pendências`, body: list, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'devolucao' });
  } else {
    L.setStatus(req, l, 'aprovado_coord');
    const exig = J(l.exigencia);
    const a2Affected = !exig || (exig.items || []).some((k) => k.startsWith('a2_'));
    const data = J(l.data, {});
    if (exig && !a2Affected && data.rtReview?.concludedAt) {
      // exigência só no Anexo III: o RT não precisa revisar de novo
      const lk = await L.signLock(l.id, { revalidate: true });
      if (lk.ok) { await L.generateFinalDocs(req, l.id, baseUrl(req)); L.setStatus(req, one('SELECT * FROM laudos WHERE id=?', l.id), 'liberado_assinatura', { sub_status: 'aguardando_ambas' }); notifySigners(req, l.id); return res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id))); }
    }
    if (data.rtReview) { data.rtReview.concludedAt = null; update('laudos', l.id, { data: S(data) }); }
    L.setStatus(req, one('SELECT * FROM laudos WHERE id=?', l.id), 'revisao_tecnica');
    const rt = l.rt_id ? one('SELECT r.*, u.token FROM rts r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=?', l.rt_id) : null;
    if (rt) SV.notify({ channel: 'email', to: rt.email || rt.phone, toName: rt.name, subject: `Laudo ${l.code} pronto para revisão técnica`, body: `O coordenador aprovou o laudo da unidade ${store.fantasia}. Faça a revisão técnica, a descrição das instalações e anexe a ART/RRT:\n${baseUrl(req)}/a/${rt.token}`, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'revisao_rt' });
    if (fr) SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: `Laudo ${l.code} aprovado pelo coordenador`, body: 'Seu laudo foi aprovado pelo coordenador e seguiu para a revisão do responsável técnico.', brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'aprovado' });
  }
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});

// ---------------- Revisão técnica do RT (B.22) ----------------
app.get('/api/rt/laudos', need('rt', 'admin'), (req, res) => {
  const rt = one('SELECT * FROM rts WHERE user_id=?', req.user.id);
  const rows = L.isAdmin(req.user) && !rt ? all("SELECT * FROM laudos WHERE status='revisao_tecnica' AND deleted_at IS NULL") : rt ? all('SELECT * FROM laudos WHERE rt_id=? AND deleted_at IS NULL ORDER BY id DESC', rt.id) : [];
  res.json(rows.filter((l) => !['nao_iniciado', 'rascunho'].includes(l.status)).map(L.laudoListRow));
});
function baseDescription(ctx) {
  const f = (k) => ctx.data.items?.[k]?.fields || {};
  const cfg = ctx.cfg, Lb = +cfg.boxesLeves || 0, Pb = cfg.pesados ? +cfg.boxesPesados || 0 : 0;
  const bx = (k, pref, n) => Array.from({ length: n }, (_, i) => { const b = f(k).boxes?.[pref + (i + 1)] || {}; return `box ${i + 1} com ${b.comprimento || '?'} × ${b.largura || '?'} m e pé-direito de ${b.altura || '?'} m`; }).join('; ');
  const portoes = (f('a2_9').portoes || []).map((p, i) => `portão ${i + 1} (${p.tipo === 'pesados' ? 'pesados' : 'leves'}) com ${p.largura || '?'} × ${p.altura || '?'} m`).join('; ');
  return `A unidade ${ctx.data.empresa?.fantasia || ctx.store.fantasia}, situada em ${ctx.data.empresa?.endereco || ctx.store.address}, município de ${ctx.municipio?.name || '—'} (${C.PORTE_LABEL[ctx.porte] || '—'} porte), dispõe de ${Lb} box(es) para vistoria de veículos leves${Pb ? ` e ${Pb} box(es) para veículos pesados` : ''}${cfg.movel ? ', além de atender à modalidade de vistoria móvel' : ''}.

Recepção com área total de ${f('a2_2').area || '?'} m², ${f('a2_2').cadeiras || '?'} cadeiras, bebedouro e ar-condicionado. Sala de administração com ${f('a2_3').area || '?'} m², mobiliada e com recursos tecnológicos${f('a2_3').recursos ? ` (${f('a2_3').recursos})` : ''}. ${f('a2_4').banheiros || '?'} sanitário(s), sendo ${f('a2_4').acessiveis || '?'} acessível(is) conforme a ABNT NBR 9050:2020.

Boxes de veículos leves: ${bx('a2_7', 'L', Lb) || '—'}.${Pb ? ` Boxes de veículos pesados: ${bx('a2_8', 'P', Pb)}.` : ''} Os boxes são cobertos, com piso plano e horizontal, iluminação e ventilação adequadas.

Acesso por ${portoes || '—'}. Área de manobra com largura mínima de ${f('a2_10').largura || '?'} m.${ctx.porte && ctx.params.porte.vagasExigidas[ctx.porte] ? ` Estacionamento com ${(f('a2_6').vagas || []).length} vaga(s) de espera.` : ''} Equipamentos de prevenção e combate a incêndio instalados conforme a legislação vigente.`;
}
app.get('/api/laudos/:id/rt-base', need('rt', 'admin'), (req, res) => { const l = getLaudo(req, +req.params.id); res.json({ text: baseDescription(R.buildContext(l.id)) }); });
const isRtOf = (req, l) => { if (L.isAdmin(req.user)) return true; const rt = one('SELECT id FROM rts WHERE user_id=?', req.user.id); return rt && rt.id === l.rt_id; };
app.put('/api/laudos/:id/rt-review', need('rt', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!isRtOf(req, l) || l.status !== 'revisao_tecnica') throw err(403, 'A revisão técnica não está aberta para você.');
  const data = J(l.data, {});
  data.rtReview = { ...(data.rtReview || {}), descricao: req.body.descricao, acessibilidade: !!req.body.acessibilidade, updatedAt: now(), by: req.user.name };
  update('laudos', l.id, { data: S(data), updated_at: now() });
  SV.audit(req, 'rt.revisao_salvar', { laudoId: l.id, after: { acessibilidade: !!req.body.acessibilidade, chars: (req.body.descricao || '').length } });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/laudos/:id/rt-return', need('rt', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!isRtOf(req, l) || l.status !== 'revisao_tecnica') throw err(403, 'A revisão técnica não está aberta para você.');
  const items = req.body.items || [];
  if (!items.length) throw err(400, 'Indique ao menos um item a devolver.');
  for (const it of items) { if (!it.reason) throw err(400, 'Informe o motivo de cada item devolvido.'); setReview(req, l, it.item, 'devolver', it.reason, it.comment, 'rt'); }
  L.setStatus(req, l, 'devolvido');
  L.makeVersion(req, l.id, 'Devolvido pelo RT');
  const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", l.store_id);
  if (fr) SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: `Laudo ${l.code}: correções pedidas pelo engenheiro`, body: items.map((i) => `• ${C.ITEM[i.item].short}: ${i.reason}${i.comment ? ' — ' + i.comment : ''}`).join('\n'), brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'devolucao' });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/laudos/:id/rt-conclude', need('rt', 'admin'), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!isRtOf(req, l) || l.status !== 'revisao_tecnica') throw err(403, 'A revisão técnica não está aberta para você.');
  const data = J(l.data, {});
  if (!data.rtReview?.descricao || !data.rtReview?.acessibilidade) throw err(422, 'Preencha a descrição técnica e confirme a declaração de acessibilidade.');
  data.rtReview.concludedAt = now();
  update('laudos', l.id, { data: S(data) });
  SV.audit(req, 'rt.concluir', { laudoId: l.id });
  const lock = await L.signLock(l.id, { revalidate: true });
  if (!lock.ok) { data.rtReview.concludedAt = null; update('laudos', l.id, { data: S(data) }); return res.status(422).json({ error: 'O laudo ainda não está 100% validado. Veja o que impede a assinatura.', conds: lock.conds }); }
  const { version } = await L.generateFinalDocs(req, l.id, baseUrl(req));
  L.setStatus(req, one('SELECT * FROM laudos WHERE id=?', l.id), 'liberado_assinatura', { sub_status: 'aguardando_ambas' });
  notifySigners(req, l.id);
  res.json({ ok: true, version: version.code, payload: laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)) });
});
function notifySigners(req, laudoId) {
  const l = one('SELECT * FROM laudos WHERE id=?', laudoId), store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  const rt = l.rt_id ? one('SELECT r.*, u.token FROM rts r LEFT JOIN users u ON u.id=r.user_id WHERE r.id=?', l.rt_id) : null;
  const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", l.store_id);
  const howTo = '\nComo assinar: 1) baixe o PDF; 2) acesse assinador.iti.br e entre com sua conta gov.br (prata ou ouro); 3) assine SEM abrir e salvar o arquivo em outro programa; 4) devolva o PDF assinado no botão "Enviar PDF assinado".';
  if (rt) SV.notify({ channel: 'email', to: rt.email || rt.phone, toName: rt.name, subject: `Anexo II do laudo ${l.code} liberado para assinatura`, body: `O laudo está 100% validado. Assine o Anexo II pelo gov.br.${howTo}\n${baseUrl(req)}/a/${rt.token}`, brandId: store.brand_id, storeId: store.id, laudoId, kind: 'assinatura' });
  if (fr) SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: `Anexo III do laudo ${l.code} liberado para assinatura`, body: `Seu laudo está 100% validado! Assine o Anexo III pelo gov.br (ou envie a via com firma reconhecida).${howTo}\n${linkFor(req, fr)}`, brandId: store.brand_id, storeId: store.id, laudoId, kind: 'assinatura' });
}

// ---------------- Assinatura: baixar, assinar no gov.br, devolver (B.23) ----------------
app.get('/api/laudos/:id/sign-lock', need(), async (req, res) => { const l = getLaudo(req, +req.params.id); const lk = await L.signLock(l.id); res.json({ ok: lk.ok, conds: lk.conds }); });
app.get('/api/laudos/:id/doc/:doc', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const v = L.currentVersion(l.id);
  const d = v && J(v.docs, {})[req.params.doc];
  if (!d) throw err(404, 'Documento final ainda não gerado.');
  const signed = req.query.signed && d.signed && d.signed.file;
  SV.audit(req, 'documento.download', { laudoId: l.id, after: { doc: req.params.doc, versao: v.n, assinado: !!signed } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${l.code}-v${v.n}-${req.params.doc === 'a2' ? 'AnexoII' : 'AnexoIII'}${signed ? '-assinado' : ''}.pdf"`);
  res.send(SV.readFile(signed ? d.signed.file : d.file));
});
async function acceptSigned(req, l, docKey, buf, method, originalName) {
  const v = L.currentVersion(l.id);
  const docs = J(v.docs, {});
  const d = docs[docKey];
  if (!d) throw err(404, 'Documento não encontrado.');
  if (l.status !== 'liberado_assinatura') throw err(409, 'O laudo não está liberado para assinatura.');
  let result;
  const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  const data = J(l.data, {});
  if (method === 'firma') {
    if (docKey !== 'a3') throw err(400, 'Firma reconhecida só é aceita no Anexo III.');
    result = { ok: true, checks: [{ n: 0, ok: true, msg: 'Via com firma reconhecida em cartório recebida (conferência visual pelo coordenador).' }], signer: data.empresa?.repName || store.rep_name };
  } else {
    const rt = l.rt_id ? one('SELECT * FROM rts WHERE id=?', l.rt_id) : null;
    const older = all('SELECT * FROM versions WHERE laudo_id=? AND n<?', l.id, v.n).flatMap((ov) => { const od = J(ov.docs, {})[docKey]; return od ? [{ n: ov.n, sha: od.sha, length: od.length }] : []; });
    result = SIG.verifySignedPdf(buf, { expectedSha: d.sha, expectedLength: d.length, expectedName: docKey === 'a2' ? rt?.name : (data.empresa?.repName || store.rep_name), expectedCpf: docKey === 'a2' ? rt?.cpf : (data.empresa?.repCpf || store.rep_cpf), olderVersions: older });
  }
  if (!result.ok) { SV.audit(req, 'assinatura.recusada', { laudoId: l.id, after: { doc: docKey, motivo: result.reason, checks: result.checks } }); throw err(422, result.reason, { checks: result.checks }); }
  const file = SV.saveFile(buf, 'pdf'); // guardado exatamente como recebido
  d.signed = { file, at: now(), by: req.user.name, method, signer: result.signer, size: buf.length, sha: SV.sha256(buf), checks: result.checks, original_name: originalName };
  update('versions', v.id, { docs: S(docs) });
  SV.audit(req, 'assinatura.recebida', { laudoId: l.id, after: { doc: docKey, metodo: method, signatario: result.signer, sha: d.signed.sha } });
  const all2 = Object.values(docs).every((x) => x.signed && !x.signed.invalidated_at);
  if (all2) L.setStatus(req, l, 'pronto_protocolo', { sub_status: null });
  else update('laudos', l.id, { sub_status: docs.a2?.signed ? 'aguardando_rep' : 'aguardando_rt' });
  return result;
}
app.post('/api/laudos/:id/signed/:doc', need(), upload.single('file'), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const isRt = isRtOf(req, l), isLoja = L.storeRole(req.user, l.store_id) === 'loja';
  if (req.params.doc === 'a2' && !isRt) throw err(403, 'O Anexo II é assinado e devolvido pelo responsável técnico.');
  if (req.params.doc === 'a3' && !isLoja && !L.isAdmin(req.user)) throw err(403, 'O Anexo III é assinado e devolvido pelo representante legal.');
  if (!req.file) throw err(400, 'Envie o PDF assinado.');
  const r = await acceptSigned(req, l, req.params.doc, req.file.buffer, req.body.method === 'firma' ? 'firma' : 'govbr', req.file.originalname);
  res.json({ ok: true, checks: r.checks, payload: laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)) });
});
// Demonstração: simula a assinatura gov.br do arquivo gerado
app.post('/api/laudos/:id/demo-sign/:doc', need(), async (req, res) => {
  if (!DEMO) throw err(404, 'Indisponível.');
  const l = getLaudo(req, +req.params.id);
  const v = L.currentVersion(l.id), d = J(v.docs, {})[req.params.doc];
  if (!d) throw err(404, 'Documento não gerado.');
  const data = J(l.data, {}), store = one('SELECT * FROM stores WHERE id=?', l.store_id), rt = one('SELECT * FROM rts WHERE id=?', l.rt_id);
  const name = req.params.doc === 'a2' ? rt.name : (data.empresa?.repName || store.rep_name);
  const cpf = req.params.doc === 'a2' ? rt.cpf : (data.empresa?.repCpf || store.rep_cpf);
  let signed = SIG.simulateGovbrSignature(SV.readFile(d.file), req.body.wrongSigner ? 'FULANO DE TAL' : name, cpf);
  if (req.body.tamper) signed = Buffer.concat([signed, Buffer.from('\n% alterado\n')]);
  if (req.body.download) { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${l.code}-${req.params.doc}-assinado-simulacao.pdf"`); return res.send(signed); }
  const r = await acceptSigned(req, l, req.params.doc, signed, 'govbr', 'simulacao.pdf');
  res.json({ ok: true, checks: r.checks, payload: laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)) });
});

// ---------------- Protocolo, exigência e resultado (B.24) ----------------
app.get('/api/laudos/:id/package', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const v = all('SELECT * FROM versions WHERE laudo_id=? ORDER BY n DESC', l.id).find((x) => Object.keys(J(x.docs, {})).length), docs = v ? J(v.docs, {}) : {};
  const ctx = R.buildContext(l.id);
  const limit = ctx.params.arquivos.sceLimiteMB * 1048576;
  const out = [];
  for (const [k, d] of Object.entries(docs)) out.push({ name: `${k === 'a2' ? 'Anexo II — Laudo Técnico' : 'Anexo III — Declaração de Equipamentos'}${d.signed ? ' (assinado)' : ''}`, size: d.signed ? d.signed.size : d.size, url: `/api/laudos/${l.id}/doc/${k}${d.signed ? '?signed=1' : ''}`, signed: !!d.signed, limit });
  for (const f of ctx.files.filter((x) => ['art', 'plano_calibracao', 'doc_boroscopio', 'contrato_rede', 'contrato_internet', 'incendio', 'dgcv'].includes(x.kind))) out.push({ name: `${C.DOCS.find((d) => d.kind === f.kind)?.title || f.kind} · ${f.original_name}`, size: f.size, url: `/f/d/${f.id}`, limit });
  for (const f of ctx.files.filter((x) => x.kind === 'certificado')) { const e = ctx.equipment.find((x) => x.id === f.equipment_id); if (e) out.push({ name: `Certificado ${C.EQ_TYPES[e.type].short} #${e.patrimonio} · ${f.original_name}`, size: f.size, url: `/f/d/${f.id}`, limit }); }
  res.json({ files: out.map((f) => ({ ...f, pct: Math.round((f.size / limit) * 100), over: f.size > limit })), consulta: v ? `${baseUrl(req)}/c/${v.code}` : null });
});
app.post('/api/laudos/:id/protocol', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!L.storeRole(req.user, l.store_id) && !L.isAdmin(req.user) && !L.has(req.user, 'franqueadora')) throw err(403, 'Sem permissão.');
  if (l.status !== 'pronto_protocolo') throw err(409, 'O laudo precisa estar "Pronto para protocolo".');
  if (!req.body.numero || !req.body.data) throw err(400, 'Informe número e data do protocolo no SCE.');
  update('laudos', l.id, { protocol: S({ numero: req.body.numero, data: req.body.data, by: req.user.name, at: now() }) });
  L.setStatus(req, l, 'protocolado');
  SV.audit(req, 'protocolo.registrar', { laudoId: l.id, after: req.body });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/laudos/:id/exigencia', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!L.storeRole(req.user, l.store_id) && !L.isAdmin(req.user) && !L.has(req.user, 'franqueadora')) throw err(403, 'Sem permissão.');
  if (l.status !== 'protocolado') throw err(409, 'Só é possível registrar exigência após o protocolo.');
  if (!req.body.texto || !req.body.prazo) throw err(400, 'Informe o texto da exigência e o prazo de resposta.');
  update('laudos', l.id, { exigencia: S({ texto: req.body.texto, data: req.body.data || now().slice(0, 10), prazo: req.body.prazo, items: [], by: req.user.name, at: now() }) });
  L.setStatus(req, l, 'exigencia');
  L.invalidateSignatures(req, l.id, 'Exigência da CET-MG');
  SV.audit(req, 'exigencia.registrar', { laudoId: l.id, after: req.body });
  notifyFranqueadora(req, one('SELECT * FROM stores WHERE id=?', l.store_id), `Exigência da CET-MG no laudo ${l.code}`, `Prazo de resposta: ${new Date(req.body.prazo).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.\n${req.body.texto}\nMarque os itens afetados no sistema.`);
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/laudos/:id/exigencia/items', need('franqueadora', 'coordenador', 'admin'), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (l.status !== 'exigencia') throw err(409, 'O laudo não está em exigência.');
  const items = (req.body.items || []).filter((k) => C.ITEM[k]);
  if (!items.length) throw err(400, 'Selecione os itens afetados pela exigência.');
  const ex = J(l.exigencia, {});
  ex.items = items;
  update('laudos', l.id, { exigencia: S(ex) });
  for (const k of items) setReview(req, l, k, 'devolver', 'Exigência da CET-MG', ex.texto, 'cet');
  const data = J(l.data, {});
  if (items.some((k) => k.startsWith('a2_')) && data.rtReview) { data.rtReview.concludedAt = null; update('laudos', l.id, { data: S(data) }); }
  L.makeVersion(req, l.id, 'Exigência da CET-MG');
  SV.audit(req, 'exigencia.itens', { laudoId: l.id, after: { items } });
  const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", l.store_id);
  if (fr) SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: `Exigência da CET-MG — laudo ${l.code}`, body: `A CET-MG fez uma exigência. Reabrimos só estes itens: ${items.map((k) => C.ITEM[k].short).join(', ')}. Prazo: ${new Date(ex.prazo).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'exigencia' });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});
app.post('/api/laudos/:id/result', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  if (!L.storeRole(req.user, l.store_id) && !L.isAdmin(req.user) && !L.has(req.user, 'franqueadora')) throw err(403, 'Sem permissão.');
  if (l.status !== 'protocolado') throw err(409, 'O laudo precisa estar protocolado.');
  const { result, portaria, validade, obs } = req.body;
  if (!['deferido', 'indeferido'].includes(result)) throw err(400, 'Informe o resultado.');
  if (result === 'deferido' && !validade) throw err(400, 'Informe a data de validade do credenciamento.');
  update('laudos', l.id, { result: S({ result, portaria, validade, obs, by: req.user.name, at: now() }) });
  L.setStatus(req, l, result);
  if (result === 'deferido') update('stores', l.store_id, { cred_expiry: validade, cred_portaria: portaria });
  SV.audit(req, 'resultado.registrar', { laudoId: l.id, storeId: l.store_id, after: req.body });
  res.json(laudoPayload(req, one('SELECT * FROM laudos WHERE id=?', l.id)));
});

// ---------------- Versões e link de consulta (B.25, B.26) ----------------
app.put('/api/versions/:id', need(), (req, res) => {
  const v = one('SELECT * FROM versions WHERE id=?', +req.params.id);
  if (!v) throw err(404, 'Versão não encontrada.');
  const l = getLaudo(req, v.laudo_id);
  if (!L.storeRole(req.user, l.store_id) && !L.has(req.user, 'franqueadora') && !L.isAdmin(req.user)) throw err(403, 'Sem permissão.');
  const upd = {};
  if ('password' in req.body) upd.access_password = req.body.password ? hashPw(req.body.password) : null;
  if ('until' in req.body) upd.access_until = req.body.until || null;
  if (req.body.regenerate) { upd.public_token = token(9); upd.revoked = 0; }
  if ('revoked' in req.body) upd.revoked = req.body.revoked ? 1 : 0;
  update('versions', v.id, upd);
  SV.audit(req, 'consulta.configurar', { laudoId: l.id, entity: 'version', entityId: v.id, after: { ...req.body, password: req.body.password ? '***' : undefined } });
  res.json({ ok: true });
});
app.get('/api/public/:code', (req, res) => {
  const v = one('SELECT * FROM versions WHERE code=?', req.params.code);
  if (!v || v.revoked) throw err(404, 'Link de consulta inválido ou revogado.');
  if (v.access_until && new Date(v.access_until) < new Date()) throw err(410, 'Este link de consulta expirou.');
  if (v.access_password && !checkPw(String(req.query.pw || req.headers['x-consulta-pw'] || ''), v.access_password)) return res.status(401).json({ needPassword: true, error: 'Informe a senha de acesso.' });
  const l = one('SELECT * FROM laudos WHERE id=?', v.laudo_id);
  const latest = L.currentVersion(l.id);
  const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
  const brand = L.brandOfStore(store);
  const snap = J(v.snapshot, {});
  const docs = J(v.docs, {});
  run('UPDATE versions SET views=views+1 WHERE id=?', v.id);
  SV.audit({ ...req, publicActor: 'consulta pública' }, 'consulta.abrir', { entity: 'version', entityId: v.id, laudoId: l.id, after: { code: v.code } });
  const mun = one('SELECT name FROM municipalities WHERE ibge=?', store.municipio_ibge);
  const rt = snap.rt_id ? one('SELECT name, council, reg_number, cpf FROM rts WHERE id=?', snap.rt_id) : null;
  const pw = req.query.pw ? `?pw=${encodeURIComponent(req.query.pw)}` : '';
  const photos = (snap.photos || []).map((p) => { const ph = one('SELECT id, item, slot, caption FROM photos WHERE sha=? ORDER BY id DESC LIMIT 1', p.sha); return ph ? { id: ph.id, item: p.item, caption: p.caption || p.slot, url: `/api/public/${v.code}/photo/${ph.id}${pw}` } : null; }).filter(Boolean);
  const eqPhotos = [];
  for (const e of snap.equipment || []) for (const sha of e.photos || []) { const ph = one('SELECT id, slot, caption FROM photos WHERE sha=? ORDER BY id DESC LIMIT 1', sha); if (ph) eqPhotos.push({ id: ph.id, item: C.A3.find((i) => i.eqType === e.type)?.key, caption: `${C.EQ_TYPES[e.type]?.short} #${e.patrimonio} · ${ph.caption || ph.slot}`, url: `/api/public/${v.code}/photo/${ph.id}${pw}` }); }
  const videos = [];
  for (const k of ['a3_2', 'a3_4']) for (const [eid, vv] of Object.entries(snap.data?.items?.[k]?.videos || {})) { const e = (snap.equipment || []).find((x) => String(x.id) === eid); videos.push({ label: `${C.ITEM[k].short} #${e?.patrimonio || eid}`, url: vv.url }); }
  const att = (snap.files || []).filter((f) => ['art', 'plano_calibracao', 'doc_boroscopio', 'contrato_rede', 'contrato_internet', 'incendio'].includes(f.kind)).map((f) => ({ name: C.DOCS.find((d) => d.kind === f.kind)?.title || f.kind, url: `/api/public/${v.code}/file/${f.id}${pw}` }));
  for (const f of all("SELECT * FROM files WHERE kind='certificado' AND store_id=? AND deleted_at IS NULL", store.id)) att.push({ name: `Certificado de calibração · ${f.original_name}`, url: `/api/public/${v.code}/file/${f.id}${pw}` });
  const maskName = (n) => n;
  res.json({
    code: v.code, n: v.n, created_at: v.created_at, reason: v.reason, current: latest.id === v.id, currentCode: latest.code,
    brand: { name: brand.name, theme: J(brand.theme, {}), logo: brand.logo_dark_file ? `/api/public/brand/${brand.id}/logo` : null },
    laudo: { code: l.code, process: C.PROCESS_TYPES[l.process_type], status: L.STATUS[l.status].label },
    store: { razao: store.razao, fantasia: store.fantasia, cnpj: store.cnpj, municipio: mun?.name, porte: C.PORTE_LABEL[snap.porte] },
    rep: { name: maskName(snap.data?.empresa?.repName || store.rep_name), cpf: maskCpf(snap.data?.empresa?.repCpf || store.rep_cpf) },
    rt: rt ? { name: rt.name, council: rt.council, reg: rt.reg_number, cpf: maskCpf(rt.cpf) } : null,
    docs: Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, { sha: d.sha, size: d.size, generated_at: d.generated_at, signed: d.signed ? { at: d.signed.at, signer: d.signed.signer, method: d.signed.method, invalidated: !!d.signed.invalidated_at, url: `/api/public/${v.code}/doc/${k}${pw}` } : null, url: `/api/public/${v.code}/doc/${k}?unsigned=1${pw ? '&' + pw.slice(1) : ''}` }])),
    photos: [...photos, ...eqPhotos], videos, attachments: att,
  });
});
function publicGuard(req) {
  const v = one('SELECT * FROM versions WHERE code=?', req.params.code);
  if (!v || v.revoked || (v.access_until && new Date(v.access_until) < new Date())) throw err(404, 'Link inválido.');
  if (v.access_password && !checkPw(String(req.query.pw || ''), v.access_password)) throw err(401, 'Senha necessária.');
  return v;
}
app.get('/api/public/:code/photo/:pid', (req, res) => {
  const v = publicGuard(req);
  const snap = J(v.snapshot, {});
  const p = one('SELECT * FROM photos WHERE id=?', +req.params.pid);
  const ok = p && ((snap.photos || []).some((x) => x.sha === p.sha) || (snap.equipment || []).some((e) => (e.photos || []).includes(p.sha)));
  if (!ok) throw err(404, 'Foto não encontrada.');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(SV.filePath(req.query.v === 'small' ? p.small_file : p.file));
});
app.get('/api/public/:code/file/:fid', (req, res) => {
  const v = publicGuard(req);
  const l = one('SELECT * FROM laudos WHERE id=?', v.laudo_id);
  const f = one('SELECT * FROM files WHERE id=?', +req.params.fid);
  const snap = J(v.snapshot, {});
  if (!f || !((snap.files || []).some((x) => x.id === f.id) || (f.kind === 'certificado' && f.store_id === l.store_id))) throw err(404, 'Arquivo não encontrado.');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.original_name)}"`);
  res.type(f.mime || 'application/octet-stream').sendFile(SV.filePath(f.file));
});
app.get('/api/public/:code/doc/:doc', (req, res) => {
  const v = publicGuard(req);
  const d = J(v.docs, {})[req.params.doc];
  if (!d) throw err(404, 'Documento não encontrado.');
  const file = !req.query.unsigned && d.signed ? d.signed.file : d.file;
  res.type('application/pdf').sendFile(SV.filePath(file));
});
app.post('/api/public/:code/verify', upload.single('file'), (req, res) => {
  const v = publicGuard(req);
  if (!req.file) throw err(400, 'Envie o PDF para conferir.');
  const sha = SV.sha256(req.file.buffer);
  const match = Object.entries(J(v.docs, {})).find(([, d]) => d.sha === sha || d.signed?.sha === sha);
  res.json({ authentic: !!match, doc: match ? match[0] : null, sha });
});
app.get('/api/public/brand/:id/logo', (req, res) => { const b = one('SELECT * FROM brands WHERE id=?', +req.params.id); if (!b || !b.logo_dark_file) throw err(404, 'Sem logo.'); res.sendFile(SV.filePath(b.logo_dark_file)); });
app.get('/v/:token', (req, res) => {
  const f = all("SELECT * FROM files WHERE kind='video' AND deleted_at IS NULL").find((x) => J(x.meta, {}).publicToken === req.params.token);
  if (!f) return res.status(404).send('Vídeo não encontrado.');
  res.type(f.mime || 'video/mp4').sendFile(SV.filePath(f.file));
});

app.get('/api/qr', need(), async (req, res) => { res.type('image/png').send(await require('qrcode').toBuffer(String(req.query.data || '').slice(0, 500), { margin: 1, width: 440 })); });

// ---------------- Arquivos protegidos ----------------
app.get('/f/p/:id', need(), (req, res) => {
  const p = one('SELECT * FROM photos WHERE id=?', +req.params.id);
  if (!p) throw err(404, 'Foto não encontrada.');
  if (p.laudo_id) getLaudo(req, p.laudo_id);
  else { const e = one('SELECT store_id FROM equipment WHERE id=?', +p.item.slice(3)); if (!e || !L.canSeeStore(req.user, e.store_id)) throw err(403, 'Sem acesso.'); }
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(SV.filePath(req.query.v === 'small' ? p.small_file : req.query.v === 'pdf' ? p.pdf_file : p.file));
});
app.get('/f/d/:id', need(), (req, res) => {
  const f = one('SELECT * FROM files WHERE id=?', +req.params.id);
  if (!f) throw err(404, 'Arquivo não encontrado.');
  if (f.laudo_id) getLaudo(req, f.laudo_id); else if (!L.canSeeStore(req.user, f.store_id)) throw err(403, 'Sem acesso.');
  const meta = J(f.meta, {});
  if (req.query.v === 'image' && meta.image) return res.type('image/png').sendFile(SV.filePath(meta.image));
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.original_name || 'arquivo')}"`);
  res.type(f.mime || 'application/octet-stream').sendFile(SV.filePath(f.file));
});

// ---------------- PDFs: prévia e checklist ----------------
app.get('/api/laudos/:id/preview/:doc', need(), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const sum = R.summarize(l.id);
  const r = await PDF.generateWithinLimit(sum.ctx, req.params.doc === 'a2' ? 'II' : 'III', { consultaUrl: null });
  SV.audit(req, 'documento.previa', { laudoId: l.id, after: { doc: req.params.doc, size: r.size, compressao: r.level } });
  res.setHeader('X-Pdf-Size', r.size); res.setHeader('X-Pdf-Level', r.level);
  res.type('application/pdf').send(r.buf);
});
app.get('/api/laudos/:id/checklist.pdf', need(), async (req, res) => {
  const l = getLaudo(req, +req.params.id);
  const sum = R.summarize(l.id);
  const buf = await PDF.renderChecklist(sum.ctx, buildChecklist(sum), null);
  res.setHeader('Content-Disposition', `inline; filename="checklist-${l.code}.pdf"`);
  res.type('application/pdf').send(buf);
});

// ================= ADMINISTRAÇÃO =================
app.get('/api/brands', need(), (req, res) => res.json(all('SELECT * FROM brands WHERE deleted_at IS NULL').map((b) => ({ ...b, theme: J(b.theme, {}), sender: J(b.sender, {}) }))));
app.post('/api/brands', need('admin'), (req, res) => {
  const b = req.body;
  const id = insert('brands', { slug: R.norm(b.name).replace(/[^a-z0-9]+/g, '-'), name: b.name, tagline: b.tagline, theme: S(b.theme || {}), sender: S(b.sender || {}), orientation_text: b.orientation_text, published: 1, created_at: now() });
  SV.audit(req, 'marca.criar', { entity: 'brand', entityId: id, after: b });
  res.json({ id });
});
app.put('/api/brands/:id', need('admin'), (req, res) => {
  const b = one('SELECT * FROM brands WHERE id=?', +req.params.id);
  if (!b) throw err(404, 'Marca não encontrada.');
  const upd = {};
  for (const k of ['name', 'tagline', 'orientation_text']) if (k in req.body) upd[k] = req.body[k];
  if ('theme' in req.body) upd.theme = S({ ...J(b.theme, {}), ...req.body.theme });
  if ('sender' in req.body) upd.sender = S(req.body.sender);
  update('brands', b.id, upd);
  SV.audit(req, 'marca.editar', { entity: 'brand', entityId: b.id, before: b, after: upd });
  res.json({ ok: true });
});
app.post('/api/brands/:id/logo', need('admin'), upload.single('file'), async (req, res) => {
  const b = one('SELECT * FROM brands WHERE id=?', +req.params.id);
  if (!b || !req.file) throw err(400, 'Envie o logo (PNG/SVG).');
  const png = await require('sharp')(req.file.buffer, { density: 300 }).resize(800, 300, { fit: 'inside' }).png().toBuffer();
  const rel = SV.saveFile(png, 'png');
  update('brands', b.id, req.body.variant === 'light' ? { logo_file: rel } : { logo_dark_file: rel });
  SV.audit(req, 'marca.logo', { entity: 'brand', entityId: b.id, after: { variant: req.body.variant } });
  res.json({ ok: true });
});
app.get('/api/brands/:id/logo', (req, res) => { const b = one('SELECT * FROM brands WHERE id=?', +req.params.id); const f = req.query.variant === 'light' ? b?.logo_file : b?.logo_dark_file; if (!f) return res.status(404).end(); res.sendFile(SV.filePath(f)); });
app.get('/api/brands/:id/preview/:doc', need('admin'), async (req, res) => {
  // pré-visualização com dados fictícios
  const brand = one('SELECT * FROM brands WHERE id=?', +req.params.id);
  const fake = {
    laudo: { id: 0, code: 'XXC-26-0000', process_type: 'credenciamento', scope_items: null },
    store: { id: 0, brand_id: brand.id, razao: '[Razão social da loja]', fantasia: '[Nome da unidade]', cnpj: '00000000000000', address: '[Endereço]', rep_name: '[Nome]', rep_cpf: '00000000000', rep_role: '[Sócio-administrador]' },
    data: { empresa: {}, items: { a2_7: { fields: { boxes: { L1: { comprimento: '5,62', largura: '3,58', altura: '3,10', coberto: 'sim', piso: 'Concreto' }, L2: { comprimento: '5,60', largura: '3,55', altura: '3,10', coberto: 'sim', piso: 'Concreto' }, L3: { comprimento: '5,58', largura: '3,52', altura: '3,10', coberto: 'sim', piso: 'Concreto' }, L4: { comprimento: '5,61', largura: '3,54', altura: '3,10', coberto: 'sim', piso: 'Concreto' } } } } } },
    params: R.getParams(), porte: 'medio', municipio: { name: '[Município]' }, cfg: { boxesLeves: 4, dataPedido: now() }, photos: [], files: [], equipment: [], eqPhotos: [], rt: { name: '[Nome do engenheiro]', council: 'CREA', reg_number: 'MG0000000000D', uf: 'MG' },
  };
  fake.laudo.scope_items = S(req.params.doc === 'a2' ? ['a2_7'] : ['a3_2', 'a3_5']);
  const r = await PDF.generateWithinLimit(fake, req.params.doc === 'a2' ? 'II' : 'III', { consultaUrl: `${baseUrl(req)}/c/EXEMPLO-v1` });
  res.type('application/pdf').send(r.buf);
});

app.get('/api/users', need('admin', 'franqueadora'), (req, res) => {
  res.json(all('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY name').map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, roles: J(u.roles, []), scope: J(u.scope, {}), active: u.active, last_access_at: u.last_access_at, link_opened_at: u.link_opened_at, hasPassword: !!u.password_hash,
    stores: all('SELECT s.id, s.fantasia, su.kind FROM store_users su JOIN stores s ON s.id=su.store_id WHERE su.user_id=?', u.id), link: L.isAdmin(req.user) && !L.isAdmin(u) ? `${baseUrl(req)}/a/${u.token}` : undefined })));
});
app.post('/api/users', need('admin'), (req, res) => {
  const b = req.body;
  if (!b.name || !(b.email || b.phone)) throw err(400, 'Informe nome e e-mail ou WhatsApp.');
  const roles = (b.roles || []).filter((r) => ['admin', 'franqueadora', 'coordenador', 'rt', 'loja', 'colaborador', 'diretoria'].includes(r));
  const id = insert('users', { name: b.name, email: b.email, phone: b.phone, roles: S(roles), scope: S(b.scope || {}), token: token(), password_hash: roles.includes('admin') && b.password ? hashPw(b.password) : null, active: 1, created_at: now(), invited_by: req.user.id });
  SV.audit(req, 'usuario.criar', { entity: 'user', entityId: id, after: { ...b, password: b.password ? '***' : undefined } });
  res.json({ id, link: roles.includes('admin') ? null : `${baseUrl(req)}/a/${one('SELECT token FROM users WHERE id=?', id).token}` });
});
app.put('/api/users/:id', need('admin'), (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', +req.params.id);
  if (!u) throw err(404, 'Usuário não encontrado.');
  const upd = {};
  for (const k of ['name', 'email', 'phone']) if (k in req.body) upd[k] = req.body[k];
  if ('roles' in req.body) upd.roles = S(req.body.roles);
  if ('scope' in req.body) upd.scope = S(req.body.scope);
  if ('active' in req.body) { upd.active = req.body.active ? 1 : 0; if (!upd.active) run('DELETE FROM sessions WHERE user_id=?', u.id); }
  if (req.body.password) upd.password_hash = hashPw(req.body.password);
  update('users', u.id, upd);
  SV.audit(req, 'usuario.editar', { entity: 'user', entityId: u.id, before: { roles: J(u.roles), scope: J(u.scope), active: u.active }, after: { ...req.body, password: req.body.password ? '***' : undefined } });
  res.json({ ok: true });
});
app.post('/api/users/:id/act-as', need('admin'), (req, res) => {
  const u = one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL', +req.params.id);
  if (!u) throw err(404, 'Usuário não encontrado.');
  SV.audit(req, 'admin.agir_como', { entity: 'user', entityId: u.id, after: { como: u.name, perfis: J(u.roles) } });
  newSession(req, res, u, `admin:${req.user.id}`);
  res.json({ ok: true });
});

// Lixeira genérica (90 dias)
function softDelete(req, entity, id, label) {
  const table = { store: 'stores', laudo: 'laudos', user: 'users', equipment: 'equipment', photo: 'photos', file: 'files', brand: 'brands', rt: 'rts' }[entity];
  update(table, id, { deleted_at: now() });
  insert('trash', { entity, entity_id: id, label, deleted_at: now(), deleted_by: req.user.id });
  SV.audit(req, 'lixeira.excluir', { entity, entityId: id, after: { label } });
}
app.delete('/api/admin/:entity/:id', need('admin'), (req, res) => {
  const { entity } = req.params, id = +req.params.id;
  const label = entity === 'store' ? one('SELECT fantasia FROM stores WHERE id=?', id)?.fantasia : entity === 'laudo' ? one('SELECT code FROM laudos WHERE id=?', id)?.code : entity === 'user' ? one('SELECT name FROM users WHERE id=?', id)?.name : entity === 'brand' ? one('SELECT name FROM brands WHERE id=?', id)?.name : `${entity} ${id}`;
  if (entity === 'laudo') { const l = one('SELECT status FROM laudos WHERE id=?', id); if (['pronto_protocolo', 'protocolado', 'deferido', 'indeferido'].includes(l?.status)) throw err(409, 'Laudos assinados/protocolados ficam arquivados e não podem ir para a lixeira.'); }
  softDelete(req, entity, id, label || `${entity} ${id}`);
  res.json({ ok: true });
});
app.get('/api/admin/trash', need('admin'), (req, res) => {
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  res.json(all('SELECT t.*, u.name deleted_by_name FROM trash t LEFT JOIN users u ON u.id=t.deleted_by WHERE t.restored_at IS NULL AND t.deleted_at > ? ORDER BY t.id DESC', cutoff));
});
app.post('/api/admin/trash/:id/restore', need('admin'), (req, res) => {
  const t = one('SELECT * FROM trash WHERE id=?', +req.params.id);
  if (!t || t.restored_at) throw err(404, 'Item não encontrado na lixeira.');
  const table = { store: 'stores', laudo: 'laudos', user: 'users', equipment: 'equipment', photo: 'photos', file: 'files', brand: 'brands', rt: 'rts' }[t.entity];
  if (t.entity === 'photo') {
    const p = one('SELECT * FROM photos WHERE id=?', t.entity_id);
    const occ = one('SELECT id FROM photos WHERE item=? AND slot=? AND deleted_at IS NULL AND COALESCE(laudo_id,0)=COALESCE(?,0)', p.item, p.slot, p.laudo_id);
    if (occ && p.slot !== 'extra') update('photos', t.entity_id, { deleted_at: null, slot: 'extra', essential: 0 }); else update(table, t.entity_id, { deleted_at: null });
  } else update(table, t.entity_id, { deleted_at: null });
  update('trash', t.id, { restored_at: now() });
  SV.audit(req, 'lixeira.restaurar', { entity: t.entity, entityId: t.entity_id, after: { label: t.label } });
  res.json({ ok: true });
});

// Parâmetros versionados (B.30)
app.get('/api/admin/params', need('admin'), (req, res) => res.json({ current: R.getParams(), versions: all('SELECT version, label, created_at FROM params ORDER BY version DESC') }));
app.post('/api/admin/params', need('admin'), (req, res) => {
  const cur = R.getParams();
  const next = deepMerge(JSON.parse(JSON.stringify(cur)), req.body.data || {});
  delete next._version;
  const version = (cur._version || 0) + 1;
  insert('params', { version, label: req.body.label || `Versão ${version}`, data: S(next), created_at: now(), created_by: req.user.id });
  SV.audit(req, 'parametros.nova_versao', { entity: 'params', entityId: version, before: cur, after: next });
  res.json({ version });
});
function deepMerge(a, b) { for (const [k, v] of Object.entries(b)) { if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = deepMerge(a[k] || {}, v); else a[k] = v; } return a; }

// Porte dos municípios (lista CET + IBGE, B.30 / Seção 5.3)
app.get('/api/admin/municipios', need('admin'), (req, res) => {
  const rows = all('SELECT * FROM municipalities ORDER BY name');
  const P = R.getParams();
  const out = rows.map((m) => {
    const ibge = C.porteFromPop(m.pop2024 || m.pop2022, P), official = m.porte_override || m.porte_cet || ibge;
    const near = [m.pop2022, m.pop2024].some((p) => p && [P.porte.limitePequeno, P.porte.limiteMedio].some((lim) => Math.abs(p - lim) / lim < 0.05));
    const changes = m.pop2022 && m.pop2024 && C.porteFromPop(m.pop2022, P) !== C.porteFromPop(m.pop2024, P);
    const stores = one('SELECT COUNT(*) n FROM stores WHERE municipio_ibge=? AND deleted_at IS NULL', m.ibge).n;
    return { ...m, porte_ibge: ibge, porte_oficial: official, divergente: !!(m.porte_cet && ibge && m.porte_cet !== ibge), atencao: near || changes, mudaConformeBase: changes, stores };
  });
  const q = R.norm(req.query.q || '');
  const f = req.query.filter;
  res.json(out.filter((m) => (!q || R.norm(m.name).includes(q)) && (!f || (f === 'divergente' && m.divergente) || (f === 'atencao' && m.atencao) || (f === 'lojas' && m.stores) || (f === 'override' && m.porte_override))));
});
app.put('/api/admin/municipios/:ibge', need('admin'), (req, res) => {
  const m = one('SELECT * FROM municipalities WHERE ibge=?', req.params.ibge);
  if (!m) throw err(404, 'Município não encontrado.');
  if (!req.body.reason) throw err(400, 'Informe a justificativa.');
  update('municipalities', m.ibge, { porte_override: req.body.porte || null, override_reason: req.body.reason }, 'ibge');
  SV.audit(req, 'porte.alterar_municipio', { entity: 'municipio', entityId: m.ibge, before: { porte: m.porte_override }, after: { porte: req.body.porte, justificativa: req.body.reason } });
  porteChangedNotify(req, all('SELECT id FROM stores WHERE municipio_ibge=? AND deleted_at IS NULL', m.ibge).map((r) => r.id), req.body.porte);
  res.json({ ok: true });
});
app.post('/api/admin/municipios/import', need('admin'), (req, res) => {
  const rows = parseCsv(req.body.csv);
  const kind = req.body.kind; // 'cet' (município → porte) | 'ibge' (população)
  let ok = 0; const errors = [], changed = [];
  const mapP = (s) => ({ pequeno: 'pequeno', p: 'pequeno', medio: 'medio', m: 'medio', grande: 'grande', g: 'grande' }[R.norm(s).trim()] || null);
  for (const [i, r] of rows.entries()) {
    const m = r.ibge || r.codigo_ibge || r.codigo ? one('SELECT * FROM municipalities WHERE ibge=?', String(r.ibge || r.codigo_ibge || r.codigo).slice(0, 7)) : one('SELECT * FROM municipalities WHERE lower(name)=lower(?)', r.municipio || r.nome || '');
    if (!m) { errors.push(`Linha ${i + 2}: município não encontrado (${r.municipio || r.nome || r.ibge})`); continue; }
    if (kind === 'cet') {
      const p = mapP(r.porte); if (!p) { errors.push(`Linha ${i + 2}: porte inválido "${r.porte}"`); continue; }
      if (m.porte_cet !== p) changed.push(m.ibge);
      update('municipalities', m.ibge, { porte_cet: p }, 'ibge');
    } else {
      const p22 = parseInt(String(r.pop2022 || r.censo_2022 || r.populacao || '').replace(/\D/g, '')) || null, p24 = parseInt(String(r.pop2024 || r.estimativa_2024 || '').replace(/\D/g, '')) || null;
      update('municipalities', m.ibge, { pop2022: p22 || m.pop2022, pop2024: p24 || m.pop2024 }, 'ibge');
    }
    ok++;
  }
  SV.audit(req, kind === 'cet' ? 'porte.importar_cet' : 'porte.importar_ibge', { after: { linhas: rows.length, ok, erros: errors.length, alterados: changed.length } });
  if (kind === 'cet' && changed.length) {
    const affected = all(`SELECT id FROM stores WHERE deleted_at IS NULL AND municipio_ibge IN (${changed.map(() => '?').join(',')})`, ...changed).map((r) => r.id);
    if (affected.length) porteChangedNotify(req, affected, null);
  }
  res.json({ ok, errors, changed: changed.length });
});

// Auditoria (B.31) — consulta também fica registrada
app.get('/api/admin/audit', need('admin'), (req, res) => {
  const { from, to, user, action, store, laudo, role, format } = req.query;
  const w = [], p = [];
  if (from) { w.push('at >= ?'); p.push(from); }
  if (to) { w.push('at <= ?'); p.push(to + 'T23:59:59'); }
  if (user) { w.push('(user_name LIKE ? OR user_id = ?)'); p.push(`%${user}%`, +user || -1); }
  if (action) { w.push('action LIKE ?'); p.push(`%${action}%`); }
  if (role) { w.push('role = ?'); p.push(role); }
  if (store) { w.push('store_id = ?'); p.push(+store); }
  if (laudo) { w.push('laudo_id = ?'); p.push(+laudo); }
  const rows = all(`SELECT * FROM audit ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT ${format ? 50000 : 500}`, ...p);
  SV.audit(req, 'auditoria.consultar', { after: req.query });
  const maskAll = (s) => (s ? String(s).replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, '***.$2.***-**') : s);
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return res.send('\ufeff' + ['data;usuario;perfil;acesso;ip;aparelho;acao;entidade;id;loja;laudo;item;antes;depois', ...rows.map((r) => [r.at, r.user_name, r.role, r.via, r.ip, r.ua, r.action, r.entity, r.entity_id, r.store_id, r.laudo_id, r.item, maskAll(r.before), maskAll(r.after)].map(esc).join(';'))].join('\n'));
  }
  const security = all("SELECT * FROM audit WHERE action='seguranca.alerta' ORDER BY id DESC LIMIT 20");
  res.json({ rows: rows.map((r) => ({ ...r, before: maskAll(r.before), after: maskAll(r.after) })), security });
});
app.get('/api/laudos/:id/timeline', need(), (req, res) => {
  const l = getLaudo(req, +req.params.id);
  res.json(all('SELECT id, at, user_name, role, via, action, item, after FROM audit WHERE laudo_id=? ORDER BY id', l.id).map((r) => ({ ...r, after: J(r.after) })));
});
app.get('/api/admin/outbox', need('admin', 'franqueadora'), (req, res) => res.json(all('SELECT o.*, b.name brand FROM outbox o LEFT JOIN brands b ON b.id=o.brand_id ORDER BY o.id DESC LIMIT 300')));

// Relatórios (13.4)
app.get('/api/reports/stores.csv', need('franqueadora', 'diretoria', 'admin'), (req, res) => {
  const ids = L.storeIdsForUser(req.user);
  const rows = ids.length ? all(`SELECT * FROM stores WHERE deleted_at IS NULL AND id IN (${ids.join(',')}) ORDER BY fantasia`).map(storeRow) : [];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  SV.audit(req, 'relatorio.exportar', { after: { relatorio: 'lojas' } });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="lojas.csv"');
  res.send('\ufeff' + ['loja;marca;cnpj;municipio;porte;coordenador;laudo;status;checklist_%;prazo;vencimento_credenciamento', ...rows.map((s) => [s.fantasia, s.brand?.name, s.cnpj, s.municipio?.name, C.PORTE_LABEL[s.porte], s.coordinator?.name, s.laudo?.code, s.laudo?.statusLabel || s.lastLaudo?.statusLabel, s.laudo?.progress, s.laudo?.deadline, s.cred_expiry].map(esc).join(';'))].join('\n'));
});
app.get('/api/reports/expiry.csv', need('franqueadora', 'diretoria', 'admin'), (req, res) => {
  const days = +req.query.days || 180;
  const ids = L.storeIdsForUser(req.user);
  const lim = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const s of ids.length ? all(`SELECT * FROM stores WHERE deleted_at IS NULL AND id IN (${ids.join(',')})`) : []) {
    if (s.cred_expiry && s.cred_expiry <= lim) out.push([s.fantasia, 'Credenciamento', '', s.cred_expiry]);
    for (const e of all("SELECT * FROM equipment WHERE store_id=? AND deleted_at IS NULL AND status='ativo'", s.id)) { const c = J(e.cert); if (c?.validade && c.validade <= lim) out.push([s.fantasia, 'Calibração', `${C.EQ_TYPES[e.type]?.short} #${e.patrimonio}`, c.validade]); }
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vencimentos-${days}d.csv"`);
  res.send('\ufeff' + ['loja;tipo;equipamento;vencimento', ...out.sort((a, b) => a[3].localeCompare(b[3])).map((r) => r.map((v) => `"${v}"`).join(';'))].join('\n'));
});

// ---------------- Rotinas automáticas (alertas, lembretes, renovação) ----------------
function recentlySent(kind, laudoId, days) { return !!one('SELECT id FROM outbox WHERE kind=? AND laudo_id IS ? AND at > ?', kind, laudoId ?? null, new Date(Date.now() - days * 86400000).toISOString()); }
function runJobs() {
  try {
    const P = R.getParams();
    const sys = { user: null, publicActor: 'sistema', headers: {}, socket: {} };
    const base = process.env.BASE_URL || `http://localhost:${PORT}`;
    for (const l of all(`SELECT * FROM laudos WHERE deleted_at IS NULL AND status IN ('nao_iniciado','rascunho','em_preenchimento','devolvido')`)) {
      const idle = (Date.now() - new Date(l.last_activity_at || l.created_at)) / 86400000;
      if (idle >= P.prazos.lembreteParadoDias && !recentlySent('lembrete', l.id, P.prazos.lembreteParadoDias)) {
        const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
        const fr = one("SELECT u.* FROM store_users su JOIN users u ON u.id=su.user_id WHERE su.store_id=? AND su.kind='loja'", l.store_id);
        if (!fr) continue;
        let falta = '';
        try { const sm = R.summarize(l.id); falta = Object.entries(sm.statuses).filter(([, s]) => s.status !== 'completo').map(([k]) => '• ' + C.ITEM[k].title).slice(0, 10).join('\n'); } catch {}
        SV.notify({ channel: 'whatsapp', to: fr.phone || fr.email, toName: fr.name, subject: `Laudo ${l.code} parado há ${Math.floor(idle)} dias`, body: `Faltam:\n${falta}\nContinue de onde parou: ${base}/a/${fr.token}`, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'lembrete' });
        const coord = store.coordinator_id ? one('SELECT * FROM users WHERE id=?', store.coordinator_id) : null;
        if (coord) SV.notify({ channel: 'email', to: coord.email, toName: coord.name, subject: `Laudo ${l.code} parado`, body: `${store.fantasia} está sem movimentação há ${Math.floor(idle)} dias.`, brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'lembrete' });
      }
    }
    for (const l of all("SELECT * FROM laudos WHERE deleted_at IS NULL AND status='liberado_assinatura'")) {
      if (!recentlySent('lembrete_assinatura', l.id, P.prazos.lembreteAssinaturaDias) && (Date.now() - new Date(l.updated_at)) / 86400000 >= P.prazos.lembreteAssinaturaDias) {
        const store = one('SELECT * FROM stores WHERE id=?', l.store_id);
        SV.notify({ channel: 'email', to: store.contact_email || 'franqueadora', subject: `Assinatura pendente — ${l.code}`, body: 'Ainda falta assinatura de um dos documentos.', brandId: store.brand_id, storeId: store.id, laudoId: l.id, kind: 'lembrete_assinatura' });
      }
    }
    // renovação automática X dias antes do vencimento (art. 36)
    for (const s of all("SELECT * FROM stores WHERE deleted_at IS NULL AND status='ativa' AND cred_expiry IS NOT NULL")) {
      const days = (new Date(s.cred_expiry) - Date.now()) / 86400000;
      if (days <= P.prazos.renovacaoAutoDias && days > 0) {
        const active = one(`SELECT id FROM laudos WHERE store_id=? AND deleted_at IS NULL AND status IN (${L.ACTIVE.map(() => '?').join(',')})`, s.id, ...L.ACTIVE);
        if (!active && one("SELECT id FROM laudos WHERE store_id=? AND status='deferido'", s.id)) {
          const dl = new Date(new Date(s.cred_expiry).getTime() - P.prazos.renovacaoAntecedenciaDias * 86400000).toISOString().slice(0, 10);
          const id = L.createLaudo(sys, s, { process_type: 'renovacao', deadline: dl });
          notifyFranqueadora(sys, s, `Renovação criada automaticamente — ${s.fantasia}`, `O credenciamento vence em ${new Date(s.cred_expiry).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}. O pedido de renovação (laudo ${id}) foi criado com prazo até ${new Date(dl).toLocaleDateString('pt-BR', { timeZone: 'UTC' })}. Envie o link ao franqueado.`);
        }
      }
      for (const alertDays of P.prazos.alertasVencimento) if (Math.floor(days) === alertDays && !recentlySent('vencimento_' + alertDays, null, 2)) notifyFranqueadora(sys, s, `Credenciamento de ${s.fantasia} vence em ${alertDays} dias`, 'Verifique o pedido de renovação (art. 36).');
    }
    // lixeira: exclusão definitiva após 90 dias (exceto laudos arquivados)
    const cut = new Date(Date.now() - 90 * 86400000).toISOString();
    for (const t of all("SELECT * FROM trash WHERE restored_at IS NULL AND deleted_at < ? AND entity IN ('photo','file')", cut)) {
      const row = one(`SELECT * FROM ${t.entity === 'photo' ? 'photos' : 'files'} WHERE id=?`, t.entity_id);
      if (row && row.deleted_at) for (const f of [row.file, row.pdf_file, row.small_file].filter(Boolean)) try { fs.unlinkSync(SV.filePath(f)); } catch {}
      update('trash', t.id, { restored_at: 'purged:' + now() });
    }
  } catch (e) { console.error('jobs', e); }
}
setInterval(runJobs, 6 * 3600 * 1000).unref();

// ---------------- Front-end ----------------
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false, maxAge: 0 }));
app.get('/manifest.webmanifest', (req, res) => res.json({ name: 'Laudo ECV', short_name: 'Laudo ECV', start_url: '/', display: 'standalone', background_color: '#0B1430', theme_color: '#0B1430', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] }));
app.get(['/', '/c/:code'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((e, req, res, next) => {
  const status = e.status || (e.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(e);
  res.status(status).json({ error: status >= 500 && !e.expose ? 'Erro interno. Tente novamente.' : e.message, issues: e.issues, checks: e.checks, heavy: e.heavy, conds: e.conds });
});

if (require.main === module) {
  require('./seed').ensureSeed().then(() => {
    app.listen(PORT, () => { console.log(`Laudo ECV rodando em http://localhost:${PORT}  (modo demonstração: ${DEMO ? 'sim' : 'não'})`); runJobs(); });
  });
}
module.exports = { app, runJobs };
