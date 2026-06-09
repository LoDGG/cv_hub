const state = {
  cvs: [],
  currentId: null,
  ppVersion: Date.now()
};

const els = {
  cvList: document.getElementById('cvList'),
  newCvButton: document.getElementById('newCvButton'),
  saveButton: document.getElementById('saveButton'),
  downloadButton: document.getElementById('downloadButton'),
  deleteButton: document.getElementById('deleteButton'),
  refreshButton: document.getElementById('refreshButton'),
  titleInput: document.getElementById('titleInput'),
  htmlInput: document.getElementById('htmlInput'),
  cssInput: document.getElementById('cssInput'),
  ppForm: document.getElementById('ppForm'),
  ppInput: document.getElementById('ppInput'),
  previewFrame: document.getElementById('previewFrame'),
  previewTitle: document.getElementById('previewTitle'),
  status: document.getElementById('status')
};

function setStatus(message) {
  els.status.textContent = message || '';
}

function formatDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function replacePpReferences(html) {
  const ppUrl = `/uploads/pp.png?v=${state.ppVersion}`;
  return String(html || '')
    .replace(/src=(['"])pp\.png\1/g, `src=$1${ppUrl}$1`)
    .replace(/src=(['"])\.\/pp\.png\1/g, `src=$1${ppUrl}$1`)
    .replace(/src=(['"])img\/Media\.jpg\1/g, `src=$1${ppUrl}$1`);
}

function buildPreviewDocument(html, css) {
  const patchedHtml = replacePpReferences(html);

  // The preview guard gives the iframe a stable rendering context.
  // It does not get saved with the CV and it is not injected into the PDF.
  const injectedStyle = `
<style id="cv-hub-preview-css">
${css || ''}
</style>
<style id="cv-hub-preview-guard">
html { min-width: 1024px; background: #dbe2ea; }
body { min-width: 1024px; }
</style>
`;
  const viewport = '<meta name="viewport" content="width=1024, initial-scale=1">';

  if (/<html[\s>]/i.test(patchedHtml)) {
    let doc = patchedHtml;

    if (/<meta[^>]+name=["']viewport["'][^>]*>/i.test(doc)) {
      doc = doc.replace(/<meta[^>]+name=["']viewport["'][^>]*>/i, viewport);
    } else if (/<head[\s>]/i.test(doc)) {
      doc = doc.replace(/<head([^>]*)>/i, `<head$1>
  ${viewport}`);
    }

    if (/<\/head>/i.test(doc)) {
      return doc.replace(/<\/head>/i, `${injectedStyle}</head>`);
    }
    return doc.replace(/<html[^>]*>/i, (match) => `${match}<head>${viewport}${injectedStyle}</head>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${viewport}
  ${injectedStyle}
</head>
<body>${patchedHtml}</body>
</html>`;
}

function renderPreview() {
  const title = els.titleInput.value.trim() || 'CV sans titre';
  els.previewTitle.textContent = title;
  els.previewFrame.srcdoc = buildPreviewDocument(els.htmlInput.value, els.cssInput.value);
}

function renderList() {
  els.cvList.innerHTML = '';

  if (!state.cvs.length) {
    els.cvList.innerHTML = '<p class="empty">Aucun CV enregistré.</p>';
    return;
  }

  state.cvs.forEach((cv) => {
    const button = document.createElement('button');
    button.className = `cv-item${cv.id === state.currentId ? ' active' : ''}`;
    button.type = 'button';
    button.innerHTML = `<strong>${cv.title}</strong><span>${formatDate(cv.updatedAt)}</span>`;
    button.addEventListener('click', () => loadCv(cv.id));
    els.cvList.appendChild(button);
  });
}

async function loadList() {
  const response = await fetch('/api/cvs');
  if (!response.ok) throw new Error('Impossible de charger les CV.');
  state.cvs = await response.json();
  renderList();
}

async function loadCv(id) {
  const response = await fetch(`/api/cvs/${id}`);
  if (!response.ok) throw new Error('CV introuvable.');
  const cv = await response.json();
  state.currentId = cv.id;
  els.titleInput.value = cv.title || '';
  els.htmlInput.value = cv.html || '';
  els.cssInput.value = cv.css || '';
  els.downloadButton.disabled = false;
  els.deleteButton.disabled = false;
  renderList();
  renderPreview();
  setStatus(`CV chargé: ${cv.title}`);
}

function newCv() {
  state.currentId = null;
  els.titleInput.value = '';
  els.htmlInput.value = '';
  els.cssInput.value = '';
  els.downloadButton.disabled = true;
  els.deleteButton.disabled = true;
  renderList();
  renderPreview();
  setStatus('Nouveau CV prêt. Colle le HTML et le CSS puis enregistre.');
}

async function saveCv() {
  const payload = {
    title: els.titleInput.value.trim(),
    html: els.htmlInput.value,
    css: els.cssInput.value
  };

  if (!payload.title || !payload.html.trim()) {
    setStatus('Titre et HTML obligatoires.');
    return;
  }

  const url = state.currentId ? `/api/cvs/${state.currentId}` : '/api/cvs';
  const method = state.currentId ? 'PUT' : 'POST';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erreur pendant l\'enregistrement.');
  }

  const saved = await response.json();
  state.currentId = saved.id;
  await loadList();
  renderPreview();
  els.downloadButton.disabled = false;
  els.deleteButton.disabled = false;
  setStatus('CV enregistré.');
}

async function deleteCv() {
  if (!state.currentId) return;
  const confirmed = confirm('Supprimer ce CV ?');
  if (!confirmed) return;

  const response = await fetch(`/api/cvs/${state.currentId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('Suppression impossible.');
  await loadList();
  newCv();
  setStatus('CV supprimé.');
}

async function downloadPdf() {
  if (!state.currentId) {
    setStatus('Enregistre ou sélectionne un CV avant de télécharger le PDF.');
    return;
  }

  setStatus('Génération du PDF...');
  const response = await fetch(`/api/cvs/${state.currentId}/pdf`, { method: 'POST' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erreur pendant la génération PDF.');
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match ? match[1] : 'cv.pdf';

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus('PDF téléchargé.');
}

async function uploadPp(event) {
  event.preventDefault();
  if (!els.ppInput.files.length) {
    setStatus('Choisis une image avant upload.');
    return;
  }

  const formData = new FormData();
  formData.append('pp', els.ppInput.files[0]);

  const response = await fetch('/api/pp', { method: 'POST', body: formData });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Upload impossible.');
  }

  state.ppVersion = Date.now();
  renderPreview();
  setStatus('Photo mise à jour pour tous les CV.');
}

function bindEvents() {
  els.newCvButton.addEventListener('click', newCv);
  els.saveButton.addEventListener('click', () => saveCv().catch((error) => setStatus(error.message)));
  els.deleteButton.addEventListener('click', () => deleteCv().catch((error) => setStatus(error.message)));
  els.downloadButton.addEventListener('click', () => downloadPdf().catch((error) => setStatus(error.message)));
  els.refreshButton.addEventListener('click', renderPreview);
  els.ppForm.addEventListener('submit', (event) => uploadPp(event).catch((error) => setStatus(error.message)));

  [els.titleInput, els.htmlInput, els.cssInput].forEach((input) => {
    input.addEventListener('input', () => {
      window.clearTimeout(input.previewTimer);
      input.previewTimer = window.setTimeout(renderPreview, 250);
    });
  });
}

async function boot() {
  bindEvents();
  els.downloadButton.disabled = true;
  els.deleteButton.disabled = true;
  await loadList();
  if (state.cvs[0]) {
    await loadCv(state.cvs[0].id);
  } else {
    newCv();
  }
}

boot().catch((error) => setStatus(error.message));
