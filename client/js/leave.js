// leave.js — modal de confirmação para "Voltar ao Hub"
(function () {
  // tenta encontrar o botão que abre o modal (pode ser btn-leave ou, em alguns layouts, btn-profile)
  const btn = document.getElementById("btn-leave") || document.getElementById("btn-profile");
  if (!btn) return; // se não existir, nada a fazer aqui

  // lê ?room= da URL (usado para avisar o servidor ao sair)
  function parseRoomFromUrl() {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("room") || null;
    } catch (e) { return null; }
  }

  // cria o DOM do modal (idempotente — retorna se já existir)
  function createModal() {
    if (document.getElementById("leave-modal")) return document.getElementById("leave-modal");

    const modal = document.createElement("div");
    modal.id = "leave-modal";
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.display = "none"; // inicialmente escondido
    modal.style.alignItems = "center";
    modal.style.justifyContent = "center";
    modal.style.background = "rgba(0,0,0,0.45)";
    modal.style.zIndex = "6000";

    modal.innerHTML = `
      <div style="background:#fff;padding:18px;border-radius:10px; width:360px; max-width:92%; text-align:center; box-shadow:0 12px 36px rgba(12,30,50,0.12);">
        <h3 style="margin:0 0 8px 0;">Voltar ao Hub</h3>
        <p style="margin:0 0 14px; color:var(--muted);">Tem certeza que deseja voltar ao Hub? Você sairá da sala atual.</p>
        <div style="display:flex; gap:8px; justify-content:center;">
          <button id="leave-cancel" class="btn secondary">Cancelar</button>
          <button id="leave-confirm" class="btn">Voltar ao Hub</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  // mostra modal e trava o scroll da página
  function showModal(modal) {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  // esconde modal e restaura scroll
  function hideModal(modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  // tenta avisar o servidor via socket que o usuário saiu da sala e então redireciona para o hub
  // faz um "best-effort": abre uma conexão temporária socket.io, emite leaveRoom e redireciona rapidamente
  function leaveRoomThenRedirect(roomId) {
    if (typeof io === "function") {
      // cria socket temporário
      const tmp = io();
      let done = false;
      tmp.on("connect", () => {
        try {
          if (roomId) {
            // emite o evento deixando a sala; usa callback ack para garantir que o servidor recebeu
            tmp.emit("leaveRoom", { roomId }, () => {
              if (done) return;
              done = true;
              try { tmp.disconnect(); } catch(e) {}
              window.location.href = "/hub.html";
            });
            // fallback: se ack não chegar rápido, garante redirecionar
            setTimeout(() => {
              if (done) return;
              done = true;
              try { tmp.disconnect(); } catch(e) {}
              window.location.href = "/hub.html";
            }, 900);
          } else {
            // sem roomId apenas redireciona
            done = true;
            try { tmp.disconnect(); } catch(e) {}
            window.location.href = "/hub.html";
          }
        } catch (e) {
          try { tmp.disconnect(); } catch(e){}
          window.location.href = "/hub.html";
        }
      });
      // se nunca conectar, força redirecionamento
      setTimeout(() => {
        if (!done) {
          try { tmp.disconnect(); } catch (e) {}
          window.location.href = "/hub.html";
        }
      }, 1200);
    } else {
      // sem socket.io disponível, apenas redireciona
      window.location.href = "/hub.html";
    }
  }

  // inicializa modal e liga comportamentos aos botões
  const modal = createModal();
  const cancel = modal.querySelector("#leave-cancel");
  const confirm = modal.querySelector("#leave-confirm");

  // altera texto do botão para indicar ação de voltar (compatível com layouts que usam esse botão para perfil também)
  btn.textContent = "Voltar";
  btn.title = "Voltar ao Hub";

  // abrir modal ao clicar
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    showModal(modal);
  });
  // cancelar
  cancel.addEventListener("click", () => hideModal(modal));
  // clique fora do card fecha
  modal.addEventListener("click", (ev) => { if (ev.target === modal) hideModal(modal); });
  // confirmar: fecha modal, tenta avisar servidor e redireciona
  confirm.addEventListener("click", () => {
    hideModal(modal);
    const room = parseRoomFromUrl();
    leaveRoomThenRedirect(room);
  });
  // ESC fecha modal
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal.style.display === "flex") hideModal(modal);
  });

  // expõe função global para abrir o modal programaticamente, se necessário
  window.openLeaveModal = () => { showModal(modal); };
})();