'use strict';

/* TECH-LAG Admin: catálogo jerárquico sobre el CSV existente.
   El CSV representa cada combinación marca/modelo/servicio/calidad como una fila. */
let datos = [];
let datosGuardados = [];
let csrfToken = sessionStorage.getItem('techlag_csrf') || '';
let modalState = null;
let pendingConfirmAction = null;
let toastTimer = null;
let guardando = false;
let resumenConsultas = null;
let terminosGuardados = '';
let terminosCargados = false;
let guardandoTerminos = false;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const nombresSecciones = {
  dashboard: 'Resumen del catálogo',
  marcas: 'Marcas',
  modelos: 'Modelos',
  servicios: 'Servicios y calidades',
  precios: 'Precios',
  consultas: 'Consultas del cotizador',
  terminos: 'Términos y condiciones',
  errores: 'Centro de errores'
};
const qualityLabels = { generica: 'Genérica', oem: 'OEM / Premium', original: 'Original' };
const NEW_SERVICE_VALUE = '__techlag_new_service__';
const QUALITY_VALUES = ['generica', 'oem', 'original'];

function escapeHTML(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeLabel(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function keyOf(value) {
  return normalizeLabel(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function same(a, b) { return keyOf(a) === keyOf(b); }

function labelIsValid(value, field, maxLength) {
  const text = normalizeLabel(value);
  if (!text) return `${field} es obligatorio.`;
  if (text.length > maxLength) return `${field} no puede superar ${maxLength} caracteres.`;
  if (/[\r\n,"\u0000-\u001f]/.test(text)) return `${field} no puede contener comas, comillas dobles ni saltos de línea.`;
  if (/^[\s\u0000-\u001f]*[=+@]/.test(text) || /^[\s\u0000-\u001f]*-\s*\d/.test(text)) {
    return `${field} empieza con un carácter no permitido.`;
  }
  return '';
}

function cloneRows(rows) { return rows.map(row => ({ ...row, precio: String(row.precio ?? '') })); }
function hasPendingChanges() { return JSON.stringify(datos) !== JSON.stringify(datosGuardados); }
function hasPendingTermsChanges() { const editor = $('#termsEditor'); return Boolean(editor && terminosCargados && editor.value !== terminosGuardados); }
function hasAnyPendingChanges() { return hasPendingChanges() || hasPendingTermsChanges(); }

function showMessage(message, type = 'success') {
  const toast = $('#adminMessage');
  toast.textContent = message;
  toast.className = `toast show ${type === 'error' ? 'toast-error' : 'toast-success'}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 3600);
}

function setSaveState(mode) {
  const root = $('#saveState');
  const text = $('#saveStateText');
  root.className = `save-state ${mode === 'pending' ? 'is-pending' : mode === 'saving' ? 'is-saving' : 'is-saved'}`;
  text.textContent = mode === 'saving' ? 'Guardando en el servidor…' : mode === 'pending' ? 'Tienes cambios pendientes' : 'Todos los cambios guardados';
  $('#saveChangesButton').disabled = mode !== 'pending' || guardando;
}

function updatePendingState() {
  setSaveState(guardando ? 'saving' : hasPendingChanges() ? 'pending' : 'saved');
}

function getUnique(values) {
  const found = new Map();
  values.forEach(value => {
    const normalized = normalizeLabel(value);
    const key = keyOf(normalized);
    if (normalized && !found.has(key)) found.set(key, normalized);
  });
  return [...found.values()].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function getBrands() { return getUnique(datos.map(row => row.marca)); }
function getModels(brand) { return getUnique(datos.filter(row => same(row.marca, brand)).map(row => row.modelo)); }
function getServices(brand, model) { return getUnique(datos.filter(row => same(row.marca, brand) && same(row.modelo, model)).map(row => row.servicio)); }
function matchingRows(brand, model, service) {
  return datos.filter(row => same(row.marca, brand) && same(row.modelo, model) && (service === undefined || same(row.servicio, service)));
}
function uniqueModelKeys() { return new Set(datos.map(row => `${keyOf(row.marca)}\u0000${keyOf(row.modelo)}`)); }
function uniqueServiceKeys() { return new Set(datos.map(row => `${keyOf(row.marca)}\u0000${keyOf(row.modelo)}\u0000${keyOf(row.servicio)}`)); }

function updateDashboard() {
  const brands = getBrands();
  const models = uniqueModelKeys();
  const services = getUnique(datos.map(row => row.servicio));
  $('#totalMarcas').textContent = brands.length;
  $('#totalModelos').textContent = models.size;
  $('#totalServicios').textContent = services.size;
  $('#totalPrecios').textContent = datos.length;
  $('#navMarcas').textContent = brands.length;
  $('#navModelos').textContent = models.size;
  const navServicios = $('#navServicios');
  if (navServicios) navServicios.textContent = services.length;
}

function getActiveSearch(selector) { return $(selector)?.value || ''; }
function matchesSearch(haystack, query) { return keyOf(haystack).includes(keyOf(query)); }

function renderBrands() {
  const query = getActiveSearch('#brandSearch');
  const brands = getBrands().filter(brand => matchesSearch(brand, query));
  $('#brandCount').textContent = `${brands.length} ${brands.length === 1 ? 'marca' : 'marcas'}`;
  if (!brands.length) {
    $('#marcasContainer').innerHTML = `<div class="table-card"><p class="empty-state">${query ? 'No hay marcas que coincidan con la búsqueda.' : 'Aún no hay marcas. Agrega una y registra su primer modelo, servicio y precio.'}</p></div>`;
    return;
  }
  $('#marcasContainer').innerHTML = brands.map(brand => {
    const rows = datos.filter(row => same(row.marca, brand));
    const models = getModels(brand);
    const serviceCount = getUnique(rows.map(row => row.servicio)).length;
    const modelTools = models.map(model => {
      const modelRows = matchingRows(brand, model);
      const serviceCountForModel = getUnique(modelRows.map(row => row.servicio)).length;
      return `<div class="brand-model-manage-row"><div><strong>${escapeHTML(model)}</strong><small>${serviceCountForModel} ${serviceCountForModel === 1 ? 'servicio' : 'servicios'} · ${modelRows.length} precios</small></div><div class="entity-actions"><button type="button" class="action-button" data-action="create-service" data-brand="${escapeHTML(brand)}" data-model="${escapeHTML(model)}">＋ Servicio</button><button type="button" class="action-button" data-action="create-variant" data-brand="${escapeHTML(brand)}" data-model="${escapeHTML(model)}">＋ Calidad / precio</button><button type="button" class="action-button" data-action="rename-model" data-brand="${escapeHTML(brand)}" data-model="${escapeHTML(model)}">Renombrar</button><button type="button" class="action-button danger" data-action="delete-model" data-brand="${escapeHTML(brand)}" data-model="${escapeHTML(model)}">Eliminar</button></div></div>`;
    }).join('');
    return `<article class="entity-card">
      <div class="entity-top"><div class="entity-title"><h3>${escapeHTML(brand)}</h3><p>Marca registrada</p></div><span class="entity-metric">${models.length}</span></div>
      <div class="entity-meta"><span>${models.length} ${models.length === 1 ? 'modelo' : 'modelos'}</span><span>${serviceCount} tipos de servicio</span><span>${rows.length} ${rows.length === 1 ? 'precio' : 'precios'}</span></div>
      <div class="entity-actions"><button type="button" class="action-button" data-action="rename-brand" data-brand="${escapeHTML(brand)}">Renombrar marca</button><button type="button" class="action-button" data-action="create-model" data-brand="${escapeHTML(brand)}">＋ Modelo</button><button type="button" class="action-button danger" data-action="delete-brand" data-brand="${escapeHTML(brand)}">Eliminar marca</button></div>
      <details class="brand-model-manage"><summary>Administrar modelos de esta marca (${models.length})</summary><div class="brand-model-manage-list">${modelTools}</div></details>
    </article>`;
  }).join('');
}

function renderModels() {
  const query = getActiveSearch('#modelSearch');
  const brands = getBrands().map(brand => {
    const models = getModels(brand).map(model => {
      const rows = matchingRows(brand, model);
      return { brand, model, rows, services: getUnique(rows.map(row => row.servicio)).length };
    }).filter(item => matchesSearch(`${item.brand} ${item.model}`, query));
    return { brand, models };
  }).filter(group => group.models.length);
  const total = brands.reduce((sum, group) => sum + group.models.length, 0);
  $('#modelCount').textContent = `${total} ${total === 1 ? 'modelo' : 'modelos'}`;
  if (!total) {
    $('#modelosContainer').innerHTML = `<div class="table-card"><p class="empty-state">${query ? 'No encontramos modelos con esos términos.' : 'No hay modelos registrados.'}</p></div>`;
    return;
  }
  $('#modelosContainer').innerHTML = brands.map(group => `<details class="brand-model-group" open>
    <summary><span class="brand-model-summary-name">${escapeHTML(group.brand)}</span><span class="brand-model-summary-count">${group.models.length} ${group.models.length === 1 ? 'modelo' : 'modelos'}</span></summary>
    <div class="brand-model-read-list">${group.models.map(item => `<article class="model-read-card"><span class="model-read-icon">▣</span><div class="model-read-copy"><h3>${escapeHTML(item.model)}</h3><p>${item.services} ${item.services === 1 ? 'tipo de servicio' : 'tipos de servicio'} · ${item.rows.length} ${item.rows.length === 1 ? 'combinación de precio' : 'combinaciones de precio'}</p><div class="model-service-tags">${getUnique(item.rows.map(row => row.servicio)).map(service => `<span>${escapeHTML(service)}</span>`).join('')}</div></div></article>`).join('')}</div>
  </details>`).join('');
}

function renderServices() {
  const query = getActiveSearch('#serviceSearch');
  const serviceNames = getUnique(datos.map(row => row.servicio)).filter(service => matchesSearch(service, query));
  $('#serviceCount').textContent = `${serviceNames.length} ${serviceNames.length === 1 ? 'servicio único' : 'servicios únicos'}`;
  if (!serviceNames.length) {
    $('#serviciosContainer').innerHTML = `<div class="table-card"><p class="empty-state">${query ? 'No hay servicios que coincidan con la búsqueda.' : 'Aún no hay servicios registrados. Crea el primer registro desde el cotizador del administrador.'}</p></div>`;
    return;
  }
  $('#serviciosContainer').innerHTML = serviceNames.map(service => {
    const rows = datos.filter(row => same(row.servicio, service));
    const modelKeys = new Set(rows.map(row => `${keyOf(row.marca)}\u0000${keyOf(row.modelo)}`));
    const brands = getUnique(rows.map(row => row.marca));
    const qualityTypes = getUnique(rows.map(row => row.calidad));
    return `<article class="entity-row service-row global-service-row">
      <div class="entity-row-main"><span class="entity-symbol">⌁</span><div><h3>${escapeHTML(service)}</h3><p>Tipo global · disponible en ${modelKeys.size} ${modelKeys.size === 1 ? 'modelo' : 'modelos'} y ${brands.length} ${brands.length === 1 ? 'marca' : 'marcas'}.</p><div class="quality-list">${qualityTypes.map(quality => `<span class="quality-pill">${escapeHTML(qualityLabels[quality] || quality)}</span>`).join('')}</div><small class="service-usage-note">${rows.length} combinaciones de calidad y precio. El nombre se comparte entre todos los modelos.</small></div></div>
      <div class="entity-actions"><button type="button" class="action-button" data-action="rename-service" data-service="${escapeHTML(service)}">Renombrar en todo el catálogo</button><button type="button" class="action-button" data-action="add-service-to-model" data-service="${escapeHTML(service)}">＋ Añadir a modelo</button><button type="button" class="action-button danger" data-action="delete-service" data-service="${escapeHTML(service)}">Eliminar globalmente</button></div>
    </article>`;
  }).join('');
}

function formatCOP(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return 'Precio inválido';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(number);
}

function renderPrices() {
  const query = getActiveSearch('#priceSearch');
  const rows = datos.map((item, index) => ({ item, index })).filter(({ item }) => matchesSearch(`${item.marca} ${item.modelo} ${item.servicio} ${qualityLabels[item.calidad] || item.calidad}`, query));
  $('#priceCount').textContent = `${rows.length} ${rows.length === 1 ? 'registro' : 'registros'}`;
  if (!rows.length) {
    $('#preciosContainer').innerHTML = `<p class="empty-state">${query ? 'No hay precios que coincidan con la búsqueda.' : 'No hay precios en el catálogo.'}</p>`;
    return;
  }
  $('#preciosContainer').innerHTML = `<div class="table-wrapper"><table class="admin-table"><thead><tr><th>Marca / modelo</th><th>Servicio</th><th>Calidad</th><th>Precio (COP)</th><th>Acción</th></tr></thead><tbody>${rows.map(({ item, index }) => `<tr>
    <td><span class="table-primary">${escapeHTML(item.marca)}</span><span class="table-secondary">${escapeHTML(item.modelo)}</span></td>
    <td>${escapeHTML(item.servicio)}</td><td><span class="row-badge">${escapeHTML(qualityLabels[item.calidad] || item.calidad)}</span></td>
    <td><input class="price-input" aria-label="Precio de ${escapeHTML(item.marca)} ${escapeHTML(item.modelo)} ${escapeHTML(item.servicio)} ${escapeHTML(item.calidad)}" type="number" min="0" max="100000000" step="1" inputmode="numeric" value="${escapeHTML(item.precio)}" data-last-valid="${escapeHTML(item.precio)}" data-row-index="${index}"></td>
    <td><button type="button" class="action-button danger" data-action="delete-price" data-index="${index}">Eliminar variante</button></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function renderAll() {
  updateDashboard();
  renderBrands();
  renderModels();
  renderServices();
  renderPrices();
  renderDashboardConsultas();
  updatePendingState();
}

function showSection(name) {
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.section === name));
  $$('.admin-section').forEach(section => section.classList.toggle('active', section.id === `section-${name}`));
  $('#sectionTitle').textContent = nombresSecciones[name] || 'Administración';
  $('#breadcrumb').textContent = `TECH-LAG / ${(nombresSecciones[name] || name).toLocaleUpperCase('es')}`;
  if (name === 'errores') cargarErrores();
  if (name === 'consultas') cargarConsultas();
  if (name === 'terminos' && !terminosCargados) cargarTerminos();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function verificarSesion() {
  try {
    const response = await fetch('/api/session', { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) { window.location.replace('/admin/login'); return false; }
    const data = await response.json();
    if (!data.authenticated) { window.location.replace('/admin/login'); return false; }
    if (data.csrf) {
      csrfToken = data.csrf;
      sessionStorage.setItem('techlag_csrf', csrfToken);
    }
    return true;
  } catch (error) {
    console.error('No se pudo verificar la sesión:', error);
    showMessage('No se pudo comprobar la sesión. Revisa tu conexión e intenta recargar.', 'error');
    return false;
  }
}

async function cargarDatos() {
  const response = await fetch('/api/admin/datos', { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { window.location.replace('/admin/login'); return false; }
  if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los datos.');
  if (!Array.isArray(data.rows)) throw new Error('El servidor devolvió un catálogo con formato inválido.');
  datos = cloneRows(data.rows);
  datosGuardados = cloneRows(data.rows);
  renderAll();
  return true;
}

function field({ id, label, type = 'text', value = '', required = true, maxLength, min, max, step, placeholder = '', help = '', options, disabled = false, full = false }) {
  const idAttr = escapeHTML(id);
  const cls = `field-group${full ? ' full-width' : ''}`;
  let control = '';
  if (type === 'select') {
    control = `<select id="${idAttr}" name="${idAttr}" ${required ? 'required' : ''} ${disabled ? 'disabled' : ''}>${(options || []).map(option => `<option value="${escapeHTML(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${escapeHTML(option.label)}</option>`).join('')}</select>`;
  } else {
    control = `<input id="${idAttr}" name="${idAttr}" type="${escapeHTML(type)}" value="${escapeHTML(value)}" ${required ? 'required' : ''} ${maxLength ? `maxlength="${maxLength}"` : ''} ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''} ${step !== undefined ? `step="${step}"` : ''} ${disabled ? 'disabled' : ''} placeholder="${escapeHTML(placeholder)}" autocomplete="off">`;
  }
  return `<div class="${cls}"><label for="${idAttr}">${escapeHTML(label)}${required ? ' <span aria-hidden="true">*</span>' : ''}</label>${control}${help ? `<p class="field-help">${escapeHTML(help)}</p>` : ''}</div>`;
}

function selectOptions(values, placeholder) {
  return [{ value: '', label: placeholder }, ...values.map(value => ({ value, label: value }))];
}

function getModeCopy(mode) {
  const copy = {
    'create-brand': ['Crear marca y primer registro', 'Crea la marca con su primer modelo. Puedes reutilizar un tipo de servicio existente o crear uno nuevo de forma explícita.'],
    'create-model': ['Crear modelo', 'Elige una marca ya registrada y un servicio de la lista. El modelo se agregará dentro de esa marca con su primer precio.'],
    'create-service': ['Agregar servicio o calidad', 'Elige una marca y un modelo. Puedes reutilizar un tipo existente o crear uno nuevo explícitamente; si ya existe en el modelo, agrega una calidad disponible.'],
    'create-variant': ['Agregar calidad y precio', 'Elige un servicio ya existente y agrega una calidad que todavía no esté registrada para ese servicio.'],
    'rename-brand': ['Renombrar marca', 'El nuevo nombre se aplicará a todos los modelos, servicios y precios de esta marca.'],
    'rename-model': ['Renombrar modelo', 'El cambio se aplicará a todos los servicios y precios de este modelo.'],
    'rename-service': ['Renombrar servicio', 'El cambio se aplicará a todas las calidades y precios de este servicio.']
  };
  return copy[mode] || ['Editar catálogo', 'Revisa los datos antes de guardar.'];
}

function openModal(mode, context = {}) {
  modalState = { mode, ...context };
  const [title, description] = getModeCopy(mode);
  $('#modalTitle').textContent = title;
  $('#modalDescription').textContent = description;
  $('#modalError').textContent = '';
  $('#modalSaveButton').textContent = mode.startsWith('rename-') ? 'Aplicar cambio' : 'Agregar al borrador';

  const brandSelect = (value = '') => field({ id: 'fieldBrand', label: 'Marca existente', type: 'select', value, options: selectOptions(getBrands(), 'Selecciona una marca'), help: 'Solo puedes elegir marcas que ya existen.' });
  const modelSelect = (brand, value = '') => field({ id: 'fieldModel', label: 'Modelo existente', type: 'select', value, options: selectOptions(brand ? getModels(brand) : [], brand ? 'Selecciona un modelo' : 'Primero selecciona la marca'), disabled: !brand, help: 'Los modelos dependen de la marca seleccionada.' });
  const serviceSelect = (brand, model, value = '') => field({ id: 'fieldService', label: 'Servicio del modelo', type: 'select', value, options: selectOptions(brand && model ? getServices(brand, model) : [], model ? 'Selecciona un servicio' : 'Primero selecciona el modelo'), disabled: !brand || !model });
  const globalServiceSelect = (value = '', { allowNew = false, label = 'Servicio existente' } = {}) => {
    const services = getUnique(datos.map(row => row.servicio));
    const options = selectOptions(services, services.length ? 'Selecciona un servicio existente' : (allowNew ? 'No hay tipos; crea el primero' : 'No hay servicios registrados'));
    if (allowNew) options.push({ value: NEW_SERVICE_VALUE, label: '＋ Crear un tipo de servicio nuevo…' });
    const selectedValue = value || (allowNew && services.length === 0 ? NEW_SERVICE_VALUE : '');
    return field({ id: 'fieldService', label, type: 'select', value: selectedValue, options, disabled: services.length === 0 && !allowNew, help: allowNew ? 'Elige un tipo ya existente o selecciona “Crear un tipo nuevo” explícitamente.' : 'Solo puedes elegir tipos de servicio que ya están registrados.' });
  };
  const newServiceNameField = () => `<div id="fieldNewServiceWrap" class="full-width" hidden>${field({ id: 'fieldServiceName', label: 'Nombre del nuevo tipo de servicio', maxLength: 80, placeholder: 'Ej. cambio_pantalla', help: 'Debe ser un tipo nuevo; si ya existe, selecciónalo en la lista.' })}</div>`;
  const qualitySelect = (value = 'generica') => field({ id: 'fieldQuality', label: 'Calidad', type: 'select', value, options: [{ value: '', label: 'Selecciona una calidad' }, { value: 'generica', label: 'Genérica' }, { value: 'oem', label: 'OEM / Premium' }, { value: 'original', label: 'Original' }], help: 'Cada combinación de marca, modelo y servicio admite una sola entrada por calidad.' });
  const priceField = () => field({ id: 'fieldPrice', label: 'Precio (COP)', type: 'number', value: '', min: 0, max: 100000000, step: 1, placeholder: 'Ej. 85000', help: 'Solo números enteros, entre $0 y $100.000.000.' });
  const textField = (id, label, maxLength, placeholder, help = '', value = '') => field({ id, label, maxLength, placeholder, help, value });
  let html = '';

  if (mode === 'create-brand') {
    html = textField('fieldBrandName', 'Nombre de marca', 80, 'Ej. Samsung', 'Se creará junto con su primer modelo, servicio y precio.') +
      textField('fieldModelName', 'Primer modelo', 100, 'Ej. Galaxy A54') +
      globalServiceSelect(context.service || '', { allowNew: true, label: 'Primer servicio' }) + newServiceNameField() + qualitySelect() + priceField();
  } else if (mode === 'create-model') {
    const brand = context.brand && getBrands().some(item => same(item, context.brand)) ? context.brand : '';
    html = brandSelect(brand) + textField('fieldModelName', 'Nombre del modelo', 100, 'Ej. Galaxy A54') +
      globalServiceSelect('', { allowNew: false, label: 'Primer servicio (existente)' }) + qualitySelect() + priceField();
  } else if (mode === 'create-service') {
    const brand = context.brand && getBrands().some(item => same(item, context.brand)) ? context.brand : '';
    const models = brand ? getModels(brand) : [];
    const model = context.model && models.some(item => same(item, context.model)) ? context.model : '';
    const initialService = context.service && getUnique(datos.map(row => row.servicio)).some(item => same(item, context.service)) ? context.service : '';
    html = brandSelect(brand) + modelSelect(brand, model) + globalServiceSelect(initialService, { allowNew: true, label: 'Tipo de servicio' }) + newServiceNameField() + qualitySelect() + priceField();
  } else if (mode === 'create-variant') {
    const brand = context.brand && getBrands().some(item => same(item, context.brand)) ? context.brand : '';
    const models = brand ? getModels(brand) : [];
    const model = context.model && models.some(item => same(item, context.model)) ? context.model : '';
    const services = brand && model ? getServices(brand, model) : [];
    const service = context.service && services.some(item => same(item, context.service)) ? context.service : '';
    html = brandSelect(brand) + modelSelect(brand, model) + serviceSelect(brand, model, service) + qualitySelect('') + priceField();
  } else if (mode === 'rename-brand') {
    html = field({ id: 'fieldOldBrand', label: 'Marca actual', value: context.brand, disabled: true, full: true }) + textField('fieldBrandName', 'Nuevo nombre de marca', 80, 'Escribe el nombre corregido', 'No se permite renombrar una marca con el mismo nombre de otra existente.');
  } else if (mode === 'rename-model') {
    html = field({ id: 'fieldParentBrand', label: 'Marca', value: context.brand, disabled: true }) + field({ id: 'fieldOldModel', label: 'Modelo actual', value: context.model, disabled: true }) + textField('fieldModelName', 'Nuevo nombre de modelo', 100, 'Escribe el nombre corregido', 'Se actualizarán todos los registros de este modelo.');
  } else if (mode === 'rename-service') {
    html = field({ id: 'fieldOldService', label: 'Tipo de servicio actual', value: context.service, disabled: true, full: true }) + textField('fieldServiceName', 'Nuevo nombre global', 80, 'Escribe el nombre corregido', 'Se actualizará el nombre en todos los modelos y precios que usan este servicio.');
  }

  $('#modalFields').innerHTML = html;
  $('#catalogModal').classList.add('active');
  $('#catalogModal').setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  bindModalDependencies();
  setTimeout(() => $('#modalFields input:not(:disabled), #modalFields select:not(:disabled)')?.focus(), 60);
}

function fillSelect(select, options, placeholder, value = '') {
  if (!select) return;
  const list = [{ value: '', label: placeholder }, ...options];
  select.innerHTML = list.map(option => `<option value="${escapeHTML(option.value)}" ${String(option.value) === String(value) ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${escapeHTML(option.label)}</option>`).join('');
  if (!list.some(option => String(option.value) === String(value) && !option.disabled)) select.value = '';
}

function currentServiceChoice() { return $('#fieldService')?.value || ''; }
function currentServiceName() {
  const selected = currentServiceChoice();
  return normalizeLabel(selected === NEW_SERVICE_VALUE ? ($('#fieldServiceName')?.value || '') : selected);
}
function updateNewServiceVisibility() {
  const wrap = $('#fieldNewServiceWrap');
  if (!wrap) return;
  const isNew = currentServiceChoice() === NEW_SERVICE_VALUE;
  wrap.hidden = !isNew;
  const input = $('#fieldServiceName');
  if (input) input.required = isNew;
}
function servicePickerOptions({ global = false, brand = '', model = '', selected = '', allowNew = false } = {}) {
  const services = global ? getUnique(datos.map(row => row.servicio)) : (brand && model ? getServices(brand, model) : []);
  const options = services.map(value => ({ value, label: value }));
  if (allowNew) options.push({ value: NEW_SERVICE_VALUE, label: '＋ Crear un tipo de servicio nuevo…' });
  fillSelect($('#fieldService'), options, services.length ? 'Selecciona un servicio' : (allowNew ? 'No hay tipos; crea el primero' : 'Primero selecciona el modelo'), selected);
  if ($('#fieldService')) $('#fieldService').disabled = !services.length && !allowNew;
}
function refreshAvailableQualities() {
  const select = $('#fieldQuality');
  if (!select) return;
  let used = [];
  const mode = modalState?.mode;
  if (mode === 'create-variant') {
    const brand = $('#fieldBrand')?.value || '';
    const model = $('#fieldModel')?.value || '';
    const service = $('#fieldService')?.value || '';
    if (brand && model && service) used = matchingRows(brand, model, service).map(row => row.calidad);
  } else if (mode === 'create-service') {
    const brand = $('#fieldBrand')?.value || '';
    const model = $('#fieldModel')?.value || '';
    const choice = currentServiceChoice();
    if (brand && model && choice && choice !== NEW_SERVICE_VALUE) used = matchingRows(brand, model, currentServiceName()).map(row => row.calidad);
  }
  const available = QUALITY_VALUES.filter(quality => !used.includes(quality));
  const current = select.value;
  select.innerHTML = [{ value: '', label: available.length ? 'Selecciona una calidad' : 'No quedan calidades disponibles' }, ...available.map(value => ({ value, label: qualityLabels[value] }))]
    .map(option => `<option value="${escapeHTML(option.value)}">${escapeHTML(option.label)}</option>`).join('');
  select.value = available.includes(current) ? current : (mode === 'create-variant' || used.length ? '' : 'generica');
  const help = select.closest('.field-group')?.querySelector('.field-help');
  if (help) help.textContent = available.length
    ? 'Las calidades ya usadas para esta combinación no aparecen como opciones.'
    : 'Esta combinación ya tiene Genérica, OEM / Premium y Original. Edita los precios existentes en la sección Precios.';
  const saveButton = $('#modalSaveButton');
  if (saveButton) saveButton.disabled = available.length === 0;
}
function bindModalDependencies() {
  const brand = $('#fieldBrand');
  const model = $('#fieldModel');
  const mode = modalState?.mode;
  if (brand && model) brand.addEventListener('change', () => {
    const selectedBrand = brand.value;
    fillSelect(model, (selectedBrand ? getModels(selectedBrand) : []).map(value => ({ value, label: value })), selectedBrand ? 'Selecciona un modelo' : 'Primero selecciona la marca', '');
    model.disabled = !selectedBrand;
    if (mode === 'create-variant') servicePickerOptions({ brand: selectedBrand, model: '', selected: '' });
    refreshAvailableQualities();
  });
  if (model) model.addEventListener('change', () => {
    if (mode === 'create-variant') servicePickerOptions({ brand: $('#fieldBrand')?.value || '', model: model.value, selected: '' });
    refreshAvailableQualities();
  });
  $('#fieldService')?.addEventListener('change', () => {
    updateNewServiceVisibility();
    refreshAvailableQualities();
  });
  $('#fieldServiceName')?.addEventListener('input', refreshAvailableQualities);
  updateNewServiceVisibility();
  refreshAvailableQualities();
}
function closeModal() {
  $('#catalogModal').classList.remove('active');
  $('#catalogModal').setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  $('#catalogForm').reset();
  $('#modalFields').innerHTML = '';
  $('#modalError').textContent = '';
  modalState = null;
}

function showModalError(message) {
  $('#modalError').textContent = message;
  $('#modalError').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function createRow(brand, model, service, quality, price) {
  return { marca: normalizeLabel(brand), modelo: normalizeLabel(model), servicio: normalizeLabel(service), calidad: quality, precio: String(price) };
}

function priceValue() {
  const input = $('#fieldPrice');
  const raw = input?.value ?? '';
  if (!/^\d{1,9}$/.test(raw)) return { error: 'El precio debe ser un número entero entre $0 y $100.000.000.' };
  const price = Number(raw);
  if (!Number.isSafeInteger(price) || price < 0 || price > 100000000) return { error: 'El precio está fuera del rango permitido.' };
  return { value: String(price) };
}

function duplicateVariant(row, excludeIndex = -1) {
  return datos.some((item, index) => index !== excludeIndex && same(item.marca, row.marca) && same(item.modelo, row.modelo) && same(item.servicio, row.servicio) && same(item.calidad, row.calidad));
}

function validateAllRows(rows) {
  const seen = new Set();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    for (const [key, label, max] of [['marca', 'Marca', 80], ['modelo', 'Modelo', 100], ['servicio', 'Servicio', 80]]) {
      const error = labelIsValid(row[key], label, max);
      if (error) return `${error} (registro ${index + 1})`;
    }
    if (!['generica', 'oem', 'original'].includes(row.calidad)) return `La calidad del registro ${index + 1} no es válida.`;
    if (!/^\d{1,9}$/.test(String(row.precio)) || Number(row.precio) > 100000000) return `El precio del registro ${index + 1} no es válido.`;
    const key = `${keyOf(row.marca)}\u0000${keyOf(row.modelo)}\u0000${keyOf(row.servicio)}\u0000${keyOf(row.calidad)}`;
    if (seen.has(key)) return `Hay una combinación duplicada de marca, modelo, servicio y calidad: ${row.marca} ${row.modelo} / ${row.servicio} / ${row.calidad}.`;
    seen.add(key);
  }
  return '';
}

function submitModal(event) {
  event.preventDefault();
  if (!modalState) return;
  $('#modalError').textContent = '';
  const mode = modalState.mode;
  const val = id => normalizeLabel($(`#${id}`)?.value || '');
  const price = priceValue();
  let nextRows = cloneRows(datos);
  let message = '';

  if (mode === 'create-brand') {
    const brand = val('fieldBrandName');
    const model = val('fieldModelName');
    const serviceChoice = currentServiceChoice();
    const service = currentServiceName();
    for (const [value, label, max] of [[brand, 'Marca', 80], [model, 'Modelo', 100], [service, 'Servicio', 80]]) {
      const error = labelIsValid(value, label, max); if (error) { showModalError(error); return; }
    }
    if (getBrands().some(item => same(item, brand))) { showModalError('Esa marca ya existe. Elige la marca existente en lugar de duplicarla.'); return; }
    const services = getUnique(datos.map(row => row.servicio));
    if (serviceChoice === NEW_SERVICE_VALUE && services.some(item => same(item, service))) { showModalError('Ese tipo de servicio ya existe. Selecciónalo en la lista en lugar de volver a crearlo.'); return; }
    if (serviceChoice !== NEW_SERVICE_VALUE && !services.some(item => same(item, service))) { showModalError('Selecciona un servicio existente o elige explícitamente crear uno nuevo.'); return; }
    if (!price.value) { showModalError(price.error); return; }
    const quality = $('#fieldQuality')?.value;
    if (!QUALITY_VALUES.includes(quality)) { showModalError('Selecciona una calidad válida.'); return; }
    nextRows.push(createRow(brand, model, service, quality, price.value));
    message = `Marca ${brand} creada con su primer modelo y servicio.`;
  } else if (mode === 'create-model') {
    const brand = val('fieldBrand'); const model = val('fieldModelName'); const service = val('fieldService');
    if (!brand || !getBrands().some(item => same(item, brand))) { showModalError('Debes seleccionar una marca existente antes de crear el modelo.'); return; }
    const existingServices = getUnique(datos.map(row => row.servicio));
    if (!service || !existingServices.some(item => same(item, service))) { showModalError('Debes seleccionar un servicio que ya exista en el catálogo. No puedes escribir un servicio nuevo aquí.'); return; }
    const modelError = labelIsValid(model, 'Modelo', 100);
    if (modelError) { showModalError(modelError); return; }
    if (getModels(brand).some(item => same(item, model))) { showModalError('Ese modelo ya existe dentro de esa marca. Para añadir otra opción, agrega un servicio o una calidad/precio.'); return; }
    if (!price.value) { showModalError(price.error); return; }
    const quality = $('#fieldQuality')?.value;
    if (!QUALITY_VALUES.includes(quality)) { showModalError('Selecciona una calidad válida.'); return; }
    nextRows.push(createRow(brand, model, service, quality, price.value));
    message = `Modelo ${model} creado en ${brand}.`;
  } else if (mode === 'create-service') {
    const brand = val('fieldBrand'); const model = val('fieldModel'); const serviceChoice = currentServiceChoice(); const service = currentServiceName();
    if (!brand || !getBrands().some(item => same(item, brand))) { showModalError('Selecciona primero una marca existente.'); return; }
    if (!model || !getModels(brand).some(item => same(item, model))) { showModalError('Selecciona un modelo válido de la marca elegida.'); return; }
    const error = labelIsValid(service, 'Servicio', 80); if (error) { showModalError(error); return; }
    const globalServices = getUnique(datos.map(row => row.servicio));
    if (serviceChoice === NEW_SERVICE_VALUE && globalServices.some(item => same(item, service))) { showModalError('Ese tipo de servicio ya existe. Selecciónalo en la lista para reutilizarlo.'); return; }
    if (serviceChoice !== NEW_SERVICE_VALUE && !globalServices.some(item => same(item, service))) { showModalError('Selecciona un servicio existente o elige crear un tipo nuevo.'); return; }
    if (!price.value) { showModalError(price.error); return; }
    const quality = $('#fieldQuality')?.value;
    if (!QUALITY_VALUES.includes(quality)) { showModalError('Selecciona una calidad disponible.'); return; }
    const existingForModel = getServices(brand, model).some(item => same(item, service));
    const row = createRow(brand, model, service, quality, price.value);
    if (duplicateVariant(row)) { showModalError(`Ya existe una variante ${qualityLabels[quality]} para ${service}. Elige otra calidad o edita su precio en Precios.`); return; }
    nextRows.push(row);
    message = existingForModel
      ? `Calidad ${qualityLabels[quality]} añadida a ${service} en ${brand} ${model}.`
      : `Servicio ${service} añadido a ${brand} ${model}.`;
  } else if (mode === 'create-variant') {
    const brand = val('fieldBrand'); const model = val('fieldModel'); const service = val('fieldService'); const quality = $('#fieldQuality')?.value;
    if (!brand || !getBrands().some(item => same(item, brand))) { showModalError('Selecciona una marca existente.'); return; }
    if (!model || !getModels(brand).some(item => same(item, model))) { showModalError('Selecciona un modelo de la marca elegida.'); return; }
    if (!service || !getServices(brand, model).some(item => same(item, service))) { showModalError('Selecciona un servicio del modelo elegido.'); return; }
    if (!QUALITY_VALUES.includes(quality)) { showModalError('Selecciona una calidad que todavía no esté registrada para este servicio.'); return; }
    const row = createRow(brand, model, service, quality, price.value || '');
    if (!price.value) { showModalError(price.error); return; }
    if (duplicateVariant(row)) { showModalError(`Ya existe una variante ${qualityLabels[quality]} para este servicio. Edita su precio en la tabla de precios.`); return; }
    nextRows.push(row);
    message = `Calidad ${qualityLabels[quality]} agregada al servicio ${service}.`;
  } else if (mode === 'rename-brand') {
    const old = modalState.brand; const name = val('fieldBrandName');
    const error = labelIsValid(name, 'Marca', 80); if (error) { showModalError(error); return; }
    if (same(old, name)) { showModalError('El nuevo nombre es igual al nombre actual.'); return; }
    if (getBrands().some(item => same(item, name))) { showModalError('Ya existe una marca con ese nombre. No se combinan marcas automáticamente.'); return; }
    nextRows.forEach(row => { if (same(row.marca, old)) row.marca = name; });
    message = `Marca renombrada a ${name}.`;
  } else if (mode === 'rename-model') {
    const { brand, model: old } = modalState; const name = val('fieldModelName');
    const error = labelIsValid(name, 'Modelo', 100); if (error) { showModalError(error); return; }
    if (same(old, name)) { showModalError('El nuevo nombre es igual al nombre actual.'); return; }
    if (getModels(brand).some(item => same(item, name))) { showModalError('Ese nombre de modelo ya existe bajo esta marca.'); return; }
    nextRows.forEach(row => { if (same(row.marca, brand) && same(row.modelo, old)) row.modelo = name; });
    message = `Modelo renombrado a ${name}.`;
  } else if (mode === 'rename-service') {
    const old = modalState.service; const name = val('fieldServiceName');
    const error = labelIsValid(name, 'Servicio', 80); if (error) { showModalError(error); return; }
    if (same(old, name)) { showModalError('El nuevo nombre es igual al nombre actual.'); return; }
    if (getUnique(datos.map(row => row.servicio)).some(item => !same(item, old) && same(item, name))) { showModalError('Ya existe otro tipo de servicio con ese nombre. No se cambiarán dos tipos distintos por accidente.'); return; }
    nextRows.forEach(row => { if (same(row.servicio, old)) row.servicio = name; });
    message = `El tipo de servicio se renombró globalmente a ${name}.`;
  }

  const validationError = validateAllRows(nextRows);
  if (validationError) { showModalError(validationError); return; }
  datos = nextRows;
  closeModal();
  renderAll();
  showMessage(`${message} Recuerda guardar los cambios.`);
}

function askConfirmation({ title, message, details, confirmLabel = 'Sí, eliminar', danger = true, action }) {
  pendingConfirmAction = action;
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmDetails').textContent = details || '';
  $('#acceptConfirmButton').textContent = confirmLabel;
  $('#acceptConfirmButton').className = `button ${danger ? 'button-danger' : 'button-primary'}`;
  $('#confirmModal').classList.add('active');
  $('#confirmModal').setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}

function closeConfirmation() {
  $('#confirmModal').classList.remove('active');
  $('#confirmModal').setAttribute('aria-hidden', 'true');
  if (!$('#catalogModal').classList.contains('active')) document.body.classList.remove('modal-open');
  pendingConfirmAction = null;
}

function commitDraftRows(rows, message) {
  const error = validateAllRows(rows);
  if (error) { showMessage(error, 'error'); return; }
  datos = rows;
  renderAll();
  showMessage(`${message} Recuerda guardar los cambios.`);
}

function deleteBrand(brand) {
  const rows = datos.filter(row => same(row.marca, brand));
  const models = getModels(brand).length;
  const services = new Set(rows.map(row => `${keyOf(row.modelo)}\u0000${keyOf(row.servicio)}`)).size;
  askConfirmation({
    title: 'Eliminar marca completa',
    message: `¿Eliminar la marca “${brand}” del catálogo?`,
    details: `Esta acción quitará ${models} ${models === 1 ? 'modelo' : 'modelos'}, ${services} ${services === 1 ? 'servicio' : 'servicios'} y ${rows.length} ${rows.length === 1 ? 'registro de precio' : 'registros de precio'}. No se publicará hasta pulsar Guardar cambios.`,
    action: () => commitDraftRows(datos.filter(row => !same(row.marca, brand)), `Marca ${brand} eliminada del borrador.`)
  });
}

function deleteModel(brand, model) {
  const rows = datos.filter(row => same(row.marca, brand) && same(row.modelo, model));
  const services = new Set(rows.map(row => keyOf(row.servicio))).size;
  const modelsOfBrand = getModels(brand);
  const brandWillDisappear = modelsOfBrand.length === 1;
  askConfirmation({
    title: 'Eliminar modelo y dependencias',
    message: `¿Eliminar el modelo “${brand} ${model}”?`,
    details: `Se quitarán ${services} ${services === 1 ? 'servicio' : 'servicios'} y ${rows.length} ${rows.length === 1 ? 'variante de precio' : 'variantes de precio'} relacionados.${brandWillDisappear ? ' Es el último modelo de esta marca, así que la marca también dejará de aparecer en el catálogo si no tiene otros registros.' : ''} Esta acción solo se envía al servidor al guardar.`,
    action: () => commitDraftRows(datos.filter(row => !(same(row.marca, brand) && same(row.modelo, model))), `Modelo ${model} eliminado del borrador.`)
  });
}

function deleteService(service) {
  const rows = datos.filter(row => same(row.servicio, service));
  if (!rows.length) return;
  const modelKeys = new Set(rows.map(row => `${keyOf(row.marca)}\u0000${keyOf(row.modelo)}`));
  const brandNames = getUnique(rows.map(row => row.marca));
  askConfirmation({
    title: 'Eliminar tipo de servicio global',
    message: `¿Eliminar “${service}” de todo el catálogo?`,
    details: `Se eliminarán ${rows.length} combinaciones de calidad/precio distribuidas en ${modelKeys.size} modelos y ${brandNames.length} marcas. Esta eliminación puede hacer que algunos modelos o marcas dejen de aparecer si se quedan sin precios. No se publicará hasta pulsar Guardar cambios.`,
    action: () => commitDraftRows(datos.filter(row => !same(row.servicio, service)), `El tipo de servicio ${service} se eliminó del borrador en todos los modelos.`)
  });
}

function deletePrice(index) {
  const row = datos[index];
  if (!row) return;
  const variants = matchingRows(row.marca, row.modelo, row.servicio);
  const modelRows = matchingRows(row.marca, row.modelo);
  let details = `Se quitará únicamente la variante ${qualityLabels[row.calidad] || row.calidad} por ${formatCOP(row.precio)}.`;
  if (variants.length === 1) details += ' Es la última calidad de ese servicio, por lo que el servicio desaparecerá del catálogo.';
  if (modelRows.length === 1) details += ' También es el último registro del modelo; el modelo y posiblemente la marca dejarán de aparecer si no tienen otros registros.';
  askConfirmation({
    title: 'Eliminar variante de precio',
    message: `¿Eliminar el precio de ${row.marca} ${row.modelo} · ${row.servicio}?`,
    details,
    action: () => commitDraftRows(datos.filter((_, rowIndex) => rowIndex !== index), 'Variante de precio eliminada del borrador.')
  });
}

async function saveChanges() {
  if (guardando || !hasPendingChanges()) return;
  const invalidPriceInput = $$('.price-input').find(input => {
    const raw = input.value;
    return !/^\d{1,9}$/.test(raw) || Number(raw) > 100000000;
  });
  if (invalidPriceInput) {
    invalidPriceInput.classList.add('invalid');
    invalidPriceInput.focus();
    showMessage('Corrige el precio marcado antes de guardar. Debe ser un entero entre $0 y $100.000.000.', 'error');
    return;
  }
  const validationError = validateAllRows(datos);
  if (validationError) { showMessage(validationError, 'error'); return; }
  const button = $('#saveChangesButton');
  guardando = true;
  button.disabled = true;
  updatePendingState();
  try {
    const response = await fetch('/api/admin/datos', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      cache: 'no-store',
      body: JSON.stringify({ rows: datos })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.replace('/admin/login'); return; }
    if (!response.ok) throw new Error(result.error || `No se pudieron guardar los cambios (HTTP ${response.status}).`);
    datos = cloneRows(datos);
    datosGuardados = cloneRows(datos);
    renderAll();
    showMessage(`Cambios guardados correctamente. ${result.count ?? datos.length} registros persistidos.`);
  } catch (error) {
    console.error('Error guardando catálogo:', error);
    showMessage(error.message || 'No se pudieron guardar los cambios.', 'error');
  } finally {
    guardando = false;
    updatePendingState();
  }
}

async function cargarErrores() {
  const container = $('#errorsContainer');
  container.innerHTML = '<p class="empty-state">Cargando registros…</p>';
  try {
    const response = await fetch('/api/admin/errores', { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.replace('/admin/login'); return; }
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los errores.');
    const entries = Array.isArray(data.entries) ? data.entries : [];
    $('#errorTotal').textContent = data.total ?? entries.length;
    $('#error404').textContent = entries.filter(item => Number(item.status) === 404).length;
    $('#errorAuth').textContent = entries.filter(item => [401, 403].includes(Number(item.status))).length;
    $('#error500').textContent = entries.filter(item => Number(item.status) === 500).length;
    if (!entries.length) { container.innerHTML = '<p class="empty-state">Todo tranquilo por aquí. No hay errores registrados en el período conservado.</p>'; return; }
    container.innerHTML = `<div class="table-wrapper"><table class="admin-table"><thead><tr><th>Fecha y hora</th><th>Código</th><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead><tbody>${entries.map(item => {
      const status = Number(item.status) || 0;
      const dateValue = new Date(item.timestamp);
      const date = Number.isNaN(dateValue.getTime()) ? 'Fecha inválida' : dateValue.toLocaleString('es-CO');
      return `<tr><td>${escapeHTML(date)}</td><td><span class="http-status status-${status}">${status}</span></td><td>${escapeHTML(item.method)}</td><td><code>${escapeHTML(item.path)}</code></td><td>${escapeHTML(item.message)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  } catch (error) {
    container.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
  }
}

// =====================================================
// ANALÍTICA ANÓNIMA DEL COTIZADOR
// =====================================================

function formatCount(value) {
  return new Intl.NumberFormat('es-CO').format(Number(value) || 0);
}

function renderDashboardConsultas() {
  const total = $('#dashboardConsultaTotal');
  const period = $('#dashboardConsultaPeriodo');
  const container = $('#dashboardTopConsultas');
  if (!total || !container) return;
  if (!resumenConsultas) {
    total.textContent = '—';
    container.innerHTML = '<p class="empty-state">Todavía no hay datos cargados. Abre Consultas para actualizar.</p>';
    return;
  }
  total.textContent = formatCount(resumenConsultas.total);
  if (period) period.textContent = `Consultas registradas durante los últimos ${resumenConsultas.days} días.`;
  const rows = (resumenConsultas.topRepuestos || []).slice(0, 5);
  if (!rows.length) {
    container.innerHTML = '<p class="empty-state">No hay consultas en este periodo. Los datos aparecerán cuando los clientes consulten precios en el cotizador.</p>';
    return;
  }
  container.innerHTML = `<ol class="top-consultation-list">${rows.map(item => `<li><span><strong>${escapeHTML(item.marca)} ${escapeHTML(item.modelo)}</strong><small>${escapeHTML(item.servicio)} · ${escapeHTML(qualityLabels[item.calidad] || item.calidad)}</small></span><b>${formatCount(item.consultas)}</b></li>`).join('')}</ol>`;
}

function renderConsultationTables(data) {
  const topItems = Array.isArray(data.topRepuestos) ? data.topRepuestos : [];
  const topServices = Array.isArray(data.topServicios) ? data.topServicios : [];
  const itemTarget = $('#consultaTopRepuestos');
  const serviceTarget = $('#consultaTopServicios');
  $('#consultaTotal').textContent = formatCount(data.total);
  $('#consultaPeriodoTexto').textContent = `Últimos ${data.days} días`;
  $('#consultaRepuestoTop').textContent = topItems.length ? `${topItems[0].marca} ${topItems[0].modelo}` : '—';
  $('#consultaRepuestoCount').textContent = topItems.length ? `${formatCount(topItems[0].consultas)} consultas · ${topItems[0].servicio}` : 'Sin datos todavía';
  $('#consultaServicioTop').textContent = topServices.length ? topServices[0].servicio : '—';
  $('#consultaServicioCount').textContent = topServices.length ? `${formatCount(topServices[0].consultas)} consultas` : 'Sin datos todavía';
  if (!topItems.length) itemTarget.innerHTML = '<p class="empty-state">No hay combinaciones consultadas en el periodo seleccionado.</p>';
  else itemTarget.innerHTML = `<div class="table-wrapper"><table class="admin-table"><thead><tr><th>Equipo / repuesto</th><th>Servicio</th><th>Calidad</th><th>Consultas</th></tr></thead><tbody>${topItems.map(item => `<tr><td><span class="table-primary">${escapeHTML(item.marca)} ${escapeHTML(item.modelo)}</span></td><td>${escapeHTML(item.servicio)}</td><td>${escapeHTML(qualityLabels[item.calidad] || item.calidad)}</td><td><strong>${formatCount(item.consultas)}</strong></td></tr>`).join('')}</tbody></table></div>`;
  if (!topServices.length) serviceTarget.innerHTML = '<p class="empty-state">No hay servicios consultados en el periodo seleccionado.</p>';
  else serviceTarget.innerHTML = `<div class="table-wrapper"><table class="admin-table"><thead><tr><th>Tipo de servicio</th><th>Modelos consultados</th><th>Consultas</th></tr></thead><tbody>${topServices.map(item => `<tr><td><strong>${escapeHTML(item.servicio)}</strong></td><td>${formatCount(item.modelos)}</td><td><strong>${formatCount(item.consultas)}</strong></td></tr>`).join('')}</tbody></table></div>`;
  renderDashboardConsultas();
}

async function cargarConsultas() {
  const target = $('#consultaTopRepuestos');
  if (target) target.innerHTML = '<p class="empty-state">Cargando estadísticas…</p>';
  const days = $('#consultaPeriodo')?.value || '30';
  try {
    const response = await fetch(`/api/admin/consultas?days=${encodeURIComponent(days)}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.replace('/admin/login'); return; }
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las consultas.');
    resumenConsultas = data;
    renderConsultationTables(data);
  } catch (error) {
    if (target) target.innerHTML = `<p class="empty-state">${escapeHTML(error.message)}</p>`;
    showMessage(error.message || 'No se pudieron cargar las consultas.', 'error');
  }
}

// =====================================================
// EDITOR DE TÉRMINOS Y CONDICIONES
// =====================================================

function updateTermsState() {
  const editor = $('#termsEditor');
  const button = $('#saveTermsButton');
  const status = $('#termsSaveStatus');
  const statusText = $('#termsSaveStatusText');
  const counter = $('#termsCharCount');
  if (!editor || !button || !status || !statusText) return;
  const dirty = hasPendingTermsChanges();
  button.disabled = !dirty || guardandoTerminos || !terminosCargados;
  status.className = `save-state ${guardandoTerminos ? 'is-saving' : dirty ? 'is-pending' : 'is-saved'}`;
  statusText.textContent = guardandoTerminos ? 'Guardando…' : dirty ? 'Tienes cambios sin guardar' : 'Contenido guardado';
  if (counter) counter.textContent = `${formatCount(editor.value.length)} / 50.000 caracteres`;
}

async function cargarTerminos(force = false) {
  const editor = $('#termsEditor');
  if (!editor) return;
  if (terminosCargados && !force) { updateTermsState(); return; }
  if (hasPendingTermsChanges() && force) {
    if (!window.confirm('Hay cambios de Términos y Condiciones sin guardar. ¿Descartarlos y volver a cargar la versión del servidor?')) return;
  }
  editor.disabled = true;
  $('#termsSaveStatusText').textContent = 'Cargando contenido…';
  $('#termsMessage').textContent = '';
  try {
    const response = await fetch('/api/admin/terminos', { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.replace('/admin/login'); return; }
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los Términos y Condiciones.');
    editor.value = String(data.content || '');
    terminosGuardados = editor.value;
    terminosCargados = true;
    editor.disabled = false;
    updateTermsState();
    $('#termsMessage').textContent = 'Contenido cargado desde el servidor.';
  } catch (error) {
    editor.disabled = false;
    $('#termsSaveStatusText').textContent = 'No se pudo cargar';
    $('#termsMessage').textContent = error.message;
    showMessage(error.message, 'error');
  }
}

async function guardarTerminos() {
  const editor = $('#termsEditor');
  if (!editor || !hasPendingTermsChanges() || guardandoTerminos) return;
  const content = editor.value.trim();
  if (content.length < 20) {
    $('#termsMessage').textContent = 'El contenido es demasiado corto. Revisa los términos antes de guardarlos.';
    editor.focus();
    return;
  }
  if (content.length > 50000) {
    $('#termsMessage').textContent = 'El contenido supera el límite de 50.000 caracteres.';
    return;
  }
  if (!window.confirm('Esto publicará una nueva versión de Términos y Condiciones en la página pública. ¿Deseas continuar?')) return;
  guardandoTerminos = true;
  $('#termsMessage').textContent = '';
  updateTermsState();
  try {
    const response = await fetch('/api/admin/terminos', {
      method: 'PUT',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ content })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { window.location.replace('/admin/login'); return; }
    if (!response.ok) throw new Error(data.error || `No se pudieron guardar los términos (HTTP ${response.status}).`);
    editor.value = content;
    terminosGuardados = content;
    $('#termsMessage').textContent = 'Términos guardados. La página pública ya muestra esta versión.';
    showMessage('Términos y Condiciones actualizados.', 'success');
  } catch (error) {
    $('#termsMessage').textContent = error.message;
    showMessage(error.message, 'error');
  } finally {
    guardandoTerminos = false;
    updateTermsState();
  }
}

// Navigation
$$('.nav-item').forEach(button => button.addEventListener('click', () => showSection(button.dataset.section)));
$$('[data-go-section]').forEach(button => button.addEventListener('click', () => showSection(button.dataset.goSection)));

// Open creation forms, including quick action buttons.
$('#addMarcaButton').addEventListener('click', () => openModal('create-brand'));
$('#addServicioButton').addEventListener('click', () => openModal('create-service'));
$('#addVariantButton').addEventListener('click', () => openModal('create-variant'));
$('#addPriceVariantButton').addEventListener('click', () => openModal('create-variant'));

// Entity actions are delegated because the lists are redrawn after every change.
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || !button.isConnected) return;
  const action = button.dataset.action;
  const brand = button.dataset.brand;
  const model = button.dataset.model;
  const service = button.dataset.service;
  if (action === 'create-brand') openModal('create-brand');
  else if (action === 'rename-brand') openModal('rename-brand', { brand });
  else if (action === 'rename-model') openModal('rename-model', { brand, model });
  else if (action === 'rename-service') openModal('rename-service', { service });
  else if (action === 'delete-brand') deleteBrand(brand);
  else if (action === 'delete-model') deleteModel(brand, model);
  else if (action === 'delete-service') deleteService(service);
  else if (action === 'add-service-to-model') openModal('create-service', { service });
  else if (action === 'delete-price') deletePrice(Number(button.dataset.index));
  else if (action === 'create-model') openModal('create-model', { brand });
  else if (action === 'create-service') openModal('create-service', { brand, model });
  else if (action === 'create-variant') openModal('create-variant', { brand, model, service });
});

// Searches
$('#brandSearch').addEventListener('input', renderBrands);
$('#modelSearch').addEventListener('input', renderModels);
$('#serviceSearch').addEventListener('input', renderServices);
$('#priceSearch').addEventListener('input', renderPrices);

// Price draft input: index points to datos (not to the filtered view).
$('#preciosContainer').addEventListener('input', event => {
  const input = event.target.closest('.price-input');
  if (!input) return;
  const index = Number(input.dataset.rowIndex);
  if (!Number.isInteger(index) || !datos[index]) return;
  const raw = input.value;
  const valid = /^\d{0,9}$/.test(raw) && (raw === '' || Number(raw) <= 100000000);
  input.classList.toggle('invalid', !valid || raw === '');
  if (valid) {
    datos[index].precio = raw;
    if (raw !== '') input.dataset.lastValid = raw;
  }
  updatePendingState();
});
$('#preciosContainer').addEventListener('change', event => {
  const input = event.target.closest('.price-input');
  if (!input) return;
  const index = Number(input.dataset.rowIndex);
  if (!Number.isInteger(index) || !datos[index]) return;
  const raw = input.value;
  if (!/^\d{1,9}$/.test(raw) || Number(raw) > 100000000) {
    input.classList.add('invalid');
    input.value = input.dataset.lastValid || '0';
    datos[index].precio = input.value;
    input.classList.remove('invalid');
    updatePendingState();
    input.focus();
    showMessage('El precio debe ser un entero entre $0 y $100.000.000. Se restauró el último valor válido.', 'error');
    return;
  }
  datos[index].precio = String(Number(raw));
  input.value = datos[index].precio;
  input.classList.remove('invalid');
  updatePendingState();
});

// Save and form events
$('#saveChangesButton').addEventListener('click', saveChanges);
$('#catalogForm').addEventListener('submit', submitModal);
$('#closeModalButton').addEventListener('click', closeModal);
$('#cancelModalButton').addEventListener('click', closeModal);
$('#catalogModal').addEventListener('click', event => { if (event.target.matches('[data-close-modal="true"]')) closeModal(); });
$('#cancelConfirmButton').addEventListener('click', closeConfirmation);
$('#confirmModal').addEventListener('click', event => { if (event.target.matches('[data-close-confirm="true"]')) closeConfirmation(); });
$('#acceptConfirmButton').addEventListener('click', () => {
  const action = pendingConfirmAction;
  closeConfirmation();
  if (typeof action === 'function') action();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if ($('#confirmModal').classList.contains('active')) closeConfirmation();
    else if ($('#catalogModal').classList.contains('active')) closeModal();
  }
});

$('#refreshErrorsButton').addEventListener('click', cargarErrores);
$('#refreshConsultasButton').addEventListener('click', cargarConsultas);
$('#consultaPeriodo').addEventListener('change', cargarConsultas);
$('#saveTermsButton').addEventListener('click', guardarTerminos);
$('#reloadTermsButton').addEventListener('click', () => cargarTerminos(true));
$('#termsEditor').addEventListener('input', updateTermsState);
$('#clearErrorsButton').addEventListener('click', async () => {
  askConfirmation({
    title: 'Limpiar centro de errores',
    message: '¿Seguro que quieres borrar todos los registros de errores guardados?',
    details: 'Esta acción borra el registro del servidor y no se puede deshacer.',
    confirmLabel: 'Borrar registros',
    action: async () => {
      const button = $('#clearErrorsButton');
      button.disabled = true;
      try {
        const response = await fetch('/api/admin/errores', { method: 'DELETE', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken }, cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) { window.location.replace('/admin/login'); return; }
        if (!response.ok) throw new Error(data.error || 'No se pudieron limpiar los registros.');
        await cargarErrores();
        showMessage('Centro de errores limpiado.');
      } catch (error) { showMessage(error.message, 'error'); }
      finally { button.disabled = false; }
    }
  });
});

$('#logoutButton').addEventListener('click', async () => {
  if (hasAnyPendingChanges()) {
    const leave = window.confirm('Tienes cambios de catálogo o Términos y Condiciones sin guardar. Si cierras sesión, se perderán. ¿Deseas continuar?');
    if (!leave) return;
  }
  const button = $('#logoutButton');
  button.disabled = true;
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrfToken }, cache: 'no-store' });
  } catch (error) { console.error('No se pudo cerrar sesión en el servidor:', error); }
  finally {
    sessionStorage.removeItem('techlag_csrf');
    window.location.replace('/admin/login');
  }
});

window.addEventListener('beforeunload', event => {
  if (hasAnyPendingChanges()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

(async function initAdmin() {
  const authenticated = await verificarSesion();
  if (!authenticated) return;
  try {
    const loaded = await cargarDatos();
    if (!loaded) return;
    await cargarConsultas();
  } catch (error) {
    console.error(error);
    showMessage(error.message || 'No se pudo cargar el catálogo.', 'error');
  }
})();
