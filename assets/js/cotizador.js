
const CSV_URL = "/api/catalogo";
const WHATSAPP_NUMBER = "573224494595";


let datos = [];
let precioActual = 0;
let servicioPreseleccionado = "";

const marcaSelect = document.getElementById("marca");
const modeloSelect = document.getElementById("modelo");
const servicioSelect = document.getElementById("servicio");
const calidadSelect = document.getElementById("calidad");
const precioElement = document.getElementById("precio");
const whatsappBtn = document.getElementById("whatsapp-btn");
const aceptaTyc = document.getElementById("acepta-tyc");

const nombresServicio = {
    cambio_pantalla: "Cambio de pantalla",
    bateria: "Cambio de batería",
    puerto: "Puerto de carga",
    software: "Software",
    diagnostico: "Diagnóstico"
};

const nombresCalidad = {
    generica: "Genérica",
    oem: "OEM / Premium",
    original: "Original"
};

function formatCOP(valor) {
    const numero = Number(valor);

    if (!Number.isFinite(numero)) {
        return "$0 COP";
    }

    return numero.toLocaleString("es-CO", {
        style: "currency",
        currency: "COP",
        maximumFractionDigits: 0
    });
}

function limpiarTexto(texto) {
    return String(texto ?? "").trim();
}

function parseCSV(texto) {
    const lineas = texto
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map(linea => linea.trim())
        .filter(Boolean);

    if (lineas.length < 2) {
        return [];
    }

    const encabezados = lineas[0]
        .split(",")
        .map(valor => limpiarTexto(valor).toLowerCase());

    return lineas.slice(1).map(linea => {
        const valores = linea.split(",");
        const fila = {};

        encabezados.forEach((encabezado, indice) => {
            fila[encabezado] = limpiarTexto(valores[indice]);
        });

        return fila;
    }).filter(fila =>
        fila.marca &&
        fila.modelo &&
        fila.servicio &&
        fila.calidad &&
        fila.precio
    );
}

async function cargarCSV() {
    try {
        const respuesta = await fetch(CSV_URL, {
            cache: "no-store"
        });

        if (!respuesta.ok) {
            throw new Error(`Error cargando CSV: ${respuesta.status}`);
        }

        const texto = await respuesta.text();

        datos = parseCSV(texto);

        if (datos.length === 0) {
            throw new Error("data.csv está vacío o no tiene el formato correcto.");
        }

        cargarMarcas();

    } catch (error) {
        console.error("Error:", error);

        marcaSelect.innerHTML =
            '<option value="">Error al cargar marcas</option>';

        alert(
            "No se pudo cargar data.csv. " +
            "Verifica que estés usando Live Server."
        );
    }
}

function cargarMarcas() {
    const marcas = [...new Set(
        datos.map(item => item.marca)
    )].sort((a, b) => a.localeCompare(b, "es"));

    marcaSelect.innerHTML =
        '<option value="">Selecciona una marca</option>';

    marcas.forEach(marca => {
        const option = document.createElement("option");

        option.value = marca;
        option.textContent = marca;

        marcaSelect.appendChild(option);
    });

    modeloSelect.innerHTML =
        '<option value="">Selecciona una marca primero</option>';

    servicioSelect.innerHTML =
        '<option value="">Selecciona un modelo primero</option>';

    calidadSelect.innerHTML =
        '<option value="">Selecciona servicio primero</option>';

    modeloSelect.disabled = true;
    servicioSelect.disabled = true;
    calidadSelect.disabled = true;

    precioActual = 0;
    actualizarPrecio();
    actualizarWhatsApp();
}

marcaSelect.addEventListener("change", () => {
    const marca = marcaSelect.value;

    modeloSelect.innerHTML =
        '<option value="">Selecciona un modelo</option>';

    servicioSelect.innerHTML =
        '<option value="">Selecciona un modelo primero</option>';

    calidadSelect.innerHTML =
        '<option value="">Selecciona servicio primero</option>';

    modeloSelect.disabled = true;
    servicioSelect.disabled = true;
    calidadSelect.disabled = true;

    precioActual = 0;
    actualizarPrecio();
    actualizarWhatsApp();

    if (!marca) {
        return;
    }

    const modelos = [...new Set(
        datos
            .filter(item => item.marca === marca)
            .map(item => item.modelo)
    )].sort((a, b) => a.localeCompare(b, "es"));

    modelos.forEach(modelo => {
        const option = document.createElement("option");

        option.value = modelo;
        option.textContent = modelo;

        modeloSelect.appendChild(option);
    });

    modeloSelect.disabled = false;
});

modeloSelect.addEventListener("change", () => {
    const marca = marcaSelect.value;
    const modelo = modeloSelect.value;

    servicioSelect.innerHTML =
        '<option value="">Selecciona un servicio</option>';

    calidadSelect.innerHTML =
        '<option value="">Selecciona servicio primero</option>';

    servicioSelect.disabled = true;
    calidadSelect.disabled = true;

    precioActual = 0;
    actualizarPrecio();
    actualizarWhatsApp();

    if (!modelo) {
        return;
    }

    const servicios = [...new Set(
        datos
            .filter(item =>
                item.marca === marca &&
                item.modelo === modelo
            )
            .map(item => item.servicio)
    )];

    servicios.forEach(servicio => {
        const option = document.createElement("option");

        option.value = servicio;
        option.textContent =
            nombresServicio[servicio] || servicio;

        servicioSelect.appendChild(option);
    });

    servicioSelect.disabled = false;

    if (
        servicioPreseleccionado &&
        servicios.includes(servicioPreseleccionado)
    ) {
        servicioSelect.value = servicioPreseleccionado;
        servicioPreseleccionado = "";

        cargarCalidades();
    }
});

servicioSelect.addEventListener("change", () => {
    cargarCalidades();
});

function cargarCalidades() {
    const marca = marcaSelect.value;
    const modelo = modeloSelect.value;
    const servicio = servicioSelect.value;

    calidadSelect.innerHTML =
        '<option value="">Selecciona una calidad</option>';

    calidadSelect.disabled = true;

    precioActual = 0;
    actualizarPrecio();
    actualizarWhatsApp();

    if (!servicio) {
        return;
    }

    const calidades = [...new Set(
        datos
            .filter(item =>
                item.marca === marca &&
                item.modelo === modelo &&
                item.servicio === servicio
            )
            .map(item => item.calidad)
    )];

    calidades.forEach(calidad => {
        const option = document.createElement("option");

        option.value = calidad;
        option.textContent =
            nombresCalidad[calidad] || calidad;

        calidadSelect.appendChild(option);
    });

    calidadSelect.disabled = false;
}

calidadSelect.addEventListener("change", () => {
    const marca = marcaSelect.value;
    const modelo = modeloSelect.value;
    const servicio = servicioSelect.value;
    const calidad = calidadSelect.value;

    precioActual = 0;

    if (calidad) {
        const resultado = datos.find(item =>
            item.marca === marca &&
            item.modelo === modelo &&
            item.servicio === servicio &&
            item.calidad === calidad
        );

        if (resultado) {
            precioActual = Number(resultado.precio);
            // Registra una consulta anónima cuando el cliente selecciona una combinación válida.
            // El servidor vuelve a validar el precio contra el catálogo y no guarda datos personales.
            registrarConsulta({ marca, modelo, servicio, calidad, precio: precioActual });
        }
    }

    actualizarPrecio();
    actualizarWhatsApp();
});

let ultimaConsultaRegistrada = '';
let ultimoMomentoConsulta = 0;
function registrarConsulta(consulta) {
    if (!consulta || !consulta.marca || !consulta.modelo || !consulta.servicio || !consulta.calidad || !(Number(consulta.precio) > 0)) return;
    const key = [consulta.marca, consulta.modelo, consulta.servicio, consulta.calidad, consulta.precio].join('\u0000');
    const now = Date.now();
    // Evita duplicar un mismo evento si el navegador dispara dos cambios seguidos.
    if (key === ultimaConsultaRegistrada && now - ultimoMomentoConsulta < 2500) return;
    ultimaConsultaRegistrada = key;
    ultimoMomentoConsulta = now;
    fetch('/api/consultas', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(consulta)
    }).catch(error => console.warn('No se pudo registrar la consulta anónima:', error));
}

function actualizarPrecio() {
    precioElement.textContent = formatCOP(precioActual);
}

function actualizarWhatsApp() {
    const completo =
        marcaSelect.value &&
        modeloSelect.value &&
        servicioSelect.value &&
        calidadSelect.value &&
        precioActual > 0;

    const tycAceptados = aceptaTyc.checked;

    if (!completo || !tycAceptados) {
        whatsappBtn.classList.add("disabled");
        whatsappBtn.href = "#";
        return;
    }

    const mensaje = `Hola TECH-LAG.

Quiero cotizar:

📱 Equipo: ${marcaSelect.value} ${modeloSelect.value}

🛠 Servicio: ${
        nombresServicio[servicioSelect.value] ||
        servicioSelect.value
    }

⭐ Calidad: ${
        nombresCalidad[calidadSelect.value] ||
        calidadSelect.value
    }

💰 Precio estimado: ${formatCOP(precioActual)}

El precio es un valor estimado y está sujeto a diagnóstico físico.`;

    whatsappBtn.href =
        `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensaje)}`;

    whatsappBtn.classList.remove("disabled");
}

aceptaTyc.addEventListener("change", () => {
    actualizarWhatsApp();
});

document.addEventListener("DOMContentLoaded", async () => {
    const parametros =
        new URLSearchParams(window.location.search);

    servicioPreseleccionado =
        parametros.get("servicio") || "";

    actualizarPrecio();
    actualizarWhatsApp();

    await cargarCSV();
});