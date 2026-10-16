(() => {
  'use strict';

  const form = document.getElementById('loginForm');
  const username = document.getElementById('username');
  const password = document.getElementById('password');
  const button = document.getElementById('loginButton');
  const error = document.getElementById('loginError');

  if (!form || !username || !password || !button || !error) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';

    const cleanUsername = username.value.trim();
    if (!cleanUsername || !password.value) {
      error.textContent = 'Escribe tu usuario y contraseña.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Verificando…';

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ username: cleanUsername, password: password.value })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        error.textContent = result.error || 'No fue posible iniciar sesión. Verifica tus datos.';
        password.value = '';
        password.focus();
        return;
      }

      window.location.replace('/admin/');
    } catch (_) {
      error.textContent = 'No se pudo conectar con el servidor. Comprueba que TECH-LAG esté iniciado.';
    } finally {
      button.disabled = false;
      button.innerHTML = 'Ingresar al panel <span aria-hidden="true">→</span>';
    }
  });
})();
