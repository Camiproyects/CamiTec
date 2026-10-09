const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    loginError.textContent = "";

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;

    if (!username || !password) {
        loginError.textContent = "Completa todos los campos.";
        return;
    }

    const button = loginForm.querySelector("button");

    button.disabled = true;
    button.textContent = "Verificando...";

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                username,
                password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "No se pudo iniciar sesión.");
        }

        if (!data.csrf) {
            throw new Error("El servidor no entregó el token de seguridad.");
        }

        sessionStorage.setItem("techlag_csrf", data.csrf);

        window.location.href = "/admin";

    } catch (error) {

        loginError.textContent = error.message;

        button.disabled = false;
        button.textContent = "Iniciar sesión";
    }
});