// Envio de fotos: redução no aparelho, câmera com guia, GPS e fila offline (IndexedDB).
import { toast, html } from './core.js';

let qCount = 0;
const DB = 'laudo-ecv-queue';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('q', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function qAll() { try { const d = await idb(); return await new Promise((res) => { const r = d.transaction('q').objectStore('q').getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); }); } catch { return []; } }
async function qAdd(item) { const d = await idb(); await new Promise((res, rej) => { const t = d.transaction('q', 'readwrite'); t.objectStore('q').add(item); t.oncomplete = res; t.onerror = () => rej(t.error); }); qCount++; }
async function qDel(id) { const d = await idb(); await new Promise((res) => { const t = d.transaction('q', 'readwrite'); t.objectStore('q').delete(id); t.oncomplete = res; t.onerror = res; }); qCount = Math.max(0, qCount - 1); }
qAll().then((l) => { qCount = l.length; });
export const queueSize = () => qCount;
export async function queued(filter) { return (await qAll()).filter((x) => !filter || filter(x)); }

async function send(url, fields, blob, name) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v != null) fd.append(k, v);
  fd.append('file', blob, name || 'foto.jpg');
  const r = await fetch(url, { method: 'POST', body: fd, credentials: 'same-origin' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'Falha no envio'), { status: r.status, data });
  return data;
}
let flushing = false;
export async function flushQueue() {
  if (flushing) return; flushing = true;
  try {
    for (const it of await qAll()) {
      try { await send(it.url, it.fields, it.blob, it.name); await qDel(it.id); toast('Foto pendente enviada: ' + (it.fields.caption || it.fields.slot || ''), 'ok'); }
      catch (e) { if (e.status) { await qDel(it.id); toast(`Foto pendente recusada: ${e.message}`, 'err'); } else break; }
    }
  } finally { flushing = false; }
}

// reduz fotos enormes (mantendo ≥ 1600 px) para subir mais rápido no 4G
export async function prepareImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = Math.max(bmp.width, bmp.height);
    if (max <= 2600 && file.size < 3.5 * 1048576) return file;
    const s = 2400 / max;
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * Math.min(1, s)); c.height = Math.round(bmp.height * Math.min(1, s));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    return blob && blob.size < file.size ? new File([blob], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified }) : file;
  } catch { return file; }
}

let lastPos = null;
export function getPosition() {
  return new Promise((res) => {
    if (lastPos && Date.now() - lastPos.at < 120000) return res(lastPos);
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => { lastPos = { lat: p.coords.latitude, lng: p.coords.longitude, at: Date.now() }; res(lastPos); }, () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}

// Envia (ou guarda na fila se estiver sem internet)
export async function uploadPhoto(url, file, fields = {}) {
  const f = await prepareImage(file);
  const all = { ...fields, taken_at: fields.taken_at || new Date(file.lastModified || Date.now()).toISOString() };
  try { return await send(url, all, f, f.name); }
  catch (e) {
    if (e.status) throw e;
    await qAdd({ url, fields: all, blob: f, name: f.name, at: Date.now() });
    toast('Sem internet: a foto ficou guardada e sobe sozinha quando a conexão voltar. Mantenha a página aberta.', 'err');
    return { queued: true };
  }
}

// Seleção pela galeria/computador
export function pickFiles({ multiple = false, accept = 'image/*', capture } = {}) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    if (capture) i.setAttribute('capture', 'environment');
    i.onchange = () => res([...i.files]); i.click();
  });
}

// Câmera com moldura e dica de enquadramento (B.15)
export async function openCamera({ label, tip }) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const f = await pickFiles({ capture: true });
    if (!f.length) return null;
    const pos = await getPosition();
    return { file: f[0], lat: pos?.lat, lng: pos?.lng, source: 'camera' };
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false }); }
  catch { const f = await pickFiles({ capture: true }); if (!f.length) return null; const pos = await getPosition(); return { file: f[0], lat: pos?.lat, lng: pos?.lng, source: 'camera' }; }
  const posP = getPosition();
  return new Promise((resolve) => {
    const d = document.createElement('div'); d.className = 'camera';
    d.innerHTML = String(html`<video autoplay playsinline muted></video><div class="frame"></div><div class="tip"><b>${label}</b><br>${tip || 'Enquadre dentro da moldura. A foto leva data, hora e GPS.'}</div>
      <div class="ctl"><button class="t" data-a="x">Cancelar</button><button class="shoot" data-a="s" aria-label="Tirar foto"></button><button class="t" data-a="g">Galeria</button></div>`);
    document.body.appendChild(d);
    const v = d.querySelector('video'); v.srcObject = stream;
    const end = (r) => { stream.getTracks().forEach((t) => t.stop()); d.remove(); resolve(r); };
    d.querySelector('[data-a=x]').onclick = () => end(null);
    d.querySelector('[data-a=g]').onclick = async () => { const f = await pickFiles(); end(f.length ? { file: f[0], source: 'upload' } : null); };
    d.querySelector('[data-a=s]').onclick = async () => {
      const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      const pos = await posP;
      end({ file: new File([blob], 'camera.jpg', { type: 'image/jpeg', lastModified: Date.now() }), lat: pos?.lat, lng: pos?.lng, source: 'camera' });
    };
  });
}
