// watch-history web app — all client-side. The only outbound requests
// are <img> hotlinks to i.ytimg.com for channel/video thumbnails. No JSON
// APIs, no keys, no tracking endpoints.
import { parseEntries, computeStats, FORMAT, videoIdFromUrl } from "./core.js";

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const landing = $("landing");
const loading = $("loading");
const loadingText = $("loading-text");
const report  = $("report");
const dz      = $("dropzone");
const input   = $("file-input");
const overlay = $("drag-overlay");

// ── Drag and drop ─────────────────────────────────────────────────────────
// We always preventDefault on drag* so the browser never tries to
// navigate to dropped files. `dataTransfer.types` is a DOMStringList in
// some browsers, so don't call .includes on it — just inspect the drop.
let dragDepth = 0;
const hasFiles = (e) => {
  const t = e.dataTransfer?.types;
  if (!t) return false;
  for (let i = 0; i < t.length; i++) if (t[i] === "Files") return true;
  return false;
};
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  overlay.classList.add("is-on");
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) overlay.classList.remove("is-on");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.classList.remove("is-on");
  const file = e.dataTransfer?.files?.[0];
  if (file) handleFile(file);
});

// The dropzone is a <label> wrapping the file input. The browser
// natively forwards clicks on the label to the input — do NOT add a
// JS click handler that calls input.click() again, or the picker
// will open twice (visible as "selecting a file just re-opens the
// picker"). Only handle keyboard activation explicitly.
dz.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
});
input.addEventListener("change", () => {
  if (input.files?.[0]) handleFile(input.files[0]);
});

// Mouse glow follow on the dropzone
dz.addEventListener("pointermove", (e) => {
  const r = dz.getBoundingClientRect();
  dz.style.setProperty("--mx", `${e.clientX - r.left}px`);
  dz.style.setProperty("--my", `${e.clientY - r.top}px`);
});

// Reset
$("reset-btn").addEventListener("click", () => {
  report.hidden = true;
  landing.hidden = false;
  input.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ── Thumbnail toggle ──────────────────────────────────────────────────────
// Off by default to keep the "no network requests" promise. When on,
// channel avatars hotlink i.ytimg.com (no API key, no JSON handshake,
// but still outbound image requests). Persisted to localStorage so the
// user only has to make the choice once.
const THUMBS_KEY = "yt-stats:thumbs";
let thumbsEnabled = false;
try { thumbsEnabled = localStorage.getItem(THUMBS_KEY) === "1"; } catch { /* private mode */ }
let lastStats = null;

const thumbsToggle = $("thumbs-toggle");
thumbsToggle.checked = thumbsEnabled;
thumbsToggle.addEventListener("change", () => {
  thumbsEnabled = thumbsToggle.checked;
  try { localStorage.setItem(THUMBS_KEY, thumbsEnabled ? "1" : "0"); } catch { /* private mode */ }
  if (lastStats) refreshAvatarSections(lastStats);
});

function refreshAvatarSections(stats) {
  renderTopChannels("top-channels", stats.topChannels.slice(0, 20));
  renderTopChannels("top-channels-90", stats.topChannels90d.slice(0, 15));
  renderRewatched(stats);
  renderPlayBuckets(stats);
}

// ── Example data ──────────────────────────────────────────────────────────
// One deliberate network request when the user clicks "see an example" —
// fetches a stripped 2022 subset of a real history. Same pipeline as a
// dropped file afterwards.
$("example-link").addEventListener("click", async (e) => {
  e.preventDefault();
  landing.hidden = true;
  loading.hidden = false;
  loadingText.textContent = "Loading example…";
  try {
    const res = await fetch("./example.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    await processHistoryText(text);
  } catch (err) {
    loading.hidden = true;
    landing.hidden = false;
    alert("Couldn't load the example.\n\n" + (err?.message ?? err));
  }
});

// ── File handling ─────────────────────────────────────────────────────────
async function handleFile(file) {
  landing.hidden = true;
  loading.hidden = false;
  loadingText.textContent = "Reading file…";
  try {
    const text = await file.text();
    await processHistoryText(text);
  } catch (err) {
    loading.hidden = true;
    landing.hidden = false;
    alert("Couldn't parse that file.\n\nMake sure it's the watch-history.json from your Google Takeout.\n\n" + (err?.message ?? err));
  }
}

async function processHistoryText(text) {
  loadingText.textContent = "Parsing JSON…";
  await raf();
  const raw = JSON.parse(text);

  loadingText.textContent = "Crunching numbers…";
  await raf();
  const { watches, skippedMusic, skippedNoTime } = parseEntries(raw);
  const stats = computeStats(watches, { skippedMusic, skippedNoTime });

  loading.hidden = true;
  report.hidden = false;
  report.querySelectorAll(".reveal").forEach((el) => {
    el.style.animation = "none";
    el.offsetHeight; // reflow
    el.style.animation = "";
  });
  lastStats = stats;
  renderReport(stats);
  requestAnimationFrame(() => {
    report.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// ── Channel avatars ───────────────────────────────────────────────────────
// We don't have the channel's real avatar hash without a network round-trip
// or an API key, so use the thumbnail of a representative video as a
// stand-in. i.ytimg.com hotlinks need no key and no JSON handshake.
// Fallback: a deterministic initials gradient if there's no video id or
// the image fails to load.
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const initials = (name) => {
  const parts = name.replace(/[\(\)\[\]'"`’]/g, "").split(/[\s\-_/]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};
function fallbackBg(name) {
  const h = hash32(name);
  const h1 = h % 360;
  const h2 = (h1 + 35 + ((h >> 9) % 60)) % 360;
  const s1 = 55 + (h >> 17) % 25;
  const l1 = 42 + (h >> 21) % 14;
  return `linear-gradient(135deg, hsl(${h1}deg ${s1}% ${l1}%), hsl(${h2}deg ${s1 - 8}% ${l1 - 12}%))`;
}
function avatarEl(name, videoId) {
  const wrap = el("div", {
    class: "avatar",
    style: { background: fallbackBg(name) },
  }, el("span", { class: "avatar-initials" }, initials(name)));
  if (thumbsEnabled && videoId) {
    // mqdefault is 320×180 with no letterboxing; default.jpg has black bars.
    const img = el("img", {
      class: "avatar-img",
      src: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      alt: "",
      loading: "lazy",
      decoding: "async",
      referrerpolicy: "no-referrer",
      onerror: () => img.remove(),
    });
    wrap.appendChild(img);
  }
  return wrap;
}

// ── Tooltip ───────────────────────────────────────────────────────────────
const tip = document.createElement("div");
tip.className = "tip";
document.body.appendChild(tip);
function attachTip(el, msg) {
  el.addEventListener("mouseenter", () => { tip.textContent = msg; tip.classList.add("is-on"); });
  el.addEventListener("mouseleave", () => { tip.classList.remove("is-on"); });
  el.addEventListener("mousemove", (e) => {
    tip.style.left = e.clientX + "px";
    tip.style.top  = e.clientY - 8 + "px";
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
const fmtNum = (n) => n.toLocaleString();
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
function bucketLevel(v, max) {
  if (v === 0) return "empty";
  const r = v / max;
  return r > 0.75 ? "l4" : r > 0.5 ? "l3" : r > 0.25 ? "l2" : "l1";
}
function ymBg(v, max) {
  if (v === 0) return null;
  const r = Math.max(0.08, v / max);
  return `linear-gradient(180deg, rgba(239,68,68,${r * 0.85}), rgba(239,68,68,${r * 0.55}))`;
}

// ── Number count-up ───────────────────────────────────────────────────────
function countUp(node, to, opts = {}) {
  const dur = opts.duration ?? 900;
  const start = performance.now();
  const fmt = opts.fmt ?? fmtNum;
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const v = Math.round(to * ease(t));
    node.firstChild ? (node.firstChild.nodeValue = fmt(v)) : (node.textContent = fmt(v));
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Rendering ─────────────────────────────────────────────────────────────
function renderReport(stats) {
  const s = stats.summary;

  $("report-range").textContent =
    `${FORMAT.niceDate(s.first)} → ${FORMAT.niceDate(s.last)} · ${fmtNum(s.daysSpan)} days`;

  renderSummary(stats);
  renderYearMonth(stats);
  renderDailyHeatmap(stats);
  renderHourDow(stats);
  renderTopChannels("top-channels", stats.topChannels.slice(0, 20));
  renderTopChannels("top-channels-90", stats.topChannels90d.slice(0, 15));
  renderRewatched(stats);
  renderPlayBuckets(stats);
  renderExtras(stats);
}

function renderSummary(stats) {
  const s = stats.summary;
  const items = [
    { label: "Videos watched", value: s.watched, sub: `${fmtNum(s.total)} entries total` },
    { label: "Channels",        value: s.uniqueChannels, sub: `${fmtNum(s.uniqueVideos)} unique titles` },
    { label: "Active days",     value: stats.streaks.daysWatched, sub: `${stats.streaks.pct.toFixed(1)}% of the range` },
    { label: "Average / day",   value: Number(s.avgPerDay.toFixed(1)), sub: `over ${fmtNum(s.daysSpan)} days`,
      fmt: (v) => v.toFixed(1) },
  ];
  const wrap = $("summary");
  wrap.innerHTML = "";
  for (const it of items) {
    const valNode = el("div", { class: "stat-value" }, "0");
    wrap.appendChild(el("div", { class: "stat" },
      el("p", { class: "stat-label" }, it.label),
      valNode,
      el("p", { class: "stat-sub" }, it.sub),
    ));
    countUp(valNode, it.value, { fmt: it.fmt });
  }
}

function renderYearMonth(stats) {
  const ym = stats.yearMonth;
  const host = $("ym-grid");
  host.innerHTML = "";

  const grid = el("div", { class: "ym-grid-inner" });

  // header row
  grid.appendChild(el("div", { class: "ym-month" }, ""));
  for (const m of ym.months) grid.appendChild(el("div", { class: "ym-month" }, m));
  grid.appendChild(el("div", { class: "ym-month" }, "Total"));

  for (const y of ym.years) {
    grid.appendChild(el("div", { class: "ym-label" }, y));
    for (let i = 0; i < 12; i++) {
      const v = ym.data[y][i];
      const cell = el("div", { class: v === 0 ? "ym-cell empty" : "ym-cell" }, v === 0 ? "·" : String(v));
      const bg = ymBg(v, ym.max);
      if (bg) cell.style.background = bg;
      if (v > 0) attachTip(cell, `${ym.months[i]} ${y} · ${fmtNum(v)} videos`);
      grid.appendChild(cell);
    }
    grid.appendChild(el("div", { class: "ym-total" }, fmtNum(ym.totals[y])));
  }

  host.appendChild(grid);
  host.appendChild(makeLegend({
    peak: ym.max,
    peakLabel: `peak ${fmtNum(ym.max)}/month`,
    cells: [0, 0.2, 0.45, 0.7, 1].map((r) => ({
      background: r === 0
        ? "rgba(255,255,255,0.025)"
        : `linear-gradient(180deg, rgba(239,68,68,${r * 0.85}), rgba(239,68,68,${r * 0.55}))`,
    })),
  }));
}

function renderDailyHeatmap(stats) {
  const wrap = $("heatmap");
  wrap.innerHTML = "";

  const weeks = 53;
  const grid = el("div", { class: "heatmap", style: { "--weeks": weeks } });

  // Anchor on the more recent of (today, last entry) so an old dataset
  // (e.g. the bundled 2022 example) still produces a populated grid.
  // `past` below uses the same anchor so days after it stay "empty".
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const lastEntry = new Date(stats.summary.last); lastEntry.setHours(0, 0, 0, 0);
  const anchor = lastEntry < today ? lastEntry : today;
  const start = new Date(anchor);
  start.setDate(start.getDate() - (weeks * 7 - 1) - start.getDay());

  const sub = $("heatmap-sub");
  if (sub) {
    sub.textContent = anchor < today
      ? `The 53 weeks ending ${FORMAT.niceDate(anchor)}. Each square is a day.`
      : "Last 53 weeks. Each square is a day.";
  }

  // Month label row
  grid.appendChild(el("div", { class: "heatmap-month-label" }, ""));
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const day = new Date(start);
    day.setDate(start.getDate() + w * 7);
    const m = day.getMonth();
    const label = el("div", { class: "heatmap-month-label" });
    if (m !== lastMonth) {
      label.textContent = FORMAT.months[m];
      lastMonth = m;
    }
    grid.appendChild(label);
  }

  // Day rows
  let max = 0;
  const cells = [];
  for (let d = 0; d < 7; d++) {
    for (let w = 0; w < weeks; w++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      const past = day <= anchor;
      const k = FORMAT.isoDate(day);
      const v = past ? (stats.daily.byDate.get(k) ?? 0) : -1;
      if (v > max) max = v;
      cells.push({ d, w, v, k, day });
    }
  }
  for (let d = 0; d < 7; d++) {
    const lbl = el("div", { class: "heatmap-day-label" }, ["Mon","","Wed","","Fri","",""][d] ?? "");
    lbl.style.gridRow = d + 2;
    lbl.style.gridColumn = 1;
    grid.appendChild(lbl);
  }
  for (const cell of cells) {
    const level = cell.v < 0 ? "empty" : bucketLevel(cell.v, max);
    const c = el("div", { class: `heatmap-cell ${level}` });
    c.style.gridRow = cell.d + 2;
    c.style.gridColumn = cell.w + 2;
    if (cell.v >= 0) {
      const niceDate = cell.day.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      attachTip(c, cell.v === 0 ? `${niceDate} · no videos` : `${niceDate} · ${fmtNum(cell.v)} video${cell.v === 1 ? "" : "s"}`);
    }
    grid.appendChild(c);
  }
  wrap.appendChild(grid);

  // legend
  wrap.appendChild(el("div", { class: "heatmap-legend" },
    el("span", {}, "less"),
    el("div", { class: "heatmap-legend-cells" },
      el("span", { class: "heatmap-cell empty" }),
      el("span", { class: "heatmap-cell l1" }),
      el("span", { class: "heatmap-cell l2" }),
      el("span", { class: "heatmap-cell l3" }),
      el("span", { class: "heatmap-cell l4" }),
    ),
    el("span", {}, `more · peak ${max}/day`),
  ));
}

function renderHourDow(stats) {
  const wrap = $("hourdow");
  wrap.innerHTML = "";
  const grid = el("div", { class: "hourdow" });

  // top row: empty + 24 hour labels
  grid.appendChild(el("div", { class: "hourdow-hour" }, ""));
  for (let h = 0; h < 24; h++) {
    grid.appendChild(el("div", { class: "hourdow-hour" }, String(h).padStart(2, "0")));
  }

  const dows = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const max = stats.hourDow.max;
  for (let d = 0; d < 7; d++) {
    grid.appendChild(el("div", { class: "hourdow-label" }, dows[d]));
    for (let h = 0; h < 24; h++) {
      const v = stats.hourDow.grid[d][h];
      const c = el("div", { class: `hourdow-cell ${bucketLevel(v, max)}` });
      attachTip(c, `${dows[d]} ${String(h).padStart(2, "0")}:00 · ${fmtNum(v)} video${v === 1 ? "" : "s"}`);
      grid.appendChild(c);
    }
  }
  wrap.appendChild(grid);

  wrap.appendChild(makeLegend({
    peak: max,
    peakLabel: `peak ${fmtNum(max)}/hour`,
    cells: ["empty", "l1", "l2", "l3", "l4"].map((cls) => ({ className: `hourdow-cell ${cls}` })),
  }));
}

// Shared legend renderer for heatmap-style grids. Each cell can be styled
// either by className (for the level-bucket grids) or by inline background
// (for the opacity-gradient ym grid).
function makeLegend({ peak, peakLabel, cells }) {
  const cellNodes = cells.map((spec) => {
    const node = el("span", spec.className ? { class: spec.className } : {});
    if (spec.background) node.style.background = spec.background;
    return node;
  });
  return el("div", { class: "heatmap-legend" },
    el("span", {}, "less"),
    el("div", { class: "heatmap-legend-cells" }, ...cellNodes),
    el("span", {}, peak > 0 ? `more · ${peakLabel}` : "more"),
  );
}

function renderTopChannels(targetId, list) {
  const wrap = $(targetId);
  wrap.innerHTML = "";
  if (list.length === 0) { wrap.appendChild(el("li", {}, "(none)")); return; }
  const max = list[0].count;
  for (const ch of list) {
    const avEl = avatarEl(ch.name, ch.videoId);
    const fill = el("span", { class: "channel-bar-fill" });
    const nameNode = ch.url
      ? el("a", { href: ch.url, target: "_blank", rel: "noopener noreferrer" }, ch.name)
      : document.createTextNode(ch.name);
    wrap.appendChild(el("li", { class: "channel-row" },
      avEl,
      el("div", { class: "channel-meta" },
        el("div", { class: "channel-name" }, nameNode),
        el("div", { class: "channel-bar" }, fill),
      ),
      el("div", { class: "channel-count" }, fmtNum(ch.count)),
    ));
    requestAnimationFrame(() => { fill.style.width = `${(ch.count / max) * 100}%`; });
  }
}

function renderRewatched(stats) {
  const wrap = $("rewatched-list");
  wrap.innerHTML = "";
  const list = stats.rewatched.slice(0, 25);
  $("rewatched-sub").textContent = stats.rewatched.length
    ? `${fmtNum(stats.rewatched.length)} videos watched more than once. The top 25:`
    : "No rewatches found.";

  for (const r of list) {
    const avEl = avatarEl(r.channel, videoIdFromUrl(r.url));
    const titleNode = r.url
      ? el("a", { href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.title)
      : document.createTextNode(r.title);
    const chanNode = r.channelUrl
      ? el("a", { href: r.channelUrl, target: "_blank", rel: "noopener noreferrer" }, r.channel)
      : document.createTextNode(r.channel);
    wrap.appendChild(el("li", { class: "rewatched-row" },
      el("div", { class: "rewatched-count" }, fmtNum(r.count)),
      avEl,
      el("div", { class: "rewatched-meta" },
        el("div", { class: "rewatched-title" }, titleNode),
        el("div", { class: "rewatched-channel" }, chanNode),
      ),
      el("div", { class: "rewatched-span" }, `${FORMAT.niceDate(r.first)} → ${FORMAT.niceDate(r.last)}`),
    ));
  }
}

function renderPlayBuckets(stats) {
  const host = $("play-buckets");
  host.innerHTML = "";
  const buckets = stats.playCountBuckets;
  const totalPlays = stats.summary.watched;
  const maxV = Math.max(...buckets.map((r) => r.videos));

  const master = el("ul", { class: "play-master" });
  const detail = el("div", { class: "play-detail" });
  const hint = el("p", { class: "play-detail-hint" }, "Click a bucket to see videos.");
  detail.appendChild(hint);

  const rows = [];
  let selectedIdx = -1;

  buckets.forEach((b, idx) => {
    const fill = el("span", { class: "bucket-bar-fill" });
    const pctP = totalPlays ? (b.plays / totalPlays * 100) : 0;
    const row = el("li", {
      class: "bucket-row" + (b.videos === 0 ? " is-empty" : ""),
      role: "button",
      tabindex: b.videos === 0 ? "-1" : "0",
      "aria-pressed": "false",
    },
      el("div", { class: "bucket-label" }, b.label),
      el("div", { class: "bucket-bar" }, fill),
      el("div", { class: "bucket-num" },
        el("strong", {}, fmtNum(b.videos)),
        document.createTextNode(` videos · ${pctP.toFixed(1)}% of plays`),
      ),
    );
    if (b.videos > 0) {
      const onActivate = () => selectBucket(idx);
      row.addEventListener("click", onActivate);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActivate(); }
      });
    }
    rows.push(row);
    master.appendChild(row);
    requestAnimationFrame(() => { fill.style.width = `${maxV ? (b.videos / maxV) * 100 : 0}%`; });
  });

  function selectBucket(idx) {
    if (selectedIdx === idx) {
      // toggle off
      rows[idx].classList.remove("is-selected");
      rows[idx].setAttribute("aria-pressed", "false");
      selectedIdx = -1;
      detail.innerHTML = "";
      detail.appendChild(hint);
      return;
    }
    if (selectedIdx >= 0) {
      rows[selectedIdx].classList.remove("is-selected");
      rows[selectedIdx].setAttribute("aria-pressed", "false");
    }
    selectedIdx = idx;
    rows[idx].classList.add("is-selected");
    rows[idx].setAttribute("aria-pressed", "true");
    renderBucketDetail(detail, buckets[idx]);
  }

  host.appendChild(el("div", { class: "play-master-detail" }, master, detail));
}

function renderBucketDetail(panel, bucket) {
  panel.innerHTML = "";
  const truncated = bucket.videos > bucket.items.length;
  panel.appendChild(el("div", { class: "play-detail-head" },
    el("h3", { class: "play-detail-title" }, bucket.label),
    el("p", { class: "play-detail-sub" },
      `${fmtNum(bucket.videos)} video${bucket.videos === 1 ? "" : "s"} · ${fmtNum(bucket.plays)} play${bucket.plays === 1 ? "" : "s"}` +
      (truncated ? ` · showing top ${fmtNum(bucket.items.length)}` : ""),
    ),
  ));

  if (bucket.items.length === 0) {
    panel.appendChild(el("p", { class: "play-detail-hint" }, "No videos in this bucket."));
    return;
  }

  const list = el("ol", { class: "play-detail-list" });
  for (const v of bucket.items) {
    const titleNode = v.url
      ? el("a", { href: v.url, target: "_blank", rel: "noopener noreferrer" }, v.title)
      : document.createTextNode(v.title);
    const chanNode = v.channelUrl
      ? el("a", { href: v.channelUrl, target: "_blank", rel: "noopener noreferrer" }, v.channel)
      : document.createTextNode(v.channel);
    list.appendChild(el("li", { class: "play-detail-row" },
      el("div", { class: "play-detail-count" }, fmtNum(v.count)),
      avatarEl(v.channel, videoIdFromUrl(v.url)),
      el("div", { class: "play-detail-meta" },
        el("div", { class: "play-detail-vtitle" }, titleNode),
        el("div", { class: "play-detail-channel" }, chanNode),
      ),
    ));
  }
  panel.appendChild(list);
}

function renderExtras(stats) {
  const wrap = $("extras");
  wrap.innerHTML = "";
  const items = [
    {
      label: "Busiest day",
      value: fmtNum(stats.streaks.busiestDay.count),
      sub: stats.streaks.busiestDay.date ? FORMAT.niceDate(stats.streaks.busiestDay.date, { weekday: true }) : "—",
    },
    {
      label: "Longest streak",
      value: fmtNum(stats.streaks.longestStreak.length),
      sub: stats.streaks.longestStreak.end ? `ending ${FORMAT.niceDate(stats.streaks.longestStreak.end)}` : "—",
    },
    {
      label: "Days watched",
      value: fmtNum(stats.streaks.daysWatched),
      sub: `${stats.streaks.pct.toFixed(1)}% of the range`,
    },
    {
      label: "Skipped entries",
      value: fmtNum(stats.summary.skippedMusic + stats.summary.skippedNoTime),
      sub: `${stats.summary.skippedMusic} music + ${stats.summary.skippedNoTime} undated`,
    },
  ];
  for (const it of items) {
    wrap.appendChild(el("div", { class: "extra" },
      el("p", { class: "extra-label" }, it.label),
      el("div", { class: "extra-value" }, it.value),
      el("p", { class: "extra-sub" }, it.sub),
    ));
  }
}
