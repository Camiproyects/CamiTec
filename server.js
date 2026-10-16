const http = require('http');

const fs = require('fs');

const path = require('path');

const crypto = require('crypto');



// Carga .env sin dependencias externas.

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {

  const env = fs.readFileSync(envPath, 'utf8');

  for (const line of env.split(/\r?\n/)) {

    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');

    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();

    const value = trimmed.slice(separator + 1).trim();

    if (!process.env[key]) process.env[key] = value;

  }

}



const PORT = Number(process.env.PORT) || 3000;

const ROOT = path.resolve(__dirname);

const DATA_FILE = path.join(ROOT, 'data.csv');
const DATA_DIR = path.join(ROOT, 'data');
const TERMS_FILE = path.join(DATA_DIR, 'terminos.txt');

const BACKUP_DIR = path.join(ROOT, 'backups');

const LOG_DIR = path.join(ROOT, 'logs');

const ERROR_LOG_FILE = path.join(LOG_DIR, 'errors.jsonl');
const CONSULTATIONS_FILE = path.join(LOG_DIR, 'consultas.jsonl');
const MAX_CONSULTATIONS = 15000;
const CONSULTATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CONSULTATION_WINDOW_MS = 10 * 60 * 1000;
const CONSULTATION_MAX_ATTEMPTS = 80;

const MAX_ERROR_LOG_BYTES = 2 * 1024 * 1024;

const MAX_ERROR_LOG_ENTRIES = 2000;

const ERROR_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const BODY_LIMIT_BYTES = 1024 * 1024;

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const LOGIN_MAX_ATTEMPTS = 10;



const sessions = new Map();

const loginAttempts = new Map();
const consultationAttempts = new Map();



const MIME_TYPES = {

  '.html': 'text/html; charset=utf-8',

  '.css': 'text/css; charset=utf-8',

  '.js': 'application/javascript; charset=utf-8',

  '.json': 'application/json; charset=utf-8',

  '.ico': 'image/x-icon',

  '.png': 'image/png',

  '.jpg': 'image/jpeg',

  '.jpeg': 'image/jpeg',

  '.webp': 'image/webp',

  '.svg': 'image/svg+xml',

  '.woff': 'font/woff',

  '.woff2': 'font/woff2'

};



// Archivos estáticos públicos permitidos. No se exponen carpetas completas.

// Si agregas un CSS, JS o imagen nuevo, añádelo aquí con su ruta exacta.

const STATIC_FILE_ROUTES = new Map([

  ['/assets/css/style.css', 'assets/css/style.css'],

  ['/assets/css/cotizador.css', 'assets/css/cotizador.css'],

  ['/assets/css/admin.css', 'assets/css/admin.css'],

  ['/assets/css/tyc.css', 'assets/css/tyc.css'],

  ['/assets/css/404.css', 'assets/css/404.css'],

  ['/assets/js/app.js', 'assets/js/app.js'],

  ['/assets/js/cotizador.js', 'assets/js/cotizador.js'],

  ['/assets/js/login.js', 'assets/js/login.js'],

  ['/assets/js/admin.js', 'assets/js/admin.js'],

  ['/assets/img/techlag-404.png', 'assets/img/techlag-404.png'],
  ['/assets/img/logo.jpg', 'assets/img/logo.jpg'],
  ['/assets/img/logo.jpeg', 'assets/img/logo.jpeg']

]);



if (!ADMIN_PASSWORD_HASH) {

  console.error('ERROR: Falta ADMIN_PASSWORD_HASH en .env');

  process.exit(1);

}

if (!/^scrypt:[a-f0-9]+:[a-f0-9]{128}$/i.test(ADMIN_PASSWORD_HASH)) {

  console.error('ERROR: ADMIN_PASSWORD_HASH no tiene el formato scrypt esperado.');

  process.exit(1);

}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });



function errorLabel(statusCode) {

  const labels = {

    400: 'Solicitud inválida',

    401: 'No autenticado',

    403: 'Acceso denegado',

    404: 'Recurso no encontrado',

    413: 'Solicitud demasiado grande',

    429: 'Demasiados intentos',

    500: 'Error interno del servidor',

    503: 'Servicio no disponible'

  };

  return labels[statusCode] || `Error HTTP ${statusCode}`;

}



function readErrorLog() {

  try {

    if (!fs.existsSync(ERROR_LOG_FILE)) return [];

    return fs.readFileSync(ERROR_LOG_FILE, 'utf8')

      .split(/\r?\n/)

      .filter(Boolean)

      .map(line => {

        try { return JSON.parse(line); } catch { return null; }

      })

      .filter(Boolean);

  } catch (error) {

    console.error('No se pudo leer el registro de errores:', error.message);

    return [];

  }

}



function pruneErrorLog() {

  const cutoff = Date.now() - ERROR_LOG_RETENTION_MS;

  const entries = readErrorLog()

    .filter(item => Number.isFinite(Date.parse(item.timestamp)) && Date.parse(item.timestamp) >= cutoff)

    .slice(-MAX_ERROR_LOG_ENTRIES);



  try {

    fs.writeFileSync(

      ERROR_LOG_FILE,

      entries.map(item => JSON.stringify(item)).join('\n') + (entries.length ? '\n' : ''),

      { encoding: 'utf8', mode: 0o600 }

    );

  } catch (error) {

    console.error('No se pudo depurar el registro de errores:', error.message);

  }

}



function recordHttpError(entry) {

  try {

    // Solo se guardan datos técnicos mínimos. No se registran query strings,

    // cuerpos de solicitudes, cookies, contraseñas ni tokens.

    const safeEntry = {

      id: crypto.randomBytes(8).toString('hex'),

      timestamp: new Date().toISOString(),

      status: Number(entry.status) || 500,

      method: String(entry.method || 'GET').slice(0, 10),

      path: String(entry.path || '/').slice(0, 180),

      message: errorLabel(Number(entry.status) || 500)

    };



    fs.appendFileSync(ERROR_LOG_FILE, JSON.stringify(safeEntry) + '\n', {

      encoding: 'utf8',

      mode: 0o600

    });



    const stat = fs.statSync(ERROR_LOG_FILE);

    if (stat.size > MAX_ERROR_LOG_BYTES) pruneErrorLog();

  } catch (error) {

    // El fallo del registro no debe detener el servidor.

    console.error('No se pudo registrar un error HTTP:', error.message);

  }

}



function errorSummary(entries) {

  const counts = {};

  for (const entry of entries) {

    counts[entry.status] = (counts[entry.status] || 0) + 1;

  }

  return Object.entries(counts)

    .map(([status, count]) => ({ status: Number(status), count }))

    .sort((a, b) => b.count - a.count);

}



function parseCookies(req) {

  const cookies = {};

  for (const part of (req.headers.cookie || '').split(';')) {

    const index = part.indexOf('=');

    if (index < 0) continue;

    const key = part.slice(0, index).trim();

    const rawValue = part.slice(index + 1).trim();

    try { cookies[key] = decodeURIComponent(rawValue); } catch { /* Ignorar cookie malformada. */ }

  }

  return cookies;

}



function createSession() { return crypto.randomBytes(32).toString('hex'); }

function createCSRFToken() { return crypto.randomBytes(32).toString('hex'); }



function requireAuth(req, res) {

  const sessionId = parseCookies(req).techlag_session;

  const session = sessions.get(sessionId);

  if (!session) {

    sendJSON(res, 401, { error: 'No autorizado' });

    return null;

  }

  if (Date.now() >= session.expiresAt) {

    sessions.delete(sessionId);

    sendJSON(res, 401, { error: 'Sesión expirada' });

    return null;

  }

  return session;

}



function checkCSRF(req, session) {

  const supplied = req.headers['x-csrf-token'];

  if (typeof supplied !== 'string' || supplied.length !== session.csrf.length) return false;

  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrf));

}



function securityHeaders(res) {

  res.setHeader('X-Content-Type-Options', 'nosniff');

  res.setHeader('X-Frame-Options', 'DENY');

  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");

  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

}



function sendJSON(res, statusCode, data) {

  res.statusCode = statusCode;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  res.setHeader('Cache-Control', 'no-store');

  res.end(JSON.stringify(data));

}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {

  res.statusCode = statusCode;

  res.setHeader('Content-Type', contentType);

  if (statusCode !== 200) res.setHeader('Cache-Control', 'no-store');

  res.end(text);

}



function sendNotFound(res) {

  if (res.headersSent || res.destroyed) return;



  const errorPage = path.join(ROOT, '404.html');

  let html;

  try {

    html = fs.readFileSync(errorPage, 'utf8');

  } catch {

    sendText(res, 404, 'Página no encontrada');

    return;

  }



  res.statusCode = 404;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  res.setHeader('Cache-Control', 'no-store');

  res.end(html);

}



function serveFile(res, filePath) {

  const resolved = path.resolve(filePath);

  if (!resolved.startsWith(ROOT + path.sep) && resolved !== path.join(ROOT, 'index.html')) {

    sendNotFound(res);

    return;

  }



  let stat;

  try {

    stat = fs.statSync(resolved);

  } catch {

    sendNotFound(res);

    return;

  }



  if (!stat.isFile()) {

    sendNotFound(res);

    return;

  }



  res.statusCode = 200;

  res.setHeader('Content-Type', MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream');

  res.setHeader('Cache-Control', 'no-cache');



  const stream = fs.createReadStream(resolved);

  stream.on('error', () => {

    if (!res.headersSent) sendText(res, 500, 'Error al leer el archivo');

    else res.destroy();

  });

  stream.pipe(res);

}



function readBody(req) {

  return new Promise((resolve, reject) => {

    let body = '';

    let tooLarge = false;

    req.on('data', chunk => {

      if (tooLarge) return;

      body += chunk.toString('utf8');

      if (Buffer.byteLength(body, 'utf8') > BODY_LIMIT_BYTES) {

        tooLarge = true;

        body = '';

      }

    });

    req.on('end', () => {

      if (tooLarge) { const error = new Error('Solicitud demasiado grande'); error.statusCode = 413; reject(error); return; }

      try {

        const parsed = body ? JSON.parse(body) : {};

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON debe ser un objeto');

        resolve(parsed);

      } catch {

        const error = new Error('JSON inválido'); error.statusCode = 400; reject(error);

      }

    });

    req.on('error', reject);

  });

}



function hasUnsafeSpreadsheetPrefix(value) {

  const text = String(value);

  return /^[\s\u0000-\u001f]*[=+@]/.test(text) || /^[\s\u0000-\u001f]*-\s*\d/.test(text);

}

function normalizeCatalogPart(value) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('es');
}
function duplicateCatalogRow(rows) {
  const seen = new Set();
  for (const row of rows) {
    const key = [row.marca, row.modelo, row.servicio, row.calidad].map(normalizeCatalogPart).join('\u0000');
    if (seen.has(key)) return row;
    seen.add(key);
  }
  return null;
}

function validateRow(row) {

  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;

  for (const [field, max] of [['marca', 80], ['modelo', 100], ['servicio', 80], ['calidad', 40]]) {

    const value = row[field];

    if (typeof value !== 'string' || !value.trim() || value.length > max) return false;

    if (/[\r\n,"\u0000-\u001f]/.test(value) || hasUnsafeSpreadsheetPrefix(value)) return false;

  }

  if (!['generica', 'oem', 'original'].includes(row.calidad.toLowerCase())) return false;

  if (typeof row.precio !== 'string' || !/^\d{1,9}$/.test(row.precio)) return false;

  const price = Number(row.precio);

  return Number.isSafeInteger(price) && price >= 0 && price <= 100000000;

}

function rowsToCSV(rows) {

  return ['marca,modelo,servicio,calidad,precio', ...rows.map(row => [row.marca, row.modelo, row.servicio, row.calidad, row.precio].join(','))].join('\n') + '\n';

}

// Parser CSV sencillo y estricto: el formato validado no admite comas, comillas ni saltos de línea en campos.

function csvToRows(text) {

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => line.trim() !== '');

  if (!lines.length) return [];

  const expected = 'marca,modelo,servicio,calidad,precio';

  if (lines[0].trim() !== expected) throw new Error('Encabezado CSV inválido');

  const rows = [];

  for (let i = 1; i < lines.length; i++) {

    const parts = lines[i].split(',');

    if (parts.length !== 5) throw new Error(`Fila CSV inválida en línea ${i + 1}`);

    const row = { marca: parts[0].trim(), modelo: parts[1].trim(), servicio: parts[2].trim(), calidad: parts[3].trim(), precio: parts[4].trim() };

    if (!validateRow(row)) throw new Error(`Datos CSV inválidos en línea ${i + 1}`);

    rows.push(row);

  }

  return rows;

}

function createBackup() {

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `data-${timestamp}.csv`), fs.constants.COPYFILE_EXCL);

}

function saveRows(rows) {

  const csv = rowsToCSV(rows);

  createBackup();

  const temporaryFile = `${DATA_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`;

  try {

    fs.writeFileSync(temporaryFile, csv, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

    fs.renameSync(temporaryFile, DATA_FILE);

  } catch (error) {

    try { fs.unlinkSync(temporaryFile); } catch { /* Archivo temporal no creado o ya eliminado. */ }

    throw error;

  }

}

function comparePassword(password, storedHash) {

  try {

    const [algorithm, salt, hash] = storedHash.split(':');

    if (algorithm !== 'scrypt' || !salt || !hash || !/^[a-f0-9]{32,128}$/i.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) return false;

    const derived = crypto.scryptSync(password, salt, 64).toString('hex');

    return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'));

  } catch { return false; }

}

function loginKey(req) { return req.socket.remoteAddress || 'unknown'; }

function isLoginBlocked(key) {

  const record = loginAttempts.get(key);

  if (!record) return false;

  if (Date.now() - record.windowStart >= LOGIN_WINDOW_MS) { loginAttempts.delete(key); return false; }

  return record.count >= LOGIN_MAX_ATTEMPTS;

}

function recordLoginFailure(key) {

  const now = Date.now();

  let record = loginAttempts.get(key);

  if (!record || now - record.windowStart >= LOGIN_WINDOW_MS) record = { count: 0, windowStart: now };

  record.count++;

  loginAttempts.set(key, record);

}

function sessionCookie(sessionId) {

  return `techlag_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${IS_PRODUCTION ? '; Secure' : ''}`;

}

function clearSessionCookie() {

  return `techlag_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`;

}



// Limpieza periódica de sesiones vencidas y contadores de login antiguos.

const cleanupTimer = setInterval(() => {

  const now = Date.now();

  for (const [id, session] of sessions) if (now >= session.expiresAt) sessions.delete(id);

  for (const [key, record] of loginAttempts) if (now - record.windowStart >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
  for (const [key, record] of consultationAttempts) if (now - record.windowStart >= CONSULTATION_WINDOW_MS) consultationAttempts.delete(key);

}, 10 * 60 * 1000);

cleanupTimer.unref();



function atomicWriteFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryFile, filePath);
  } catch (error) {
    try { fs.unlinkSync(temporaryFile); } catch { /* temporal ausente */ }
    throw error;
  }
}

function decodeBasicHtmlEntities(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const number = parseInt(code, 16);
      return Number.isFinite(number) && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    })
    .replace(/&#([0-9]+);/g, (_, code) => {
      const number = Number(code);
      return Number.isFinite(number) && number <= 0x10ffff ? String.fromCodePoint(number) : '';
    });
}

function extractTermsTextFromHtml(html) {
  let source = String(html || '');
  const main = source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const article = source.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  source = main ? main[1] : (article ? article[1] : (body ? body[1] : source));
  source = source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|section|article|div|main|ul|ol)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  source = decodeBasicHtmlEntities(source)
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
  return source.slice(0, 50000);
}

function defaultTermsText() {
  const existingPage = path.join(ROOT, 'legal', 'terminos.html');
  if (fs.existsSync(existingPage)) {
    try {
      const extracted = extractTermsTextFromHtml(fs.readFileSync(existingPage, 'utf8'));
      if (extracted.length >= 20) return extracted;
    } catch (error) {
      console.error('No se pudo leer la página original de términos:', error.message);
    }
  }
  return [
    '# Términos y condiciones',
    '',
    'Estas condiciones describen el uso del cotizador TECH-LAG. Antes de publicar una versión definitiva, revisa y adapta el texto a las políticas reales del negocio.',
    '',
    '## Cotizaciones y precios estimados',
    'Los valores mostrados en el cotizador son estimaciones y pueden cambiar después de revisar físicamente el equipo y confirmar el repuesto requerido.',
    '',
    '## Diagnóstico y reparación',
    'La reparación, disponibilidad del repuesto, plazo y precio final deben confirmarse con TECH-LAG antes de iniciar el servicio.',
    '',
    '## Contacto y aceptación',
    'Al continuar con una solicitud, el cliente declara haber leído las condiciones publicadas. Mantén esta sección actualizada con las condiciones comerciales vigentes.'
  ].join('\n');
}

function readTermsText() {
  try {
    if (fs.existsSync(TERMS_FILE)) return fs.readFileSync(TERMS_FILE, 'utf8').slice(0, 50000);
  } catch (error) {
    console.error('No se pudieron leer los términos guardados:', error.message);
  }
  return defaultTermsText();
}

function escapeHtmlServer(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function termsTextToHtml(content) {
  const blocks = String(content || '').trim().split(/\n\s*\n/).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return '';
    if (/^#{1,2}\s+/.test(lines[0])) {
      const heading = lines[0].replace(/^#{1,2}\s+/, '');
      return `<h2>${escapeHtmlServer(heading)}</h2>${lines.slice(1).length ? `<p>${lines.slice(1).map(escapeHtmlServer).join('<br>')}</p>` : ''}`;
    }
    if (lines.every(line => /^[-•]\s+/.test(line))) {
      return `<ul>${lines.map(line => `<li>${escapeHtmlServer(line.replace(/^[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(escapeHtmlServer).join('<br>')}</p>`;
  }).join('\n');
}

function sendTermsPage(res) {
  const content = readTermsText();
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0b1020"><title>Términos y condiciones | TECH-LAG</title>
<style>
:root{color-scheme:dark;--bg:#0b1020;--panel:#111a2c;--line:#29364d;--text:#edf2ff;--muted:#a4b0c4;--accent:#a99eff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at top,#17213a 0,var(--bg) 48%);color:var(--text);font:16px/1.75 Inter,system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh}.site-header{border-bottom:1px solid var(--line);background:rgba(9,14,27,.78)}.site-header-inner{max-width:960px;padding:20px 24px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:16px}.logo{font-weight:850;letter-spacing:.03em}.logo span{color:var(--accent)}nav{display:flex;gap:18px;flex-wrap:wrap}a{color:var(--accent);text-decoration:none;font-weight:650}a:hover{text-decoration:underline}.page{width:min(900px,calc(100% - 32px));margin:48px auto 64px}.page-kicker{text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:750;color:var(--accent)}h1{font-size:clamp(2rem,5vw,3.3rem);line-height:1.15;letter-spacing:-.04em;margin:.55rem 0 1.5rem}.terms-content{background:linear-gradient(145deg,rgba(17,26,44,.98),rgba(14,21,36,.96));border:1px solid var(--line);border-radius:22px;padding:clamp(22px,5vw,46px);box-shadow:0 20px 70px #0004;overflow-wrap:anywhere}.terms-content h2{font-size:1.2rem;line-height:1.4;margin:1.7rem 0 .45rem;color:#dcd7ff}.terms-content h2:first-child{margin-top:0}.terms-content p{margin:.7rem 0;color:#d5deed}.terms-content ul{padding-left:1.4rem;color:#d5deed}.page-footer{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:24px;color:var(--muted);font-size:.85rem}@media(max-width:560px){.site-header-inner{align-items:flex-start;flex-direction:column}.page{margin-top:30px}.terms-content{border-radius:16px}}
</style></head><body><header class="site-header"><div class="site-header-inner"><a class="logo" href="/">TECH<span>-LAG</span></a><nav aria-label="Navegación"><a href="/">Inicio</a><a href="/cotizador.html">Cotizador</a></nav></div></header><main class="page"><span class="page-kicker">Información legal</span><h1>Términos y condiciones</h1><article class="terms-content">${termsTextToHtml(content)}</article><footer class="page-footer"><span>TECH-LAG · Información para clientes</span><a href="/cotizador.html">Volver al cotizador →</a></footer></main></body></html>`;
  res.setHeader('Cache-Control', 'no-store');
  sendText(res, 200, html, 'text/html; charset=utf-8');
}

function readConsultations() {
  try {
    if (!fs.existsSync(CONSULTATIONS_FILE)) return [];
    return fs.readFileSync(CONSULTATIONS_FILE, 'utf8')
      .split(/\r?\n/).filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(item => item && Number.isFinite(Date.parse(item.timestamp)));
  } catch (error) {
    console.error('No se pudieron leer las consultas:', error.message);
    return [];
  }
}

function pruneConsultations() {
  const cutoff = Date.now() - CONSULTATION_RETENTION_MS;
  const entries = readConsultations()
    .filter(item => Date.parse(item.timestamp) >= cutoff)
    .slice(-MAX_CONSULTATIONS);
  try {
    atomicWriteFile(CONSULTATIONS_FILE, entries.map(item => JSON.stringify(item)).join('\n') + (entries.length ? '\n' : ''));
  } catch (error) {
    console.error('No se pudieron depurar las consultas:', error.message);
  }
}

function allowConsultationRequest(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let record = consultationAttempts.get(key);
  if (!record || now - record.windowStart >= CONSULTATION_WINDOW_MS) {
    record = { count: 0, windowStart: now };
  }
  record.count++;
  consultationAttempts.set(key, record);
  return record.count <= CONSULTATION_MAX_ATTEMPTS;
}

function getConsultationAnalytics(days = 30) {
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const entries = readConsultations().filter(item => Date.parse(item.timestamp) >= cutoff);
  const itemGroups = new Map();
  const serviceGroups = new Map();
  for (const item of entries) {
    const itemKey = [item.marca, item.modelo, item.servicio, item.calidad].join('\u0000');
    const itemGroup = itemGroups.get(itemKey) || { marca: item.marca, modelo: item.modelo, servicio: item.servicio, calidad: item.calidad, consultas: 0 };
    itemGroup.consultas++;
    itemGroups.set(itemKey, itemGroup);

    const serviceKey = String(item.servicio).toLocaleLowerCase('es');
    const serviceGroup = serviceGroups.get(serviceKey) || { servicio: item.servicio, consultas: 0, modelKeys: new Set() };
    serviceGroup.consultas++;
    serviceGroup.modelKeys.add(`${item.marca}\u0000${item.modelo}`);
    serviceGroups.set(serviceKey, serviceGroup);
  }
  const topRepuestos = [...itemGroups.values()].sort((a, b) => b.consultas - a.consultas).slice(0, 20);
  const topServicios = [...serviceGroups.values()]
    .map(item => ({ servicio: item.servicio, consultas: item.consultas, modelos: item.modelKeys.size }))
    .sort((a, b) => b.consultas - a.consultas).slice(0, 20);
  return { days, total: entries.length, topRepuestos, topServicios };
}

const server = http.createServer(async (req, res) => {

  securityHeaders(res);

  try {

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    const pathname = decodeURIComponent(url.pathname);

    res.once('finish', () => {

      if (res.statusCode >= 400) {

        recordHttpError({ status: res.statusCode, method: req.method, path: pathname });

      }

    });



    if (pathname === '/api/login' && req.method === 'POST') {

      const key = loginKey(req);

      if (isLoginBlocked(key)) {

        res.setHeader('Retry-After', String(Math.ceil(LOGIN_WINDOW_MS / 1000)));

        sendJSON(res, 429, { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' });

        return;

      }

      const body = await readBody(req);

      const username = typeof body.username === 'string' ? body.username : '';

      const password = typeof body.password === 'string' ? body.password : '';

      if (username.length > 100 || password.length > 200 || !username || !password) {

        sendJSON(res, 400, { error: 'Datos inválidos' }); return;

      }

      if (username !== ADMIN_USER || !comparePassword(password, ADMIN_PASSWORD_HASH)) {

        recordLoginFailure(key);

        sendJSON(res, 401, { error: 'Usuario o contraseña incorrectos' }); return;

      }

      loginAttempts.delete(key);

      const sessionId = createSession();

      const session = { csrf: createCSRFToken(), expiresAt: Date.now() + SESSION_TTL_MS };

      sessions.set(sessionId, session);

      res.setHeader('Set-Cookie', sessionCookie(sessionId));

      sendJSON(res, 200, { success: true, csrf: session.csrf });

      return;

    }



    if (pathname === '/api/logout' && req.method === 'POST') {

      const cookies = parseCookies(req);

      const session = sessions.get(cookies.techlag_session);

      if (session && !checkCSRF(req, session)) { sendJSON(res, 403, { error: 'CSRF inválido' }); return; }

      if (cookies.techlag_session) sessions.delete(cookies.techlag_session);

      res.setHeader('Set-Cookie', clearSessionCookie());

      sendJSON(res, 200, { success: true });

      return;

    }



    if (pathname === '/api/session' && req.method === 'GET') {

      const session = requireAuth(req, res);

      if (!session) return;

      sendJSON(res, 200, { authenticated: true, csrf: session.csrf });

      return;

    }



    if (pathname === '/api/admin/errores' && req.method === 'GET') {

      const session = requireAuth(req, res);

      if (!session) return;



      pruneErrorLog();

      const entries = readErrorLog().slice(-500).reverse();

      sendJSON(res, 200, {

        total: entries.length,

        summary: errorSummary(entries),

        entries

      });

      return;

    }



    if (pathname === '/api/admin/errores' && req.method === 'DELETE') {

      const session = requireAuth(req, res);

      if (!session) return;

      if (!checkCSRF(req, session)) {

        sendJSON(res, 403, { error: 'CSRF inválido' });

        return;

      }



      fs.writeFileSync(ERROR_LOG_FILE, '', { encoding: 'utf8', mode: 0o600 });

      sendJSON(res, 200, { success: true });

      return;

    }



    // Registrar una consulta válida del cotizador. No se conserva IP ni información personal.
    if (pathname === '/api/consultas' && req.method === 'POST') {
      if (!allowConsultationRequest(req)) {
        sendJSON(res, 429, { error: 'Demasiadas consultas en un periodo corto.' });
        return;
      }
      const body = await readBody(req);
      const fields = ['marca', 'modelo', 'servicio', 'calidad'];
      if (fields.some(field => typeof body[field] !== 'string' || !body[field].trim() || body[field].length > 100) || !Number.isSafeInteger(Number(body.precio)) || Number(body.precio) <= 0 || Number(body.precio) > 100000000) {
        sendJSON(res, 400, { error: 'Consulta incompleta o inválida.' });
        return;
      }
      if (!fs.existsSync(DATA_FILE)) {
        sendJSON(res, 503, { error: 'Catálogo no disponible.' });
        return;
      }
      const catalog = csvToRows(fs.readFileSync(DATA_FILE, 'utf8'));
      const match = catalog.find(row => row.marca === body.marca.trim() && row.modelo === body.modelo.trim() && row.servicio === body.servicio.trim() && row.calidad === body.calidad.trim() && Number(row.precio) === Number(body.precio));
      if (!match) {
        sendJSON(res, 409, { error: 'La combinación ya no coincide con el catálogo actual.' });
        return;
      }
      try {
        fs.appendFileSync(CONSULTATIONS_FILE, JSON.stringify({
          timestamp: new Date().toISOString(),
          marca: match.marca,
          modelo: match.modelo,
          servicio: match.servicio,
          calidad: match.calidad,
          precio: Number(match.precio)
        }) + '\n', { encoding: 'utf8', mode: 0o600 });
        const stat = fs.statSync(CONSULTATIONS_FILE);
        if (stat.size > 4 * 1024 * 1024) pruneConsultations();
      } catch (error) {
        console.error('No se pudo guardar la consulta:', error.message);
        sendJSON(res, 500, { error: 'No se pudo registrar la consulta.' });
        return;
      }
      sendJSON(res, 202, { success: true });
      return;
    }

    // Estadísticas de uso disponibles solo para el administrador autenticado.
    if (pathname === '/api/admin/consultas' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      const requestedDays = Number(url.searchParams.get('days') || 30);
      const days = [7, 30, 90].includes(requestedDays) ? requestedDays : 30;
      const cutoff = Date.now() - CONSULTATION_RETENTION_MS;
      if (readConsultations().some(item => Date.parse(item.timestamp) < cutoff)) pruneConsultations();
      sendJSON(res, 200, getConsultationAnalytics(days));
      return;
    }

    // Leer términos y condiciones actuales para el editor autenticado.
    if (pathname === '/api/admin/terminos' && req.method === 'GET') {
      const session = requireAuth(req, res);
      if (!session) return;
      sendJSON(res, 200, { content: readTermsText() });
      return;
    }

    // Guardar el texto legal como texto plano; el servidor lo escapa al publicarlo para evitar HTML/XSS.
    if (pathname === '/api/admin/terminos' && req.method === 'PUT') {
      const session = requireAuth(req, res);
      if (!session) return;
      if (!checkCSRF(req, session)) {
        sendJSON(res, 403, { error: 'CSRF inválido' });
        return;
      }
      const body = await readBody(req);
      if (typeof body.content !== 'string') {
        sendJSON(res, 400, { error: 'El contenido debe ser texto.' });
        return;
      }
      const content = body.content.trim();
      if (content.length < 20 || content.length > 50000) {
        sendJSON(res, 400, { error: 'El contenido debe tener entre 20 y 50.000 caracteres.' });
        return;
      }
      try {
        if (fs.existsSync(TERMS_FILE)) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          fs.copyFileSync(TERMS_FILE, path.join(BACKUP_DIR, `terminos-${timestamp}.txt`), fs.constants.COPYFILE_EXCL);
        }
        atomicWriteFile(TERMS_FILE, content + '\n');
      } catch (error) {
        console.error('No se pudieron guardar los términos:', error.message);
        sendJSON(res, 500, { error: 'No se pudo guardar el contenido legal.' });
        return;
      }
      sendJSON(res, 200, { success: true, length: content.length });
      return;
    }

    if (pathname === '/api/catalogo' && req.method === 'GET') {

      if (!fs.existsSync(DATA_FILE)) { sendJSON(res, 500, { error: 'Catálogo no disponible' }); return; }

      const csv = fs.readFileSync(DATA_FILE, 'utf8');

      sendText(res, 200, csv, 'text/csv; charset=utf-8');

      return;

    }



    if (pathname === '/api/admin/datos' && req.method === 'GET') {

      const session = requireAuth(req, res);

      if (!session) return;

      const rows = csvToRows(fs.readFileSync(DATA_FILE, 'utf8'));

      sendJSON(res, 200, { rows });

      return;

    }



    if (pathname === '/api/admin/datos' && req.method === 'PUT') {

      const session = requireAuth(req, res);

      if (!session) return;

      if (!checkCSRF(req, session)) { sendJSON(res, 403, { error: 'CSRF inválido' }); return; }

      const body = await readBody(req);

      if (!Array.isArray(body.rows)) { sendJSON(res, 400, { error: 'Formato inválido' }); return; }

      if (body.rows.length > 10000) { sendJSON(res, 400, { error: 'Demasiados registros' }); return; }

      const rows = body.rows.map(row => {

        if (!row || typeof row !== 'object' || Array.isArray(row)) return null;

        return {

          marca: typeof row.marca === 'string' ? row.marca.trim() : '',

          modelo: typeof row.modelo === 'string' ? row.modelo.trim() : '',

          servicio: typeof row.servicio === 'string' ? row.servicio.trim() : '',

          calidad: typeof row.calidad === 'string' ? row.calidad.trim() : '',

          precio: typeof row.precio === 'number' && Number.isSafeInteger(row.precio) ? String(row.precio) : (typeof row.precio === 'string' ? row.precio.trim() : '')

        };

      });

      if (!rows.every(validateRow)) { sendJSON(res, 400, { error: 'Uno o más registros son inválidos' }); return; }

      const duplicate = duplicateCatalogRow(rows);
      if (duplicate) {
        sendJSON(res, 409, { error: `Combinación duplicada: ${duplicate.marca} ${duplicate.modelo} · ${duplicate.servicio} · ${duplicate.calidad}. Cada calidad solo puede registrarse una vez para el mismo servicio del modelo.` });
        return;
      }

      saveRows(rows);

      sendJSON(res, 200, { success: true, count: rows.length });

      return;

    }



    // Navegación al panel: si no hay sesión, mostrar el formulario de acceso.

    // Las rutas API siguen usando requireAuth() y responden 401 en JSON.

    if ((pathname === '/admin' || pathname === '/admin/') && req.method === 'GET') {

      const sessionId = parseCookies(req).techlag_session;

      const session = sessions.get(sessionId);



      if (!session || Date.now() >= session.expiresAt) {

        if (sessionId) sessions.delete(sessionId);

        res.statusCode = 302;

        res.setHeader('Location', '/admin/login');

        res.setHeader('Cache-Control', 'no-store');

        res.end();

        return;

      }



      serveFile(res, path.join(ROOT, 'admin', 'admin.html'));

      return;

    }

    // Si no hay favicon implementado, responder sin contenido en vez de 404.

    // Si luego agregas favicon.ico a la raíz, se podrá servir desde esta ruta.

    if (pathname === '/favicon.ico' && req.method === 'GET') {

      const faviconPath = path.join(ROOT, 'favicon.ico');

      if (fs.existsSync(faviconPath) && fs.statSync(faviconPath).isFile()) {

        serveFile(res, faviconPath);

      } else {

        res.statusCode = 204;

        res.end();

      }

      return;

    }



    if (pathname === '/admin/login' || pathname === '/admin/login.html') {

      serveFile(res, path.join(ROOT, 'admin', 'login.html'));

      return;

    }



    // Rutas limpias y compatibilidad con las URL anteriores.

    // La página pública de términos se construye con el texto editable desde administración.
    if ((pathname === '/legal/terminos' || pathname === '/legal/terminos.html') && req.method === 'GET') {
      sendTermsPage(res);
      return;
    }

    const pageRoutes = new Map([

      ['/', 'index.html'],

      ['/index.html', 'index.html'],

      ['/cotizador', 'cotizador.html'],

      ['/cotizador.html', 'cotizador.html'],

      ['/legal/privacidad', 'legal/privacidad.html'],

      ['/legal/privacidad.html', 'legal/privacidad.html'],

      ['/legal/terminos', 'legal/terminos.html'],

      ['/legal/terminos.html', 'legal/terminos.html'],

      ['/legal/centro-legal', 'legal/centro-legal.html'],

      ['/legal/centro-legal.html', 'legal/centro-legal.html']

    ]);

    if (pageRoutes.has(pathname)) {

      serveFile(res, path.join(ROOT, pageRoutes.get(pathname)));

      return;

    }



    // Solo se sirven los recursos estáticos enumerados arriba por su ruta exacta.

    if (STATIC_FILE_ROUTES.has(pathname)) {

      serveFile(res, path.join(ROOT, STATIC_FILE_ROUTES.get(pathname)));

      return;

    }



    // API desconocida: conservar respuesta JSON para clientes y llamadas fetch.

    if (pathname === '/api' || pathname.startsWith('/api/')) {

      sendJSON(res, 404, { error: 'Recurso no encontrado' });

      return;

    }



    // Toda ruta web no definida explícitamente recibe el 404 personalizado.

    sendNotFound(res);

    return;

  } catch (error) {

    if (res.headersSent || res.destroyed) return;

    if (error.statusCode === 413) { sendJSON(res, 413, { error: error.message }); return; }

    if (error.statusCode === 400) { sendJSON(res, 400, { error: error.message }); return; }

    console.error('Error interno:', error.message);

    sendJSON(res, 500, { error: 'Error interno del servidor' });

  }

});



server.listen(PORT, () => {

  console.log(`TECH-LAG funcionando en http://localhost:${PORT}`);

  console.log(`Entorno: ${IS_PRODUCTION ? 'production' : 'development'}`);

});
