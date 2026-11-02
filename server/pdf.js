// Geração dos documentos: Anexo II, Anexo III e Checklist, com a identidade visual da marca da loja.
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const C = require('./catalog');
const R = require('./rules');
const { one, J } = require('./db');
const { pdfVariant, plantCrop, readFile } = require('./services');

const FONT = fs.existsSync(path.join(__dirname, 'fonts', 'Verdana.ttf')) ? 'Verdana' : 'DejaVuSans';
const FONT_B = fs.existsSync(path.join(__dirname, 'fonts', 'Verdana-Bold.ttf')) ? 'Verdana-Bold' : 'DejaVuSans-Bold';
const A4 = { w: 595.28, h: 841.89 };
const M = { l: 46, r: 46, top: 132, bottom: 92 };
const CW = A4.w - M.l - M.r;
const PORTARIA = 'Portaria CET-MG nº 01524/2025';

const dt = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');
const maskCnpj = (c) => String(c || '').replace(/\D/g, '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const maskCpf = (c) => String(c || '').replace(/\D/g, '').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
const yn = (v) => (R.sim(v) ? 'Sim' : v === undefined || v === null || v === '' ? '—' : 'Não');
const m = (v, u = 'm') => (R.num(v) == null ? '—' : `${R.fmt(R.num(v))} ${u}`);

function themeOf(brand) {
  const t = J(brand && brand.theme, {});
  return {
    primary: '#333333', accent: '#333333', bg: '#F4F4F4', text: '#1A1A1A', headerText: '#FFFFFF',
    pattern: 'grid', shape: 'round', upper: false, logoText: brand ? brand.name : 'Projeto Técnico DETRAN MG', logoSub: 'VISTORIAS AUTOMOTIVAS', ...t,
  };
}

function newDoc(meta) {
  const doc = new PDFDocument({ size: 'A4', margins: { top: M.top, bottom: M.bottom, left: M.l, right: M.r }, bufferPages: true, autoFirstPage: false, info: meta, compress: true });
  doc.registerFont('Body', path.join(__dirname, 'fonts', FONT + '.ttf'));
  doc.registerFont('Bold', path.join(__dirname, 'fonts', FONT_B + '.ttf'));
  return doc;
}

// ----- Grafismos de marca -----
const PUB = path.join(__dirname, '..', 'public');
const assetCache = {};
function brandAsset(rel) {
  if (!rel) return null;
  if (assetCache[rel] !== undefined) return assetCache[rel];
  const f = path.join(PUB, rel.replace(/^\//, ''));
  let v = null;
  try { const buf = fs.readFileSync(f); const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20); v = { buf, w, h }; } catch {}
  return (assetCache[rel] = v);
}
// Embute cada imagem da marca uma única vez por documento (reutilizada em todas as páginas)
function docImage(doc, key, buf) {
  doc._brandImgs = doc._brandImgs || {};
  return doc._brandImgs[key] || (doc._brandImgs[key] = doc.openImage(buf));
}
function drawPattern(doc, T, y, h, seed = 7) {
  // faixa oficial da marca (arquivo), repetida na horizontal
  const fx = brandAsset(T.faixa);
  if (fx) {
    const tw = h * (fx.w / fx.h);
    const img = docImage(doc, T.faixa, fx.buf);
    doc.save().rect(0, y, A4.w, h).clip();
    for (let x = 0; x < A4.w; x += tw) doc.image(img, x, y, { width: tw, height: h });
    doc.restore();
    return;
  }
  if (T.pattern === 'angular') {
    doc.save().rect(0, y, A4.w, h).fill(T.bg);
    const n = 4, seg = A4.w / n;
    for (let i = 0; i < n; i++) {
      const x = i * seg;
      doc.polygon([x, y], [x + seg * 0.42, y], [x + seg * 0.30, y + h * 0.55], [x + seg * 0.12, y + h * 0.55]).fill(T.primary);
      doc.polygon([x + seg * 0.46, y], [x + seg * 0.96, y], [x + seg * 0.86, y + h], [x + seg * 0.56, y + h]).fill(T.accent);
    }
    doc.restore();
  } else {
    const s = h / 3;
    let r = seed;
    const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
    doc.save();
    for (let row = 0; row < 3; row++) for (let x = 0; x < A4.w; x += s) {
      const v = rnd();
      doc.rect(x, y + row * s, s, s).fill(v < 0.42 ? T.primary : v < 0.72 ? '#111111' : '#FFFFFF');
    }
    doc.restore();
  }
}

function drawLogo(doc, brand, T, x, y, onDark = true) {
  const file = brand && (onDark ? brand.logo_dark_file : brand.logo_file);
  if (file) { try { doc.image(readFile(file), x, y, { fit: [150, 40] }); return; } catch {} }
  const off = brandAsset(onDark ? T.logoDark : T.logoLight);
  if (off) { doc.image(docImage(doc, onDark ? T.logoDark : T.logoLight, off.buf), x, y - 6, { fit: [150, 46], valign: 'center' }); return; }
  doc.fillColor(onDark ? T.headerText : T.primary).font('Bold').fontSize(T.upper ? 20 : 21).text(T.logoText, x, y, { lineBreak: false });
  doc.font('Body').fontSize(5.8).fillColor(onDark ? T.headerText : T.text).text(T.logoSub, x + 1, y + 26, { characterSpacing: 1.2, lineBreak: false });
}

function header(doc, ctx, title, subtitle) {
  const { T, brand } = ctx;
  doc.save();
  doc.rect(0, 0, A4.w, 74).fill(T.primary);
  drawLogo(doc, brand, T, M.l, 22);
  doc.font('Bold').fontSize(9.5).fillColor(T.headerText).text(title, M.l, 28, { width: CW, align: 'right', characterSpacing: 1.1 });
  doc.font('Body').fontSize(7).fillColor(T.headerText).text(subtitle, M.l, 42, { width: CW, align: 'right' });
  drawPattern(doc, T, 74, 24, 11);
  doc.restore();
  doc.x = M.l; doc.y = M.top - 18;
}

async function footers(doc, ctx, label) {
  const { T, consultaUrl } = ctx;
  const qr = consultaUrl ? await QRCode.toBuffer(consultaUrl, { margin: 0, width: 140, errorCorrectionLevel: 'M' }) : null;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const y = A4.h - 62;
    doc.save();
    drawPattern(doc, T, y, 20, 3);
    doc.rect(0, y + 20, A4.w, 42).fill(T.primary);
    doc.font('Body').fontSize(6.6).fillColor(T.headerText)
      .text(label, M.l, y + 30, { width: CW - 80, lineBreak: false, height: 10 });
    if (consultaUrl) doc.fontSize(5.6).text('Consulta: ' + consultaUrl, M.l, y + 41, { width: CW - 80, lineBreak: false, height: 10 });
    doc.fontSize(6.6).text(`Página ${i + 1} de ${range.count}`, M.l, y + 30, { width: CW - 42, align: 'right', lineBreak: false, height: 10 });
    if (qr) { doc.rect(A4.w - M.r - 34, y + 22, 38, 38).fill('#FFFFFF'); doc.image(qr, A4.w - M.r - 32, y + 24, { width: 34 }); }
    doc.restore();
  }
}

function ensure(doc, h, onNew) {
  if (doc.y + h > A4.h - M.bottom) { doc.addPage(); if (onNew) onNew(); }
}

function sectionTitle(doc, T, text) {
  ensure(doc, 30);
  const y = doc.y + 6;
  doc.save().rect(M.l, y + 3, 10, 2).fill(T.accent).restore();
  doc.font('Bold').fontSize(6.8).fillColor(T.text).text(text.toUpperCase(), M.l + 16, y, { characterSpacing: 0.8 });
  doc.moveDown(0.4);
}

function itemHeading(doc, T, n, title) {
  ensure(doc, 120);
  const y = doc.y + 8;
  if (T.shape === 'chamfer') doc.save().polygon([M.l, y], [M.l + 20, y], [M.l + 20, y + 15], [M.l + 15, y + 20], [M.l, y + 20]).fill(T.accent).restore();
  else doc.save().circle(M.l + 10, y + 10, 10).fill(T.accent).restore();
  doc.font('Bold').fontSize(9).fillColor('#FFFFFF').text(String(n), M.l, y + 5, { width: 20, align: 'center' });
  doc.font('Bold').fontSize(11.5).fillColor(T.text).text(T.upper ? title.toUpperCase() : title, M.l + 28, y + 3.5, { width: CW - 28 });
  doc.y = y + 28; doc.x = M.l;
}

function reqBox(doc, T, text) {
  doc.font('Body').fontSize(7.2);
  const h = doc.heightOfString(text, { width: CW - 24 }) + 14;
  ensure(doc, h + 6);
  const y = doc.y;
  doc.save().rect(M.l, y, CW, h).fill(T.bg).rect(M.l, y, 3, h).fill(T.accent).restore();
  doc.fillColor(T.text).text(text, M.l + 14, y + 7, { width: CW - 24 });
  doc.y = y + h + 8; doc.x = M.l;
}

function dataGrid(doc, T, rows) {
  const colW = CW / 2, rowH = 22;
  ensure(doc, rows.length * rowH + 4);
  const y0 = doc.y;
  rows.forEach((pair, r) => pair.forEach(([lb, val], c) => {
    const x = M.l + c * colW, y = y0 + r * rowH;
    doc.save().rect(x, y, colW, rowH).lineWidth(0.5).stroke('#D6D6D6').restore();
    doc.font('Body').fontSize(5.6).fillColor('#7A7A7A').text(lb.toUpperCase(), x + 6, y + 4, { width: colW - 12, lineBreak: false, characterSpacing: 0.4 });
    doc.font('Body').fontSize(7.6).fillColor(T.text).text(val || '—', x + 6, y + 11.5, { width: colW - 12, lineBreak: false, ellipsis: true, height: 10 });
  }));
  doc.y = y0 + rows.length * rowH + 6;
}

function processChecks(doc, T, type) {
  const y = doc.y;
  let x = M.l;
  for (const [k, lb] of [['credenciamento', 'Credenciamento'], ['renovacao', 'Renovação'], ['alteracao_endereco', 'Alteração de endereço'], ['modificacao', 'Modificação']]) {
    doc.save().rect(x, y, 8, 8).lineWidth(0.7).stroke(T.text).restore();
    if (type === k) doc.save().moveTo(x + 1.5, y + 1.5).lineTo(x + 6.5, y + 6.5).moveTo(x + 6.5, y + 1.5).lineTo(x + 1.5, y + 6.5).lineWidth(1).stroke(T.text).restore();
    doc.font('Body').fontSize(7.2).fillColor(T.text).text(lb, x + 12, y + 0.5, { lineBreak: false });
    x += doc.widthOfString(lb) + 30;
  }
  doc.y = y + 16; doc.x = M.l;
}

function table(doc, T, cols, rows) {
  // cols: [{label, w (fração)}]
  const rowH = 14;
  const head = () => {
    const y = doc.y;
    doc.save().rect(M.l, y, CW, rowH).fill(T.primary === '#F20C1F' ? '#1A1A1A' : T.primary).restore();
    let x = M.l;
    for (const c of cols) { doc.font('Bold').fontSize(6.4).fillColor('#FFFFFF').text(c.label, x + 5, y + 4, { width: c.w * CW - 8, lineBreak: false, ellipsis: true, height: 9 }); x += c.w * CW; }
    doc.y = y + rowH;
  };
  ensure(doc, rowH * Math.min(rows.length + 1, 4)); head();
  for (const r of rows) {
    if (doc.y + rowH > A4.h - M.bottom) { doc.addPage(); head(); }
    const y = doc.y;
    let x = M.l;
    r.forEach((v, i) => {
      const s = v == null ? '—' : String(v);
      const ok = s.startsWith('✓'), bad = s.startsWith('✗');
      doc.font(ok || bad ? 'Bold' : 'Body').fontSize(6.6).fillColor(ok ? '#16803C' : bad ? '#C21B1B' : T.text)
        .text(s, x + 5, y + 4, { width: cols[i].w * CW - 8, lineBreak: false, ellipsis: true, height: 9 });
      x += cols[i].w * CW;
    });
    doc.save().moveTo(M.l, y + rowH).lineTo(M.l + CW, y + rowH).lineWidth(0.4).stroke('#DDDDDD').restore();
    doc.y = y + rowH;
  }
  doc.moveDown(0.6); doc.x = M.l;
}

async function photoGrid(doc, ctx, photos, cols = 3) {
  const { T } = ctx;
  const gap = 8, w = (CW - gap * (cols - 1)) / cols, h = w * 0.68;
  for (let i = 0; i < photos.length; i += cols) {
    ensure(doc, h + 22);
    const y = doc.y;
    const rowPh = photos.slice(i, i + cols);
    for (let j = 0; j < rowPh.length; j++) {
      const p = rowPh[j], x = M.l + j * (w + gap);
      ctx.fig++;
      p._fig = ctx.fig;
      if (T.shape === 'chamfer') doc.save().polygon([x, y], [x + w, y], [x + w, y + h - 8], [x + w - 8, y + h], [x, y + h]).fill('#EEEEF0').restore();
      else doc.save().roundedRect(x, y, w, h, 5).fill('#EEEEF0').restore();
      try {
        const buf = await pdfVariant(p, ctx.level + (ctx.annex === 'III' ? 1 : 0), isEssential(p));
        doc.image(buf, x + 2, y + 2, { fit: [w - 4, h - 4], align: 'center', valign: 'center' });
      } catch { doc.font('Body').fontSize(6).fillColor('#999').text('imagem indisponível', x, y + h / 2, { width: w, align: 'center' }); }
      const cap = `Figura ${String(ctx.fig).padStart(2, '0')} · ${p.caption || p.slot}`;
      doc.font('Body').fontSize(5.9).fillColor('#555555').text(cap, x, y + h + 3, { width: w, height: 15, ellipsis: true });
    }
    doc.y = y + h + 20; doc.x = M.l;
  }
}
const isEssential = (p) => /trena|medida|serie|patrimonio|calibracao|acessivel|ext|vaga|portao|config|evidencia/.test(p.slot) || p.essential === 1;

async function plantBlock(doc, ctx, k, label) {
  const it = (ctx.data.items || {})[k] || {};
  const plant = ctx.files.filter((f) => f.kind === 'planta').pop();
  const own = ctx.photos.find((p) => p.item === k && p.slot === 'planta');
  let buf = null;
  try {
    if (own) buf = await pdfVariant(own, ctx.level, true);
    else if (plant && it.plantRect) {
      const meta = J(plant.meta, {});
      buf = await plantCrop(meta.image || plant.file, it.plantRect, ctx.T.accent);
      const sharp = require('sharp');
      const q = [70, 60, 50, 42, 36, 30][Math.min(ctx.level, 5)];
      buf = await sharp(buf).resize(900 - ctx.level * 90, 600, { fit: 'inside' }).jpeg({ quality: q }).toBuffer();
    }
  } catch { buf = null; }
  sectionTitle(doc, ctx.T, 'Planta · localização ' + label);
  const h = 150;
  ensure(doc, h + 18);
  const y = doc.y;
  doc.save().roundedRect(M.l, y, CW, h, ctx.T.shape === 'chamfer' ? 0 : 5).fill('#EEEEF0').restore();
  if (buf) doc.image(buf, M.l + 3, y + 3, { fit: [CW - 6, h - 6], align: 'center', valign: 'center' });
  else doc.font('Body').fontSize(6.5).fillColor('#888').text('Planta de localização não informada', M.l, y + h / 2 - 4, { width: CW, align: 'center' });
  ctx.fig++;
  doc.font('Body').fontSize(5.9).fillColor('#555').text(`Figura ${String(ctx.fig).padStart(2, '0')} · Recorte da planta com ${label} destacado(s)`, M.l, y + h + 3, { width: CW });
  doc.y = y + h + 16; doc.x = M.l;
}

function ok(cond) { return cond ? '✓ Atende' : '✗ Não atende'; }

function a2Measures(k, ctx) {
  const f = (ctx.data.items?.[k]?.fields) || {}, P = ctx.params, D = P.dimensoes, cfg = ctx.cfg, porte = ctx.porte;
  const L = +cfg.boxesLeves || 0, Pz = cfg.pesados ? +cfg.boxesPesados || 0 : 0, T = L + Pz, n = R.num;
  switch (k) {
    case 'a2_1': return { cols: [{ label: 'Requisito', w: 0.45 }, { label: 'Informado', w: 0.3 }, { label: 'Conformidade', w: 0.25 }],
      rows: [['Backlight', yn(f.backlight), ok(R.sim(f.backlight))], ['Acrílico branco', yn(f.acrilico), ok(R.sim(f.acrilico))], ['Grafismo em plotter de recorte', yn(f.plotter), ok(R.sim(f.plotter))], ['Modelo conforme Anexo I', yn(f.modeloAnexoI), ok(R.sim(f.modeloAnexoI))], ['Local de fixação', { fachada: 'Fachada', corredor: 'Corredor próximo à entrada', porta: 'Acima da porta' }[f.local] || '—', ok(!!f.local)]] };
    case 'a2_2': { const min = D.recepcaoBase + D.recepcaoPorBox * T; return { cols: [{ label: 'Requisito', w: 0.35 }, { label: 'Informado', w: 0.22 }, { label: 'Mínimo', w: 0.2 }, { label: 'Conformidade', w: 0.23 }],
      rows: [['Área total', m(f.area, 'm²'), `${R.fmt(min)} m²`, ok(n(f.area) >= min)], ['Cadeiras', f.cadeiras || '—', String(T), ok(n(f.cadeiras) >= T)], ['Bebedouro', yn(f.bebedouro), 'Sim', ok(R.sim(f.bebedouro))], ['Ar-condicionado', yn(f.ar), 'Sim', ok(R.sim(f.ar))]] }; }
    case 'a2_3': return { cols: [{ label: 'Requisito', w: 0.35 }, { label: 'Informado', w: 0.22 }, { label: 'Mínimo', w: 0.2 }, { label: 'Conformidade', w: 0.23 }],
      rows: [['Área', m(f.area, 'm²'), `${R.fmt(D.salaAdm)} m²`, ok(n(f.area) >= D.salaAdm)], ['Mobília', yn(f.mobilia), 'Sim', ok(R.sim(f.mobilia))], ['Recursos tecnológicos', f.recursos || '—', '—', '']] };
    case 'a2_4': { const min = porte ? P.porte.banheirosMin[porte] : 1; return { cols: [{ label: 'Requisito', w: 0.35 }, { label: 'Informado', w: 0.22 }, { label: 'Mínimo', w: 0.2 }, { label: 'Conformidade', w: 0.23 }],
      rows: [['Banheiros', f.banheiros || '—', String(min), ok(n(f.banheiros) >= min)], ['Acessíveis', f.acessiveis || '—', '1', ok(n(f.acessiveis) >= 1)], ['NBR 9050:2020', yn(f.nbr9050), 'Sim', ok(R.sim(f.nbr9050))]] }; }
    case 'a2_5': return { cols: [{ label: 'Equipamento', w: 0.3 }, { label: 'Local', w: 0.35 }, { label: 'Validade', w: 0.15 }, { label: 'Situação', w: 0.2 }],
      rows: (f.extintores || []).map((e) => [e.tipo, e.local, dt(e.validade), ok(new Date(e.validade) >= new Date(cfg.dataPedido || Date.now()))]) };
    case 'a2_6': return { cols: [{ label: 'Vaga', w: 0.15 }, { label: 'Comprimento', w: 0.2 }, { label: 'Largura', w: 0.2 }, { label: 'Cobertura', w: 0.2 }, { label: 'Conformidade', w: 0.25 }],
      rows: (f.vagas || []).map((v, i) => [String(i + 1), m(v.comprimento), m(v.largura), v.coberto === 'sim' ? 'Coberta' : 'Descoberta', ok(n(v.comprimento) >= D.vaga.c && n(v.largura) >= D.vaga.l)]) };
    case 'a2_7': case 'a2_8': {
      const pref = k === 'a2_7' ? 'L' : 'P', N = k === 'a2_7' ? L : Pz, dim = k === 'a2_7' ? D.boxLeve : D.boxPesado, cob = k === 'a2_7' || P.porte.coberturaPesadoObrigatoria[porte];
      const bx = f.boxes || {};
      return { cols: [{ label: 'Box', w: 0.1 }, { label: 'Comprimento', w: 0.17 }, { label: 'Largura', w: 0.17 }, { label: 'Altura', w: 0.15 }, { label: 'Coberto', w: 0.13 }, { label: 'Piso', w: 0.13 }, { label: 'Conformidade', w: 0.15 }],
        rows: Array.from({ length: N }, (_, i) => { const b = bx[pref + i + 1] || {}; return [String(i + 1), m(b.comprimento), m(b.largura), m(b.altura), yn(b.coberto), b.piso || '—', ok(n(b.comprimento) >= dim.c && n(b.largura) >= dim.l && n(b.altura) >= dim.h && (!cob || R.sim(b.coberto)))]; }) };
    }
    case 'a2_9': return { cols: [{ label: 'Portão', w: 0.12 }, { label: 'Acesso', w: 0.2 }, { label: 'Largura', w: 0.17 }, { label: 'Altura livre', w: 0.17 }, { label: 'Boxes', w: 0.14 }, { label: 'Conformidade', w: 0.2 }],
      rows: (f.portoes || []).map((p, i) => { const d = p.tipo === 'pesados' ? D.portaoPesado : D.portaoLeve; return [String(i + 1), p.tipo === 'pesados' ? 'Pesados' : 'Leves', m(p.largura), m(p.altura), p.boxes || '—', ok(n(p.largura) >= d.l && n(p.altura) >= d.h)]; }) };
    case 'a2_10': return { cols: [{ label: 'Requisito', w: 0.35 }, { label: 'Informado', w: 0.22 }, { label: 'Mínimo', w: 0.2 }, { label: 'Conformidade', w: 0.23 }],
      rows: [['Largura mínima de manobra', m(f.largura), `${R.fmt(D.manobra)} m`, ok(n(f.largura) >= D.manobra)]] };
  }
  return null;
}

function headerRows(ctx) {
  const e = ctx.data.empresa || {}, s = ctx.store, rt = ctx.rt;
  return [
    [['Razão social', e.razao || s.razao], ['Data', dt(ctx.cfg.dataPedido)]],
    [['CNPJ', maskCnpj(e.cnpj || s.cnpj)], ['Responsável técnico', 'Conforme ART/RRT anexa e assinatura deste documento']],
    [['Município · Porte', `${ctx.municipio ? ctx.municipio.name : '—'} · ${ctx.porte ? C.PORTE_LABEL[ctx.porte] + ' porte' : '—'}`], ['CREA/CAU', 'Conforme ART/RRT anexa']],
    [['Representante legal', e.repName || s.rep_name], ['Cargo/função', e.repRole || s.rep_role]],
  ];
}

function orientationPage(doc, ctx, annexLabel) {
  const { T } = ctx;
  doc.font('Bold').fontSize(13).fillColor(T.text).text(T.upper ? 'ORIENTAÇÕES PARA ANÁLISE' : 'Orientações para análise');
  doc.moveDown(0.5);
  const brandText = ctx.brand && ctx.brand.orientation_text;
  doc.font('Body').fontSize(8).fillColor(T.text).text(brandText ||
    `Este documento (${annexLabel}) foi gerado pelo sistema Projeto Técnico DETRAN MG no padrão da ${PORTARIA}. Em razão do limite de 3 MB do SCE, as fotos estão comprimidas neste PDF. As fotos originais em alta resolução, os vídeos das câmeras e do aplicativo de vistoria, os certificados de calibração e a ART/RRT estão disponíveis no link de consulta desta versão, acessível também pelo QR code no rodapé de cada página.`, { width: CW, lineGap: 2 });
  doc.moveDown(0.8);
  dataGrid(doc, T, [[['Laudo', ctx.versionCode || ctx.laudo.code], ['Versão', ctx.versionN ? 'v' + ctx.versionN : 'prévia (não vigente)']], [['Unidade', (ctx.data.empresa?.fantasia) || ctx.store.fantasia], ['Processo', C.PROCESS_TYPES[ctx.laudo.process_type]]]]);
  sectionTitle(doc, T, 'Link de consulta');
  doc.font('Bold').fontSize(9).fillColor(T.accent).text(ctx.consultaUrl || '(gerado na liberação para assinatura)', { link: ctx.consultaUrl || null, underline: !!ctx.consultaUrl });
  doc.moveDown(0.6);
  const vids = [];
  for (const k of ['a3_2', 'a3_4']) {
    const v = ctx.data.items?.[k]?.videos || {};
    for (const e of ctx.equipment.filter((x) => x.type === C.ITEM[k].eqType && x.status === 'ativo')) if (v[e.id]?.url) vids.push([`${C.ITEM[k].short} ${e.box ? C.boxLabel(e.box) : ''} #${e.patrimonio}`, v[e.id].url]);
  }
  if (ctx.data.items?.a3_9?.videoUrl) vids.push(['Reconhecimento facial (item 9)', ctx.data.items.a3_9.videoUrl]);
  if (ctx.store.drive_folder) vids.unshift(['Pasta da unidade no Google Drive', ctx.store.drive_folder]);
  if (vids.length && annexLabel.includes('III')) {
    sectionTitle(doc, T, 'Vídeos e pastas no Google Drive');
    table(doc, T, [{ label: 'Conteúdo', w: 0.35 }, { label: 'Link (acesso: qualquer pessoa com o link)', w: 0.65 }], vids);
  }
}

// ======================= ANEXO II =======================
async function renderAnexoII(ctx) {
  const doc = newDoc({ Title: 'Anexo II — Laudo Técnico de Infraestrutura', Author: ctx.brand?.name, Subject: PORTARIA, Keywords: `laudo:${ctx.laudo.code};versao:${ctx.versionN || 0};doc:A2` });
  const title = 'LAUDO TÉCNICO DE INFRAESTRUTURA', sub = `Anexo II · ${PORTARIA}`;
  doc.on('pageAdded', () => header(doc, ctx, title, sub));
  doc.addPage();
  orientationPage(doc, ctx, 'Anexo II — Laudo Técnico de Infraestrutura');
  doc.addPage();
  dataGrid(doc, ctx.T, headerRows(ctx));
  processChecks(doc, ctx.T, ctx.laudo.process_type);
  if (ctx.scope.length < C.ALL_ITEMS.length && ['alteracao_endereco', 'modificacao'].includes(ctx.laudo.process_type))
    reqBox(doc, ctx.T, 'Documento restrito aos tópicos objeto da alteração/modificação (art. 45 §1º, I e II), mantida a numeração original do Anexo II.');
  for (const it of C.A2) {
    if (!ctx.scope.includes(it.key)) continue;
    const item = ctx.data.items?.[it.key] || {};
    itemHeading(doc, ctx.T, it.n, it.title);
    reqBox(doc, ctx.T, it.req);
    if (item.na || (it.key === 'a2_6' && !ctx.params.porte.vagasExigidas[ctx.porte])) {
      doc.font('Body').fontSize(7.5).fillColor(ctx.T.text).text(it.key === 'a2_6' ? 'Item dispensado para unidades de pequeno porte.' : 'Não aplicável.' + (item.naJust ? ' ' + item.naJust : ''));
      doc.moveDown(0.6);
      continue;
    }
    await plantBlock(doc, ctx, it.key, it.key === 'a2_7' || it.key === 'a2_8' ? 'os boxes' : 'o ambiente');
    const ph = ctx.photos.filter((p) => p.item === it.key && p.slot !== 'planta' && p.essential !== -1);
    sectionTitle(doc, ctx.T, 'Fotos · ' + it.title);
    if (ph.length) await photoGrid(doc, ctx, ph, 3);
    if (item.descricao) { ensure(doc, 20); doc.font('Body').fontSize(7.2).fillColor(ctx.T.text).text(item.descricao, { width: CW }); doc.moveDown(0.4); }
    const ms = a2Measures(it.key, ctx);
    if (ms && ms.rows.length) { sectionTitle(doc, ctx.T, 'Medidas declaradas'); table(doc, ctx.T, ms.cols, ms.rows); }
  }
  // Descrição técnica e acessibilidade (RT)
  const rv = ctx.data.rtReview || {};
  itemHeading(doc, ctx.T, '•', 'Descrição técnica das instalações e dimensionamentos');
  doc.font('Body').fontSize(7.6).fillColor(ctx.T.text).text(rv.descricao || '(a preencher pelo responsável técnico)', { width: CW, lineGap: 1.5 });
  doc.moveDown(0.6);
  itemHeading(doc, ctx.T, '•', 'Declaração de acessibilidade');
  doc.font('Body').fontSize(7.6).fillColor(ctx.T.text).text(accessibilityText(ctx), { width: CW, lineGap: 1.5 });
  doc.moveDown(1);
  signatureBlock(doc, ctx, 'Responsável técnico (engenheiro ou arquiteto)', 'Registro CREA/CAU conforme ART/RRT anexa', 'Assinatura digital gov.br do responsável técnico');
  await footers(doc, ctx, `${ctx.brand?.name || ''} · ${(ctx.data.empresa?.fantasia) || ctx.store.fantasia} · Laudo nº ${ctx.laudo.code} · ${ctx.versionN ? 'versão ' + ctx.versionN : 'prévia'}`);
  return finish(doc);
}

function accessibilityText(ctx) {
  const rt = ctx.rt;
  return `O responsável técnico signatário deste laudo, identificado na ART/RRT anexa, declara, para os fins do art. 34 §16, "a", da Portaria CET-MG nº 1.290/2023, com redação da ${PORTARIA}, que as instalações da unidade ${(ctx.data.empresa?.razao) || ctx.store.razao}, CNPJ ${maskCnpj(ctx.store.cnpj)}, atendem às condições de acessibilidade previstas na ABNT NBR 9050:2020, na Lei nº 13.146/2015, na Lei nº 10.048/2000, na Lei nº 10.098/2000 e na Convenção Internacional sobre os Direitos das Pessoas com Deficiência.${(ctx.data.rtReview || {}).acessibilidade ? '' : ' (pendente de confirmação)'}`;
}

function signatureBlock(doc, ctx, name, line2, note) {
  ensure(doc, 90);
  const y = doc.y + 30, x = M.l + CW / 2 - 130;
  doc.save().moveTo(x, y).lineTo(x + 260, y).lineWidth(0.7).stroke(ctx.T.text).restore();
  doc.font('Bold').fontSize(8).fillColor(ctx.T.text).text(name, x, y + 5, { width: 260, align: 'center' });
  doc.font('Body').fontSize(7).text(line2, x, doc.y + 1, { width: 260, align: 'center' });
  doc.fontSize(6.2).fillColor('#777').text(note, x, doc.y + 2, { width: 260, align: 'center' });
  doc.x = M.l;
}

// ======================= ANEXO III =======================
async function renderAnexoIII(ctx) {
  const doc = newDoc({ Title: 'Anexo III — Declaração de Requisitos de Equipamentos', Author: ctx.brand?.name, Subject: PORTARIA, Keywords: `laudo:${ctx.laudo.code};versao:${ctx.versionN || 0};doc:A3` });
  const title = 'DECLARAÇÃO DE REQUISITOS DE EQUIPAMENTOS', sub = `Anexo III · ${PORTARIA}`;
  doc.on('pageAdded', () => header(doc, ctx, title, sub));
  doc.addPage();
  orientationPage(doc, ctx, 'Anexo III — Declaração de Requisitos de Equipamentos');
  doc.addPage();
  dataGrid(doc, ctx.T, headerRows(ctx));
  processChecks(doc, ctx.T, ctx.laudo.process_type);
  const e = ctx.data.empresa || {}, s = ctx.store;
  reqBox(doc, ctx.T, `Eu, ${e.repName || s.rep_name}, CPF ${maskCpf(e.repCpf || s.rep_cpf)}, ${e.repRole || s.rep_role || 'representante legal'} da empresa ${e.razao || s.razao}, CNPJ ${maskCnpj(s.cnpj)}, estabelecida em ${e.endereco || s.address}, declaro, para fins de ${C.PROCESS_TYPES[ctx.laudo.process_type].toLowerCase()} junto à Coordenadoria Estadual de Gestão de Trânsito, que a unidade dispõe dos equipamentos relacionados a seguir, em pleno funcionamento e de uso no local, nos termos da Portaria CET-MG nº 1.290/2023, com a redação dada pela ${PORTARIA}, e que as informações e fotos apresentadas são verdadeiras e atuais.`);
  for (const it of C.A3) {
    if (!ctx.scope.includes(it.key)) continue;
    itemHeading(doc, ctx.T, it.n, it.title);
    reqBox(doc, ctx.T, it.req);
    const item = ctx.data.items?.[it.key] || {};
    if (it.eqType) {
      const eqs = ctx.equipment.filter((x) => x.type === it.eqType && x.status === 'ativo');
      const rows = eqs.map((x) => [
        [x.subtype ? C.ELEVACAO[x.subtype] : x.description, x.brand, x.model].filter(Boolean).join(' · '),
        x.serial || '—', x.patrimonio || '—', x.box ? (x.box === 'movel' ? 'Móvel' : C.boxLabel(x.box)) : '—',
        it.cal ? (x.cert ? `${x.cert.numero} · val. ${dt(x.cert.validade)}` : '—') : specSummary(x),
      ]);
      table(doc, ctx.T, [{ label: 'Descrição · marca · modelo', w: 0.33 }, { label: 'Nº de série', w: 0.17 }, { label: 'Patrimônio', w: 0.12 }, { label: 'Box', w: 0.12 }, { label: it.cal ? 'Certificado · validade' : 'Especificações', w: 0.26 }], rows.length ? rows : [['Nenhum equipamento cadastrado', '', '', '', '']]);
      if (it.video) {
        const v = item.videos || {};
        const vr = eqs.map((x) => [`#${x.patrimonio} ${x.box ? C.boxLabel(x.box) : ''}`, v[x.id]?.url || '—']);
        if (vr.length) { sectionTitle(doc, ctx.T, 'Vídeos (Google Drive)'); table(doc, ctx.T, [{ label: 'Equipamento', w: 0.25 }, { label: 'Link do vídeo', w: 0.75 }], vr); }
      }
      const ph = [];
      for (const x of eqs) for (const p of x.photosArr.filter((q) => q.essential !== -1)) ph.push({ ...p, caption: `${it.short} #${x.patrimonio || ''} · ${p.caption || p.slot}` });
      if (ph.length) { sectionTitle(doc, ctx.T, 'Fotos'); await photoGrid(doc, ctx, ph, 4); }
    } else {
      const ph = ctx.photos.filter((p) => p.item === it.key && p.essential !== -1);
      if (it.key === 'a3_9') { doc.font('Body').fontSize(7.4).fillColor(ctx.T.text).text('Quantidade de aparelhos: 0. Requisito atendido pelo reconhecimento facial integrado ao sistema de vistoria.' + (item.videoUrl ? ` Vídeo: ${item.videoUrl}` : '')); doc.moveDown(0.4); }
      if (it.key === 'a3_15') { doc.font('Body').fontSize(7.4).fillColor(ctx.T.text).text(`Comprovação por contrato/documento anexo (pacote de anexos).${item.fields?.obs ? ' ' + item.fields.obs : ''}`); doc.moveDown(0.4); }
      if (it.key === 'a3_17') { doc.font('Body').fontSize(7.4).fillColor(ctx.T.text).text(`Velocidade de upload contratada: ${item.fields?.upload || '—'} Mb/s. Operadora: ${item.fields?.operadora || '—'}. Contrato no pacote de anexos.`); doc.moveDown(0.4); }
      if (ph.length) await photoGrid(doc, ctx, ph, 4);
    }
    if (item.obs) { doc.font('Body').fontSize(7).fillColor('#555').text('Observações: ' + item.obs); doc.moveDown(0.4); }
  }
  doc.moveDown(1);
  signatureBlock(doc, ctx, e.repName || s.rep_name, `${e.repRole || s.rep_role || 'Representante legal'} · CPF ${maskCpf(e.repCpf || s.rep_cpf)}`, 'Assinatura digital gov.br ou firma reconhecida do representante legal');
  await footers(doc, ctx, `${ctx.brand?.name || ''} · ${(ctx.data.empresa?.fantasia) || ctx.store.fantasia} · Laudo nº ${ctx.laudo.code} · ${ctx.versionN ? 'versão ' + ctx.versionN : 'prévia'}`);
  return finish(doc);
}

function specSummary(x) {
  const s = x.specs || {};
  switch (x.type) {
    case 'elevacao': return x.subtype === 'rampas' ? `Elev. ${s.elevacao || '?'} mm · ${s.carga || '?'} kg/rampa` : x.subtype === 'fosso' ? `${s.largura || '?'} cm × ${s.altura || '?'} m × ${s.comprimento || '?'} m` : `${s.capacidade || '?'} kg${s.elevacao ? ' · ' + s.elevacao + ' mm' : ''}`;
    case 'camera_fixa': case 'boroscopio': return `${s.resW || '?'} × ${s.resH || '?'} px`;
    case 'servidor': return `${s.cpu || '?'} · ${s.ram || '?'} GB · ${s.disco || '?'} TB`;
    case 'nobreak': return `${s.va || '?'} VA`;
    case 'roteador': return R.sim(s.portas) ? 'Redirecionamento de portas' : '—';
    default: return '—';
  }
}

function finish(doc) {
  return new Promise((resolve) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

function makeCtx(sumCtx, opts = {}) {
  const brand = one('SELECT * FROM brands WHERE id=?', sumCtx.store.brand_id);
  return { ...sumCtx, brand, T: themeOf(brand), fig: 0, level: opts.level || 0, scope: C.itemsInScope(sumCtx.laudo, sumCtx.cfg).map((i) => i.key),
    consultaUrl: opts.consultaUrl, versionCode: opts.versionCode, versionN: opts.versionN };
}

// Escada de compressão até caber no alvo do SCE (Seção 9.3, R23)
async function generateWithinLimit(sumCtx, annex, opts = {}) {
  const alvo = (sumCtx.params.arquivos.sceAlvoMB || 2.9) * 1024 * 1024;
  let last;
  for (let level = 0; level <= 5; level++) {
    const ctx = makeCtx(sumCtx, { ...opts, level });
    ctx.annex = annex;
    const buf = annex === 'II' ? await renderAnexoII(ctx) : await renderAnexoIII(ctx);
    last = { buf, level, size: buf.length, pages: null };
    if (buf.length <= alvo) return { ...last, ok: true };
  }
  // Ainda acima: lista dos itens mais pesados para o Administrador decidir
  const heavy = {};
  for (const p of [...sumCtx.photos, ...sumCtx.eqPhotos]) heavy[p.item] = (heavy[p.item] || 0) + (p.size || 0);
  return { ...last, ok: false, heavy: Object.entries(heavy).sort((a, b) => b[1] - a[1]).slice(0, 8) };
}

// ======================= CHECKLIST =======================
async function renderChecklist(sumCtx, checklist, url) {
  const ctx = makeCtx(sumCtx, { consultaUrl: url });
  const doc = newDoc({ Title: 'Checklist do Franqueado', Author: ctx.brand?.name });
  doc.on('pageAdded', () => header(doc, ctx, 'CHECKLIST DO FRANQUEADO', `Laudo ${ctx.laudo.code} · ${C.PROCESS_TYPES[ctx.laudo.process_type]}`));
  doc.addPage();
  const cfg = ctx.cfg;
  dataGrid(doc, ctx.T, [
    [['Unidade', ctx.store.fantasia], ['Município · Porte', `${ctx.municipio?.name || '—'} · ${ctx.porte ? C.PORTE_LABEL[ctx.porte] : '—'}`]],
    [['Boxes', `${cfg.boxesLeves || 0} leves${cfg.pesados ? ' + ' + cfg.boxesPesados + ' pesado(s)' : ''}${cfg.movel ? ' · vistoria móvel' : ''}`], ['Progresso', `${checklist.done} de ${checklist.total} (${checklist.pct}%)`]],
  ]);
  reqBox(doc, ctx.T, 'Você vai precisar de: ' + checklist.summary.join(' · ') + '.');
  const label = { pronto: '✓ Pronto', parcial: 'Parcial', erro: '✗ Com erro', faltando: 'Faltando', pendente: 'Pendente', opcional: 'Opcional' };
  for (const b of checklist.blocks) {
    sectionTitle(doc, ctx.T, `Bloco ${b.id} — ${b.title} (${b.done}/${b.total})`);
    for (const r of b.rows) {
      const txt = `${r.min ? 'Mínimo: ' + r.min + ' ' : ''}${r.tip ? 'Dica: ' + r.tip : ''}${r.progress ? ' · ' + r.progress : ''}`;
      doc.font('Body').fontSize(6.6);
      const h = Math.max(24, doc.heightOfString(txt, { width: CW - 130 }) + 16);
      ensure(doc, h);
      const y = doc.y;
      doc.save().rect(M.l, y, 9, 9).lineWidth(0.7).stroke(ctx.T.text).restore();
      if (r.status === 'pronto') doc.font('Bold').fontSize(8).fillColor('#16803C').text('✓', M.l + 1.2, y - 0.5);
      doc.font('Bold').fontSize(7.6).fillColor(ctx.T.text).text(r.title + (r.qty ? `  (qtd.: ${r.qty})` : ''), M.l + 16, y, { width: CW - 130 });
      doc.font('Body').fontSize(6.6).fillColor('#555').text(txt, M.l + 16, doc.y + 1, { width: CW - 130 });
      doc.font('Bold').fontSize(7).fillColor(r.status === 'pronto' ? '#16803C' : r.status === 'erro' ? '#C21B1B' : '#8A6100').text(label[r.status] || r.status, M.l + CW - 100, y, { width: 100, align: 'right' });
      doc.y = y + h; doc.x = M.l;
    }
  }
  await footers(doc, ctx, `${ctx.brand?.name || ''} · Checklist · ${ctx.store.fantasia}`);
  return finish(doc);
}

module.exports = { generateWithinLimit, renderChecklist, themeOf };
