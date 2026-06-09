const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CVS_DIR = path.join(DATA_DIR, 'cvs');
const LEGACY_CVS_FILE = path.join(DATA_DIR, 'cvs.json');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(UPLOADS_DIR, {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store')
}));
app.use(express.static(path.join(ROOT, 'public')));

function slugify(value) {
  return String(value || 'cv')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 70) || 'cv';
}

function assertSafeId(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,90}$/.test(String(id || ''))) {
    const error = new Error('Invalid CV id.');
    error.statusCode = 400;
    throw error;
  }
}

function cvDir(id) {
  assertSafeId(id);
  return path.join(CVS_DIR, id);
}

function cvPaths(id) {
  const dir = cvDir(id);
  return {
    dir,
    html: path.join(dir, 'index.html'),
    css: path.join(dir, 'styles.css'),
    metadata: path.join(dir, 'metadata.json')
  };
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw || 'null') || fallback;
  } catch {
    return fallback;
  }
}

async function uniqueCvId(title, currentId = null) {
  const base = slugify(title);
  let id = base;
  let counter = 2;

  while (id !== currentId && await exists(path.join(CVS_DIR, id))) {
    id = `${base}-${counter}`;
    counter += 1;
  }

  return id;
}

async function migrateLegacyJsonIfNeeded() {
  if (!(await exists(LEGACY_CVS_FILE))) return;

  const legacy = await readJson(LEGACY_CVS_FILE, []);
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  for (const item of legacy) {
    const title = item.title || 'Untitled CV';
    const id = await uniqueCvId(title);
    const now = new Date().toISOString();
    const createdAt = item.createdAt || now;
    const updatedAt = item.updatedAt || now;
    const paths = cvPaths(id);

    await fs.mkdir(paths.dir, { recursive: true });
    await fs.writeFile(paths.html, String(item.html || ''), 'utf8');
    await fs.writeFile(paths.css, String(item.css || ''), 'utf8');
    await fs.writeFile(paths.metadata, JSON.stringify({ id, title, createdAt, updatedAt }, null, 2), 'utf8');
  }

  await fs.rename(LEGACY_CVS_FILE, path.join(DATA_DIR, `cvs.migrated-${Date.now()}.json`));
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(CVS_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  await migrateLegacyJsonIfNeeded();
}

async function listCvIds() {
  await ensureStorage();
  const entries = await fs.readdir(CVS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => /^[a-z0-9][a-z0-9-]{0,90}$/.test(id));
}

async function readCvMetadata(id) {
  const paths = cvPaths(id);
  const metadata = await readJson(paths.metadata, null);
  if (!metadata) return null;
  return {
    id,
    title: metadata.title || id,
    createdAt: metadata.createdAt || null,
    updatedAt: metadata.updatedAt || null
  };
}

async function readCvsPublic() {
  const ids = await listCvIds();
  const metadataList = [];

  for (const id of ids) {
    const metadata = await readCvMetadata(id);
    if (metadata) metadataList.push(metadata);
  }

  return metadataList.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

async function readCv(id) {
  assertSafeId(id);
  const paths = cvPaths(id);
  const metadata = await readCvMetadata(id);
  if (!metadata) return null;

  const [html, css] = await Promise.all([
    fs.readFile(paths.html, 'utf8').catch(() => ''),
    fs.readFile(paths.css, 'utf8').catch(() => '')
  ]);

  return { ...metadata, html, css };
}

async function writeCv({ id, title, html, css, createdAt, updatedAt }) {
  const paths = cvPaths(id);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.html, String(html || ''), 'utf8');
  await fs.writeFile(paths.css, String(css || ''), 'utf8');
  await fs.writeFile(paths.metadata, JSON.stringify({ id, title, createdAt, updatedAt }, null, 2), 'utf8');
}

function patchPpPath(html, ppUrl) {
  return String(html || '')
    .replace(/src=(['\"])pp\.png\1/g, `src=$1${ppUrl}$1`)
    .replace(/src=(['\"])\.\/pp\.png\1/g, `src=$1${ppUrl}$1`)
    .replace(/src=(['\"])img\/Media\.jpg\1/g, `src=$1${ppUrl}$1`);
}

function injectCssIntoFullDocument(html, css, ppUrl) {
  let documentHtml = patchPpPath(html, ppUrl);
  const injected = `\n<style id="cv-hub-injected-css">\n${css || ''}\n</style>\n<style>\n@page { size: A4; margin: 8mm 9mm; }\nbody { -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n</style>\n`;

  if (/<\/head>/i.test(documentHtml)) {
    return documentHtml.replace(/<\/head>/i, `${injected}</head>`);
  }

  if (/<html[^>]*>/i.test(documentHtml)) {
    return documentHtml.replace(/<html[^>]*>/i, (match) => `${match}<head>${injected}</head>`);
  }

  return `<!doctype html><html lang="en"><head>${injected}</head><body>${documentHtml}</body></html>`;
}

function buildPdfHtml(cv, ppUrl) {
  const html = cv.html || '';
  const css = cv.css || '';

  if (/<html[\s>]/i.test(html)) {
    return injectCssIntoFullDocument(html, css, ppUrl);
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${cv.title || 'CV'}</title>
  <style>${css}</style>
  <style>
    @page { size: A4; margin: 8mm 9mm; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
</head>
<body>${patchPpPath(html, ppUrl)}</body>
</html>`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, 'pp.png')
  }),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error('Only PNG, JPG or WEBP images are allowed.'));
      return;
    }
    cb(null, true);
  }
});

app.get('/api/cvs', async (req, res, next) => {
  try {
    res.json(await readCvsPublic());
  } catch (error) {
    next(error);
  }
});

app.get('/api/cvs/:id', async (req, res, next) => {
  try {
    const cv = await readCv(req.params.id);
    if (!cv) return res.status(404).json({ error: 'CV not found' });
    res.json(cv);
  } catch (error) {
    next(error);
  }
});

app.post('/api/cvs', async (req, res, next) => {
  try {
    const { title, html, css } = req.body;
    if (!title || !String(html || '').trim()) {
      return res.status(400).json({ error: 'title and html are required' });
    }

    const now = new Date().toISOString();
    const id = await uniqueCvId(title);
    const cv = {
      id,
      title: String(title).trim(),
      html: String(html),
      css: String(css || ''),
      createdAt: now,
      updatedAt: now
    };

    await writeCv(cv);
    res.status(201).json(cv);
  } catch (error) {
    next(error);
  }
});

app.put('/api/cvs/:id', async (req, res, next) => {
  try {
    const existing = await readCv(req.params.id);
    if (!existing) return res.status(404).json({ error: 'CV not found' });

    const title = String(req.body.title || existing.title).trim();
    const newId = slugify(title) === existing.id ? existing.id : await uniqueCvId(title, existing.id);
    const updated = {
      id: newId,
      title,
      html: typeof req.body.html === 'string' ? req.body.html : existing.html,
      css: typeof req.body.css === 'string' ? req.body.css : existing.css,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString()
    };

    await writeCv(updated);

    if (newId !== existing.id) {
      await fs.rm(cvDir(existing.id), { recursive: true, force: true });
    }

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/cvs/:id', async (req, res, next) => {
  try {
    const existing = await readCv(req.params.id);
    if (!existing) return res.status(404).json({ error: 'CV not found' });
    await fs.rm(cvDir(req.params.id), { recursive: true, force: true });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/pp', upload.single('pp'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ ok: true, url: `/uploads/pp.png?v=${Date.now()}` });
});

app.post('/api/cvs/:id/pdf', async (req, res, next) => {
  let browser;
  try {
    const cv = await readCv(req.params.id);
    if (!cv) return res.status(404).json({ error: 'CV not found' });

    const ppUrl = `${req.protocol}://${req.get('host')}/uploads/pp.png`;
    const pdfHtml = buildPdfHtml(cv, ppUrl);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 1448 }, deviceScaleFactor: 1 });
    await page.setContent(pdfHtml, { waitUntil: 'networkidle' });
    await page.evaluateHandle('document.fonts ? document.fonts.ready : Promise.resolve()');
    await page.emulateMedia({ media: 'print' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${slugify(cv.title)}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  } finally {
    if (browser) await browser.close();
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
});

ensureStorage().then(() => {
  app.listen(PORT, () => {
    console.log(`CV Hub running on http://localhost:${PORT}`);
    console.log(`CV folders are stored in ${CVS_DIR}`);
  });
});
