// Checklist do Franqueado (Seção 6): gerado a partir de porte, boxes, pesados e elevação.
const C = require('./catalog');
const { fmt } = require('./rules');

function buildChecklist(sum) {
  const { ctx, statuses, issues } = sum;
  const { cfg, params: P, porte, files } = ctx;
  const L = +cfg.boxesLeves || 0, Pz = cfg.pesados ? +cfg.boxesPesados || 0 : 0, T = L + Pz;
  const D = P.dimensoes, Q = C.quantities(cfg);
  const scope = C.itemsInScope(ctx.laudo, cfg).map((i) => i.key);
  const errOf = (k) => issues.filter((i) => i.item === k && i.type === 'B' && i.stage === 'submit').map((i) => i.msg);
  const row = (o) => ({ ...o, status: o.status || 'faltando' });

  // Bloco A — Documentos
  const hasFile = (k) => files.some((f) => f.kind === k);
  const eqCal = ctx.equipment.filter((e) => C.EQ_TYPES[e.type]?.cal);
  const A = C.DOCS.filter((d) => {
    if (d.kind === 'doc_boroscopio') return scope.includes('a3_3');
    if (d.kind === 'contrato_rede') return scope.includes('a3_15');
    if (d.kind === 'contrato_internet') return scope.includes('a3_17');
    if (d.kind === 'incendio') return scope.includes('a2_5');
    if (d.kind === 'planta') return scope.some((k) => k.startsWith('a2_'));
    return true;
  }).map((d) => row({ key: 'doc:' + d.kind, title: d.title, qty: 1, tip: d.note, who: d.who, optional: d.optional,
    status: hasFile(d.kind) ? 'pronto' : d.optional ? 'opcional' : 'faltando' }));
  for (const t of ['paquimetro', 'profundimetro', 'trena5', 'trena50', 'espessura']) {
    const need = Q[t] || 0; if (!need) continue;
    const it = C.EQ_TYPES[t];
    const withCert = eqCal.filter((e) => e.type === t && e.cert && e.cert.numero && files.some((f) => f.kind === 'certificado' && f.equipment_id === e.id)).length;
    A.push(row({ key: 'cert:' + t, title: `Certificados de calibração — ${it.title.toLowerCase()}`, qty: need,
      tip: t === 'trena5' ? 'A faixa de medição deve cobrir 5 m. Número igual ao da etiqueta.' : t === 'trena50' ? 'A faixa de medição deve cobrir 50 m.' : t === 'espessura' ? 'Base ferrosa e não ferrosa.' : 'Um por equipamento; número igual ao da etiqueta.',
      status: withCert >= need ? 'pronto' : withCert ? 'parcial' : 'faltando', progress: `${withCert} de ${need}` }));
  }
  A.push(row({ key: 'doc:veracidade', title: 'Declaração de veracidade (aceite no envio para conferência)', qty: 1, tip: 'Aceite eletrônico do representante legal no envio.', status: ctx.data.veracidade ? 'pronto' : 'pendente' }));

  // Bloco B — Fotos e vídeos da infraestrutura
  const minDesc = {
    a2_1: 'Placa padrão Anexo I; acrílico branco; plotter de recorte; backlight.',
    a2_2: `Área ≥ ${fmt(D.recepcaoBase + D.recepcaoPorBox * T)} m²; ≥ ${T} cadeiras; bebedouro e ar.`,
    a2_3: `Área ≥ ${fmt(D.salaAdm)} m².`,
    a2_4: `≥ ${porte ? P.porte.banheirosMin[porte] : '?'} banheiro(s); ≥ 1 acessível (NBR 9050).`,
    a2_5: 'Conforme legislação vigente; validade em dia.',
    a2_6: porte && !P.porte.vagasExigidas[porte] ? 'Dispensado no pequeno porte.' : `${Math.ceil(L / 2)} vaga(s) de ${fmt(D.vaga.c, 1)} × ${fmt(D.vaga.l, 1)} m.`,
    a2_7: `${L} box(es) de ${fmt(D.boxLeve.c)} × ${fmt(D.boxLeve.l)} m, altura ${fmt(D.boxLeve.h)} m; coberto.`,
    a2_8: `${Pz} box(es) de ${fmt(D.boxPesado.c)} × ${fmt(D.boxPesado.l)} m, altura ${fmt(D.boxPesado.h)} m${porte && P.porte.coberturaPesadoObrigatoria[porte] ? '; coberto' : ''}.`,
    a2_9: `Leves ≥ ${fmt(D.portaoLeve.l, 1)} × ${fmt(D.portaoLeve.h, 1)} m${cfg.pesados ? `; pesados ≥ ${fmt(D.portaoPesado.l, 1)} × ${fmt(D.portaoPesado.h)} m` : ''}.`,
    a2_10: `Largura ≥ ${fmt(D.manobra)} m.`,
  };
  const st = (k) => {
    const s = statuses[k];
    if (!s) return 'faltando';
    return { completo: 'pronto', parcial: 'parcial', erro: 'erro', nao_iniciado: 'faltando' }[s.status];
  };
  const B = C.A2.filter((i) => scope.includes(i.key)).map((i) => {
    const s = statuses[i.key] || {};
    return row({ key: i.key, title: `${i.n}. ${i.title}`, qty: s.photosReq, min: minDesc[i.key], tip: i.tip, status: st(i.key),
      progress: s.photosReq ? `${s.photosDone} de ${s.photosReq} fotos` : '', errors: errOf(i.key) });
  });
  if (scope.includes('a3_2')) B.push(row({ key: 'a3_2:videos', link: 'a3_2', title: 'Vídeos das câmeras fixas (Google Drive)', qty: T, min: '1 por box, gravado pelo sistema de vistoria.', tip: 'Envie para a pasta "Vídeos" no Drive e libere "Qualquer pessoa com o link".', status: videoStatus(ctx, 'a3_2') }));
  if (scope.includes('a3_4')) B.push(row({ key: 'a3_4:videos', link: 'a3_4', title: 'Vídeo de tela do tablet/smartphone com o app de vistoria', qty: Q.smartphone, min: '1 por aparelho.', tip: 'Grave a tela mostrando o app instalado e funcionando.', status: videoStatus(ctx, 'a3_4') }));

  // Bloco C — Equipamentos
  const Cc = C.A3.filter((i) => scope.includes(i.key)).map((i) => {
    const need = i.eqType ? Q[i.eqType] || 0 : i.key === 'a3_9' ? 0 : 1;
    const have = i.eqType ? ctx.equipment.filter((e) => e.type === i.eqType && e.status === 'ativo').length : null;
    const s = statuses[i.key] || {};
    return row({ key: i.key, title: `${i.n}. ${i.title}`, qty: need, have, min: i.req, status: st(i.key),
      tip: i.key === 'a3_9' ? 'Sem aparelho separado: anexe print ou vídeo do reconhecimento facial no app de vistoria.' : i.cal ? 'Foto do equipamento, da etiqueta de série/patrimônio e da etiqueta de calibração.' : i.eqType ? 'Foto do equipamento e das etiquetas de série e patrimônio.' : 'Contrato ou documento (Bloco A).',
      progress: i.eqType ? `${have} de ${need} cadastrados` + (s.photosReq ? ` · ${s.photosDone}/${s.photosReq} fotos` : '') : '', errors: errOf(i.key) });
  });

  const blocks = [
    { id: 'A', title: 'Documentos', rows: A },
    { id: 'B', title: 'Fotos e vídeos da infraestrutura (Anexo II)', rows: B },
    { id: 'C', title: 'Equipamentos (Anexo III)', rows: Cc },
  ];
  for (const b of blocks) {
    const counted = b.rows.filter((r) => r.status !== 'opcional');
    b.done = counted.filter((r) => r.status === 'pronto').length; b.total = counted.length;
  }
  const done = blocks.reduce((a, b) => a + b.done, 0), total = blocks.reduce((a, b) => a + b.total, 0);
  const summary = [
    `Recepção com ≥ ${fmt(D.recepcaoBase + D.recepcaoPorBox * T)} m² e ≥ ${T} cadeiras`,
    porte && !P.porte.vagasExigidas[porte] ? 'Vagas de espera: dispensadas (pequeno porte)' : `${Math.ceil(L / 2)} vaga(s) de espera de 5,0 × 2,5 m`,
    `${porte ? P.porte.banheirosMin[porte] : '?'} banheiro(s), 1 acessível`,
    `${Q.camera_fixa} câmeras fixas, ${Q.smartphone} smartphones, ${Q.lanterna_uv} lanternas UV`,
    `${Q.profundimetro} profundímetros, ${Q.trena5} trenas 5 m${Q.trena50 ? `, ${Q.trena50} trenas 50 m` : ''}`,
    `${Q.paquimetro} paquímetros, ${Q.espessura} medidores de espessura, ${Q.boroscopio} boroscópios, ${Q.engate} verificadores de engate`,
    cfg.pesados ? `Portão de ${fmt(D.portaoPesado.l, 1)} × ${fmt(D.portaoPesado.h)} m para o pesado` : `Portão de ${fmt(D.portaoLeve.l, 1)} × ${fmt(D.portaoLeve.h, 1)} m`,
  ];
  return { blocks, done, total, pct: total ? Math.round((done / total) * 100) : 0, quantities: Q, summary };
}

function videoStatus(ctx, k) {
  const it = C.ITEM[k];
  const eqs = ctx.equipment.filter((e) => e.type === it.eqType && e.status === 'ativo');
  const vids = (ctx.data.items?.[k]?.videos) || {};
  if (!eqs.length) return 'faltando';
  const ok = eqs.filter((e) => vids[e.id]?.url && vids[e.id]?.test?.status !== 'fail').length;
  const bad = eqs.some((e) => vids[e.id]?.test?.status === 'fail');
  return bad ? 'erro' : ok === eqs.length ? 'pronto' : ok ? 'parcial' : 'faltando';
}

module.exports = { buildChecklist };
