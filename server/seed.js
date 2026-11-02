// Carga inicial: municípios de MG, marcas, parâmetros e (no modo demonstração) uma rede fictícia.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const PDFDocument = require('pdfkit');
const { one, all, insert, update, run, now, S, token, J } = require('./db');
const C = require('./catalog');
const SV = require('./services');

const DEMO = process.env.DEMO_MODE !== '0';
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');

// População aproximada (Censo 2022 / Estimativa 2024) dos municípios mais populosos de MG.
// Valores de referência para a demonstração: carregue a tabela oficial do IBGE e a lista da CET-MG pela tela de Porte.
const POP = {
  'Belo Horizonte': [2315560, 2416339], 'Uberlândia': [713232, 754954], 'Contagem': [621863, 668949], 'Juiz de Fora': [540756, 565764],
  'Montes Claros': [414240, 446984], 'Betim': [411846, 444784], 'Uberaba': [337836, 359425], 'Ribeirão das Neves': [329794, 352142],
  'Governador Valadares': [257171, 266113], 'Divinópolis': [231091, 244379], 'Ipatinga': [227731, 239177], 'Sete Lagoas': [227397, 243949],
  'Santa Luzia': [219132, 233624], 'Ibirité': [170537, 180204], 'Poços de Caldas': [163742, 169838], 'Patos de Minas': [159235, 166428],
  'Pouso Alegre': [152217, 161292], 'Teófilo Otoni': [137418, 141269], 'Varginha': [136467, 143060], 'Conselheiro Lafaiete': [131621, 138104],
  'Vespasiano': [129765, 139692], 'Sabará': [129380, 135892], 'Barbacena': [125317, 129983], 'Araguari': [117825, 123383],
  'Itabira': [113343, 117469], 'Passos': [111939, 117070], 'Nova Lima': [111697, 119326], 'Araxá': [111691, 117498],
  'Lavras': [104761, 108866], 'Coronel Fabriciano': [104736, 108493], 'Muriaé': [104108, 107811], 'Ubá': [103365, 108036],
  'Ituiutaba': [102217, 106016], 'Itaúna': [97669, 100340], 'Pará de Minas': [97139, 100862], 'Paracatu': [94017, 97326],
  'Itajubá': [93073, 96286], 'Manhuaçu': [91886, 96002], 'São João del-Rei': [90225, 93479], 'Patrocínio': [89826, 93541],
  'Caratinga': [87360, 90120], 'Unaí': [86619, 90244], 'Esmeraldas': [85598, 92487], 'Timóteo': [81579, 84469], 'João Monlevade': [80187, 82745],
  'Curvelo': [80662, 83479], 'Alfenas': [78970, 82219], 'Viçosa': [76430, 79388], 'Três Corações': [75485, 78873], 'Lagoa Santa': [75145, 82105],
  'Ouro Preto': [74821, 76963], 'Janaúba': [70699, 73013], 'Formiga': [68248, 70402], 'Campanha': [16348, 16832], 'Três Pontas': [55255, 57364],
};

function genCpf(seed) {
  let n = String(100000000 + ((seed * 7919) % 899999999)).slice(0, 9).split('').map(Number);
  for (const t of [9, 10]) { const s = n.reduce((a, d, i) => a + d * (t + 1 - i), 0); n.push(((s * 10) % 11) % 10); }
  return n.join('');
}
function genCnpj(seed) {
  const base = String(10000000 + ((seed * 104729) % 89999999)).slice(0, 8) + '0001';
  const d = base.split('').map(Number);
  for (const w of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) { const s = w.reduce((a, x, i) => a + x * d[i], 0); const r = s % 11; d.push(r < 2 ? 0 : 11 - r); }
  return d.join('');
}

async function fakePhoto(seed, label) {
  let r = (seed * 9973 + 7) % 2147483647;
  const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
  const W = 1600, H = 1200, hue = Math.floor(rnd() * 360);
  let shapes = '';
  for (let i = 0; i < 16; i++) {
    const c = `hsl(${(hue + rnd() * 160) % 360},${40 + rnd() * 50}%,${30 + rnd() * 45}%)`;
    if (rnd() < 0.5) shapes += `<rect x="${rnd() * W}" y="${rnd() * H}" width="${80 + rnd() * 600}" height="${80 + rnd() * 500}" fill="${c}" opacity="${0.5 + rnd() * 0.5}" transform="rotate(${rnd() * 40 - 20} ${W / 2} ${H / 2})"/>`;
    else shapes += `<circle cx="${rnd() * W}" cy="${rnd() * H}" r="${40 + rnd() * 260}" fill="${c}" opacity="${0.5 + rnd() * 0.5}"/>`;
  }
  const trena = /trena|medida|vaga|portão|portao|largura/i.test(label) ? `<rect x="180" y="${H * 0.62}" width="${W - 360}" height="54" fill="#FFD21F" stroke="#222" stroke-width="3"/>${Array.from({ length: 24 }, (_, i) => `<line x1="${200 + i * 50}" y1="${H * 0.62}" x2="${200 + i * 50}" y2="${H * 0.62 + (i % 2 ? 22 : 38)}" stroke="#222" stroke-width="3"/>`).join('')}` : '';
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W / 2}" height="${H / 2}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},45%,38%)"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>${shapes}${trena}
    <rect x="60" y="${H - 170}" width="${W - 120}" height="110" rx="14" fill="#000" opacity="0.55"/>
    <text x="${W / 2}" y="${H - 98}" font-family="DejaVu Sans" font-size="46" fill="#fff" text-anchor="middle">${esc}</text>
    <text x="${W / 2}" y="70" font-family="DejaVu Sans" font-size="30" fill="#fff" text-anchor="middle" opacity="0.85">FOTO DE DEMONSTRAÇÃO</text></svg>`;
  return sharp(Buffer.from(svg)).resize(W, H).jpeg({ quality: 78 }).toBuffer();
}

async function fakePlant(name) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1400"><rect width="2000" height="1400" fill="#fff"/>
  <g fill="none" stroke="#1b2a4a" stroke-width="6">
    <rect x="80" y="80" width="1840" height="1240"/><rect x="80" y="80" width="560" height="420"/><rect x="640" y="80" width="380" height="420"/>
    <rect x="1020" y="80" width="200" height="200"/><rect x="1220" y="80" width="200" height="200"/><rect x="1420" y="80" width="500" height="420"/>
    <rect x="80" y="700" width="460" height="620"/><rect x="540" y="700" width="460" height="620"/><rect x="1000" y="700" width="460" height="620"/>
    <rect x="1460" y="700" width="460" height="620"/></g>
  <g font-family="DejaVu Sans" font-size="34" fill="#1b2a4a" text-anchor="middle">
    <text x="360" y="300">RECEPÇÃO</text><text x="830" y="300">ADMINISTRAÇÃO</text><text x="1120" y="190">WC</text><text x="1320" y="190">WC PCD</text>
    <text x="1670" y="300">ESTACIONAMENTO</text><text x="310" y="1010">BOX 1</text><text x="770" y="1010">BOX 2</text><text x="1230" y="1010">BOX 3</text><text x="1690" y="1010">BOX 4</text>
    <text x="1000" y="610">ÁREA DE MANOBRA (largura 2,80 m)</text><text x="1000" y="1385" font-size="26">${name} — croqui de demonstração (cotas em metros)</text></g>
  <rect x="860" y="1300" width="300" height="40" fill="#1b2a4a"/><text x="1010" y="1290" font-family="DejaVu Sans" font-size="24" text-anchor="middle">PORTÃO</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const RECTS = {
  a2_1: { x: 0.43, y: 0.92, w: 0.15, h: 0.07 }, a2_2: { x: 0.04, y: 0.06, w: 0.28, h: 0.3 }, a2_3: { x: 0.32, y: 0.06, w: 0.19, h: 0.3 },
  a2_4: { x: 0.51, y: 0.06, w: 0.2, h: 0.14 }, a2_5: { x: 0.04, y: 0.06, w: 0.47, h: 0.3 }, a2_6: { x: 0.71, y: 0.06, w: 0.25, h: 0.3 },
  a2_7: { x: 0.04, y: 0.5, w: 0.46, h: 0.44 }, a2_8: { x: 0.73, y: 0.5, w: 0.23, h: 0.44 }, a2_9: { x: 0.43, y: 0.92, w: 0.15, h: 0.04 }, a2_10: { x: 0.04, y: 0.36, w: 0.92, h: 0.14 },
};

function textPdf(lines) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.registerFont('B', path.join(__dirname, 'fonts', 'DejaVuSans.ttf'));
    doc.font('B');
    const chunks = []; doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    lines.forEach((l, i) => doc.fontSize(i === 0 ? 16 : 11).text(l).moveDown(0.4));
    doc.end();
  });
}

let photoSeed = 1;
async function addPhoto({ laudoId, item, slot, caption, userId, daysAgo = 2 }) {
  const buf = await fakePhoto(photoSeed++, caption);
  const info = await SV.storePhoto(buf);
  return insert('photos', { laudo_id: laudoId, item, slot, file: info.file, pdf_file: info.pdf_file, small_file: info.small_file, sha: info.sha, dhash: info.dhash, width: info.width, height: info.height, size: info.size,
    is_color: 1, brightness: info.brightness, sharpness: info.sharpness, taken_at: new Date(Date.now() - daysAgo * 86400000).toISOString(), source: 'camera', caption, essential: 1, uploaded_by: userId, created_at: now() });
}
async function addFile({ laudoId, storeId, equipmentId, kind, name, buf, userId, meta = {} }) {
  const rel = SV.saveFile(buf, name.split('.').pop());
  if (kind === 'planta') meta.image = SV.saveFile(buf, 'png');
  return insert('files', { laudo_id: laudoId || null, store_id: storeId, equipment_id: equipmentId || null, kind, file: rel, original_name: name, mime: name.endsWith('.pdf') ? 'application/pdf' : 'image/png', size: buf.length, sha: SV.sha256(buf), meta: S(meta), uploaded_by: userId, created_at: now() });
}

// Preenche um laudo completo (todas as fotos, medidas, equipamentos e documentos)
async function completeLaudo({ laudoId, store, userId, cfg }) {
  const L = cfg.boxesLeves, P = cfg.pesados ? cfg.boxesPesados : 0;
  const dataPedido = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  const inYear = new Date(Date.now() + 330 * 86400000).toISOString().slice(0, 10);
  const boxesL = Object.fromEntries(Array.from({ length: L }, (_, i) => [`L${i + 1}`, { comprimento: (5.6 + i * 0.01).toFixed(2).replace('.', ','), largura: (3.55 + i * 0.01).toFixed(2).replace('.', ','), altura: '3,10', coberto: 'sim', piso: 'Concreto', iluminacao: 'LED e ventilação natural' }]));
  const boxesP = Object.fromEntries(Array.from({ length: P }, (_, i) => [`P${i + 1}`, { comprimento: '13,20', largura: '4,60', altura: '4,70', coberto: 'sim', piso: 'Concreto' }]));
  const T = L + P;
  const items = {
    a2_1: { fields: { backlight: 'sim', acrilico: 'sim', plotter: 'sim', modeloAnexoI: 'sim', local: 'fachada' } },
    a2_2: { fields: { area: String(10 + T + 2.5).replace('.', ','), cadeiras: String(T + 2), bebedouro: 'sim', ar: 'sim' }, descricao: `Recepção com ${String(10 + T + 2.5).replace('.', ',')} m², cadeiras, bebedouro e ar-condicionado.` },
    a2_3: { fields: { area: '11,20', mobilia: 'sim', recursos: '2 computadores, impressora e telefone' } },
    a2_4: { fields: { banheiros: cfg.porte === 'pequeno' ? '1' : '2', acessiveis: '1', nbr9050: 'sim' } },
    a2_5: { fields: { extintores: [{ tipo: 'Pó ABC 4 kg', local: 'Recepção', validade: inYear }, { tipo: 'CO₂ 6 kg', local: 'Boxes', validade: inYear }] } },
    a2_6: { fields: { vagas: Array.from({ length: cfg.porte === 'pequeno' ? 0 : Math.ceil(L / 2) }, () => ({ comprimento: '5,20', largura: '2,60', coberto: 'nao' })) } },
    a2_7: { fields: { boxes: boxesL } },
    a2_8: { fields: { boxes: boxesP } },
    a2_9: { fields: { portoes: [{ tipo: 'leves', largura: '3,20', altura: '3,10', boxes: 'Leves' }, ...(P ? [{ tipo: 'pesados', largura: '4,20', altura: '4,60', boxes: 'Pesado' }] : [])] } },
    a2_10: { fields: { largura: '2,80' } },
    a3_15: { fields: { obs: 'Rede cabeada Cat6 com ponto por box.' } },
    a3_17: { fields: { upload: '50', operadora: 'Fibra Minas Telecom' } },
  };
  for (const k of Object.keys(RECTS)) if (items[k]) items[k].plantRect = RECTS[k];
  const data = { etapa1: { boxesLeves: L, pesados: !!P, boxesPesados: P, movel: true, elevacao: ['rampas'], dataPedido, savedAt: now() }, empresa: { razao: store.razao, fantasia: store.fantasia, endereco: store.address, cep: store.cep, repName: store.rep_name, repCpf: store.rep_cpf, repRole: store.rep_role, cnpj: store.cnpj }, items };
  // fotos do Anexo II
  for (const it of C.A2) {
    if (it.key === 'a2_8' && !P) continue;
    if (it.key === 'a2_6' && cfg.porte === 'pequeno') continue;
    for (const s of C.photoSlots(it.key, cfg, items[it.key]?.fields)) await addPhoto({ laudoId, item: it.key, slot: s.slot, caption: s.label, userId });
  }
  await addPhoto({ laudoId, item: 'a3_9', slot: 'evidencia', caption: 'Reconhecimento facial no app de vistoria', userId });
  // documentos
  await addFile({ laudoId, storeId: store.id, kind: 'planta', name: 'croqui.png', buf: await fakePlant(store.fantasia), userId });
  await addFile({ laudoId, storeId: store.id, kind: 'doc_boroscopio', name: 'ficha-boroscopio.pdf', buf: await textPdf(['Ficha técnica — Boroscópio Wi-Fi', 'Resolução: 1280 × 720 px', 'Haste flexível 5 m · conexão Wi-Fi']), userId });
  await addFile({ laudoId, storeId: store.id, kind: 'contrato_rede', name: 'contrato-rede.pdf', buf: await textPdf(['Contrato de rede estruturada', `Unidade: ${store.fantasia}`, `Pontos: ${T + 3}`]), userId });
  await addFile({ laudoId, storeId: store.id, kind: 'contrato_internet', name: 'contrato-internet.pdf', buf: await textPdf(['Contrato de internet', 'Plano 300 Mb/s download / 50 Mb/s upload']), userId });
  await addFile({ laudoId, storeId: store.id, kind: 'incendio', name: 'clcb.pdf', buf: await textPdf(['Certificado de Licença do Corpo de Bombeiros (CLCB)', 'Demonstração']), userId });
  // equipamentos
  const Q = C.quantities(cfg);
  const boxes = C.boxesList(cfg);
  let pat = 1;
  const specsFor = (t) => ({
    elevacao: { elevacao: 520, largura: 320, plana: 320, inclinacao: 18, carga: 1500, protecao: 110, distCentros: 1.40, fixacao: 'sim', antiderrapante: 'sim', semQuinas: 'sim', centralizado: 'sim' },
    camera_fixa: { resW: 1920, resH: 1080 }, boroscopio: { resW: 1280, resH: 720 }, servidor: { cpu: 'Intel Core i5-10400', ram: 8, disco: 1, exclusivo: 'sim' },
    nobreak: { va: 1200 }, roteador: { portas: 'sim' },
  }[t] || {});
  const videos = { a3_2: {}, a3_4: {} };
  for (const [type, need] of Object.entries(Q)) {
    if (!need || !C.EQ_TYPES[type]) continue;
    const it = C.EQ_TYPES[type];
    for (let i = 0; i < need; i++) {
      const box = it.perBox ? (boxes[i] || 'movel') : null;
      const serial = `${type.slice(0, 3).toUpperCase()}${store.id}${String(1000 + pat)}`;
      const cert = it.cal ? { numero: `CAL-${store.id}-${pat}`, laboratorio: 'Laboratório Metrológico Demo', dataCalibracao: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), validade: inYear, faixaMax: type === 'trena5' ? 5000 : type === 'trena50' ? 50000 : type === 'paquimetro' ? 150 : 25, resultado: 'Aprovado' } : null;
      const eid = insert('equipment', { store_id: store.id, type, subtype: type === 'elevacao' ? 'rampas' : null, description: it.title, brand: 'Marca Demo', model: `M-${type.slice(0, 4)}`, serial: it.serial ? serial : null, patrimonio: String(pat).padStart(3, '0'), box, specs: S(specsFor(type)), cert: cert ? S(cert) : null, status: 'ativo', confirmed_at: now(), created_at: now(), updated_at: now() });
      pat++;
      for (const s of C.equipmentPhotoSlots(type)) await addPhoto({ laudoId: null, item: 'eq:' + eid, slot: s.slot, caption: s.label, userId });
      if (cert) await addFile({ storeId: store.id, equipmentId: eid, kind: 'certificado', name: `certificado-${cert.numero}.pdf`, userId, buf: await textPdf([`Certificado de calibração nº ${cert.numero}`, `Equipamento: ${it.title}`, `Nº de série: ${serial}`, `Faixa de medição: 0 a ${cert.faixaMax} mm`, `Data da calibração: ${cert.dataCalibracao.split('-').reverse().join('/')}`, `Validade: ${inYear.split('-').reverse().join('/')}`, 'Resultado: Aprovado', 'Laboratório: Laboratório Metrológico Demo'], ), meta: { ocr: { lido: true, divergencias: [] } } });
      if (type === 'camera_fixa') videos.a3_2[eid] = { url: `https://drive.google.com/file/d/DEMO${crypto.randomBytes(8).toString('hex')}/view?usp=sharing`, test: { status: 'ok', at: now(), msg: 'Acessível sem login (demonstração).' } };
      if (type === 'smartphone') videos.a3_4[eid] = { url: `https://drive.google.com/file/d/DEMO${crypto.randomBytes(8).toString('hex')}/view?usp=sharing`, test: { status: 'ok', at: now(), msg: 'Acessível sem login (demonstração).' } };
    }
  }
  data.items.a3_2 = { videos: videos.a3_2 };
  data.items.a3_4 = { videos: videos.a3_4 };
  update('laudos', laudoId, { data: S(data) });
}

async function ensureSeed() {
  if (!one('SELECT COUNT(*) n FROM municipalities').n) {
    const lines = fs.readFileSync(path.join(__dirname, 'data', 'municipios_mg.tsv'), 'utf8').trim().split('\n');
    for (const l of lines) { const [ibge, name] = l.split('\t'); const p = POP[name] || [null, null]; insert('municipalities', { ibge, name, pop2022: p[0], pop2024: p[1] }); }
  }
  if (!one('SELECT COUNT(*) n FROM params').n) insert('params', { version: 1, label: 'Portaria CET-MG nº 01524/2025 (inicial)', data: S(C.DEFAULT_PARAMS), created_at: now() });
  if (one('SELECT COUNT(*) n FROM brands').n) return;

  const av = insert('brands', { slug: 'autovisao', name: 'Auto Visão', tagline: 'Vistorias Automotivas', created_at: now(), sender: S({ name: 'Auto Visão Vistorias', email: 'laudos@autovisao.com.br' }),
    theme: S({ primary: '#F20C1F', primaryDark: '#BF1515', accent: '#F20C1F', bg: '#F4F4F4', text: '#1A1A1A', headerText: '#FFFFFF', pattern: 'grid', shape: 'round', upper: false, logoText: 'autovisão', logoSub: 'VISTORIAS AUTOMOTIVAS', codePrefix: 'AV', font: 'Nunito' }) });
  const ry = insert('brands', { slug: 'royal', name: 'Royal', tagline: 'Vistorias Automotivas', created_at: now(), sender: S({ name: 'Royal Vistorias', email: 'laudos@royalvistorias.com.br' }),
    theme: S({ primary: '#101419', primaryDark: '#1E242C', accent: '#ED712F', bg: '#F7F3E2', text: '#101419', headerText: '#F7F3E2', pattern: 'angular', shape: 'chamfer', upper: true, logoText: 'ROYAL', logoSub: 'VISTORIAS AUTOMOTIVAS', codePrefix: 'RY', font: 'Raleway' }) });

  const adminPw = process.env.ADMIN_PASSWORD || (DEMO ? 'admin123' : crypto.randomBytes(9).toString('base64url'));
  const admin = insert('users', { name: 'Administrador Domma', email: process.env.ADMIN_EMAIL || 'admin@domma.com.br', phone: '(31) 99999-0000', roles: S(['admin']), token: token(), password_hash: hashPw(adminPw), active: 1, created_at: now(), terms_accepted_at: now() });
  console.log(`\n  Administrador: ${process.env.ADMIN_EMAIL || 'admin@domma.com.br'} / senha: ${adminPw}\n`);
  if (!DEMO) return;

  const U = (name, roles, extra = {}) => insert('users', { name, roles: S(roles), token: token(), active: 1, created_at: now(), terms_accepted_at: now(), ...extra });
  const alexandre = U('Alexandre Souza', ['franqueadora', 'coordenador'], { email: 'alexandre@franqueadora.com.br', phone: '(31) 98888-1001' });
  const petala = U('Pétala Ramos', ['franqueadora'], { email: 'petala@franqueadora.com.br', phone: '(31) 98888-1002' });
  const marina = U('Marina Lopes', ['coordenador'], { email: 'marina@franqueadora.com.br', phone: '(31) 98888-1003', scope: S({ brands: [ry] }) });
  U('Diretoria', ['diretoria'], { email: 'diretoria@franqueadora.com.br' });
  const rtU1 = U('Venilton J. Borges', ['rt'], { email: 'venilton@engenharia.com.br', phone: '(35) 97777-2001', cpf: genCpf(11) });
  const rtU2 = U('Ana Paula Rezende', ['rt'], { email: 'ana@arquitetura.com.br', phone: '(35) 97777-2002', cpf: genCpf(12) });
  const rt1 = insert('rts', { user_id: rtU1, name: 'Venilton J. Borges', cpf: genCpf(11), council: 'CREA', reg_number: 'MG0000034311D', uf: 'MG', email: 'venilton@engenharia.com.br', phone: '(35) 97777-2001', validated_by: alexandre, validated_at: now(), created_at: now() });
  const rt2 = insert('rts', { user_id: rtU2, name: 'Ana Paula Rezende', cpf: genCpf(12), council: 'CAU', reg_number: 'A123456-7', uf: 'MG', email: 'ana@arquitetura.com.br', phone: '(35) 97777-2002', created_at: now() });

  const mun = (n) => one('SELECT ibge FROM municipalities WHERE name=?', n).ibge;
  const stores = [
    { key: 'campanha', brand: av, fantasia: 'Auto Visão Campanha', razao: 'G1 AUTO VISAO VISTORIA VEICULAR LTDA', mun: 'Campanha', fr: ['Suzzy Araboni Costa', 'suzzy@autovisaocampanha.com.br', '(35) 99111-0001'], coord: alexandre, rt: rt1 },
    { key: 'varginha', brand: ry, fantasia: 'Royal Varginha', razao: 'ROYAL VARGINHA VISTORIAS LTDA', mun: 'Varginha', fr: ['Carlos Menezes', 'carlos@royalvarginha.com.br', '(35) 99111-0002'], coord: marina },
    { key: 'pouso', brand: av, fantasia: 'Auto Visão Pouso Alegre', razao: 'AV POUSO ALEGRE VISTORIAS EIRELI', mun: 'Pouso Alegre', fr: ['Renata Figueiredo', 'renata@avpouso.com.br', '(35) 99111-0003'], coord: alexandre, rt: rt2 },
    { key: 'lavras', brand: ry, fantasia: 'Royal Lavras', razao: 'ROYAL LAVRAS VISTORIA AUTOMOTIVA LTDA', mun: 'Lavras', fr: ['Bruno Teixeira', 'bruno@royallavras.com.br', '(35) 99111-0004'], coord: marina },
    { key: 'tres', brand: av, fantasia: 'Auto Visão Três Corações', razao: 'TC AUTO VISAO VISTORIAS LTDA', mun: 'Três Corações', fr: ['Juliana Prado', 'juliana@avtc.com.br', '(35) 99111-0005'], coord: alexandre },
    { key: 'itauna', brand: ry, fantasia: 'Royal Itaúna', razao: 'ROYAL ITAUNA VISTORIAS LTDA', mun: 'Itaúna', fr: ['Diego Martins', 'diego@royalitauna.com.br', '(37) 99111-0006'], coord: marina, rt: rt1, expiry: 150 },
    { key: 'paracatu', brand: av, fantasia: 'Auto Visão Paracatu', razao: 'AUTO VISAO PARACATU LTDA', mun: 'Paracatu', fr: ['Helena Castro', 'helena@avparacatu.com.br', '(38) 99111-0007'], coord: alexandre, rt: rt1, expiry: 60 },
  ];
  const S_ = {};
  let seed = 1;
  for (const s of stores) {
    const cnpj = genCnpj(seed++);
    const repCpf = genCpf(100 + seed);
    const address = `Rua das Flores, ${100 + seed * 7}, Centro, ${s.mun}/MG`;
    const id = insert('stores', { brand_id: s.brand, cnpj, razao: s.razao, fantasia: s.fantasia, address, cep: '37400-000', municipio_ibge: mun(s.mun), situacao_cadastral: 'ATIVA',
      coordinator_id: s.coord, status: 'ativa', rep_name: s.fr[0], rep_cpf: repCpf, rep_role: 'Sócio(a)-administrador(a)', contact_email: s.fr[1], contact_phone: s.fr[2], rt_id: s.rt || null,
      cred_expiry: s.expiry ? new Date(Date.now() + s.expiry * 86400000).toISOString().slice(0, 10) : null, cnpj_source: 'Base de demonstração', cnpj_checked_at: now(),
      cnpj_data: S({ razao: s.razao, fantasia: s.fantasia, situacao: 'ATIVA', qsa: [{ nome: s.fr[0].toUpperCase(), qualificacao: 'Sócio-Administrador', cpfMascarado: '***' + repCpf.slice(3, 9) + '**' }] }), created_at: now() });
    const fu = U(s.fr[0], ['loja'], { email: s.fr[1], phone: s.fr[2], terms_accepted_at: s.key === 'varginha' || s.key === 'lavras' ? null : now() });
    run("INSERT INTO store_users (store_id, user_id, kind) VALUES (?,?,'loja')", id, fu);
    S_[s.key] = { id, user: fu, cnpj, repCpf, store: one('SELECT * FROM stores WHERE id=?', id) };
    SV.registerDemoCnpj(cnpj, { razao: s.razao, fantasia: s.fantasia, situacao: 'ATIVA', logradouro: 'Rua das Flores', numero: String(100 + seed * 7), bairro: 'Centro', cep: '37400000', municipio: s.mun, uf: 'MG', ibge: mun(s.mun), cnae: 'Serviços de vistoria veicular', natureza: 'Sociedade Empresária Limitada', qsa: [{ nome: s.fr[0].toUpperCase(), qualificacao: 'Sócio-Administrador' }], telefone: s.fr[2], email: s.fr[1] });
  }
  // CNPJs fictícios extras para testar o cadastro automático
  SV.registerDemoCnpj(genCnpj(901), { razao: 'NOVA UNIDADE VISTORIAS LTDA', fantasia: 'Auto Visão Alfenas', situacao: 'ATIVA', logradouro: 'Av. Governador Valadares', numero: '1200', bairro: 'Centro', cep: '37130000', municipio: 'Alfenas', uf: 'MG', ibge: mun('Alfenas'), cnae: 'Serviços de vistoria veicular', natureza: 'Sociedade Empresária Limitada', qsa: [{ nome: 'MARCOS VINICIUS ALVES', qualificacao: 'Sócio-Administrador' }, { nome: 'LUCIANA ALVES', qualificacao: 'Sócio' }] });
  SV.registerDemoCnpj(genCnpj(902), { razao: 'VISTORIAS BAIXADAS LTDA', fantasia: 'Detran Vistorias', situacao: 'BAIXADA', logradouro: 'Rua A', numero: '1', municipio: 'Formiga', uf: 'MG', ibge: mun('Formiga'), qsa: [] });
  fs.writeFileSync(path.join(require('./db').DATA_DIR, 'demo-cnpjs.json'), JSON.stringify({ alfenas: genCnpj(901), baixada: genCnpj(902) }));

  const mk = (key, process_type, status, extra = {}) => {
    const s = S_[key];
    const store = one('SELECT * FROM stores WHERE id=?', s.id);
    const code = `${store.brand_id === av ? 'AV' : 'RY'}${{ credenciamento: 'C', renovacao: 'R' }[process_type]}-26-${String(s.id).padStart(4, '0')}${extra.suffix || ''}`;
    return insert('laudos', { store_id: s.id, code, process_type, deadline: new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10), status, version: 0, data: S({ items: {}, empresa: {} }), reviews: S({}), alerts_just: S({}),
      rt_id: store.rt_id, coordinator_id: store.coordinator_id, params_version: 1, requested_by: petala, created_at: new Date(Date.now() - (extra.age || 10) * 86400000).toISOString(), updated_at: now(),
      last_activity_at: new Date(Date.now() - (extra.idle || 1) * 86400000).toISOString() });
  };
  console.log('  Gerando dados de demonstração (fotos sintéticas)…');
  // Campanha — completo, pronto para enviar
  const lC = mk('campanha', 'credenciamento', 'em_preenchimento', { idle: 2 });
  await completeLaudo({ laudoId: lC, store: S_.campanha.store, userId: S_.campanha.user, cfg: { boxesLeves: 2, pesados: false, boxesPesados: 0, movel: true, porte: 'pequeno' } });
  // Varginha — não iniciado, link não aberto
  mk('varginha', 'credenciamento', 'nao_iniciado', { idle: 9 });
  // Lavras — não iniciado
  mk('lavras', 'credenciamento', 'nao_iniciado', { idle: 12 });
  // Três Corações — em preenchimento parcial
  const lT = mk('tres', 'credenciamento', 'em_preenchimento', { idle: 6 });
  update('laudos', lT, { data: S({ etapa1: { boxesLeves: 3, pesados: false, boxesPesados: 0, movel: true, elevacao: ['macaco'], dataPedido: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), savedAt: now() }, empresa: {}, items: { a2_2: { fields: { area: '11', cadeiras: '3', bebedouro: 'sim', ar: 'nao' } }, a2_10: { fields: { largura: '2,60' } } } }) });
  for (const [it, slot, cap] of [['a2_1', 'frontal', 'Placa de frente'], ['a2_2', 'geral1', 'Ambiente (cadeiras)'], ['a2_10', 'trena', 'Área de circulação com trena']]) await addPhoto({ laudoId: lT, item: it, slot, caption: cap, userId: S_.tres.user });
  // Itaúna (médio, 3 leves + 1 pesado) — completo e enviado: aguardando conferência
  const lI = mk('itauna', 'credenciamento', 'aguardando_conferencia', { idle: 1 });
  await completeLaudo({ laudoId: lI, store: S_.itauna.store, userId: S_.itauna.user, cfg: { boxesLeves: 3, pesados: true, boxesPesados: 1, movel: true, porte: 'medio' } });
  {
    const d = J(one('SELECT data FROM laudos WHERE id=?', lI).data);
    d.veracidade = { by: 'Diego Martins', at: now(), text: 'Declaração de veracidade (demonstração).' };
    // rampas não servem ao box pesado: cadastra fosso para o pesado (R25)
    d.etapa1.elevacao = ['rampas', 'fosso'];
    update('laudos', lI, { data: S(d), submitted_at: now() });
    const eid = insert('equipment', { store_id: S_.itauna.id, type: 'elevacao', subtype: 'fosso', description: 'Fosso de inspeção', brand: 'Obra civil', model: '—', serial: 'FOSSO-01', patrimonio: '900', box: 'P1', specs: S({ largura: 80, altura: 1.6, comprimento: 10.5, protecao: 10, escada: 'sim', iluminacao: 'sim', centralizado: 'sim' }), status: 'ativo', confirmed_at: now(), created_at: now(), updated_at: now() });
    for (const s of C.equipmentPhotoSlots('elevacao')) await addPhoto({ laudoId: null, item: 'eq:' + eid, slot: s.slot, caption: s.label, userId: S_.itauna.user });
    const fakeReq = { user: one('SELECT * FROM users WHERE id=?', S_.itauna.user), headers: {}, socket: {} };
    require('./laudo').makeVersion(fakeReq, lI, 'Envio para conferência');
  }
  // Pouso Alegre (médio, 4 leves) — devolvido com pendências
  const lP = mk('pouso', 'credenciamento', 'devolvido', { idle: 4 });
  await completeLaudo({ laudoId: lP, store: S_.pouso.store, userId: S_.pouso.user, cfg: { boxesLeves: 4, pesados: false, boxesPesados: 0, movel: true, porte: 'medio' } });
  {
    const rv = {};
    for (const it of C.ALL_ITEMS) if (it.key !== 'a2_8' && it.key !== 'a3_8') rv[it.key] = { status: 'aprovado', by: 'Alexandre Souza', at: now(), stage: 'coord', history: [{ decision: 'aprovar', by: 'Alexandre Souza', at: now() }] };
    rv.a2_7 = { status: 'devolvido', reason: 'Medida não visível na foto', comment: 'Refazer a foto da largura do box 2 com a trena legível.', by: 'Alexandre Souza', at: now(), stage: 'coord', history: [{ decision: 'devolver', reason: 'Medida não visível na foto', by: 'Alexandre Souza', at: now() }] };
    rv.a3_5 = { status: 'devolvido', reason: 'Certificado não corresponde ao equipamento', comment: 'O certificado anexado ao paquímetro #021 é de outro número de série.', by: 'Alexandre Souza', at: now(), stage: 'coord', history: [{ decision: 'devolver', reason: 'Certificado não corresponde ao equipamento', by: 'Alexandre Souza', at: now() }] };
    const d = J(one('SELECT data FROM laudos WHERE id=?', lP).data);
    d.veracidade = { by: 'Renata Figueiredo', at: now() };
    update('laudos', lP, { reviews: S(rv), data: S(d), submitted_at: new Date(Date.now() - 5 * 86400000).toISOString(), version: 0 });
    const fakeReq = { user: one('SELECT * FROM users WHERE id=?', alexandre), headers: {}, socket: {} };
    require('./laudo').makeVersion(fakeReq, lP, 'Envio para conferência');
    require('./laudo').makeVersion(fakeReq, lP, 'Devolvido com pendências');
  }
  // Paracatu — deferido no ano passado; vence em 60 dias (a rotina cria a renovação)
  const lD = mk('paracatu', 'credenciamento', 'deferido', { age: 400, idle: 365 });
  update('laudos', lD, { data: S({ etapa1: { boxesLeves: 2, pesados: false, boxesPesados: 0, movel: true, elevacao: ['macaco'], savedAt: now() }, empresa: { razao: S_.paracatu.store.razao, fantasia: S_.paracatu.store.fantasia, repName: S_.paracatu.store.rep_name, repCpf: S_.paracatu.store.rep_cpf, repRole: S_.paracatu.store.rep_role }, items: {} }),
    result: S({ result: 'deferido', portaria: 'Portaria CET-MG nº 0999/2025', validade: S_.paracatu.store.cred_expiry, at: now() }) });

  // mensagens de exemplo na caixa de saída
  SV.notify({ channel: 'whatsapp', to: '(35) 99111-0002', toName: 'Carlos Menezes', subject: 'Royal · Laudo da unidade Royal Varginha', body: 'Olá, Carlos! A Royal solicitou o preenchimento do laudo de credenciamento.', brandId: ry, storeId: S_.varginha.id, kind: 'convite' });
  console.log('  Dados de demonstração prontos.\n');
}

module.exports = { ensureSeed, genCnpj, genCpf, fakePhoto };
