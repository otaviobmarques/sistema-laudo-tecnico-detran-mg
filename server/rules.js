// Motor de validação. Bloqueante (B) impede o envio; Alerta (A) exige justificativa.
const { one, all, J } = require('./db');
const C = require('./catalog');

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const fmt = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sim = (v) => v === true || v === 'sim' || v === 'S' || v === 1;
const nao = (v) => v === false || v === 'nao' || v === 'N' || v === 0;
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function getParams(version) {
  const row = version ? one('SELECT * FROM params WHERE version=?', version) : one('SELECT * FROM params ORDER BY version DESC LIMIT 1');
  const merge = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] && typeof a[k] === 'object' ? a[k] : {}, v) : v; return a; };
  const p = merge(JSON.parse(JSON.stringify(C.DEFAULT_PARAMS)), row ? J(row.data, {}) : {});
  p._version = row ? row.version : 0;
  C.applyCalibration(p);
  return p;
}

function storePorte(store) {
  if (!store) return { porte: null, source: null };
  if (store.porte_override) return { porte: store.porte_override, source: 'Ajuste do Administrador (loja)' };
  const m = one('SELECT * FROM municipalities WHERE ibge=?', store.municipio_ibge);
  if (!m) return { porte: null, source: null, municipio: null };
  if (m.porte_override) return { porte: m.porte_override, source: 'Ajuste do Administrador (município)', municipio: m };
  if (m.porte_cet) return { porte: m.porte_cet, source: 'Lista da CET-MG', municipio: m };
  const pop = m.pop2024 || m.pop2022;
  return { porte: C.porteFromPop(pop) || 'pequeno', source: pop ? 'Tabela IBGE (reserva)' : 'Sem população carregada (padrão pequeno)', municipio: m };
}

function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.substr(i, 2), 16) ^ parseInt(b.substr(i, 2), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Carrega tudo o que as regras precisam
function buildContext(laudoId) {
  const laudo = one('SELECT * FROM laudos WHERE id=?', laudoId);
  if (!laudo) return null;
  const store = one('SELECT * FROM stores WHERE id=?', laudo.store_id);
  const data = J(laudo.data, {});
  const params = getParams(laudo.params_version);
  const { porte, source: porteSource, municipio } = storePorte(store);
  const cfg = data.etapa1 || {};
  const photos = all('SELECT * FROM photos WHERE laudo_id=? AND deleted_at IS NULL ORDER BY id', laudoId);
  const files = all('SELECT * FROM files WHERE (laudo_id=? OR (store_id=? AND laudo_id IS NULL)) AND deleted_at IS NULL ORDER BY id', laudoId, laudo.store_id);
  const equipment = all("SELECT * FROM equipment WHERE store_id=? AND deleted_at IS NULL AND status<>'baixado' ORDER BY type, id", laudo.store_id)
    .map((e) => ({ ...e, specs: J(e.specs, {}), cert: J(e.cert, null), photosArr: [] }));
  const eqPhotos = equipment.length
    ? all(`SELECT * FROM photos WHERE item IN (${equipment.map(() => '?').join(',')}) AND deleted_at IS NULL`, ...equipment.map((e) => 'eq:' + e.id))
    : [];
  for (const p of eqPhotos) { const e = equipment.find((x) => 'eq:' + x.id === p.item); if (e) e.photosArr.push(p); }
  const rt = laudo.rt_id ? one('SELECT * FROM rts WHERE id=?', laudo.rt_id) : null;
  return { laudo, store, data, params, porte, porteSource, municipio, cfg, photos, files, equipment, eqPhotos, rt,
    reviews: J(laudo.reviews, {}), alertsJust: J(laudo.alerts_just, {}) };
}

function evaluate(ctx) {
  const issues = [];
  const add = (code, type, item, msg, detail = '', stage = 'submit') => issues.push({ id: `${code}:${item || '-'}:${detail}`, code, type, item, msg, stage });
  const { params: P, porte, cfg, data, store, laudo } = ctx;
  const D = P.dimensoes;
  const items = data.items || {};
  const fieldsOf = (k) => (items[k] && items[k].fields) || {};
  const L = +cfg.boxesLeves || 0, Pz = cfg.pesados ? +cfg.boxesPesados || 0 : 0, totalBoxes = L + Pz;
  const scope = C.itemsInScope(laudo, cfg).map((i) => i.key);
  const inScope = (k) => scope.includes(k);
  const dataPedido = cfg.dataPedido ? new Date(cfg.dataPedido) : new Date();

  // ---- Cadastro / processo ----
  if (store) {
    if (store.situacao_cadastral && norm(store.situacao_cadastral) !== 'ativa')
      add('R26', 'B', null, `Situação cadastral do CNPJ é "${store.situacao_cadastral}" — precisa estar ATIVA.`);
    if (!ctx.municipio) add('R26', 'B', null, 'Município da loja não encontrado na lista de Minas Gerais.', 'mun');
    const emp = data.empresa || {};
    const fantasia = emp.fantasia ?? store.fantasia;
    if (/\b(detran|cet|seplag)\b/.test(norm(fantasia))) add('R14', 'B', null, `Nome fantasia "${fantasia}" não pode conter Detran, CET ou Seplag (art. 8º §3º).`, 'fantasia');
    if (!(emp.repName || store.rep_name) || !(emp.repCpf || store.rep_cpf)) add('E01', 'B', null, 'Informe nome e CPF do representante legal.', 'rep');
    else if (!validCPF(emp.repCpf || store.rep_cpf)) add('E01', 'B', null, 'CPF do representante legal inválido.', 'repcpf');
  }
  if (!laudo.rt_id) add('E02', 'B', null, 'Indique o responsável técnico (engenheiro ou arquiteto).', 'rt');
  if (!cfg.savedAt) add('E03', 'B', null, 'Salve a Etapa 1 (dados do processo e configuração da unidade).', 'etapa1');
  if (!cfg.dataPedido) add('E03', 'B', null, 'Informe a data prevista do pedido.', 'dataPedido');
  if (!(cfg.elevacao || []).length) add('E03', 'B', 'a3_1', 'Escolha o(s) equipamento(s) de elevação utilizado(s).', 'elev');
  if (porte) {
    const [mn, mx] = P.porte.boxesLeves[porte];
    if (L < mn || L > mx) add('R01', 'B', 'a2_7', `Porte ${C.PORTE_LABEL[porte].toLowerCase()} exige de ${mn} a ${mx} boxes de veículos leves (informado: ${L}).`);
    if (cfg.pesados && (Pz < 1 || Pz > P.porte.boxesPesados[porte])) add('R02', 'B', 'a2_8', `Porte ${C.PORTE_LABEL[porte].toLowerCase()} permite até ${P.porte.boxesPesados[porte]} box(es) de pesados (informado: ${Pz}).`);
  }
  if (laudo.process_type === 'renovacao') {
    if (!cfg.vencimentoAtual) add('E03', 'B', null, 'Informe a data de vencimento do credenciamento atual (obrigatória na renovação).', 'venc');
    else {
      const limite = new Date(cfg.vencimentoAtual); limite.setDate(limite.getDate() - P.prazos.renovacaoAntecedenciaDias);
      if (dataPedido > limite) add('R21', 'A', null, `Renovação deve ser solicitada até ${P.prazos.renovacaoAntecedenciaDias} dias antes do vencimento (art. 36). Limite: ${limite.toLocaleDateString('pt-BR')}.`);
    }
  }

  // ---- Documentos (Bloco A) ----
  const hasFile = (kind) => ctx.files.some((f) => f.kind === kind);
  const needsA2 = scope.some((k) => k.startsWith('a2_'));
  if (needsA2 && !hasFile('planta')) add('D01', 'B', null, 'Envie a planta ou croqui do imóvel com cotas (Bloco A).', 'planta');
  if (inScope('a2_5') && !hasFile('incendio')) add('D02', 'A', 'a2_5', 'Documentos de prevenção e combate a incêndio não anexados (confirmar com o RT).', 'docinc');

  // ---- Fotos: presença (R16), qualidade, GPS e data (C11), repetição (C07) ----
  const photosBy = (item) => ctx.photos.filter((p) => p.item === item);
  for (const k of scope) {
    const it = items[k] || {};
    if (it.na) {
      // C09 — item marcado "não aplicável" quando o porte exige
      const optional = (k === 'a2_6' && !P.porte.vagasExigidas[porte]);
      if (!optional) add('C09', 'B', k, 'Item marcado como "Não aplicável", mas a regra do porte exige este item.');
      continue;
    }
    if (k === 'a2_6' && !P.porte.vagasExigidas[porte]) continue;
    const slots = C.photoSlots(k, cfg, fieldsOf(k)).filter((s) => !s.optional);
    const ph = photosBy(k);
    const missing = slots.filter((s) => !ph.some((p) => p.slot === s.slot));
    if (missing.length) add('R16', 'B', k, `Faltam ${missing.length} foto(s): ${missing.slice(0, 4).map((s) => s.label).join(', ')}${missing.length > 4 ? '…' : ''}.`, 'fotos');
    if (k.startsWith('a2_')) {
      const hasPlant = (it.plantRect && hasFile('planta')) || ph.some((p) => p.slot === 'planta');
      if (!hasPlant) add('R16', 'B', k, 'Marque o item na planta do imóvel ou envie a imagem de localização.', 'planta');
    }
  }
  const P_ = P.arquivos;
  const allPh = [...ctx.photos, ...ctx.eqPhotos];
  for (const p of ctx.photos) {
    if (p.brightness != null && (p.brightness < P_.brilhoMin || p.brightness > P_.brilhoMax)) add('F01', 'A', p.item, `Foto "${p.caption || p.slot}" muito ${p.brightness < P_.brilhoMin ? 'escura' : 'clara'}.`, 'b' + p.id);
    if (p.sharpness != null && p.sharpness < P_.nitidezMin) add('F02', 'A', p.item, `Foto "${p.caption || p.slot}" parece borrada.`, 's' + p.id);
    if (Math.max(p.width || 0, p.height || 0) < P_.fotoMinPx) add('F03', 'A', p.item, `Foto "${p.caption || p.slot}" com resolução abaixo de ${P_.fotoMinPx} px no maior lado.`, 'r' + p.id);
    if (p.taken_at) {
      const age = (Date.now() - new Date(p.taken_at)) / 86400000;
      if (age > P_.fotoIdadeMaxDias) add('C11', 'A', p.item, `Foto "${p.caption || p.slot}" tirada há ${Math.floor(age)} dias (máximo ${P_.fotoIdadeMaxDias}).`, 'd' + p.id);
    }
    const ref = ctx.data.geo;
    if (p.lat != null && ref && ref.lat != null) {
      const dist = haversine(p.lat, p.lng, ref.lat, ref.lng);
      if (dist > P_.gpsRaioM) add('C11', 'A', p.item, `Foto "${p.caption || p.slot}" com GPS a ${Math.round(dist)} m do endereço da unidade (raio ${P_.gpsRaioM} m).`, 'g' + p.id);
    }
  }
  for (let i = 0; i < allPh.length; i++) for (let j = i + 1; j < allPh.length; j++) {
    const a = allPh[i], b = allPh[j];
    if (a.item === b.item && a.slot === b.slot) continue;
    if (a.sha === b.sha || hamming(a.dhash, b.dhash) <= 3) {
      const it = a.item.startsWith('eq:') ? b.item : a.item;
      add('C07', 'B', it.startsWith('eq:') ? null : it, `A mesma foto foi usada em dois lugares ("${a.caption || a.slot}" e "${b.caption || b.slot}").`, `${a.id}-${b.id}`);
    }
  }

  // ---- Anexo II: regras dimensionais ----
  const f = fieldsOf;
  if (inScope('a2_1') && !items.a2_1?.na) {
    const x = f('a2_1');
    const reqs = [['backlight', 'backlight'], ['acrilico', 'acrílico branco'], ['plotter', 'grafismo em plotter de recorte'], ['modeloAnexoI', 'modelo conforme Anexo I']];
    const fails = reqs.filter(([k]) => !sim(x[k]));
    const tombada = sim(x.tombada) && x.tombadaJust && ctx.files.some((fl) => fl.kind === 'dgcv');
    if (fails.length && !tombada) {
      const renov = laudo.process_type === 'renovacao' && sim(x.placaAnterior);
      add('R13', renov ? 'A' : 'B', 'a2_1', renov
        ? `Placa do modelo anterior (troca gradual permitida, art. 19 §4º). Pendente: ${fails.map((r) => r[1]).join(', ')}.`
        : `Placa fora do padrão: ${fails.map((r) => r[1]).join(', ')}.`);
    }
    if (!x.local) add('R13', 'B', 'a2_1', 'Informe o local de fixação da placa.', 'local');
    if (sim(x.tombada) && !tombada) add('R13', 'B', 'a2_1', 'Edificação tombada/regra municipal: anexe a justificativa e a aprovação da DGCV (art. 19 §3º).', 'dgcv');
    if (sim(x.placaDetran)) add('R14', 'B', 'a2_1', 'A placa não pode trazer nome ou logo do Detran-MG (art. 8º §3º).', 'placa');
  }
  if (inScope('a2_2') && !items.a2_2?.na) {
    const x = f('a2_2'), area = num(x.area), min = D.recepcaoBase + D.recepcaoPorBox * totalBoxes;
    if (area == null) add('R03', 'B', 'a2_2', 'Informe a área total da recepção.', 'v');
    else if (area < min) add('R03', 'B', 'a2_2', `Área da recepção ${fmt(area)} m² abaixo do mínimo de ${fmt(min)} m² (10 m² + 1 m² por box).`);
    const cad = num(x.cadeiras);
    if (cad == null) add('R04', 'B', 'a2_2', 'Informe o número de cadeiras.', 'v');
    else if (cad < totalBoxes) add('R04', 'B', 'a2_2', `Cadeiras (${cad}) abaixo do total de boxes (${totalBoxes}).`);
    if (!sim(x.bebedouro) || !sim(x.ar)) add('R05', 'B', 'a2_2', 'Bebedouro e ar-condicionado são obrigatórios na recepção.');
    checkDescricao(add, 'a2_2', items.a2_2?.descricao, area);
  }
  if (inScope('a2_3') && !items.a2_3?.na) {
    const x = f('a2_3'), area = num(x.area);
    if (area == null) add('R06', 'B', 'a2_3', 'Informe a área da sala de administração.', 'v');
    else if (area < D.salaAdm) add('R06', 'B', 'a2_3', `Sala de administração com ${fmt(area)} m², abaixo de ${fmt(D.salaAdm)} m².`);
    if (!sim(x.mobilia)) add('R06', 'B', 'a2_3', 'Sala de administração deve ter mobília.', 'mob');
    checkDescricao(add, 'a2_3', items.a2_3?.descricao, area);
  }
  if (inScope('a2_4') && !items.a2_4?.na && porte) {
    const x = f('a2_4'), n = num(x.banheiros), ac = num(x.acessiveis), min = P.porte.banheirosMin[porte];
    if (n == null || n < min) add('R07', 'B', 'a2_4', `Porte ${C.PORTE_LABEL[porte].toLowerCase()} exige ao menos ${min} banheiro(s) (informado: ${n ?? '—'}).`);
    if (!(ac >= 1)) add('R07', 'B', 'a2_4', 'É preciso ao menos 1 banheiro acessível.', 'ac');
    if (!sim(x.nbr9050)) add('R07', 'B', 'a2_4', 'Banheiro acessível deve atender à NBR 9050:2020.', 'nbr');
  }
  if (inScope('a2_5') && !items.a2_5?.na) {
    const ex = f('a2_5').extintores || [];
    if (!ex.length) add('R16', 'B', 'a2_5', 'Cadastre os equipamentos de combate a incêndio (tipo, local e validade).', 'lista');
    ex.forEach((e, i) => {
      if (!e.tipo || !e.local || !e.validade) add('R16', 'B', 'a2_5', `Extintor ${i + 1}: preencha tipo, local e validade.`, 'e' + i);
      else if (new Date(e.validade) < dataPedido) add('A05', 'A', 'a2_5', `Extintor ${i + 1} (${e.tipo}) com validade ${new Date(e.validade).toLocaleDateString('pt-BR')} anterior à data do pedido.`, 'v' + i);
    });
  }
  if (inScope('a2_6') && porte && P.porte.vagasExigidas[porte] && !items.a2_6?.na) {
    const vagas = f('a2_6').vagas || [], min = Math.ceil(L / 2);
    if (vagas.length < min) add('R08', 'B', 'a2_6', `São exigidas ${min} vaga(s) de espera (metade dos ${L} boxes leves); informadas: ${vagas.length}.`);
    vagas.forEach((v, i) => {
      const c = num(v.comprimento), l = num(v.largura);
      if (c == null || l == null) add('R08', 'B', 'a2_6', `Vaga ${i + 1}: informe comprimento e largura.`, 'v' + i);
      else if (c < D.vaga.c || l < D.vaga.l) add('R08', 'B', 'a2_6', `Vaga ${i + 1} com ${fmt(c)} × ${fmt(l)} m, abaixo de ${fmt(D.vaga.c, 1)} × ${fmt(D.vaga.l, 1)} m.`, 'd' + i);
    });
  }
  const checkBoxes = (k, pref, n, dim, code, coberturaObrig) => {
    const boxes = f(k).boxes || {};
    for (let i = 1; i <= n; i++) {
      const b = boxes[pref + i] || {}, lb = C.boxLabel(pref + i);
      const c = num(b.comprimento), l = num(b.largura), h = num(b.altura);
      if (c == null || l == null || h == null) { add(code, 'B', k, `${lb}: informe comprimento, largura e altura.`, pref + i + 'v'); continue; }
      const fails = [];
      if (c < dim.c) fails.push(`comprimento ${fmt(c)} m < ${fmt(dim.c)} m`);
      if (l < dim.l) fails.push(`largura ${fmt(l)} m < ${fmt(dim.l)} m`);
      if (h < dim.h) fails.push(`altura ${fmt(h)} m < ${fmt(dim.h)} m`);
      if (fails.length) add(code, 'B', k, `${lb}: ${fails.join('; ')}.`, pref + i + 'd');
      if (coberturaObrig && !sim(b.coberto)) add(code, 'B', k, `${lb} precisa ser coberto.`, pref + i + 'c');
    }
  };
  if (inScope('a2_7') && !items.a2_7?.na) checkBoxes('a2_7', 'L', L, D.boxLeve, 'R09', true);
  if (inScope('a2_8') && cfg.pesados && !items.a2_8?.na) checkBoxes('a2_8', 'P', Pz, D.boxPesado, 'R10', P.porte.coberturaPesadoObrigatoria[porte]);
  if (inScope('a2_9') && !items.a2_9?.na) {
    const ps = f('a2_9').portoes || [];
    if (!ps.length) add('R11', 'B', 'a2_9', 'Cadastre ao menos um portão de acesso.', 'lista');
    ps.forEach((p, i) => {
      const l = num(p.largura), h = num(p.altura), pes = p.tipo === 'pesados';
      const dim = pes ? D.portaoPesado : D.portaoLeve;
      if (l == null || h == null) add('R11', 'B', 'a2_9', `Portão ${i + 1}: informe largura e altura livre.`, 'v' + i);
      else if (l < dim.l || h < dim.h) add('R11', 'B', 'a2_9', `Portão ${i + 1} (${pes ? 'pesados' : 'leves'}) com ${fmt(l)} × ${fmt(h)} m, abaixo de ${fmt(dim.l, 1)} × ${fmt(dim.h)} m.`, 'd' + i);
    });
    if (cfg.pesados && ps.length && !ps.some((p) => p.tipo === 'pesados')) add('R11', 'B', 'a2_9', 'A unidade vistoria pesados: informe o portão de acesso dos pesados (≥ 4,0 × 4,50 m).', 'pes');
  }
  if (inScope('a2_10') && !items.a2_10?.na) {
    const l = num(f('a2_10').largura);
    if (l == null) add('R12', 'B', 'a2_10', 'Informe a largura mínima da área de manobra.', 'v');
    else if (l < D.manobra) add('R12', 'B', 'a2_10', `Área de manobra com ${fmt(l)} m, abaixo de ${fmt(D.manobra)} m.`);
  }

  // ---- Anexo III: equipamentos ----
  const Q = C.quantities(cfg);
  const eqOf = (t) => ctx.equipment.filter((e) => e.type === t);
  const boxes = C.boxesList(cfg);
  for (const it of C.A3) {
    if (!inScope(it.key) || !it.eqType) continue;
    const list = eqOf(it.eqType), need = Q[it.eqType] || 0;
    const active = list.filter((e) => e.status === 'ativo');
    if (active.length < need) add('R24', 'B', it.key, `Quantidade mínima: ${need} (cadastrados ativos: ${active.length}).`, 'q');
    for (const e of list) {
      const nm = `${it.short} ${e.patrimonio ? '#' + e.patrimonio : '(sem patrimônio)'}`;
      if (e.status !== 'ativo') add('C12', 'B', it.key, `${nm} está "${e.status === 'manutencao' ? 'Em manutenção' : e.status}". Só equipamento ativo pode ir para o laudo — baixe ou reative.`, 'st' + e.id);
      if (laudo.parent_laudo_id && e.status === 'ativo' && (!e.confirmed_at || e.confirmed_at < laudo.created_at)) add('E12', 'B', it.key, `${nm}: confirme que o equipamento continua no local (reaproveitado do laudo anterior).`, 'conf' + e.id);
      if (!e.patrimonio) add('E10', 'B', it.key, `${nm}: número de patrimônio obrigatório.`, 'pat' + e.id);
      if (it.serial && !e.serial) add('E10', 'B', it.key, `${nm}: número de série obrigatório.`, 'ser' + e.id);
      if (!e.description && !e.brand) add('E10', 'B', it.key, `${nm}: informe descrição, marca e modelo.`, 'desc' + e.id);
      if (it.perBox && !e.box) add('E11', 'B', it.key, `${nm}: vincule o equipamento a um box (ou à vistoria móvel).`, 'box' + e.id);
      const slots = C.equipmentPhotoSlots(e.type);
      const miss = slots.filter((s) => !e.photosArr.some((p) => p.slot === s.slot));
      if (miss.length) add(it.cal && miss.some((m) => m.slot === 'calibracao') ? 'R20' : 'R16', 'B', it.key, `${nm}: faltam fotos (${miss.map((m) => m.label).join(', ')}).`, 'ph' + e.id);
      if (it.cal) {
        const ct = e.cert;
        const certFile = ctx.files.some((fl) => fl.kind === 'certificado' && fl.equipment_id === e.id);
        if (!ct || !ct.numero || !ct.validade || !certFile) add('R20', 'B', it.key, `${nm}: anexe o certificado de calibração (número, validade e PDF).`, 'cert' + e.id);
        else {
          const val = new Date(ct.validade);
          if (val < dataPedido) add('C06', 'B', it.key, `${nm}: certificado ${ct.numero} vencido em ${val.toLocaleDateString('pt-BR')} (antes da data do pedido).`, 'venc' + e.id);
          else if ((val - dataPedido) / 86400000 < P.calibracao.alertaDias) add('C06', 'A', it.key, `${nm}: certificado ${ct.numero} vence em ${val.toLocaleDateString('pt-BR')} (menos de ${P.calibracao.alertaDias} dias após o pedido).`, 'avenc' + e.id);
          if (/reprov|nao calibr|não calibr|nao ligou|não ligou/.test(norm(ct.resultado || '') + ' ' + norm(ct.obs || ''))) add('C05', 'B', it.key, `${nm}: certificado com resultado "${ct.resultado}".`, 'res' + e.id);
          const faixa = num(ct.faixaMax);
          if (it.faixaMin && faixa != null && faixa < it.faixaMin) add('C04', 'B', it.key, `${nm}: faixa do certificado (0–${faixa.toLocaleString('pt-BR')} mm) não cobre ${(it.faixaMin / 1000).toLocaleString('pt-BR')} m.`, 'fx' + e.id);
          if (ct.ocr && ct.ocr.divergencias && ct.ocr.divergencias.length) add('C04', 'A', it.key, `${nm}: leitura do certificado diverge do cadastro (${ct.ocr.divergencias.join('; ')}).`, 'ocr' + e.id);
        }
      }
      // Especificações técnicas
      const s = e.specs || {};
      if (e.type === 'camera_fixa' || e.type === 'boroscopio') {
        const [w, h] = P.equipamentos.cameraResolucao;
        if (!(num(s.resW) >= w && num(s.resH) >= h)) add('R17', 'B', it.key, `${nm}: resolução ${s.resW || '?'} × ${s.resH || '?'} abaixo de ${w} × ${h} px.`, 'res' + e.id);
      }
      if (e.type === 'servidor') {
        if (!(num(s.ram) >= P.equipamentos.servidorRam) || !(num(s.disco) >= P.equipamentos.servidorDisco) || !/i[5-9]|ryzen ?[5-9]|xeon|similar|m[1-9]/.test(norm(s.cpu)))
          add('R19', 'B', it.key, `Servidor precisa de Core i5 ou similar, ${P.equipamentos.servidorRam} GB RAM e ${P.equipamentos.servidorDisco} TB (informado: ${s.cpu || '?'}, ${s.ram || '?'} GB, ${s.disco || '?'} TB).`, 'sv' + e.id);
        if (!sim(s.exclusivo)) add('R19', 'B', it.key, 'Servidor deve ser de uso exclusivo.', 'ex' + e.id);
      }
      if (e.type === 'nobreak' && !(num(s.va) >= P.equipamentos.nobreakVA)) add('R19', 'B', it.key, `Nobreak com ${s.va || '?'} VA, abaixo de ${P.equipamentos.nobreakVA} VA.`, 'nb' + e.id);
      if (e.type === 'roteador' && !sim(s.portas)) add('R19', 'B', it.key, 'Roteador deve ter redirecionamento de portas.', 'rt' + e.id);
      if (e.type === 'elevacao') checkElevacao(add, e, s, D, cfg);
    }
    // perBox: cada box com um equipamento
    if (it.perBox && it.eqType !== 'trena5' && it.eqType !== 'trena50') {
      for (const b of boxes) if (!active.some((e) => e.box === b)) add('E11', 'B', it.key, `${C.boxLabel(b)} sem ${it.short.toLowerCase()} vinculado.`, 'pb' + b);
    }
    // vídeos (R17 / R16)
    if (it.video) {
      const vids = (items[it.key] && items[it.key].videos) || {};
      for (const e of active) {
        const v = vids[e.id];
        const nm = `${it.short} #${e.patrimonio || e.id}`;
        if (!v || !v.url) add(it.eqType === 'camera_fixa' ? 'R17' : 'R16', 'B', it.key, `${nm}: informe o link do vídeo (Google Drive).`, 'vid' + e.id);
        else if (v.test && v.test.status === 'fail') add('V01', 'B', it.key, `${nm}: o link do vídeo não abre sem login. Libere "qualquer pessoa com o link".`, 'vt' + e.id);
        else if (!v.test || v.test.status !== 'ok') add('V02', 'A', it.key, `${nm}: não foi possível confirmar o acesso público ao vídeo.`, 'vu' + e.id);
      }
    }
  }
  // R25 — elevador não pode ser o equipamento de elevação do box pesado
  if (cfg.pesados && inScope('a3_1')) {
    const elev = eqOf('elevacao').filter((e) => e.status === 'ativo');
    const paraPesado = elev.filter((e) => (e.box || '').startsWith('P'));
    const candidatos = paraPesado.length ? paraPesado : elev;
    if (candidatos.length && candidatos.every((e) => e.subtype === 'elevador')) add('R25', 'B', 'a3_1', 'O elevador automotivo não pode ser o equipamento de elevação do box pesado (art. 34 §7º).');
  }
  if (inScope('a3_1')) for (const op of cfg.elevacao || []) {
    if (!eqOf('elevacao').some((e) => e.subtype === op)) add('R18', 'B', 'a3_1', `Cadastre o equipamento de elevação "${C.ELEVACAO[op]}" indicado na Etapa 1.`, 'op' + op);
  }
  // C01, C02, C03 — duplicidades
  const pats = {}, certs = {};
  for (const e of ctx.equipment) {
    if (e.patrimonio) (pats[e.patrimonio] = pats[e.patrimonio] || []).push(e);
    if (e.cert && e.cert.numero) (certs[e.cert.numero] = certs[e.cert.numero] || []).push(e);
    if (e.serial) {
      const dup = one('SELECT e.id, s.fantasia FROM equipment e JOIN stores s ON s.id=e.store_id WHERE e.type=? AND e.serial=? AND e.id<>? AND e.deleted_at IS NULL LIMIT 1', e.type, e.serial, e.id);
      if (dup) add('C01', 'B', itemByType(e.type), `Nº de série ${e.serial} duplicado (${C.EQ_TYPES[e.type].short}${dup.fantasia ? ' — também em ' + dup.fantasia : ''}).`, 'ser' + e.id);
    }
    if (e.serial && e.patrimonio && /^\d{1,5}$/.test(e.serial) && /[a-z]/i.test(e.patrimonio) && e.patrimonio.length > 6)
      add('C10', 'A', itemByType(e.type), `${C.EQ_TYPES[e.type].short}: série "${e.serial}" e patrimônio "${e.patrimonio}" parecem invertidos.`, 'inv' + e.id);
  }
  for (const [p, l] of Object.entries(pats)) if (l.length > 1) add('C02', 'B', itemByType(l[0].type), `Patrimônio ${p} repetido em ${l.length} equipamentos da unidade.`, 'p' + p);
  for (const [c, l] of Object.entries(certs)) if (l.length > 1) add('C03', 'B', itemByType(l[0].type), `Certificado ${c} vinculado a ${l.length} equipamentos.`, 'c' + c);

  // Itens sem cadastro de equipamento
  if (inScope('a3_3') && !hasFile('doc_boroscopio')) add('R17', 'B', 'a3_3', 'Anexe o documento que comprova a resolução do boroscópio (≥ 800 × 600).', 'doc');
  if (inScope('a3_9')) {
    const ev = photosBy('a3_9').length || (items.a3_9 && items.a3_9.videoUrl);
    if (!ev) add('C13', 'B', 'a3_9', 'Anexe a evidência do reconhecimento facial no sistema de vistoria (print ou vídeo).', 'ev');
  }
  if (inScope('a3_15') && !hasFile('contrato_rede')) add('R16', 'B', 'a3_15', 'Anexe o contrato de rede estruturada de dados (ou documento equivalente).', 'doc');
  if (inScope('a3_17')) {
    if (!hasFile('contrato_internet')) add('R19', 'B', 'a3_17', 'Anexe o contrato de internet.', 'doc');
    const up = num(f('a3_17').upload);
    if (up == null || up < P.equipamentos.uploadMbps) add('R19', 'B', 'a3_17', `Velocidade de upload ${up ?? '—'} Mb/s abaixo de ${P.equipamentos.uploadMbps} Mb/s.`, 'up');
  }

  // ---- Etapas posteriores ----
  const rv = data.rtReview || {};
  const art = ctx.files.filter((x) => x.kind === 'art').pop();
  if (!art) add('R15', 'B', null, 'ART/RRT não anexada pelo responsável técnico.', 'art', 'rt');
  else {
    const meta = J(art.meta, {});
    const ano = (cfg.dataPedido ? new Date(cfg.dataPedido) : new Date()).getFullYear();
    if (+meta.ano !== ano) add('R15', 'B', null, `ART/RRT emitida em ${meta.ano || '?'}; precisa ser de ${ano} (ano do pedido).`, 'artano', 'rt');
    if (ctx.rt && meta.registro && norm(meta.registro).replace(/\W/g, '') !== norm(ctx.rt.reg_number).replace(/\W/g, '')) add('R15', 'B', null, `Nº ${meta.registro} da ART/RRT difere do registro do RT (${ctx.rt.reg_number}).`, 'artreg', 'rt');
  }
  if (!rv.descricao) add('RT1', 'B', null, 'Descrição técnica das instalações e dimensionamentos pendente (RT).', 'desc', 'rt');
  if (!rv.acessibilidade) add('RT2', 'B', null, 'Declaração de acessibilidade do RT pendente (art. 34 §16, "a").', 'acc', 'rt');
  if (ctx.rt && !ctx.rt.validated_at) add('RT3', 'B', null, 'Registro do RT ainda não validado pelo coordenador (CREA/CAU).', 'val', 'rt');

  return issues;
}

function itemByType(t) { const it = C.A3.find((i) => i.eqType === t); return it ? it.key : null; }

function checkDescricao(add, item, descricao, area) {
  if (!descricao || area == null) return;
  const m = String(descricao).match(/(\d+(?:[.,]\d+)?)\s*m(?:²|2)/i);
  if (m) {
    const v = num(m[1]);
    if (v != null && Math.abs(v - area) > 0.05) add('C08', 'A', item, `Descrição cita ${m[0]}, mas o campo de área informa ${fmt(area)} m².`);
  }
}

function checkElevacao(add, e, s, D, cfg) {
  const k = 'a3_1', nm = `${C.ELEVACAO[e.subtype] || 'Elevação'} #${e.patrimonio || e.id}`;
  const fails = [];
  if (!e.subtype) { add('R18', 'B', k, `${nm}: escolha o tipo (elevador, macaco, rampas ou fosso).`, 'tp' + e.id); return; }
  if (e.subtype === 'elevador' && !(num(s.capacidade) >= D.elevador.capacidade)) fails.push(`capacidade ≥ ${D.elevador.capacidade} kg`);
  if (e.subtype === 'macaco') {
    if (!(num(s.capacidade) >= D.macaco.capacidade)) fails.push(`capacidade ≥ ${D.macaco.capacidade} kg`);
    if (!(num(s.elevacao) >= D.macaco.elevacao)) fails.push(`elevação ≥ ${D.macaco.elevacao} mm`);
  }
  if (e.subtype === 'rampas') {
    const r = D.rampas;
    if (!(num(s.elevacao) >= r.elevacao)) fails.push(`elevação ≥ ${r.elevacao} mm`);
    if (!(num(s.largura) >= r.largura)) fails.push(`largura ≥ ${r.largura} mm`);
    if (!(num(s.plana) >= r.plana)) fails.push(`parte plana ≥ ${r.plana} mm`);
    if (!(num(s.inclinacao) <= r.inclinacaoMax)) fails.push(`inclinação ≤ ${r.inclinacaoMax}°`);
    if (!(num(s.carga) >= r.carga)) fails.push(`carga ≥ ${r.carga} kg por rampa`);
    if (!(num(s.protecao) >= r.protecao)) fails.push(`proteção frontal ≥ ${r.protecao} mm`);
    if (!(Math.abs((num(s.distCentros) ?? 0) - r.distCentros) < 0.005)) fails.push(`distância entre centros = ${r.distCentros.toFixed(2).replace('.', ',')} m`);
    for (const [kk, lb] of [['fixacao', 'fixação anti-deslocamento'], ['antiderrapante', 'antiderrapante'], ['semQuinas', 'sem quinas vivas'], ['centralizado', 'centralizado no box']]) if (!sim(s[kk])) fails.push(lb);
  }
  if (e.subtype === 'fosso') {
    const fo = D.fosso, pes = (e.box || '').startsWith('P');
    const lg = num(s.largura), al = num(s.altura), cp = num(s.comprimento);
    if (!(lg >= fo.largMin && lg <= fo.largMax)) fails.push(`largura entre ${fo.largMin} e ${fo.largMax} cm`);
    if (!(al >= fo.altMin && al <= fo.altMax)) fails.push(`altura entre ${fo.altMin} e ${fo.altMax} m`);
    if (!(cp >= (pes ? fo.compPesado : fo.compLeve))) fails.push(`comprimento ≥ ${pes ? fo.compPesado : fo.compLeve} m`);
    if (!(num(s.protecao) >= fo.protecao)) fails.push(`proteção lateral de ${fo.protecao} cm`);
    for (const [kk, lb] of [['escada', 'escada'], ['iluminacao', 'iluminação fixa lateral e móvel'], ['centralizado', 'centralizado']]) if (!sim(s[kk])) fails.push(lb);
  }
  if (fails.length) add('R18', 'B', k, `${nm}: ${fails.join('; ')}.`, 'lim' + e.id);
}

function validCPF(c) {
  c = String(c || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== +c[t]) return false;
  }
  return true;
}
function validCNPJ(c) {
  c = String(c || '').replace(/\D/g, '');
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + x * +c[i], 0);
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === +c[12] && calc(13) === +c[13];
}

// Situação de cada item (para checklist, painel e matriz)
function itemStatuses(ctx, issues) {
  const out = {};
  const cfg = ctx.cfg, items = ctx.data.items || {};
  for (const it of C.itemsInScope(ctx.laudo, cfg)) {
    const k = it.key;
    const errs = issues.filter((i) => i.item === k && i.stage === 'submit');
    const slots = C.photoSlots(k, cfg, (items[k] || {}).fields).filter((s) => !s.optional);
    let done = slots.filter((s) => ctx.photos.some((p) => p.item === k && p.slot === s.slot)).length, req = slots.length;
    if (it.eqType) {
      const eqs = ctx.equipment.filter((e) => e.type === it.eqType);
      for (const e of eqs) {
        const sl = C.equipmentPhotoSlots(e.type);
        req += sl.length; done += sl.filter((s) => e.photosArr.some((p) => p.slot === s.slot)).length;
      }
      const need = C.quantities(cfg)[it.eqType] || 0;
      if (eqs.length < need) req += (need - eqs.length) * C.equipmentPhotoSlots(it.eqType).length;
    }
    const hasData = done > 0 || Object.keys((items[k] || {}).fields || {}).length > 0 || (it.eqType && ctx.equipment.some((e) => e.type === it.eqType));
    const blockers = errs.filter((e) => e.type === 'B');
    let status = 'nao_iniciado';
    if (items[k] && items[k].na) status = blockers.length ? 'erro' : 'completo';
    else if (!hasData && !(k === 'a2_6' && !ctx.params.porte.vagasExigidas[ctx.porte])) status = 'nao_iniciado';
    else if (!blockers.length) status = 'completo';
    else if (blockers.some((b) => !['R16', 'R20', 'R24', 'E10', 'E11', 'R17', 'C13'].includes(b.code) || /abaixo|fora|precisa|vencido|duplicad|repetid|não pode|inválid/.test(b.msg))) status = 'erro';
    else status = 'parcial';
    out[k] = { status, photosDone: done, photosReq: req, errors: blockers.length, alerts: errs.filter((e) => e.type === 'A').length, review: ctx.reviews[k] || null };
  }
  return out;
}

function summarize(laudoId) {
  const ctx = buildContext(laudoId);
  if (!ctx) return null;
  const issues = evaluate(ctx);
  const statuses = itemStatuses(ctx, issues);
  const keys = Object.keys(statuses);
  const completos = keys.filter((k) => statuses[k].status === 'completo').length;
  const submitIssues = issues.filter((i) => i.stage === 'submit');
  return {
    ctx, issues, statuses,
    progress: keys.length ? Math.round((completos / keys.length) * 100) : 0,
    blockers: submitIssues.filter((i) => i.type === 'B'),
    alerts: submitIssues.filter((i) => i.type === 'A'),
  };
}

module.exports = { evaluate, buildContext, summarize, itemStatuses, getParams, storePorte, validCPF, validCNPJ, num, sim, norm, fmt, hamming };
