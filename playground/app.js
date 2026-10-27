import { samples } from './samples.js';
const editor = document.getElementById('html');
const select = document.getElementById('sample');
const button = document.getElementById('render');
const status = document.getElementById('status');
const preview = document.getElementById('pdf');
const download = document.getElementById('download');
const pageSize = document.getElementById('page-size');
const orientation = document.getElementById('orientation');
let pdfUrl;
let revision = 0;
for (const name of Object.keys(samples)) select.add(new Option(name, name));
editor.value = samples.Invoice;
function invalidate() {
  revision++;
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = null;
  preview.removeAttribute('src');
  preview.hidden = true;
  download.hidden = true;
  document.getElementById('empty').hidden = false;
  status.textContent = 'Ready';
  status.className = '';
}
select.addEventListener('change', () => { editor.value = samples[select.value]; invalidate(); });
editor.addEventListener('input', invalidate);
pageSize.addEventListener('change', () => {
  orientation.disabled = pageSize.value === 'auto';
  if (orientation.disabled) orientation.value = 'portrait';
  invalidate();
});
orientation.addEventListener('change', invalidate);
button.addEventListener('click', async () => {
  const current = revision;
  button.disabled = true;
  status.className = '';
  status.textContent = 'Generating...';
  try {
    const response = await fetch('/render', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: editor.value, pageSize: pageSize.value, orientation: orientation.value }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    const blob = await response.blob();
    if (current !== revision) return;
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = URL.createObjectURL(blob);
    preview.src = pdfUrl;
    preview.hidden = false;
    document.getElementById('empty').hidden = true;
    download.href = pdfUrl;
    download.hidden = false;
    status.textContent = `${response.headers.get('X-Render-Ms')} ms / ${Math.round(blob.size / 1024)} KB / renderer peak RSS ${response.headers.get('X-Render-Rss-Mb')} MB`;
  } catch (error) {
    if (current === revision) { status.className = 'error'; status.textContent = error.message || 'Generation failed'; }
  } finally { button.disabled = false; }
});
window.addEventListener('pagehide', () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); });
