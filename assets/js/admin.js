let datos = [];
let csrfToken = sessionStorage.getItem("techlag_csrf");

const navItems = document.querySelectorAll(".nav-item");
const sections = document.querySelectorAll(".admin-section");
const sectionTitle = document.getElementById("sectionTitle");
const adminMessage = document.getElementById("adminMessage");

const nombresSecciones = {
    dashboard: "Dashboard",
    marcas: "Marcas",
    modelos: "Modelos",
    servicios: "Servicios",
    precios: "Precios",
    errores: "Centro de errores"
};


/* =========================================
   UTILIDADES
========================================= */

function escapeHTML(valor) {
    return String(valor ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function mostrarMensaje(texto) {
    adminMessage.textContent = texto;
    adminMessage.classList.add("show");

    setTimeout(() => {
        adminMessage.classList.remove("show");
    }, 2800);
}


/* =========================================
   SESIÓN
========================================= */

async function verificarSesion() {

    try {

        const response = await fetch("/api/session", {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store"
        });

        if (!response.ok) {
            window.location.href = "/admin/login";
            return false;
        }

        const data = await response.json();

        if (!data.authenticated) {
            window.location.href = "/admin/login";
            return false;
        }

        if (data.csrf) {
            csrfToken = data.csrf;

            sessionStorage.setItem(
                "techlag_csrf",
                csrfToken
            );
        }

        return true;

    } catch (error) {

        console.error(error);

        window.location.href = "/admin/login";

        return false;
    }
}


/* =========================================
   CARGAR DATOS
========================================= */

async function cargarDatos() {

    const response = await fetch(
        "/api/admin/datos",
        {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store"
        }
    );

    if (!response.ok) {

        if (response.status === 401) {
            window.location.href = "/admin/login";
            return;
        }

        throw new Error(
            "No se pudieron cargar los datos."
        );
    }

    const data = await response.json();

    datos = Array.isArray(data.rows)
        ? data.rows
        : [];

    actualizarDashboard();

    mostrarMarcas();
    mostrarModelos();
    mostrarServicios();
    mostrarPrecios();
}


/* =========================================
   DASHBOARD
========================================= */

function actualizarDashboard() {

    const marcas = new Set(
        datos.map(item => item.marca)
    );

    const modelos = new Set(
        datos.map(item =>
            `${item.marca}|${item.modelo}`
        )
    );

    const servicios = new Set(
        datos.map(item => item.servicio)
    );

    document.getElementById(
        "totalMarcas"
    ).textContent = marcas.size;

    document.getElementById(
        "totalModelos"
    ).textContent = modelos.size;

    document.getElementById(
        "totalServicios"
    ).textContent = servicios.size;

    document.getElementById(
        "totalPrecios"
    ).textContent = datos.length;
}


/* =========================================
   MARCAS
========================================= */

function mostrarMarcas() {

    const container =
        document.getElementById(
            "marcasContainer"
        );

    const marcas = [
        ...new Set(
            datos.map(item => item.marca)
        )
    ].sort((a, b) =>
        a.localeCompare(b)
    );

    if (!marcas.length) {

        container.innerHTML =
            "<p>No hay marcas registradas.</p>";

        return;
    }

    container.innerHTML = `
        <table class="admin-table">

            <thead>
                <tr>
                    <th>Marca</th>
                </tr>
            </thead>

            <tbody>

                ${marcas.map(marca => `
                    <tr>
                        <td>
                            ${escapeHTML(marca)}
                        </td>
                    </tr>
                `).join("")}

            </tbody>

        </table>
    `;
}


/* =========================================
   MODELOS
========================================= */

function mostrarModelos() {

    const container =
        document.getElementById(
            "modelosContainer"
        );

    const modelos = [
        ...new Map(
            datos.map(item => [
                `${item.marca}|${item.modelo}`,
                item
            ])
        ).values()
    ].sort((a, b) => {

        const nombreA =
            `${a.marca} ${a.modelo}`;

        const nombreB =
            `${b.marca} ${b.modelo}`;

        return nombreA.localeCompare(nombreB);
    });

    if (!modelos.length) {

        container.innerHTML =
            "<p>No hay modelos registrados.</p>";

        return;
    }

    container.innerHTML = `
        <table class="admin-table">

            <thead>
                <tr>
                    <th>Marca</th>
                    <th>Modelo</th>
                </tr>
            </thead>

            <tbody>

                ${modelos.map(item => `
                    <tr>
                        <td>
                            ${escapeHTML(item.marca)}
                        </td>

                        <td>
                            ${escapeHTML(item.modelo)}
                        </td>
                    </tr>
                `).join("")}

            </tbody>

        </table>
    `;
}


/* =========================================
   SERVICIOS
========================================= */

function mostrarServicios() {

    const container =
        document.getElementById(
            "serviciosContainer"
        );

    const servicios = [
        ...new Set(
            datos.map(item => item.servicio)
        )
    ].sort((a, b) =>
        a.localeCompare(b)
    );

    if (!servicios.length) {

        container.innerHTML =
            "<p>No hay servicios registrados.</p>";

        return;
    }

    container.innerHTML = `
        <table class="admin-table">

            <thead>
                <tr>
                    <th>Servicio</th>
                </tr>
            </thead>

            <tbody>

                ${servicios.map(servicio => `
                    <tr>
                        <td>
                            ${escapeHTML(servicio)}
                        </td>
                    </tr>
                `).join("")}

            </tbody>

        </table>
    `;
}


/* =========================================
   PRECIOS
========================================= */

function mostrarPrecios(filtro = "") {

    const container =
        document.getElementById(
            "preciosContainer"
        );

    const termino =
        filtro.toLowerCase().trim();

    const resultados = datos
        .map((item, index) => ({
            item,
            index
        }))
        .filter(({ item }) => {

            if (!termino) {
                return true;
            }

            return (
                String(item.marca)
                    .toLowerCase()
                    .includes(termino) ||

                String(item.modelo)
                    .toLowerCase()
                    .includes(termino) ||

                String(item.servicio)
                    .toLowerCase()
                    .includes(termino) ||

                String(item.calidad)
                    .toLowerCase()
                    .includes(termino)
            );
        });


    if (!resultados.length) {

        container.innerHTML =
            "<p>No se encontraron resultados.</p>";

        return;
    }


    container.innerHTML = `
        <div class="table-wrapper">

            <table class="admin-table">

                <thead>
                    <tr>
                        <th>Marca</th>
                        <th>Modelo</th>
                        <th>Servicio</th>
                        <th>Calidad</th>
                        <th>Precio</th>
                        <th>Acción</th>
                    </tr>
                </thead>

                <tbody>

                    ${resultados.map(
                        ({ item, index }) => `

                        <tr>

                            <td>
                                ${escapeHTML(item.marca)}
                            </td>

                            <td>
                                ${escapeHTML(item.modelo)}
                            </td>

                            <td>
                                ${escapeHTML(item.servicio)}
                            </td>

                            <td>
                                ${escapeHTML(item.calidad)}
                            </td>

                            <td>

                                <input
                                    class="price-input"
                                    type="number"
                                    min="0"
                                    max="100000000"
                                    step="1"
                                    value="${Number(item.precio) || 0}"
                                    data-index="${index}"
                                >

                            </td>

                            <td>

                            <div class="price-actions">

                                <button
                                    type="button"
                                    class="edit-button"
                                    data-index="${index}"
                                >
                                    Editar
                                </button>

                                <button
                                    type="button"
                                    class="delete-button"
                                    data-index="${index}"
                                >
                                    Eliminar
                                </button>

                            </div>

                            </td>

                        </tr>

                    `).join("")}

                </tbody>

            </table>

        </div>
    `;
}


/* =========================================
   CAMBIO DE PRECIO
========================================= */

document
    .getElementById("preciosContainer")
    .addEventListener(
        "input",
        event => {

            if (
                !event.target.classList
                    .contains("price-input")
            ) {
                return;
            }

            const index =
                Number(
                    event.target.dataset.index
                );

            const nuevoPrecio =
                Number(event.target.value);

            if (
                Number.isInteger(nuevoPrecio) &&
                nuevoPrecio >= 0 &&
                nuevoPrecio <= 100000000
            ) {

                datos[index].precio =
                    nuevoPrecio;
            }
        }
    );


/* =========================================
   ELIMINAR REGISTRO
========================================= */

document
    .getElementById("preciosContainer")
    .addEventListener(
        "click",
        event => {

            if (
                !event.target.classList
                    .contains("delete-button")
            ) {
                return;
            }

            const index =
                Number(
                    event.target.dataset.index
                );

            const registro =
                datos[index];

            if (!registro) {
                return;
            }

            const confirmar = confirm(
                `¿Eliminar ${registro.marca} ${registro.modelo} - ${registro.calidad}?`
            );

            if (!confirmar) {
                return;
            }

            datos.splice(index, 1);

            actualizarDashboard();

            mostrarMarcas();
            mostrarModelos();
            mostrarServicios();

            const filtro =
                document.getElementById(
                    "priceSearch"
                ).value;

            mostrarPrecios(filtro);

            mostrarMensaje(
                "Registro eliminado."
            );
        }
    );


/* =========================================
   BUSCADOR
========================================= */

document
    .getElementById("priceSearch")
    .addEventListener(
        "input",
        event => {

            mostrarPrecios(
                event.target.value
            );
        }
    );


/* =========================================
   GUARDAR
========================================= */

document
    .getElementById("savePricesButton")
    .addEventListener(
        "click",
        async () => {

            const button =
                document.getElementById(
                    "savePricesButton"
                );

            button.disabled = true;
            button.textContent =
                "Guardando...";

            try {

                const response =
                    await fetch(
                        "/api/admin/datos",
                        {
                            method: "PUT",

                            credentials:
                                "same-origin",

                            headers: {
                                "Content-Type":
                                    "application/json",

                                "X-CSRF-Token":
                                    csrfToken
                            },

                            body: JSON.stringify({
                                rows: datos
                            })
                        }
                    );

                const result =
                    await response.json();

                if (!response.ok) {

                    throw new Error(
                        result.error ||
                        "No se pudieron guardar los cambios."
                    );
                }

                mostrarMensaje(
                    "Cambios guardados correctamente."
                );

            } catch (error) {

                console.error(error);

                mostrarMensaje(
                    error.message
                );

            } finally {

                button.disabled = false;

                button.textContent =
                    "Guardar cambios";
            }
        }
    );


/* =========================================
   CENTRO DE ERRORES
========================================= */

async function cargarErrores() {
    const container = document.getElementById("errorsContainer");
    container.innerHTML = "<p>Cargando registros...</p>";

    try {
        const response = await fetch("/api/admin/errores", {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store"
        });
        if (response.status === 401) {
            window.location.href = "/admin/login";
            return;
        }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los errores.");

        const entries = Array.isArray(data.entries) ? data.entries : [];
        document.getElementById("errorTotal").textContent = data.total ?? entries.length;
        document.getElementById("error404").textContent = entries.filter(item => item.status === 404).length;
        document.getElementById("errorAuth").textContent = entries.filter(item => item.status === 401 || item.status === 403).length;
        document.getElementById("error500").textContent = entries.filter(item => item.status === 500).length;

        if (!entries.length) {
            container.innerHTML = '<div class="empty-errors"><strong>Todo tranquilo por aquí</strong><p>No hay errores registrados en el período conservado.</p></div>';
            return;
        }

        container.innerHTML = `
            <div class="table-wrapper">
                <table class="admin-table errors-table">
                    <thead><tr><th>Fecha y hora</th><th>Código</th><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
                    <tbody>
                    ${entries.map(item => {
                        const status = Number(item.status) || 0;
                        const timestamp = new Date(item.timestamp);
                        const date = Number.isNaN(timestamp.getTime()) ? "Fecha inválida" : timestamp.toLocaleString("es-CO");
                        return `<tr>
                            <td>${escapeHTML(date)}</td>
                            <td><span class="http-status status-${status}">${status}</span></td>
                            <td>${escapeHTML(item.method)}</td>
                            <td><code>${escapeHTML(item.path)}</code></td>
                            <td>${escapeHTML(item.message)}</td>
                        </tr>`;
                    }).join("")}
                    </tbody>
                </table>
            </div>`;
    } catch (error) {
        container.innerHTML = `<p class="errors-load-failed">${escapeHTML(error.message)}</p>`;
    }
}

document.getElementById("refreshErrorsButton").addEventListener("click", cargarErrores);

document.getElementById("clearErrorsButton").addEventListener("click", async () => {
    if (!confirm("¿Seguro que quieres borrar todos los registros de errores?")) return;
    const button = document.getElementById("clearErrorsButton");
    button.disabled = true;
    try {
        const response = await fetch("/api/admin/errores", {
            method: "DELETE",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": csrfToken }
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se pudieron borrar los registros.");
        await cargarErrores();
        mostrarMensaje("Registros de errores eliminados.");
    } catch (error) {
        mostrarMensaje(error.message);
    } finally {
        button.disabled = false;
    }
});

/* =========================================
   NAVEGACIÓN
========================================= */

navItems.forEach(button => {

    button.addEventListener(
        "click",
        () => {

            const section =
                button.dataset.section;

            navItems.forEach(item =>
                item.classList.remove(
                    "active"
                )
            );

            button.classList.add(
                "active"
            );

            sections.forEach(item =>
                item.classList.remove(
                    "active"
                )
            );

            const destino =
                document.getElementById(
                    `section-${section}`
                );

            if (destino) {
                destino.classList.add(
                    "active"
                );
            }

            sectionTitle.textContent =
                nombresSecciones[
                    section
                ] || "Administración";

            if (section === "errores") cargarErrores();
        }
    );
});


/* =========================================
   CERRAR SESIÓN
========================================= */

document
    .getElementById("logoutButton")
    .addEventListener(
        "click",
        async () => {

            try {

                await fetch(
                    "/api/logout",
                    {
                        method: "POST",

                        credentials:
                            "same-origin",

                        headers: {
                            "X-CSRF-Token":
                                csrfToken
                        }
                    }
                );

            } catch (error) {

                console.error(error);

            } finally {

                sessionStorage.removeItem(
                    "techlag_csrf"
                );

                window.location.href =
                    "/admin/login";
            }
        }
    );


/* =========================================
   MODAL DE CATÁLOGO
========================================= */

const catalogModal =
    document.getElementById("catalogModal");

const catalogForm =
    document.getElementById("catalogForm");

const modalTitle =
    document.getElementById("modalTitle");

const editIndexInput =
    document.getElementById("editIndex");

const formMarca =
    document.getElementById("formMarca");

const formModelo =
    document.getElementById("formModelo");

const formServicio =
    document.getElementById("formServicio");

const formCalidad =
    document.getElementById("formCalidad");

const formPrecio =
    document.getElementById("formPrecio");

const modalError =
    document.getElementById("modalError");


function abrirModal(modo = "crear", index = null) {

    catalogModal.classList.add("active");

    modalError.textContent = "";

    if (
        modo === "editar" &&
        index !== null &&
        datos[index]
    ) {

        const registro = datos[index];

        modalTitle.textContent =
            "Editar registro";

        editIndexInput.value = index;

        formMarca.value =
            registro.marca;

        formModelo.value =
            registro.modelo;

        formServicio.value =
            registro.servicio;

        formCalidad.value =
            registro.calidad;

        formPrecio.value =
            registro.precio;

    } else {

        modalTitle.textContent =
            "Agregar registro";

        editIndexInput.value = "";

        catalogForm.reset();

        formCalidad.value =
            "generica";

    }

    setTimeout(() => {
        formMarca.focus();
    }, 50);
}


function cerrarModal() {

    catalogModal.classList.remove(
        "active"
    );

    catalogForm.reset();

    editIndexInput.value = "";

    modalError.textContent = "";
}


document
    .getElementById("closeModalButton")
    .addEventListener(
        "click",
        cerrarModal
    );


document
    .getElementById("cancelModalButton")
    .addEventListener(
        "click",
        cerrarModal
    );


document
    .querySelector(".catalog-modal-backdrop")
    .addEventListener(
        "click",
        cerrarModal
    );


/* =========================================
   AGREGAR MARCA
========================================= */

document
    .getElementById("addMarcaButton")
    .addEventListener(
        "click",
        () => {

            abrirModal("crear");

            mostrarMensaje(
                "Crea el primer registro de la nueva marca."
            );
        }
    );


/* =========================================
   AGREGAR MODELO
========================================= */

document
    .getElementById("addModeloButton")
    .addEventListener(
        "click",
        () => {

            abrirModal("crear");

            mostrarMensaje(
                "Completa la marca y el modelo."
            );
        }
    );


/* =========================================
   AGREGAR SERVICIO
========================================= */

document
    .getElementById("addServicioButton")
    .addEventListener(
        "click",
        () => {

            abrirModal("crear");

            mostrarMensaje(
                "Completa el servicio que deseas agregar."
            );
        }
    );


/* =========================================
   EDITAR REGISTRO
========================================= */

document
    .getElementById("preciosContainer")
    .addEventListener(
        "dblclick",
        event => {

            const fila =
                event.target.closest("tr");

            if (!fila) {
                return;
            }

            const input =
                fila.querySelector(
                    ".price-input"
                );

            if (!input) {
                return;
            }

            const index =
                Number(
                    input.dataset.index
                );

            if (
                Number.isInteger(index) &&
                datos[index]
            ) {
                abrirModal(
                    "editar",
                    index
                );
            }
        }
    );


/* =========================================
   GUARDAR MODAL
========================================= */

catalogForm.addEventListener(
    "submit",
    event => {

        event.preventDefault();

        modalError.textContent = "";

        const marca =
            formMarca.value.trim();

        const modelo =
            formModelo.value.trim();

        const servicio =
            formServicio.value.trim();

        const calidad =
            formCalidad.value;

        const precio =
            Number(formPrecio.value);


        if (!marca) {
            modalError.textContent =
                "La marca es obligatoria.";
            formMarca.focus();
            return;
        }

        if (!modelo) {
            modalError.textContent =
                "El modelo es obligatorio.";
            formModelo.focus();
            return;
        }

        if (!servicio) {
            modalError.textContent =
                "El servicio es obligatorio.";
            formServicio.focus();
            return;
        }

        if (
            !Number.isInteger(precio) ||
            precio < 0 ||
            precio > 100000000
        ) {

            modalError.textContent =
                "El precio debe ser un número entero válido.";

            formPrecio.focus();

            return;
        }


        const registro = {
            marca,
            modelo,
            servicio,
            calidad,
            precio
        };


        const editIndex =
            editIndexInput.value;


        if (editIndex !== "") {

            const index =
                Number(editIndex);

            if (
                Number.isInteger(index) &&
                datos[index]
            ) {

                datos[index] =
                    registro;

                mostrarMensaje(
                    "Registro actualizado. Recuerda guardar los cambios."
                );
            }

        } else {

            const duplicado =
                datos.some(item =>
                    String(item.marca)
                        .toLowerCase() ===
                        marca.toLowerCase() &&

                    String(item.modelo)
                        .toLowerCase() ===
                        modelo.toLowerCase() &&

                    String(item.servicio)
                        .toLowerCase() ===
                        servicio.toLowerCase() &&

                    String(item.calidad)
                        .toLowerCase() ===
                        calidad.toLowerCase()
                );


            if (duplicado) {

                modalError.textContent =
                    "Ese registro ya existe.";

                return;
            }


            datos.push(registro);

            mostrarMensaje(
                "Registro agregado. Recuerda guardar los cambios."
            );
        }


        actualizarDashboard();

        mostrarMarcas();
        mostrarModelos();
        mostrarServicios();

        mostrarPrecios(
            document.getElementById(
                "priceSearch"
            ).value
        );

        cerrarModal();
    }
);

/* =========================================
   INICIO
========================================= */

(async function iniciar() {

    const autenticado =
        await verificarSesion();

    if (!autenticado) {
        return;
    }

    try {

        await cargarDatos();

    } catch (error) {

        console.error(error);

        mostrarMensaje(
            error.message
        );
    }

})();
