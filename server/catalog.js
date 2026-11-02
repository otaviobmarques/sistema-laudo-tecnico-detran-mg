// Catálogo normativo: itens dos Anexos II e III, parâmetros padrão, fórmula de quantidades e checklist.
// Base: Portaria CET-MG nº 01524/2025 e Portaria CET-MG nº 1.290/2023 (art. 2º, art. 34).

const DEFAULT_PARAMS = {
  porte: {
    limitePequeno: 100000, limiteMedio: 500000,
    boxesLeves: { pequeno: [2, 4], medio: [2, 8], grande: [2, 16] },
    boxesPesados: { pequeno: 2, medio: 3, grande: 4 },
    banheirosMin: { pequeno: 1, medio: 2, grande: 2 },
    vagasExigidas: { pequeno: false, medio: true, grande: true },
    coberturaPesadoObrigatoria: { pequeno: false, medio: true, grande: true },
  },
  dimensoes: {
    recepcaoBase: 10, recepcaoPorBox: 1, salaAdm: 10,
    boxLeve: { c: 5.5, l: 3.5, h: 3.0 }, boxPesado: { c: 13.0, l: 4.5, h: 4.5 },
    vaga: { c: 5.0, l: 2.5 }, portaoLeve: { l: 3.0, h: 3.0 }, portaoPesado: { l: 4.0, h: 4.5 },
    manobra: 2.5,
    elevador: { capacidade: 2000 }, macaco: { capacidade: 2000, elevacao: 500 },
    rampas: { elevacao: 500, largura: 300, plana: 300, inclinacaoMax: 20, carga: 1000, protecao: 100, distCentros: 1.40 },
    fosso: { largMin: 70, largMax: 90, altMin: 1.5, altMax: 1.7, compLeve: 6.0, compPesado: 10.0, protecao: 10 },
  },
  equipamentos: {
    cameraResolucao: [800, 600], servidorRam: 8, servidorDisco: 1, nobreakVA: 800, uploadMbps: 1,
    // Quais equipamentos exigem certificado de calibração (ajustável em Parâmetros, conforme a Portaria)
    calibracao: { elevacao: false, camera_fixa: false, boroscopio: false, smartphone: false, paquimetro: true, profundimetro: true,
      trena5: true, trena50: true, engate: false, espessura: true, lanterna_uv: false, servidor: false, nobreak: false, roteador: false },
  },
  calibracao: { validadeMeses: 12, alertaDias: 30 },
  arquivos: {
    fotoMinPx: 1600, brilhoMin: 40, brilhoMax: 235, nitidezMin: 4, gpsRaioM: 500, fotoIdadeMaxDias: 60,
    sceLimiteMB: 3, sceAlvoMB: 2.9, videoMaxMB: 200, videoMaxSeg: 180,
  },
  prazos: { renovacaoAntecedenciaDias: 90, renovacaoAutoDias: 180, lembreteParadoDias: 5, lembreteAssinaturaDias: 3, alertasVencimento: [180, 120, 90] },
};

const PORTE_LABEL = { pequeno: 'Pequeno', medio: 'Médio', grande: 'Grande' };
const PROCESS_TYPES = {
  credenciamento: 'Credenciamento', renovacao: 'Renovação',
  alteracao_endereco: 'Alteração de endereço', modificacao: 'Modificação (art. 45)',
};

// ---------------- Anexo II ----------------
const A2 = [
  { key: 'a2_1', n: 1, title: 'Sinalização (placa de identificação)', short: 'Placa',
    req: 'Placa no padrão do Anexo I (60 × 37,5 cm, Montserrat Bold, #0a1432 e #fdc400), acrílico branco, grafismo em plotter de recorte e backlight. Fixada do lado de fora, em local visível (art. 19 §2º).',
    tip: 'Fotografe a placa de frente, depois um enquadramento mostrando a fachada e, à noite ou em local escuro, a placa com o backlight aceso.' },
  { key: 'a2_2', n: 2, title: 'Recepção', short: 'Recepção',
    req: 'Área ≥ 10 m² + 1 m² por box (leves + pesados). Cadeiras ≥ total de boxes. Bebedouro e ar-condicionado.',
    tip: 'Fotografe o ambiente inteiro, mostrando cadeiras, bebedouro e ar-condicionado. Inclua uma foto com a trena.' },
  { key: 'a2_3', n: 3, title: 'Sala de administração', short: 'Sala adm.',
    req: 'Área ≥ 10 m², com mobília e recursos tecnológicos.', tip: 'Mostre a mobília e os computadores. Inclua uma foto com a trena.' },
  { key: 'a2_4', n: 4, title: 'Sanitários', short: 'Sanitários',
    req: 'Pequeno porte: ≥ 1; médio/grande: ≥ 2. Pelo menos 1 acessível (ABNT NBR 9050:2020).',
    tip: 'Uma foto de cada banheiro. No acessível, mostre as barras, a porta e a área de giro.' },
  { key: 'a2_5', n: 5, title: 'Prevenção e combate a incêndio', short: 'Incêndio',
    req: 'Equipamentos conforme legislação vigente, com validade em dia.', tip: 'Foto de cada extintor no local instalado, com a etiqueta de validade legível.' },
  { key: 'a2_6', n: 6, title: 'Estacionamento (vagas de espera)', short: 'Estacionamento',
    req: 'Vagas = metade dos boxes leves, arredondada para cima; cada vaga ≥ 5,0 × 2,5 m. Dispensado em pequeno porte.',
    tip: 'Foto de cada vaga desobstruída, com a trena mostrando as dimensões.' },
  { key: 'a2_7', n: 7, title: 'Boxes de veículos leves', short: 'Boxes leves',
    req: 'Cada box ≥ 5,50 × 3,50 m, altura 3,00 m; coberto; piso plano e horizontal, com iluminação e ventilação.',
    tip: 'Por box: foto geral, foto do piso, foto da cobertura/iluminação e foto com a trena aberta.' },
  { key: 'a2_8', n: 8, title: 'Boxes de veículos pesados', short: 'Boxes pesados',
    req: 'Cada box ≥ 13,00 × 4,50 m, altura 4,50 m; cobertura obrigatória em médio/grande porte.',
    tip: 'Por box: as mesmas fotos dos boxes leves.' },
  { key: 'a2_9', n: 9, title: 'Portão de acesso', short: 'Portão',
    req: 'Leves: ≥ 3,0 × 3,0 m; pesados: ≥ 4,0 × 4,50 m (largura × altura livre).', tip: 'Foto do portão aberto com a trena na largura e na altura livre.' },
  { key: 'a2_10', n: 10, title: 'Área de manobra', short: 'Manobra',
    req: 'Largura ≥ 2,50 m.', tip: 'Foto da área de circulação com a trena na largura.' },
];

// ---------------- Anexo III ----------------
// eqType: tipo de equipamento no cadastro permanente; perBox: vínculo com box; cal: exige calibração.
const A3 = [
  { key: 'a3_1', n: 1, title: 'Equipamento de elevação', short: 'Elevação', eqType: 'elevacao', serial: true, cal: false,
    req: 'Elevador e macaco ≥ 2.000 kg; macaco eleva ≥ 500 mm. Rampas e fosso com as medidas da Seção 8.3.' },
  { key: 'a3_2', n: 2, title: 'Câmera fixa (IP)', short: 'Câmera fixa', eqType: 'camera_fixa', perBox: true, serial: true, video: true,
    req: '1 por box; resolução ≥ 800 × 600 px; sem obstrução nem contraluz; vídeo de cada câmera.' },
  { key: 'a3_3', n: 3, title: 'Câmera móvel (boroscópio)', short: 'Boroscópio', eqType: 'boroscopio', serial: true,
    req: 'Resolução ≥ 800 × 600 px; haste flexível; wifi ou bluetooth. Documento que comprove a resolução.' },
  { key: 'a3_4', n: 4, title: 'Tablet ou smartphone', short: 'Smartphone', eqType: 'smartphone', perBox: true, serial: true, video: true,
    req: 'App de vistoria instalado e configurado; vídeo de tela por aparelho.' },
  { key: 'a3_5', n: 5, title: 'Paquímetro digital', short: 'Paquímetro', eqType: 'paquimetro', serial: true, cal: true, faixaMin: 150,
    reqBase: 'Paquímetro digital.' },
  { key: 'a3_6', n: 6, title: 'Profundímetro digital', short: 'Profundímetro', eqType: 'profundimetro', perBox: true, serial: true, cal: true,
    reqBase: 'Profundímetro digital (foto ligado).' },
  { key: 'a3_7', n: 7, title: 'Trena de 5 m', short: 'Trena 5 m', eqType: 'trena5', perBox: true, serial: true, cal: true, faixaMin: 5000,
    reqBase: 'Trena com escala de 5 m.' },
  { key: 'a3_8', n: 8, title: 'Trena de 50 m', short: 'Trena 50 m', eqType: 'trena50', perBox: true, serial: true, cal: true, faixaMin: 50000,
    reqBase: 'Trena com escala de 50 m.' },
  { key: 'a3_9', n: 9, title: 'Leitor biométrico facial', short: 'Biometria', eqType: null,
    req: 'Atendido pelo reconhecimento facial integrado ao sistema de vistoria (sem aparelho separado). Anexar print ou vídeo da função.' },
  { key: 'a3_10', n: 10, title: 'Verificador de conexões elétricas (engate)', short: 'Engate', eqType: 'engate', serial: true,
    req: 'Conforme Resolução CONTRAN nº 937/2022.' },
  { key: 'a3_11', n: 11, title: 'Medidor de espessura de camadas', short: 'Espessura', eqType: 'espessura', serial: true, cal: true,
    reqBase: 'Base ferrosa e não ferrosa.' },
  { key: 'a3_12', n: 12, title: 'Lanterna UV', short: 'Lanterna UV', eqType: 'lanterna_uv', perBox: true, serial: false, req: 'Foto com a lanterna ligada.' },
  { key: 'a3_13', n: 13, title: 'Computador servidor (desktop)', short: 'Servidor', eqType: 'servidor', serial: true,
    req: 'Core i5 ou similar, 8 GB RAM, 1 TB; uso exclusivo.' },
  { key: 'a3_14', n: 14, title: 'Nobreak', short: 'Nobreak', eqType: 'nobreak', serial: true, req: '≥ 800 VA; uso exclusivo do servidor.' },
  { key: 'a3_15', n: 15, title: 'Rede estruturada de dados', short: 'Rede', eqType: null, req: 'Contrato ou documento equivalente; compatível com o nº de boxes.' },
  { key: 'a3_16', n: 16, title: 'Roteador', short: 'Roteador', eqType: 'roteador', serial: true, req: 'Com redirecionamento de portas.' },
  { key: 'a3_17', n: 17, title: 'Internet', short: 'Internet', eqType: null, req: 'Contrato com velocidade de upload ≥ 1 Mb/s.' },
];

const EQ_TYPES = Object.fromEntries(A3.filter((i) => i.eqType).map((i) => [i.eqType, i]));
const ALL_ITEMS = [...A2.map((i) => ({ ...i, annex: 'II' })), ...A3.map((i) => ({ ...i, annex: 'III' }))];
const ITEM = Object.fromEntries(ALL_ITEMS.map((i) => [i.key, i]));

const ELEVACAO = { elevador: 'Elevador automotivo', macaco: 'Macaco hidráulico jacaré', rampas: 'Par de rampas', fosso: 'Fosso' };

// Documentos do Bloco A (kind do arquivo)
const DOCS = [
  { kind: 'planta', title: 'Planta ou croqui do imóvel com cotas', who: 'loja', note: 'Base para as plantas de localização de cada item do Anexo II (PDF ou imagem).' },
  { kind: 'art', title: 'ART (CREA) ou RRT (CAU) do laudo', who: 'rt', note: 'Emitida no ano do pedido. Providenciada pelo responsável técnico.' },
  { kind: 'plano_calibracao', title: 'Plano de calibração e verificação metrológica', who: 'loja', optional: true, note: 'Anexo ao item 1 do Anexo III, quando exigido.' },
  { kind: 'doc_boroscopio', title: 'Documento da resolução da câmera móvel (boroscópio)', who: 'loja', note: 'Manual, ficha técnica ou nota fiscal com especificação ≥ 800 × 600.' },
  { kind: 'contrato_rede', title: 'Contrato de rede estruturada de dados', who: 'loja', note: 'Item 15 do Anexo III.' },
  { kind: 'contrato_internet', title: 'Contrato de internet (upload ≥ 1 Mb/s)', who: 'loja', note: 'Item 17 do Anexo III.' },
  { kind: 'incendio', title: 'Documentos de prevenção e combate a incêndio', who: 'loja', note: 'Ex.: AVCB/CLCB, recarga de extintores — confirmar com o RT.' },
];

// Aplica a tabela de calibração dos parâmetros ao catálogo (it.cal)
function applyCalibration(P) {
  const cal = (P && P.equipamentos && P.equipamentos.calibracao) || DEFAULT_PARAMS.equipamentos.calibracao;
  const upd = (it) => {
    if (!it.eqType) return;
    it.cal = !!cal[it.eqType];
    if (it.reqBase === undefined) it.reqBase = it.req;
    it.req = it.reqBase + (it.cal ? ' Com certificado de calibração.' : '');
  };
  A3.forEach(upd); ALL_ITEMS.forEach(upd);
}
applyCalibration(DEFAULT_PARAMS);

function porteFromPop(pop, p = DEFAULT_PARAMS) {
  if (pop == null) return null;
  if (pop <= p.porte.limitePequeno) return 'pequeno';
  if (pop <= p.porte.limiteMedio) return 'medio';
  return 'grande';
}

// Fórmula de quantidades (Seção 6.4). L = boxes leves, P = pesados, M = 1 se vistoria móvel.
function quantities(cfg) {
  const L = +cfg.boxesLeves || 0, P = cfg.pesados ? (+cfg.boxesPesados || 0) : 0, M = cfg.movel ? 1 : 0;
  return {
    elevacao: 1, camera_fixa: L + P, boroscopio: 1 + M, smartphone: L + P + M, paquimetro: 2 + M,
    profundimetro: L + P + M, trena5: L + M, trena50: P > 0 ? P + M : 0, biometrico: 0, engate: 1 + M,
    espessura: 2 + M, lanterna_uv: L + P + M, servidor: 1, nobreak: 1, roteador: 1,
  };
}

function boxesList(cfg) {
  const L = +cfg.boxesLeves || 0, P = cfg.pesados ? (+cfg.boxesPesados || 0) : 0;
  return [...Array.from({ length: L }, (_, i) => `L${i + 1}`), ...Array.from({ length: P }, (_, i) => `P${i + 1}`)];
}
const boxLabel = (b) => (b && b[0] === 'P' ? `Box pesado ${b.slice(1)}` : b ? `Box ${b.slice(1)}` : '');

// Itens que entram no laudo (para alteração/modificação, só os selecionados — art. 45 §1º)
function itemsInScope(laudo, cfg) {
  const scope = laudo.scope_items ? JSON.parse(laudo.scope_items) : null;
  return ALL_ITEMS.filter((it) => {
    if (scope && scope.length && !scope.includes(it.key)) return false;
    if (it.key === 'a2_8' && !(cfg && cfg.pesados)) return false;
    if (it.key === 'a3_8' && !(cfg && cfg.pesados)) return false;
    return true;
  });
}

// Fotos exigidas (slots) por item do Anexo II, conforme configuração e campos.
function photoSlots(itemKey, cfg, fields = {}) {
  const f = fields || {};
  switch (itemKey) {
    case 'a2_1': return [{ slot: 'frontal', label: 'Placa de frente' }, { slot: 'local', label: 'Placa no local (fachada)' }, { slot: 'backlight', label: 'Backlight aceso' }];
    case 'a2_2': return [{ slot: 'geral1', label: 'Ambiente (cadeiras)' }, { slot: 'geral2', label: 'Bebedouro e ar-condicionado' }, { slot: 'medida', label: 'Trena / medida', measure: true }];
    case 'a2_3': return [{ slot: 'geral', label: 'Mobília e recursos' }, { slot: 'medida', label: 'Trena / medida', measure: true }];
    case 'a2_4': {
      const n = Math.max(+f.banheiros || 0, 1);
      const s = Array.from({ length: n }, (_, i) => ({ slot: `banheiro${i + 1}`, label: `Banheiro ${i + 1}` }));
      s.push({ slot: 'acessivel', label: 'Banheiro acessível (barras, porta, giro)', measure: true });
      return s;
    }
    case 'a2_5': {
      const n = Math.max((f.extintores || []).length, 1);
      return Array.from({ length: n }, (_, i) => ({ slot: `ext${i + 1}`, label: `Extintor ${i + 1} (com etiqueta)`, measure: true }));
    }
    case 'a2_6': {
      const n = Math.max((f.vagas || []).length, cfg ? Math.ceil((+cfg.boxesLeves || 0) / 2) : 1);
      return Array.from({ length: n }, (_, i) => ({ slot: `vaga${i + 1}`, label: `Vaga ${i + 1} com trena`, measure: true }));
    }
    case 'a2_7': case 'a2_8': {
      const pref = itemKey === 'a2_7' ? 'L' : 'P';
      const n = itemKey === 'a2_7' ? (+cfg?.boxesLeves || 0) : (cfg?.pesados ? +cfg.boxesPesados || 0 : 0);
      const out = [];
      for (let i = 1; i <= n; i++) {
        const b = pref + i, lb = boxLabel(b);
        out.push({ slot: `${b}_geral`, label: `${lb} · vista geral`, box: b },
          { slot: `${b}_piso`, label: `${lb} · piso`, box: b },
          { slot: `${b}_cobertura`, label: `${lb} · cobertura/iluminação`, box: b },
          { slot: `${b}_trena`, label: `${lb} · trena (medidas)`, box: b, measure: true });
      }
      return out;
    }
    case 'a2_9': {
      const n = Math.max((f.portoes || []).length, 1);
      return Array.from({ length: n }, (_, i) => ({ slot: `portao${i + 1}`, label: `Portão ${i + 1} aberto com trena`, measure: true }));
    }
    case 'a2_10': return [{ slot: 'trena', label: 'Área de circulação com trena', measure: true }];
    case 'a3_9': return [{ slot: 'evidencia', label: 'Print do reconhecimento facial no app' }];
    case 'a3_15': return [];
    case 'a3_17': return [{ slot: 'speedtest', label: 'Print do teste de velocidade (opcional)', optional: true }];
    default: return [];
  }
}

// Fotos exigidas para cada equipamento (cadastro permanente)
function equipmentPhotoSlots(type) {
  const it = EQ_TYPES[type];
  const s = [{ slot: 'geral', label: type === 'lanterna_uv' ? 'Lanterna ligada' : type === 'elevacao' ? 'Equipamento com trena' : 'Foto do equipamento' }];
  if (it && it.serial) s.push({ slot: 'serie', label: type === 'smartphone' ? 'Nº de série (tela "Sobre")' : 'Etiqueta do nº de série' });
  s.push({ slot: 'patrimonio', label: 'Etiqueta de patrimônio' });
  if (it && it.cal) s.push({ slot: 'calibracao', label: 'Etiqueta de calibração' });
  if (type === 'servidor') s.push({ slot: 'config', label: 'Print da tela de configuração' });
  if (type === 'nobreak') s[0].label = 'Nobreak + etiqueta de potência';
  return s;
}

module.exports = {
  DEFAULT_PARAMS, PORTE_LABEL, PROCESS_TYPES, A2, A3, ALL_ITEMS, ITEM, EQ_TYPES, ELEVACAO, DOCS,
  porteFromPop, applyCalibration, quantities, boxesList, boxLabel, itemsInScope, photoSlots, equipmentPhotoSlots,
};
