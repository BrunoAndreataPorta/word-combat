document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const showRegisterBtn = document.getElementById("show-register");
  const showLoginBtn = document.getElementById("show-login");
  const messages = document.getElementById("messages");

  // Se já estiver autenticado no servidor, /api/me redireciona
  async function checkAuth() {
    try {
      const res = await fetch("/api/me");
      if (res.ok) {
        // já autenticado -> vai pro hub
        window.location.href = "/hub.html";
      }
    } catch (e) {
      // não faz nada
    }
  }
  checkAuth();

  function showMessage(msg, tone = "error") {
    messages.textContent = msg || "";
    if (tone === "error") messages.style.color = "#b94a48";
    else if (tone === "success") messages.style.color = "#2b8aef";
    else messages.style.color = "#666";
  }
  function clearMessage() { messages.textContent = ""; }

  function toggleForms(showRegister) {
    if (showRegister) {
      registerForm.classList.remove("hidden");
      loginForm.classList.add("hidden");
    } else {
      registerForm.classList.add("hidden");
      loginForm.classList.remove("hidden");
    }
    clearMessage();
  }

  showRegisterBtn.addEventListener("click", () => toggleForms(true));
  showLoginBtn.addEventListener("click", () => toggleForms(false));

  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  async function doRegister(name, email, password) {
    const btn = document.getElementById("register-btn");
    btn.disabled = true;
    btn.textContent = "Registrando...";
    showMessage("Registrando...", "info");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });
      const data = await safeJson(res);
      if (data && data.name) localStorage.setItem("wc_user", data.name);
      if (!res.ok) {
        showMessage(data && data.message ? data.message : `Erro (${res.status})`, "error");
        btn.disabled = false;
        btn.textContent = "Registrar";
        return;
      }
      showMessage("Registrado! Redirecionando...", "success");
      // O servidor já colocou cookie httpOnly; basta ir para hub
      setTimeout(() => window.location.href = "/hub.html", 500);
    } catch (err) {
      console.error(err);
      showMessage("Erro de rede.", "error");
      btn.disabled = false;
      btn.textContent = "Registrar";
    }
  }

  async function doLogin(email, password) {
    const btn = document.getElementById("login-btn");
    btn.disabled = true;
    btn.textContent = "Entrando...";
    showMessage("Entrando...", "info");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await safeJson(res);
      if (data && data.name) localStorage.setItem("wc_user", data.name);
      if (!res.ok) {
        showMessage(data && data.message ? data.message : `Erro (${res.status})`, "error");
        btn.disabled = false;
        btn.textContent = "Entrar";
        return;
      }
      showMessage("Login bem-sucedido! Redirecionando...", "success");
      setTimeout(() => window.location.href = "/hub.html", 500);
    } catch (err) {
      console.error(err);
      showMessage("Erro de rede.", "error");
      btn.disabled = false;
      btn.textContent = "Entrar";
    }
  }

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessage();
    const name = (document.getElementById("r-name").value || "").trim();
    const email = (document.getElementById("r-email").value || "").trim();
    const password = (document.getElementById("r-password").value || "");
    if (!name || !email || password.length < 6) {
      showMessage("Preencha nome, email e senha (mín 6).");
      return;
    }
    await doRegister(name, email, password);
  });

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMessage();
    const email = (document.getElementById("email").value || "").trim();
    const password = (document.getElementById("password").value || "");
    if (!email || !password) {
      showMessage("Preencha email e senha.");
      return;
    }
    await doLogin(email, password);
  });

});
