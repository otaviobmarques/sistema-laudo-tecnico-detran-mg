// Conferência do PDF assinado devolvido (Seção 10.4).
// 1) assinatura presente e íntegra  2) mesmo PDF gerado  3) signatário esperado  4) versão atual.
const crypto = require('crypto');
const { norm } = require('./rules');

function findSignatures(buf) {
  const s = buf.toString('latin1');
  const out = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m;
  while ((m = re.exec(s))) {
    const br = m.slice(1, 5).map(Number);
    // /Contents <hex> fica entre br[1] e br[2]
    const hex = s.slice(br[0] + br[1], br[2]).replace(/[<>\s]/g, '');
    const nameM = s.slice(Math.max(0, m.index - 4000), m.index + 4000).match(/\/Name\s*\(([^)]*)\)/);
    out.push({ byteRange: br, contents: Buffer.from(hex.replace(/0+$/, '').length % 2 ? hex.replace(/0+$/, '') + '0' : hex.replace(/0+$/, ''), 'hex'), name: nameM ? nameM[1] : null });
  }
  return out;
}

// Extrai os CNs (OID 2.5.4.3) e o messageDigest (1.2.840.113549.1.9.4) do PKCS#7, sem dependências.
function parsePkcs7(der) {
  const cns = [];
  const cnOid = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]);
  let i = 0;
  while ((i = der.indexOf(cnOid, i)) !== -1) {
    const tag = der[i + 5], len = der[i + 6];
    if ([0x0c, 0x13, 0x14, 0x16, 0x1e].includes(tag) && len < 128) {
      const raw = der.slice(i + 7, i + 7 + len);
      cns.push(tag === 0x1e ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('utf8'));
    }
    i += 5;
  }
  const mdOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04]);
  const digests = [];
  i = 0;
  while ((i = der.indexOf(mdOid, i)) !== -1) {
    // SET { OCTET STRING }
    let j = i + mdOid.length;
    if (der[j] === 0x31) { j += 2; if (der[j] === 0x04) digests.push(der.slice(j + 2, j + 2 + der[j + 1]).toString('hex')); }
    i += mdOid.length;
  }
  return { cns, digests };
}

function verifySignedPdf(buf, { expectedSha, expectedLength, expectedName, expectedCpf, olderVersions = [] }) {
  const checks = [];
  const sigs = findSignatures(buf);
  if (!sigs.length) return { ok: false, reason: 'Assinatura ausente ou inválida.', checks: [{ n: 1, ok: false, msg: 'Nenhuma assinatura digital encontrada no arquivo.' }] };
  const sig = sigs[sigs.length - 1];
  const [a, b, c, d] = sig.byteRange;
  // Integridade: a última assinatura cobre o arquivo inteiro e o digest confere
  const covers = a === 0 && c + d === buf.length;
  const signedData = Buffer.concat([buf.slice(a, a + b), buf.slice(c, c + d)]);
  const p7 = parsePkcs7(sig.contents);
  const algos = ['sha256', 'sha512', 'sha384', 'sha1'];
  const digestOk = p7.digests.some((dg) => algos.some((al) => crypto.createHash(al).update(signedData).digest('hex') === dg));
  const integ = covers && digestOk;
  checks.push({ n: 1, ok: integ, msg: integ ? 'Assinatura digital presente e íntegra.' : !covers ? 'O arquivo foi alterado depois de assinado.' : 'O resumo criptográfico da assinatura não confere.' });
  if (!integ) return { ok: false, reason: 'Assinatura ausente ou inválida.', checks };

  // Mesmo PDF: a assinatura gov.br é incremental, então o arquivo gerado é o prefixo do assinado
  const prefixSha = buf.length >= expectedLength ? crypto.createHash('sha256').update(buf.slice(0, expectedLength)).digest('hex') : null;
  const same = prefixSha === expectedSha;
  if (!same) {
    const old = olderVersions.find((v) => buf.length >= v.length && crypto.createHash('sha256').update(buf.slice(0, v.length)).digest('hex') === v.sha);
    if (old) { checks.push({ n: 4, ok: false, msg: `Arquivo da versão v${old.n}, já substituída.` }); return { ok: false, reason: 'Versão desatualizada. Baixe o arquivo novamente.', checks }; }
    checks.push({ n: 2, ok: false, msg: 'O conteúdo não corresponde ao PDF gerado pelo sistema.' });
    return { ok: false, reason: 'Este não é o arquivo gerado pelo sistema ou foi modificado.', checks };
  }
  checks.push({ n: 2, ok: true, msg: 'Arquivo idêntico ao gerado pelo sistema (mesmas páginas e texto).' });

  // Signatário
  const names = [...p7.cns, sig.name].filter(Boolean);
  if (!expectedName) {
    const who = (names.find((n) => n.includes(':')) || names[0] || 'não identificado').split(':')[0];
    checks.push({ n: 3, ok: true, msg: `Assinado por ${who}.` });
    checks.push({ n: 4, ok: true, msg: 'Versão atual do laudo.' });
    return { ok: true, checks, signer: who, signers: names };
  }
  const exp = norm(expectedName).replace(/[^a-z ]/g, '').trim();
  const cpf = String(expectedCpf || '').replace(/\D/g, '');
  let signer = null, cpfMatch = null;
  for (const n of names) {
    const [nm, cp] = n.split(':');
    if (norm(nm).replace(/[^a-z ]/g, '').trim() === exp) { signer = n; if (cp) cpfMatch = cp.replace(/\D/g, '') === cpf; break; }
  }
  const signerOk = !!signer && cpfMatch !== false;
  checks.push({ n: 3, ok: signerOk, msg: signerOk ? `Assinado por ${signer.split(':')[0]}${cpfMatch ? ' (CPF confere)' : ''}.` : `Assinado por "${(names[0] || '?').split(':')[0]}", esperado "${expectedName}".` });
  if (!signerOk) return { ok: false, reason: 'Documento assinado por pessoa diferente da cadastrada.', checks, signers: names };
  checks.push({ n: 4, ok: true, msg: 'Versão atual do laudo.' });
  return { ok: true, checks, signer: signer.split(':')[0], signers: names };
}

// ---- Modo demonstração: simula a assinatura gov.br (atualização incremental com /Sig) ----
function simulateGovbrSignature(pdfBuf, name, cpf) {
  const cn = Buffer.from(`${name.toUpperCase()}:${String(cpf || '').replace(/\D/g, '')}`, 'utf8');
  const PH = 4096; // bytes reservados para o PKCS#7
  const pre = `\n9999 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (${name.toUpperCase()}) /Reason (Assinatura gov.br - SIMULACAO) /M (D:${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}Z) /ByteRange [`;
  const mid = '] /Contents <';
  const post = Buffer.from('> >>\nendobj\n%%EOF\n', 'latin1');
  const pad = (n) => String(n).padStart(10, '0');
  const headLen = pdfBuf.length + Buffer.byteLength(pre + '0000000000 0000000000 0000000000 0000000000' + mid, 'latin1');
  const b = headLen - 1;                 // posição do '<'
  const c = headLen + PH * 2 + 1;        // logo após o '>'
  const total = headLen + PH * 2 + post.length;
  const head = Buffer.concat([pdfBuf, Buffer.from(pre + `${pad(0)} ${pad(b)} ${pad(c)} ${pad(total - c)}` + mid, 'latin1')]);
  const digest = crypto.createHash('sha256').update(Buffer.concat([head.slice(0, b), post.slice(1)])).digest();
  const der = Buffer.concat([
    Buffer.from([0x30, 0x82, 0x00, 0x00]),
    Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x09, 0x04, 0x31, 0x22, 0x04, 0x20]), digest,
    Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03, 0x0c, cn.length]), cn,
  ]);
  const hex = der.toString('hex').toUpperCase().padEnd(PH * 2, '0');
  return Buffer.concat([head, Buffer.from(hex, 'latin1'), post]);
}

module.exports = { verifySignedPdf, simulateGovbrSignature, findSignatures, parsePkcs7 };
