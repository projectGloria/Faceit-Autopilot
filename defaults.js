// Shared by content script and popup.
const FA_DEFAULTS = {
  enabled: true,
  autoAccept: true,
  acceptDelay: 2,        // seconds
  autoBan: true,
  banDelay: 3,           // seconds
  matchSound: true,      // play a chime when the "Match ready" dialog appears
  soundFile: "",         // file name in /sounds, "" = built-in chime
  soundStart: 0,         // seconds into the custom sound to start (and loop back to)
  soundVolume: 70,       // percent
  // Ban order: first = banned first. Maps not in the list are never banned.
  banList: ["Mirage", "Inferno", "Nuke", "Ancient", "Dust II", "Anubis", "Cache"],
  listVersion: 2         // bump to replace a previously saved banList with the default
};

function faLoad() {
  return new Promise((r) => chrome.storage.sync.get({ ...FA_DEFAULTS, listVersion: 0 }, (c) => {
    if (c.listVersion < FA_DEFAULTS.listVersion) {
      c.banList = FA_DEFAULTS.banList;
      c.listVersion = FA_DEFAULTS.listVersion;
      chrome.storage.sync.set({ banList: c.banList, listVersion: c.listVersion });
    }
    r(c);
  }));
}

// Built-in chime, shared by content script and popup preview.
let audioCtx = null;

function faChime(volumePct = 70) {
  try {
    audioCtx ||= new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const vol = Math.min(1, Math.max(0, (Number(volumePct) || 0) / 100));
    const t0 = audioCtx.currentTime;
    // Three rising notes, repeated twice.
    [0, 0.6].forEach((rep) => [880, 1108.7, 1318.5].forEach((f, i) => {
      const t = t0 + rep + i * 0.14;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4 * vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(g).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    }));
  } catch (e) { /* audio unavailable */ }
}
