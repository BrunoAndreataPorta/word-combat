// auth.js — gerencia telas de login/registro e chamadas para a API de autenticação
document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const showRegisterBtn = document.getElementById("show-register");
  const showLoginBtn = document.getElementById("show-login");
  const messages = document.getElementById("messages");

  // Verifica se já existe sessão ativa no servidor.
  // Se /api/me responder OK, redireciona diretamente ao hub.
  async function checkAuth() {
    try {
      const res = await fetch("/api/me");
      if (res.ok) {
        // já autenticado -> redireciona para o hub
        window.location.href = "/hub.html";
      }
    } catch (e) {
      // falha na verificação -> não faz nada (permite usar as forms)
    }
  }
  checkAuth();

  // Mostra mensagem de status no formulário (erro, sucesso, info)
  function showMessage(msg, tone = "error") {
    messages.textContent = msg || "";
    if (tone === "error") messages.style.color = "#b94a48";
    else if (tone === "success") messages.style.color = "#2b8aef";
    else messages.style.color = "#666";
  }
  function clearMessage() { messages.textContent = ""; }

  // Alterna visibilidade entre formulário de registro e login
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

  // liga botões que alternam os formulários
  showRegisterBtn.addEventListener("click", () => toggleForms(true));
  showLoginBtn.addEventListener("click", () => toggleForms(false));

  // utilitário seguro para parse de JSON (evita lançar em resposta inválida)
  async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
  }

  // Chamada para registrar usuário no servidor
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
      // guarda nome localmente para possível uso de UI (não é necessário pro cookie httpOnly)
      if (data && data.name) localStorage.setItem("wc_user", data.name);
      if (!res.ok) {
        showMessage(data && data.message ? data.message : `Erro (${res.status})`, "error");
        btn.disabled = false;
        btn.textContent = "Registrar";
        return;
      }
      showMessage("Registrado! Redirecionando...", "success");
      // servidor já colocou cookie httpOnly; redireciona ao hub
      setTimeout(() => window.location.href = "/hub.html", 500);
    } catch (err) {
      console.error(err);
      showMessage("Erro de rede.", "error");
      btn.disabled = false;
      btn.textContent = "Registrar";
    }
  }

  // Chamada para efetuar login no servidor
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
      // guarda nome localmente (opcional)
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

  // submit do formulário de registro
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

  // submit do formulário de login
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
