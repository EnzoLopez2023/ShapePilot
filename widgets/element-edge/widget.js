"use strict";

const ORIGIN = "https://shapepilot.nintek.com";
const frame = document.getElementById("website");
const statusLabel = document.getElementById("status");
let timer;
let initialized = false;

function loadDisplay() {
  clearTimeout(timer);
  document.body.classList.remove("ready");
  statusLabel.textContent = "Loading ShapePilot printer display\u2026";
  // Fixed HTTPS origin/path; credentials never pass through the wrapper or URL.
  frame.src = ORIGIN + "/display/element";
  timer = setTimeout(() => {
    statusLabel.textContent = "ShapePilot display did not confirm rendering. Check website access or reload. Do not bypass IT/browser policy.";
  }, 20000);
}

window.addEventListener("message", event => {
  if (event.origin !== ORIGIN || event.source !== frame.contentWindow
    || !event.data || event.data.type !== "shapepilot:element-display:ready") return;
  clearTimeout(timer);
  document.body.classList.add("ready");
});
function initialize() {
  if (initialized) return;
  initialized = true;
  document.title = "ShapePilot - EL-ement EDGE";
  loadDisplay();
}
document.getElementById("reload").addEventListener("click", loadDisplay);
window.icueEvents = { onICUEInitialized: initialize, onDataUpdated: initialize };
window.addEventListener("pagehide", () => {
  clearTimeout(timer);
  frame.removeAttribute("src");
});
initialize();
