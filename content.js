// FACEIT Autopilot – content script.
// FACEIT is a React SPA, so we watch DOM mutations and react when the
// "Match ready" dialog or the map veto list appears.

const SEL = {
  // Match-ready dialog: a dialog with the confirmation button container.
  readyDialog: 'div[role="dialog"]:has(div[class*="ConfirmationStyledContainer"] > button)',
  // Map veto list (map images live under /games/; server veto uses /flags/).
  vetoList: 'div[class*="Veto__Container"] div[class*="VetoList__Container"]:has(div[src*="/games/"])',
  // A map row whose ban button is clickable = it's our turn.
  vetoItem: 'div[data-testid="matchPreference"]:has(button:not([disabled]))',
  vetoName: 'div[class*="styles__MiddleSlotWrapper"] span[class*="styles__Name"]',
};

const READY_RE = /match ready|match bereit|match prêt|partida lista|partida pronta|rozgrywka gotowa|матч найден|maç hazır/i;

let cfg = { ...FA_DEFAULTS };
let pending = null; // { el, timer, toast }

faLoad().then((c) => { cfg = c; scan(); });
chrome.storage.onChanged.addListener((ch) => {
  for (const k in ch) cfg[k] = ch[k].newValue;
  scan();
});

// ---------- toast with cancel ----------
function toast(text, seconds, onCancel) {
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483647;background:#1f1f22;color:#fff;" +
    "border-left:4px solid #ff5500;padding:12px 16px;border-radius:6px;font:14px system-ui,sans-serif;" +
    "box-shadow:0 6px 20px rgba(0,0,0,.4);display:flex;gap:12px;align-items:center";
  const label = document.createElement("span");
  const btn = document.createElement("button");
  btn.textContent = "Cancel";
  btn.style.cssText = "background:#ff5500;border:0;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer";
  el.append(label, btn);
  document.body.append(el);
  let left = seconds;
  const render = () => (label.textContent = `${text} in ${left}s`);
  render();
  const tick = setInterval(() => { left = Math.max(0, left - 1); render(); }, 1000);
  btn.onclick = () => { onCancel(); close(); };
  function close() { clearInterval(tick); el.remove(); }
  return { close };
}

// Schedule a click; cancel automatically if the button disappears/disables.
function schedule(button, text, delaySec) {
  if (pending && pending.el === button) return;
  cancelPending();
  const t = toast(text, delaySec, () => { button.dataset.faSkip = "1"; cancelPending(); });
  const timer = setTimeout(() => {
    if (button.isConnected && !button.disabled) button.click();
    cancelPending();
  }, delaySec * 1000);
  pending = { el: button, timer, toast: t };
}

function cancelPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.toast.close();
  pending = null;
}

// ---------- match found sound ----------
const chimed = new WeakSet(); // dialogs we already played the sound for
const playChime = () => faChime(cfg.soundVolume);

// Custom sound: loops from the moment the match is found, then fades out
// over 3.5s once the match is accepted (or the dialog goes away).
const FADE_MS = 3500;
let custom = null; // { audio, fading }

function playCustom(file) {
  stopCustom(true);
  const audio = new Audio(chrome.runtime.getURL("sounds/" + file));
  const start = Math.max(0, Number(cfg.soundStart) || 0);
  audio.volume = Math.min(1, Math.max(0, (cfg.soundVolume ?? 70) / 100));
  audio.currentTime = start;
  // Loop back to the chosen start second, not the beginning of the file.
  audio.addEventListener("ended", () => {
    if (custom?.audio !== audio) return;
    audio.currentTime = audio.duration > start ? start : 0;
    audio.play().catch(() => {});
  });
  audio.play().catch(() => {});
  custom = { audio, fading: false };
}

function stopCustom(now) {
  if (!custom) return;
  const c = custom;
  if (now) { c.audio.pause(); custom = null; return; }
  if (c.fading) return;
  c.fading = true;
  const start = c.audio.volume, t0 = performance.now();
  const step = () => {
    if (custom !== c) return;
    const k = Math.min(1, (performance.now() - t0) / FADE_MS);
    c.audio.volume = start * (1 - k);
    if (k < 1) setTimeout(step, 50);
    else { c.audio.pause(); custom = null; }
  };
  step();
}

// True while a "Match ready" dialog still waits for our accept click.
function readyDialogs() {
  return [...document.querySelectorAll(SEL.readyDialog)].filter((d) => READY_RE.test(d.textContent));
}

function checkMatchSound() {
  const dialogs = readyDialogs();
  const waiting = dialogs.some((d) => {
    const btn = d.querySelector('div[class*="ConfirmationStyledContainer"] > button');
    return btn && !btn.disabled;
  });
  if (custom && !waiting) stopCustom(false);
  if (!cfg.matchSound) stopCustom(true);
  for (const dlg of dialogs) {
    if (chimed.has(dlg) || !waiting) continue;
    chimed.add(dlg);
    if (!cfg.matchSound) continue;
    if (cfg.soundFile) playCustom(cfg.soundFile);
    else playChime();
  }
}

// ---------- features ----------
function checkAccept() {
  if (!cfg.autoAccept) return false;
  for (const dlg of document.querySelectorAll(SEL.readyDialog)) {
    if (!READY_RE.test(dlg.textContent)) continue;
    const btn = dlg.querySelector('div[class*="ConfirmationStyledContainer"] > button');
    if (btn && !btn.disabled && !btn.dataset.faSkip) {
      schedule(btn, "Accepting match", cfg.acceptDelay);
      return true;
    }
  }
  return false;
}

function checkBan() {
  if (!cfg.autoBan) return false;
  const list = document.querySelector(SEL.vetoList);
  if (!list) return false;
  const items = [...list.querySelectorAll(SEL.vetoItem)];
  if (!items.length) return false; // not our turn

  const norm = (s) => s.toLowerCase().replace(/^de_/, "").replace(/\s+/g, "").replace(/ii$/, "2");
  const byName = new Map();
  for (const it of items) {
    const name = it.querySelector(SEL.vetoName)?.textContent?.trim();
    if (name) byName.set(norm(name), { it, name });
  }
  for (const want of cfg.banList) {
    const hit = byName.get(norm(want));
    if (!hit) continue;
    const btn = hit.it.querySelector("button:not([disabled])");
    if (!btn || btn.dataset.faSkip) return false; // user cancelled this turn
    schedule(btn, `Banning ${hit.name}`, cfg.banDelay);
    return true;
  }
  return false;
}

function scan() {
  if (!cfg.enabled) { stopCustom(true); return cancelPending(); }
  checkMatchSound();
  if (pending && (!pending.el.isConnected || pending.el.disabled)) cancelPending();
  if (pending) return;
  checkAccept() || checkBan();
}

let queued = false;
new MutationObserver(() => {
  if (queued) return;
  queued = true;
  // setTimeout, not rAF: rAF is paused in background tabs.
  setTimeout(() => { queued = false; scan(); }, 0);
}).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
