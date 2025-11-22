// profile.js — modal de perfil com confirmação que substitui o conteúdo (não aparece abaixo)
// -----------------------------------------------------------------------------
// Objetivo:
//  - Mostrar um modal de "Perfil" quando o botão #btn-profile for clicado.
//  - Dentro do modal há botão "Sair" que troca o conteúdo por uma confirmação.
//  - Ao cancelar, o conteúdo original é restaurado e recarregado (/api/me) para
//    garantir que os campos não fiquem vazios.
//  - O arquivo exporta window.profileUI.open/close para uso manual se necessário.
//
// Observações de design:
//  - O modal é criado dinamicamente na primeira vez (createModalIfMissing).
//  - O overlay bloqueia cliques fora do modal e controla acessibilidade (aria-hidden).
//  - Listeners são adicionados de forma idempotente (marcados com flags como _bound).
//  - ESC e clique fora fecham o modal (UX comum).
// -----------------------------------------------------------------------------


(function () {
  // IDs/seletores usados internamente
  const MODAL_ID = "profile-modal";
  const OVERLAY_ID = "profile-overlay";
  const DEFAULT_ANCHOR_SELECTOR = "#btn-profile";

  /**
   * Cria o DOM do modal (overlay + card) se não existir e anexa ao body.
   * Retorna a referência ao modal (elemento card).
   *
   * A função mantém um template do conteúdo original em modal._profileContentHtml
   * para que possamos restaurá-lo após exibir a tela de confirmação.
   */
  function createModalIfMissing() {
    let existing = document.getElementById(MODAL_ID);
    if (existing) return existing;

    // overlay (camada escura que cobre a página)
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.45)";
    overlay.style.display = "none"; // mostrado apenas quando abrir
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "6000";
    overlay.setAttribute("aria-hidden", "true"); // acessibilidade: escondido inicialmente

    // card/modal
    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "profile-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    // estilo inline para garantir consistência sem depender do CSS global
    modal.style.maxWidth = "460px";
    modal.style.width = "92%";
    modal.style.background = "#fff";
    modal.style.borderRadius = "10px";
    modal.style.padding = "16px";
    modal.style.boxShadow = "0 12px 36px rgba(0,0,0,0.28)";
    modal.style.transform = "translateY(0)";
    modal.style.maxHeight = "90vh";
    modal.style.overflow = "auto";

    // Cabeçalho fixo do modal (sempre exibido)
    const headerHtml = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h3 style="margin:0;font-size:18px">Perfil</h3>
        <button id="profile-close" aria-label="Fechar perfil" class="btn secondary" style="font-size:13px;">Fechar</button>
      </div>
    `;

    // Conteúdo que poderá ser substituído pela confirmação
    const contentHtml = `
      <div id="profile-content">
        <div style="margin-bottom:10px;">
          <div style="margin-bottom:6px;"><strong>Nome:</strong> <span id="profile-name">—</span></div>
          <div style="margin-bottom:6px;"><strong>Email:</strong> <span id="profile-email">—</span></div>
        </div>

        <div style="margin-top:12px; display:flex; gap:8px; justify-content:flex-end;">
          <button id="profile-logout" class="btn" style="min-width:120px">Sair</button>
        </div>
      </div>
    `;

    modal.innerHTML = headerHtml + contentHtml;

    // Guardamos o template original para restaurar mais tarde (cancel)
    modal._profileContentHtml = contentHtml;

    // Inserimos dentro do overlay (assim o overlay bloqueia cliques quando visível)
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    return modal;
  }

  /**
   * Busca informações do usuário em /api/me e atualiza os elementos do modal.
   * Idempotente: pode ser chamada várias vezes, só atualiza os spans se vier ok.
   *
   * Também atualiza nomes que possam existir no topo da página (#me-name, #me-name-top).
   */
  async function fillUserInfo(modal) {
    if (!modal) return;
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const me = await res.json();
      const nameEl = modal.querySelector("#profile-name");
      const emailEl = modal.querySelector("#profile-email");
      if (nameEl) nameEl.textContent = me.name || "—";
      if (emailEl) emailEl.textContent = me.email || "—";
      // atualiza também possíveis elementos do cabeçalho da página
      const topName = document.getElementById("me-name");
      const topNameTop = document.getElementById("me-name-top");
      if (topName) topName.textContent = me.name || "—";
      if (topNameTop) topNameTop.textContent = me.name || "—";
    } catch (e) {
      // Em caso de erro de rede, silenciosamente ignoramos — placeholders permanecem.
    }
  }

  // Guarda o elemento que tinha foco antes de abrir o modal, para restaurar depois.
  let lastActiveElement = null;

  /**
   * Abre o modal:
   *  - cria o DOM se necessário
   *  - salva o elemento com foco para restaurar depois
   *  - desabilita scroll da página (body overflow hidden)
   *  - preenche as infos via fetch e anexa listeners
   */
  async function open() {
    const modal = createModalIfMissing();
    const overlay = document.getElementById(OVERLAY_ID);
    if (!modal || !overlay) return;

    // salva foco
    lastActiveElement = document.activeElement;

    // trava rolagem do body enquanto o modal estiver aberto
    document.body.style.overflow = "hidden";

    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
    modal.setAttribute("aria-hidden", "false");

    // preencher nome/email (pode falhar silenciosamente)
    await fillUserInfo(modal);

    // anexar comportamentos (idempotente)
    attachBehavior(modal, overlay);

    // foco no botão fechar por acessibilidade/teclado
    const closeBtn = modal.querySelector("#profile-close");
    if (closeBtn) closeBtn.focus();
  }

  /**
   * Fecha o modal:
   *  - restaura o conteúdo original caso tenha sido trocado
   *  - esconde overlay e restaura scroll do body
   *  - restaura foco ao elemento anterior
   *  - re-atacha listeners e re-popula infos (garante que cancel não deixa campos vazios)
   */
  function close() {
    const modal = document.getElementById(MODAL_ID);
    const overlay = document.getElementById(OVERLAY_ID);
    if (!modal || !overlay) return;

    // restaura conteúdo original se tivermos trocado (ex: após confirmar/mostrar tela de logout)
    const content = modal.querySelector("#profile-content");
    if (content && modal._profileContentHtml) {
      content.innerHTML = modal._profileContentHtml;
    }

    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    modal.setAttribute("aria-hidden", "true");

    document.body.style.overflow = "";

    // restaura foco ao último elemento ativo (se existir)
    try { if (lastActiveElement && typeof lastActiveElement.focus === "function") lastActiveElement.focus(); } catch(e){}

    // re-atacha comportamentos e re-preenche info (garante que o conteúdo não fique com placeholders)
    attachBehavior(modal, overlay);
    fillUserInfo(modal);
  }

  /**
   * Substitui o conteúdo do modal por uma vista de confirmação de logout.
   * Quando o usuário clica "Cancelar" restauramos o conteúdo original e
   * chamamos fillUserInfo para repopular nome/email (evita que fiquem vazios).
   *
   * Observações:
   *  - Os listeners do confirmar/cancel são adicionados com { once: true }
   *    para evitar duplicação se a tela for exibida várias vezes.
   */
  function showLogoutConfirmation(modal) {
    if (!modal) return;
    const content = modal.querySelector("#profile-content");
    if (!content) return;

    // salvamos o template original (caso ainda não exista)
    if (!modal._profileContentHtml) {
      modal._profileContentHtml = content.innerHTML;
    }

    const confirmHtml = `
      <div id="profile-logout-confirm" style="margin-top:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;font-size:18px">Sair</h3>
        </div>

        <div style="margin-bottom:12px;">
          <div style="font-weight:600; margin-bottom:8px;">Tem certeza que deseja sair?</div>
          <div style="color:var(--muted); font-size:14px;">Você será desconectado e levado para a tela de login.</div>
        </div>

        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button id="profile-logout-cancel" class="btn secondary">Cancelar</button>
          <button id="profile-logout-confirm-btn" class="btn" style="min-width:120px">Sim, sair</button>
        </div>
      </div>
    `;

    // substitui conteúdo atual pelo confirmHtml (ocupa o lugar do conteúdo)
    content.innerHTML = confirmHtml;

    // foco no botão cancelar para facilitar navegação por teclado
    const cancelBtn = content.querySelector("#profile-logout-cancel");
    if (cancelBtn) cancelBtn.focus();

    // wiring dos botões (listeners transitórios)
    const cancel = content.querySelector("#profile-logout-cancel");
    const confirm = content.querySelector("#profile-logout-confirm-btn");

    if (cancel) {
      cancel.addEventListener("click", (e) => {
        e.preventDefault();
        // restaura o conteúdo original (template salvo)
        if (modal._profileContentHtml) {
          content.innerHTML = modal._profileContentHtml;
        }
        // re-anexa os comportamentos ao novo conteúdo restaurado
        attachBehavior(modal, document.getElementById(OVERLAY_ID));
        // re-popula os dados do usuário (evita que os spans fiquem com —)
        fillUserInfo(modal);
        // foco no botão Sair (se presente) para continuidade do fluxo
        const logoutBtn = content.querySelector("#profile-logout");
        if (logoutBtn) logoutBtn.focus();
      }, { once: true });
    }

    if (confirm) {
      confirm.addEventListener("click", async (e) => {
        e.preventDefault();
        try {
          await fetch("/api/logout", { method: "POST" });
        } catch (err) {
          // ignorar problemas de rede — iremos redirecionar de qualquer forma
        }
        // redireciona ao fim (servidor deve limpar cookie)
        window.location.href = "/auth.html";
      }, { once: true });
    }
  }

  /**
   * Anexa comportamentos (listeners) relacionados ao modal:
   *  - fechar (botão)
   *  - fechar ao clicar fora (overlay)
   *  - ESC para fechar
   *  - botão Sair dentro do conteúdo (mostra confirmação)
   *
   * Implementação idempotente:
   *  - marca os elementos com flags (ex.: _profileBound, _overlayBound) para não
   *    re-adicionar listeners múltiplas vezes se attachBehavior for chamado novamente.
   */
  function attachBehavior(modal, overlay) {
    if (!modal || !overlay) return;

    // botão fechar do cabeçalho
    const closeBtn = modal.querySelector("#profile-close");
    if (closeBtn && !closeBtn._profileBound) {
      closeBtn.addEventListener("click", (e) => {
        e.preventDefault();
        close();
      });
      closeBtn._profileBound = true; // marca como ligado para não duplicar handler
    }

    // clicar no overlay (fora do card) fecha modal
    if (overlay && !overlay._overlayBound) {
      overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) { // apenas se clicar literalmente no overlay
          close();
        }
      });
      overlay._overlayBound = true;
    }

    // tecla ESC fecha modal (adicionamos apenas uma vez por documento)
    if (!document._profileEscBound) {
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
          const overlayEl = document.getElementById(OVERLAY_ID);
          if (overlayEl && overlayEl.style.display === "flex") close();
        }
      });
      document._profileEscBound = true;
    }

    // botão "Sair" dentro do conteúdo atual do modal (pode ser re-criado),
    // por isso buscamos dinamicamente e ligamos o handler se ainda não estiver.
    const logoutBtn = modal.querySelector("#profile-logout");
    if (logoutBtn && !logoutBtn._bound) {
      logoutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        // mostra a confirmação no lugar do conteúdo
        showLogoutConfirmation(modal);
      });
      logoutBtn._bound = true;
    }
  }

  /**
   * Procura todos os botões que correspondem a DEFAULT_ANCHOR_SELECTOR
   * e liga o comportamento de abrir o modal. Usa flag _profileAutoBound
   * para não registrar múltiplos listeners no mesmo botão.
   */
  function autoWire() {
    document.querySelectorAll(DEFAULT_ANCHOR_SELECTOR).forEach(btn => {
      if (!btn._profileAutoBound) {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          open();
        });
        btn._profileAutoBound = true;
      }
    });
  }

  // API pública mínima para abrir/fechar programaticamente
  window.profileUI = {
    open,
    close
  };

  // Inicialização ao carregar a página: cria o modal (esqueleto) e faz o "auto wire"
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      createModalIfMissing();
      autoWire();
    });
  } else {
    createModalIfMissing();
    autoWire();
  }
})();
