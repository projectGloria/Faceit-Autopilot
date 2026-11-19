const $ = (id) => document.getElementById(id);
let cfg;

const save = (patch) => { Object.assign(cfg, patch); chrome.storage.sync.set(patch); };

const ICONS = ["mirage", "inferno", "nuke", "ancient", "dust2", "anubis", "cache"];
const iconKey = (n) => n.toLowerCase().replace(/^de_/, "").replace(/\s+/g, "").replace(/ii$/, "2");

function renderList() {
  const ol = $("list");
  ol.innerHTML = "";
  cfg.banList.forEach((name, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="n">${i + 1}</span><img class="icon" alt=""><span class="name"></span>
      <button data-a="up">↑</button><button data-a="down">↓</button>`;
    li.querySelector(".name").textContent = name;
    const img = li.querySelector(".icon");
    const key = iconKey(name);
    if (ICONS.includes(key)) {
      img.src = `icons/${key}.png`;
      img.onerror = () => { img.removeAttribute("src"); };
    }
    li.onclick = (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      const l = [...cfg.banList];
      if (a === "up" && i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]];
      else if (a === "down" && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
      save({ banList: l });
      renderList();
    };
    ol.append(li);
  });
}

faLoad().then((c) => {
  cfg = c;
  for (const k of ["enabled", "autoAccept", "autoBan", "matchSound"]) {
    $(k).checked = cfg[k];
    $(k).onchange = () => save({ [k]: $(k).checked });
  }
  for (const k of ["acceptDelay", "banDelay"]) {
    $(k).value = cfg[k];
    $(k).onchange = () => save({ [k]: Math.max(0, Number($(k).value) || 0) });
  }
  $("soundStart").value = cfg.soundStart;
  $("soundStart").onchange = () => {
    const v = Math.max(0, Number($("soundStart").value) || 0);
    $("soundStart").value = v;
    save({ soundStart: v });
  };
  $("soundVolume").value = cfg.soundVolume;
  $("soundVolume").onchange = () => {
    const v = Math.min(100, Math.max(0, Number($("soundVolume").value) || 0));
    $("soundVolume").value = v;
    save({ soundVolume: v });
  };
  renderList();
  loadSounds();
});

// List audio files dropped into the extension's /sounds folder.
const AUDIO_RE = /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i;
function listSounds() {
  return new Promise((resolve) => {
    if (!chrome.runtime.getPackageDirectoryEntry) return resolve([]);
    chrome.runtime.getPackageDirectoryEntry((root) => {
      root.getDirectory("sounds", {}, (dir) => {
        const r = dir.createReader(), out = [];
        const read = () => r.readEntries((ents) => {
          if (!ents.length) return resolve(out.sort((a, b) => a.localeCompare(b)));
          for (const e of ents) if (e.isFile && AUDIO_RE.test(e.name)) out.push(e.name);
          read();
        }, () => resolve(out));
        read();
      }, () => resolve([]));
    });
  });
}

let preview = null;
async function loadSounds() {
  const sel = $("soundFile");
  const files = await listSounds();
  sel.innerHTML = "";
  sel.append(new Option("Built-in chime", ""));
  for (const f of files) sel.append(new Option(f.replace(AUDIO_RE, ""), f));
  if (cfg.soundFile && !files.includes(cfg.soundFile)) save({ soundFile: "" });
  sel.value = cfg.soundFile;
  sel.onchange = () => { stopPreview(); save({ soundFile: sel.value }); };
  $("soundTest").onclick = () => (preview ? stopPreview() : startPreview());
}

// Test button: plays the selected sound from "Start from"; click again to stop.
function stopPreview() {
  preview?.pause();
  preview = null;
  $("soundTest").textContent = "▶";
  $("soundTest").classList.remove("on");
}

function startPreview() {
  const file = $("soundFile").value;
  if (!file) return faChime(cfg.soundVolume);
  const a = new Audio("sounds/" + file);
  a.volume = Math.min(1, cfg.soundVolume / 100);
  a.currentTime = cfg.soundStart || 0;
  a.onended = stopPreview;
  a.play().catch(stopPreview);
  preview = a;
  $("soundTest").textContent = "■";
  $("soundTest").classList.add("on");
}
