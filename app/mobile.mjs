const nav = document.querySelector("#mobileNav");
export function mobileView(view) {
  document.body.dataset.mobileView = view;
  for (const button of nav.querySelectorAll("[data-view]")) button.setAttribute("aria-pressed", String(button.dataset.view === view));
}
mobileView("sessions");

// Only viewport geometry is shared with mobile layout, never an extra session stream.
const viewport = window.visualViewport;
function resizeViewport() {
  if (matchMedia("(max-width:600px)").matches && (!viewport || viewport.scale === 1)) {
    document.documentElement.style.setProperty("--mobile-height", `${viewport?.height ?? innerHeight}px`);
  }
}
viewport?.addEventListener("resize", resizeViewport);
window.addEventListener("resize", resizeViewport);
resizeViewport();

const notice = document.querySelector("#connectionNotice");
function connectionChanged() {
  notice.hidden = navigator.onLine;
  notice.textContent = navigator.onLine ? "" : "연결이 끊겼어요. 컴퓨터와 사설망 연결을 확인하세요. 보낸 질문은 다시 연결한 뒤 확인할 수 있어요.";
}
window.addEventListener("online", connectionChanged);
window.addEventListener("offline", connectionChanged);
connectionChanged();

const install = document.querySelector("#installApp");
const help = document.querySelector("#installHelp");
let installPrompt;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); installPrompt = event; install.hidden = false;
});
install.addEventListener("click", async () => {
  if (!installPrompt) return;
  const prompt = installPrompt; installPrompt = null; install.hidden = true;
  try { await prompt.prompt(); await prompt.userChoice; }
  catch { help.textContent = "브라우저 메뉴에서 앱 설치 또는 홈 화면에 추가를 선택하세요."; }
});
window.addEventListener("appinstalled", () => { install.hidden = true; help.textContent = "홈 화면에 추가했어요."; });
if (!window.isSecureContext) {
  help.textContent = "홈 화면 설치에는 HTTPS 주소가 필요해요. 컴퓨터에서 Tailscale Serve로 도슨트의 로컬 주소를 연결하세요. 공개 Funnel은 사용하지 마세요.";
} else if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) {
  help.textContent = "설치된 앱으로 사용 중이에요. 설명을 받으려면 연결된 컴퓨터가 켜져 있어야 해요.";
} else {
  help.textContent = "iPhone은 Safari 공유 메뉴에서 ‘홈 화면에 추가’를, Android는 브라우저 메뉴에서 ‘앱 설치’를 선택하세요. 컴퓨터가 켜져 있어야 설명을 받을 수 있어요.";
}
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
    help.textContent = "설치 준비에 실패했어요. 브라우저에서 계속 사용할 수 있어요. 새로고침 후 다시 확인하세요.";
  });
}
