(function () {
  // Só faz qualquer coisa se o botão existir na página
  const btn = document.getElementById("btn-leave") || document.getElementById("btn-profile");
  if (!btn) return; // não presente -> nada a fazer

  function parseRoomFromUrl() {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("room") || null;
    } catch (e) { return null; }
  }

  function createModal() {
    if (document.getElementById("leave-modal")) return document.getElementById("leave-modal");

    const modal = document.createElement("div");
    modal.id = "leave-modal";
    modal.style.position = "fixed";
    modal.style.inset = "0";
    modal.style.display = "none";
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

  function showModal(modal) {
    modal.style.display = "flex";
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function hideModal(modal) {
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function leaveRoomThenRedirect(roomId) {
    if (typeof io === "function") {
      // tenta avisar o servidor via socket — best-effort
      const tmp = io();
      let done = false;
      tmp.on("connect", () => {
        try {
          if (roomId) {
            tmp.emit("leaveRoom", { roomId }, () => {
              if (done) return;
              done = true;
              try { tmp.disconnect(); } catch(e) {}
              window.location.href = "/hub.html";
            });
            // fallback
            setTimeout(() => {
              if (done) return;
              done = true;
              try { tmp.disconnect(); } catch(e) {}
              window.location.href = "/hub.html";
            }, 900);
          } else {
            done = true;
            try { tmp.disconnect(); } catch(e) {}
            window.location.href = "/hub.html";
          }
        } catch (e) {
          try { tmp.disconnect(); } catch(e){}
          window.location.href = "/hub.html";
        }
      });
      // caso nunca conecte
      setTimeout(() => {
        if (!done) {
          try { tmp.disconnect(); } catch (e) {}
          window.location.href = "/hub.html";
        }
      }, 1200);
    } else {
      window.location.href = "/hub.html";
    }
  }

  // wire
  const modal = createModal();
  const cancel = modal.querySelector("#leave-cancel");
  const confirm = modal.querySelector("#leave-confirm");

  btn.textContent = "Voltar";
  btn.title = "Voltar ao Hub";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    showModal(modal);
  });
  cancel.addEventListener("click", () => hideModal(modal));
  modal.addEventListener("click", (ev) => { if (ev.target === modal) hideModal(modal); });
  confirm.addEventListener("click", () => {
    hideModal(modal);
    const room = parseRoomFromUrl();
    leaveRoomThenRedirect(room);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal.style.display === "flex") hideModal(modal);
  });

  window.openLeaveModal = () => { showModal(modal); };
})();
