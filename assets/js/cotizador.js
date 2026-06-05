/* ============================= */
/* ELEMENTOS */
/* ============================= */

const marcaSelect = document.getElementById("marca");
const modeloSelect = document.getElementById("modelo");
const servicioSelect = document.getElementById("servicio");
const calidadSelect = document.getElementById("calidad");
const precioEl = document.getElementById("precio");
const whatsappBtn = document.getElementById("whatsapp-btn");

/* ============================= */
/* ESTADO */
/* ============================= */

let marcaId = null;
let modeloId = null;
let precioActual = 0;

/* ============================= */
/* HELPERS */
/* ============================= */

const formatCOP = (v) => `$${v.toLocaleString("es-CO")} COP`;

const resetPrecio = () => {
  precioActual = 0;
  precioEl.textContent = "$0 COP";
};

/* ============================= */
/* PRESELECCIONAR SERVICIO */
/* ============================= */

const params = new URLSearchParams(window.location.search);
const servicioURL = params.get("servicio");

if (servicioURL) {
  servicioSelect.value = servicioURL;
}

/* ============================= */
/* CARGAR MARCAS */
/* ============================= */

document.addEventListener("DOMContentLoaded", cargarMarcas);

async function cargarMarcas() {
  const { data, error } = await supabaseClient
    .from("marcas")
    .select("id, nombre")
    .order("nombre");

  if (error) {
    console.error(error);
    marcaSelect.innerHTML = `<option value="">Error cargando marcas</option>`;
    return;
  }

  marcaSelect.innerHTML = `<option value="">Selecciona marca</option>`;

  data.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.nombre;
    marcaSelect.appendChild(opt);
  });
}

/* ============================= */
/* MARCA → MODELOS */
/* ============================= */

marcaSelect.addEventListener("change", async () => {
  resetPrecio();

  modeloSelect.disabled = true;
  servicioSelect.disabled = true;
  calidadSelect.disabled = true;

  modeloSelect.innerHTML = `<option value="">Cargando modelos...</option>`;
  modeloId = null;

  marcaId = marcaSelect.value;
  if (!marcaId) return;

  const { data, error } = await supabaseClient
    .from("modelos")
    .select("id, nombre")
    .eq("marca_id", marcaId)
    .order("nombre");

  if (error) {
    console.error(error);
    return;
  }

  modeloSelect.innerHTML = `<option value="">Selecciona modelo</option>`;
  data.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.nombre;
    modeloSelect.appendChild(opt);
  });

  modeloSelect.disabled = false;
});

/* ============================= */
/* MODELO */
/* ============================= */

modeloSelect.addEventListener("change", () => {
  resetPrecio();

  modeloId = modeloSelect.value || null;
  servicioSelect.disabled = !modeloId;
  calidadSelect.disabled = true;
});

/* ============================= */
/* SERVICIO */
/* ============================= */

servicioSelect.addEventListener("change", () => {
  resetPrecio();
  calidadSelect.disabled = !servicioSelect.value;
});

/* ============================= */
/* CALCULAR PRECIO */
/* ============================= */

calidadSelect.addEventListener("change", calcularPrecio);

async function calcularPrecio() {
  resetPrecio();

  if (!modeloId) return;
  if (!servicioSelect.value) return;
  if (!calidadSelect.value) return;

  const { data, error } = await supabaseClient
    .from("servicios")
    .select("precio")
    .eq("modelo_id", modeloId)
    .eq("tipo", servicioSelect.value)
    .eq("calidad", calidadSelect.value)
    .eq("activo", true)
    .single();

  if (error || !data) {
    precioEl.textContent = "No disponible";
    return;
  }

  precioActual = data.precio;
  precioEl.textContent = formatCOP(precioActual);
  actualizarWhatsApp();
}

/* ============================= */
/* WHATSAPP */
/* ============================= */

function actualizarWhatsApp() {
  if (!document.getElementById("acepta-tyc").checked) {
    whatsappBtn.classList.add("disabled");
    return;
  }

  const equipoMarca = marcaSelect.options[marcaSelect.selectedIndex]?.text || "";
  const equipoModelo = modeloSelect.options[modeloSelect.selectedIndex]?.text || "";

  const mensaje = `
Hola TECH-LAG 👋
Quiero cotizar:

📱 Equipo: ${equipoMarca} ${equipoModelo}
🛠 Servicio: ${servicioSelect.options[servicioSelect.selectedIndex].text}
⭐ Calidad: ${calidadSelect.options[calidadSelect.selectedIndex].text}
💰 Precio estimado: ${formatCOP(precioActual)}
`.trim();

  whatsappBtn.href =
    "https://wa.me/573224494595?text=" +
    encodeURIComponent(mensaje);

  whatsappBtn.classList.remove("disabled");
}

/* ============================= */
/* VALIDAR TÉRMINOS */
/* ============================= */

const tycCheckbox = document.getElementById("acepta-tyc");

tycCheckbox.addEventListener("change", () => {
  if (tycCheckbox.checked && precioActual > 0) {
    whatsappBtn.classList.remove("disabled");
  } else {
    whatsappBtn.classList.add("disabled");
  }
});

