// Serviços: arquivos, processamento de fotos, CNPJ, teste de links do Drive, notificações e auditoria.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const sharp = require('sharp');
const { DATA_DIR, one, insert, run, now, S, J } = require('./db');


const FILES = path.join(DATA_DIR, 'files');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function saveFile(buf, ext) {
  const name = crypto.randomBytes(12).toString('hex') + (ext ? '.' + ext.replace(/^\./, '') : '');
  const sub = name.slice(0, 2);
  fs.mkdirSync(path.join(FILES, sub), { recursive: true });
  fs.writeFileSync(path.join(FILES, sub, name), buf);
  return `${sub}/${name}`;
}
const filePath = (rel) => path.join(FILES, rel);
const readFile = (rel) => fs.readFileSync(filePath(rel));

// ---------- Fotos ----------
async function analyzePhoto(buf) {
  const img = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  const w = meta.autoOrient ? meta.autoOrient.width : meta.width;
  const h = meta.autoOrient ? meta.autoOrient.height : meta.height;
  // cor: diferença média entre canais
  const small = await sharp(buf).rotate().resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  let diff = 0, lum = 0;
  for (let i = 0; i < small.length; i += 3) {
    const r = small[i], g = small[i + 1], b = small[i + 2];
    diff += Math.abs(r - g) + Math.abs(g - b) + Math.abs(r - b);
    lum += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  const px = small.length / 3;
  const colorScore = diff / px / 3;
  const brightness = lum / px;
  // nitidez: desvio-padrão do laplaciano em escala reduzida
  const lap = await sharp(buf).rotate().resize(512, 512, { fit: 'inside' }).greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] }).stats();
  const sharpness = lap.channels[0].stdev;
  // dHash 64 bits
  const dh = await sharp(buf).rotate().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += dh[y * 9 + x] < dh[y * 9 + x + 1] ? '1' : '0';
  const dhash = BigInt('0b' + bits).toString(16).padStart(16, '0');
  return { width: w, height: h, isColor: colorScore > 2.2, colorScore, brightness, sharpness, dhash, sha: sha256(buf), format: meta.format };
}

async function storePhoto(buf) {
  const a = await analyzePhoto(buf);
  const orig = saveFile(buf, a.format === 'png' ? 'png' : a.format === 'webp' ? 'webp' : 'jpg');
  const pdfVar = await sharp(buf).rotate().resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  const smallVar = await sharp(buf).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
  return { ...a, file: orig, pdf_file: saveFile(pdfVar, 'jpg'), small_file: saveFile(smallVar, 'jpg'), size: buf.length };
}

// Variante comprimida para o PDF, por nível da "escada" de compressão (Seção 9.3)
const variantCache = new Map();
async function pdfVariant(photo, level, essential) {
  const key = `${photo.id}:${level}:${essential ? 1 : 0}:${typeof photo.annotations === 'string' ? photo.annotations.length : 0}`;
  if (variantCache.has(key)) return variantCache.get(key);
  const ladder = [
    { px: 1100, q: 62 }, { px: 900, q: 52 }, { px: 760, q: 44 }, { px: 640, q: 38 }, { px: 520, q: 32 },
  ];
  // fotos de medida/etiqueta/certificado são preservadas (um degrau acima)
  const step = ladder[Math.min(Math.max(essential ? level - 1 : level, 0), ladder.length - 1)];
  let img = sharp(readFile(photo.pdf_file || photo.file)).resize(step.px, step.px, { fit: 'inside', withoutEnlargement: true });
  const anns = typeof photo.annotations === 'string' ? JSON.parse(photo.annotations || '[]') : photo.annotations || [];
  if (anns.length) {
    const resized = await img.toBuffer({ resolveWithObject: true });
    const W = resized.info.width, H = resized.info.height, sw = Math.max(3, Math.round(W / 220));
    const esc = (t) => String(t).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c]);
    const parts = anns.map((a) => a.t === 'rect' ? `<rect x="${a.x * W}" y="${a.y * H}" width="${a.w * W}" height="${a.h * H}" fill="none" stroke="#FFD400" stroke-width="${sw}"/>`
      : a.t === 'arrow' ? `<line x1="${a.x1 * W}" y1="${a.y1 * H}" x2="${a.x2 * W}" y2="${a.y2 * H}" stroke="#FFD400" stroke-width="${sw}" marker-end="url(#h)"/>`
      : a.t === 'text' ? `<text x="${a.x * W}" y="${a.y * H}" font-family="DejaVu Sans" font-weight="bold" font-size="${Math.round(W / 22)}" fill="#FFD400" stroke="#000" stroke-width="${sw / 2}" paint-order="stroke">${esc(a.s)}</text>` : '').join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><marker id="h" markerWidth="4" markerHeight="4" refX="2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#FFD400"/></marker></defs>${parts}</svg>`;
    img = sharp(resized.data).composite([{ input: Buffer.from(svg) }]);
  }
  const buf = await img.jpeg({ quality: step.q, mozjpeg: true, chromaSubsampling: '4:2:0' }).toBuffer();
  if (variantCache.size > 3000) variantCache.clear();
  variantCache.set(key, buf);
  return buf;
}

// Recorte da planta com destaque do item (Seção 7.1)
async function plantCrop(plantRel, rect, brandColor = '#F20C1F') {
  const buf = readFile(plantRel);
  const meta = await sharp(buf).metadata();
  const W = meta.width, H = meta.height;
  const rx = rect.x * W, ry = rect.y * H, rw = rect.w * W, rh = rect.h * H;
  const pad = Math.max(rw, rh) * 0.6;
  const left = Math.max(0, Math.floor(rx - pad)), top = Math.max(0, Math.floor(ry - pad));
  const width = Math.min(W - left, Math.ceil(rw + pad * 2)), height = Math.min(H - top, Math.ceil(rh + pad * 2));
  const sw = Math.max(3, Math.round(Math.max(width, height) / 160));
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect x="${rx - left}" y="${ry - top}" width="${rw}" height="${rh}" fill="${brandColor}" fill-opacity="0.18" stroke="${brandColor}" stroke-width="${sw}"/></svg>`);
  return sharp(buf).extract({ left, top, width, height }).composite([{ input: svg }])
    .resize(1200, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
}

// PDF -> PNG (primeira página) para usar planta em PDF
function pdfToPng(buf) {
  const tmp = path.join(DATA_DIR, 'tmp-' + crypto.randomBytes(6).toString('hex'));
  fs.writeFileSync(tmp + '.pdf', buf);
  try {
    execFileSync('pdftoppm', ['-png', '-r', '110', '-singlefile', tmp + '.pdf', tmp], { timeout: 20000 });
    return fs.readFileSync(tmp + '.png');
  } catch { return null; } finally { for (const e of ['.pdf', '.png']) try { fs.unlinkSync(tmp + e); } catch {} }
}
function pdfText(buf) {
  const tmp = path.join(DATA_DIR, 'tmp-' + crypto.randomBytes(6).toString('hex') + '.pdf');
  fs.writeFileSync(tmp, buf);
  try { return execFileSync('pdftotext', ['-layout', tmp, '-'], { timeout: 20000 }).toString('utf8'); } catch { return ''; } finally { try { fs.unlinkSync(tmp); } catch {} }
}

// ---------- CNPJ (Seção 5.4) ----------
const DEMO_FILE = path.join(DATA_DIR, 'demo-cnpj-data.json');
const DEMO_CNPJ = (() => { try { return JSON.parse(fs.readFileSync(DEMO_FILE, 'utf8')); } catch { return {}; } })();
function registerDemoCnpj(cnpj, data) { DEMO_CNPJ[cnpj.replace(/\D/g, '')] = data; fs.writeFileSync(DEMO_FILE, JSON.stringify(DEMO_CNPJ)); }

async function fetchJson(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'LaudoECV/1.0' } });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function lookupCnpj(cnpjRaw) {
  const cnpj = String(cnpjRaw).replace(/\D/g, '');
  const errors = [];
  try {
    const d = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
    return { source: 'BrasilAPI (Receita Federal)', data: {
      razao: d.razao_social, fantasia: d.nome_fantasia || '', situacao: d.descricao_situacao_cadastral,
      logradouro: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' '), numero: d.numero, complemento: d.complemento,
      bairro: d.bairro, cep: d.cep, municipio: d.municipio, uf: d.uf, ibge: d.codigo_municipio_ibge ? String(d.codigo_municipio_ibge) : null,
      cnae: d.cnae_fiscal_descricao, abertura: d.data_inicio_atividade, natureza: d.natureza_juridica, porteEmpresa: d.porte,
      telefone: d.ddd_telefone_1, email: d.email,
      qsa: (d.qsa || []).map((s) => ({ nome: s.nome_socio, qualificacao: s.qualificacao_socio, cpfMascarado: s.cnpj_cpf_do_socio })),
    } };
  } catch (e) { errors.push('BrasilAPI: ' + e.message); }
  try {
    const d = await fetchJson(`https://receitaws.com.br/v1/cnpj/${cnpj}`);
    if (d.status === 'ERROR') throw new Error(d.message);
    return { source: 'ReceitaWS (reserva)', data: {
      razao: d.nome, fantasia: d.fantasia, situacao: d.situacao, logradouro: d.logradouro, numero: d.numero, complemento: d.complemento,
      bairro: d.bairro, cep: d.cep, municipio: d.municipio, uf: d.uf, ibge: null, cnae: d.atividade_principal?.[0]?.text,
      abertura: d.abertura, natureza: d.natureza_juridica, porteEmpresa: d.porte, telefone: d.telefone, email: d.email,
      qsa: (d.qsa || []).map((s) => ({ nome: s.nome, qualificacao: s.qual })),
    } };
  } catch (e) { errors.push('ReceitaWS: ' + e.message); }
  if (DEMO_CNPJ[cnpj]) return { source: 'Base de demonstração (Receita indisponível)', data: DEMO_CNPJ[cnpj], warnings: errors };
  const err = new Error('Não foi possível consultar o CNPJ agora. Preencha os dados manualmente ou tente de novo mais tarde.');
  err.details = errors;
  throw err;
}

// ---------- Google Drive (Seção 9.2) ----------
async function testDriveLink(url) {
  const at = now();
  if (!url) return { status: 'fail', at, msg: 'Link vazio.' };
  if (process.env.DEMO_MODE !== '0' && /\/d\/DEMO/.test(url)) return { status: 'ok', at, msg: 'Acessível sem login (link de demonstração).' };
  if (url.startsWith('/v/') || url.includes('/v/')) return { status: 'ok', at, msg: 'Vídeo enviado ao sistema (link próprio).' };
  let u;
  try { u = new URL(url); } catch { return { status: 'fail', at, msg: 'Endereço inválido.' }; }
  if (!/(^|\.)google\.com$/.test(u.hostname) && !/(^|\.)youtube\.com$|youtu\.be$/.test(u.hostname))
    return { status: 'unknown', at, msg: 'O link não é do Google Drive; o sistema não consegue testar automaticamente.' };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(url, { redirect: 'manual', signal: ctl.signal });
    clearTimeout(t);
    const loc = r.headers.get('location') || '';
    if (r.status >= 300 && r.status < 400 && /accounts\.google\.com|ServiceLogin/.test(loc)) return { status: 'fail', at, msg: 'O link pede login. No Drive: Compartilhar → Acesso geral → "Qualquer pessoa com o link" → Leitor.' };
    if (r.status === 401 || r.status === 403 || r.status === 404) return { status: 'fail', at, msg: `O Drive respondeu ${r.status}: o arquivo não está público ou não existe.` };
    if (r.status === 200) {
      const html = await r.text();
      if (/accounts\.google\.com\/ServiceLogin|Solicitar acesso|Request access|You need access|Você precisa de acesso/i.test(html)) return { status: 'fail', at, msg: 'O link pede permissão de acesso. Libere "Qualquer pessoa com o link".' };
      return { status: 'ok', at, msg: 'Acessível sem login.' };
    }
    if (r.status >= 300 && r.status < 400) return { status: 'ok', at, msg: 'Acessível (redirecionamento sem login).' };
    return { status: 'unknown', at, msg: `Resposta inesperada (${r.status}).` };
  } catch (e) {
    return { status: 'unknown', at, msg: 'Não foi possível testar o link agora (rede indisponível). Teste novamente antes da assinatura.' };
  }
}

// ---------- Avisos ----------
// O sistema não envia e-mail nem WhatsApp: os links são copiados e enviados pela própria franqueadora.
// Os avisos ficam só registrados internamente (histórico).
function notify({ channel = 'email', to, toName, subject, body, brandId, storeId, laudoId, kind }) {
  if (!to) return null;
  const brand = brandId ? one('SELECT * FROM brands WHERE id=?', brandId) : null;
  const footer = `\n\n—\n${brand ? brand.name + ' · ' : ''}Projeto Técnico DETRAN MG · Desenvolvido por Domma Tecnologia`;
  const id = insert('outbox', { at: now(), channel, to_addr: to, to_name: toName, subject, body: body + footer, brand_id: brandId, store_id: storeId, laudo_id: laudoId, kind, status: 'registrado' });
  return id;
}

// ---------- Auditoria (imutável) ----------
function audit(req, action, { entity, entityId, storeId, laudoId, item, before, after } = {}) {
  const u = req && req.user;
  insert('audit', {
    at: now(), user_id: u ? u.id : null, user_name: u ? u.name : (req && req.publicActor) || 'sistema',
    role: u ? (req.actingRole || (J(u.roles, [])[0] || '')) : null, via: req && req.via ? req.via : null,
    ip: req ? (req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '') : null,
    ua: req ? String(req.headers?.['user-agent'] || '').slice(0, 200) : null,
    action, entity, entity_id: entityId != null ? String(entityId) : null, store_id: storeId, laudo_id: laudoId, item,
    before: before === undefined ? null : S(before), after: after === undefined ? null : S(after),
  });
}

module.exports = { saveFile, filePath, readFile, sha256, analyzePhoto, storePhoto, pdfVariant, plantCrop, pdfToPng, pdfText, lookupCnpj, registerDemoCnpj, testDriveLink, notify, audit };
