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
const BACKUP_DIR = path.join(ROOT, 'backups');
const LOG_DIR = path.join(ROOT, 'logs');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'errors.jsonl');
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
  ['/assets/img/techlag-404.png', 'assets/img/techlag-404.png']
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
}, 10 * 60 * 1000);
cleanupTimer.unref();

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
