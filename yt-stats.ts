#!/usr/bin/env -S deno run --allow-read

type Entry = {
  header?: string;
  title?: string;
  titleUrl?: string;
  subtitles?: { name?: string; url?: string }[];
  time?: string;
  details?: { name: string }[];
};

const file = Deno.args[0] ?? "watch-history.json";
const raw = await Deno.readTextFile(file);
const data: Entry[] = JSON.parse(raw);

// ── ANSI helpers ────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  grn: "\x1b[32m",
  yel: "\x1b[33m",
  blu: "\x1b[34m",
  mag: "\x1b[35m",
  cyn: "\x1b[36m",
  gry: "\x1b[90m",
};
const c = (s: string, color: keyof typeof C) => `${C[color]}${s}${C.reset}`;
const h1 = (s: string) => c(`\n━━ ${s} ${"━".repeat(Math.max(0, 70 - s.length))}`, "cyn");

// ── Parse ───────────────────────────────────────────────────────────────────
type Watch = {
  date: Date;
  title: string;
  url: string;
  channel: string;
  isAd: boolean;
  isPost: boolean;
  isWatched: boolean;
};

const watches: Watch[] = [];
let skippedNoTime = 0;
let skippedMusic = 0;

for (const e of data) {
  if (!e.time) { skippedNoTime++; continue; }
  if (e.header && e.header !== "YouTube") { skippedMusic++; continue; }
  const t = e.title ?? "";
  const isAd = (e.details ?? []).some((d) => d.name === "From Google Ads");
  const isPost = t.startsWith("Viewed a post") || (e.titleUrl?.includes("/post/") ?? false);
  const isWatched = t.startsWith("Watched ");
  watches.push({
    date: new Date(e.time),
    title: t.replace(/^Watched /, ""),
    url: e.titleUrl ?? "",
    channel: e.subtitles?.[0]?.name ?? "(unknown / removed)",
    isAd,
    isPost,
    isWatched,
  });
}

watches.sort((a, b) => a.date.getTime() - b.date.getTime());

const total = watches.length;
const ads = watches.filter((w) => w.isAd).length;
const posts = watches.filter((w) => w.isPost).length;
const realWatches = watches.filter((w) => w.isWatched && !w.isAd);

// ── Header ──────────────────────────────────────────────────────────────────
console.log(c("\n╔══════════════════════════════════════════════════════════════════════╗", "mag"));
console.log(c("║          YouTube Watch History — Personal Stats Report             ║", "mag"));
console.log(c("╚══════════════════════════════════════════════════════════════════════╝", "mag"));

const first = watches[0].date;
const last = watches[watches.length - 1].date;
const days = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000));
const fmt = (d: Date) => d.toISOString().slice(0, 10);

console.log(`${c("Entries:", "bold")} ${total.toLocaleString()}  ` +
  `${c("Watched:", "bold")} ${realWatches.length.toLocaleString()}  ` +
  `${c("Ads:", "bold")} ${ads.toLocaleString()}  ` +
  `${c("Posts:", "bold")} ${posts.toLocaleString()}`);
console.log(`${c("Range:", "bold")} ${fmt(first)} → ${fmt(last)}  ${c(`(${days} days)`, "gry")}`);
console.log(`${c("Avg/day:", "bold")} ${(realWatches.length / days).toFixed(1)} videos`);

// ── Year/Month breakdown ────────────────────────────────────────────────────
console.log(h1("Year × Month breakdown"));
const ym = new Map<string, Map<number, number>>();
const yearTotals = new Map<string, number>();
for (const w of realWatches) {
  const y = String(w.date.getUTCFullYear());
  const m = w.date.getUTCMonth();
  if (!ym.has(y)) ym.set(y, new Map());
  const mm = ym.get(y)!;
  mm.set(m, (mm.get(m) ?? 0) + 1);
  yearTotals.set(y, (yearTotals.get(y) ?? 0) + 1);
}
const years = [...ym.keys()].sort();
const maxYearMonth = Math.max(...[...ym.values()].flatMap((mm) => [...mm.values()]));
const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const cellW = 5;
const head = "Year  " + months.map((m) => m.padStart(cellW)).join("") + "   Total";
console.log(c(head, "gry"));
for (const y of years) {
  const mm = ym.get(y)!;
  const row = months.map((_, i) => {
    const v = mm.get(i) ?? 0;
    if (v === 0) return c("   . ", "gry");
    const intensity = v / maxYearMonth;
    const color: keyof typeof C = intensity > 0.66 ? "red" : intensity > 0.33 ? "yel" : "grn";
    return c(String(v).padStart(cellW), color);
  }).join("");
  console.log(`${c(y, "bold")}  ${row}   ${c(String(yearTotals.get(y)).padStart(5), "cyn")}`);
}

// ── Daily heatmap (last 53 weeks, GitHub-style) ─────────────────────────────
console.log(h1("Daily heatmap — last 53 weeks (GitHub style)"));
const byDay = new Map<string, number>();
for (const w of realWatches) {
  const k = w.date.toISOString().slice(0, 10);
  byDay.set(k, (byDay.get(k) ?? 0) + 1);
}
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const weeks = 53;
// Start from Sunday `weeks` weeks back
const start = new Date(today);
start.setUTCDate(start.getUTCDate() - (weeks * 7 - 1) - start.getUTCDay());

const grid: number[][] = []; // grid[day 0..6][week 0..weeks-1]
for (let d = 0; d < 7; d++) grid.push(new Array(weeks).fill(-1));
let maxDay = 0;
for (let w = 0; w < weeks; w++) {
  for (let d = 0; d < 7; d++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + w * 7 + d);
    if (day > today) continue;
    const k = day.toISOString().slice(0, 10);
    const v = byDay.get(k) ?? 0;
    grid[d][w] = v;
    if (v > maxDay) maxDay = v;
  }
}
const blocks = [" ", "░", "▒", "▓", "█"];
const cellFor = (v: number): string => {
  if (v < 0) return " ";
  if (v === 0) return c("·", "gry");
  const r = v / maxDay;
  const idx = r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
  const color: keyof typeof C = idx >= 4 ? "red" : idx === 3 ? "yel" : idx === 2 ? "grn" : "blu";
  return c(blocks[idx], color);
};

// month labels row
const monthLabelRow = new Array(weeks).fill(" ");
let lastMonth = -1;
for (let w = 0; w < weeks; w++) {
  const day = new Date(start);
  day.setUTCDate(start.getUTCDate() + w * 7);
  const m = day.getUTCMonth();
  if (m !== lastMonth) {
    const label = months[m];
    for (let i = 0; i < label.length && w + i < weeks; i++) monthLabelRow[w + i] = label[i];
    lastMonth = m;
  }
}
console.log("    " + monthLabelRow.join(""));
const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
for (let d = 0; d < 7; d++) {
  const row = grid[d].map(cellFor).join("");
  console.log(`${c(dayLabels[d], "gry")} ${row}`);
}
console.log(c(`legend: `, "gry") + `${c("·","gry")} 0  ${c("░","blu")} low  ${c("▒","grn")}  ${c("▓","yel")}  ${c("█","red")} high (max=${maxDay}/day)`);

// ── Hour-of-day × Day-of-week heatmap ───────────────────────────────────────
console.log(h1("Hour-of-day × Day-of-week (your local time)"));
const hod: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
for (const w of realWatches) {
  hod[w.date.getDay()][w.date.getHours()]++;
}
const maxHod = Math.max(...hod.flat());
console.log("    " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[0]).join(" "));
console.log("    " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[1]).join(" "));
const dayShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
for (let d = 0; d < 7; d++) {
  const row = hod[d].map((v) => {
    if (v === 0) return c("·", "gry");
    const r = v / maxHod;
    const idx = r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
    const color: keyof typeof C = idx >= 4 ? "red" : idx === 3 ? "yel" : idx === 2 ? "grn" : "blu";
    return c(blocks[idx], color);
  }).join(" ");
  console.log(`${c(dayShort[d], "gry")} ${row}`);
}

// ── Day of week totals ──────────────────────────────────────────────────────
console.log(h1("Day-of-week totals"));
const dowTotals = new Array(7).fill(0);
for (const w of realWatches) dowTotals[w.date.getDay()]++;
const maxDow = Math.max(...dowTotals);
const barW = 40;
for (let d = 0; d < 7; d++) {
  const len = Math.round((dowTotals[d] / maxDow) * barW);
  console.log(`${c(dayShort[d], "gry")} ${c("█".repeat(len), "cyn")}${"·".repeat(barW - len)} ${dowTotals[d]}`);
}

// ── Hour totals ────────────────────────────────────────────────────────────
console.log(h1("Hour-of-day totals"));
const hourTotals = new Array(24).fill(0);
for (const w of realWatches) hourTotals[w.date.getHours()]++;
const maxHour = Math.max(...hourTotals);
const barH = 20;
const hourBars: string[][] = Array.from({ length: barH }, () => new Array(24).fill(" "));
for (let h = 0; h < 24; h++) {
  const height = Math.round((hourTotals[h] / maxHour) * barH);
  for (let r = 0; r < height; r++) hourBars[barH - 1 - r][h] = "█";
}
for (const row of hourBars) {
  console.log("  " + row.map((ch) => ch === "█" ? c("█", "mag") : " ").join(" "));
}
console.log("  " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[0]).join(" "));
console.log("  " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[1]).join(" "));

// ── Top channels ────────────────────────────────────────────────────────────
console.log(h1("Top 25 channels (all-time)"));
const chCount = new Map<string, number>();
for (const w of realWatches) chCount.set(w.channel, (chCount.get(w.channel) ?? 0) + 1);
const top = [...chCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
const maxCh = top[0]?.[1] ?? 1;
const nameW = Math.min(40, Math.max(...top.map(([n]) => n.length)));
for (const [name, n] of top) {
  const len = Math.round((n / maxCh) * 30);
  const bar = c("█".repeat(len), "grn") + c("·".repeat(30 - len), "gry");
  console.log(`  ${name.slice(0, nameW).padEnd(nameW)} ${bar} ${c(String(n), "bold")}`);
}

// ── Top channels — last 90 days ─────────────────────────────────────────────
console.log(h1("Top 15 channels (last 90 days)"));
const cutoff = new Date(last.getTime() - 90 * 86400000);
const ch90 = new Map<string, number>();
for (const w of realWatches) {
  if (w.date >= cutoff) ch90.set(w.channel, (ch90.get(w.channel) ?? 0) + 1);
}
const top90 = [...ch90.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
const maxCh90 = top90[0]?.[1] ?? 1;
const nameW2 = Math.min(40, Math.max(...top90.map(([n]) => n.length), 1));
for (const [name, n] of top90) {
  const len = Math.round((n / maxCh90) * 30);
  const bar = c("█".repeat(len), "yel") + c("·".repeat(30 - len), "gry");
  console.log(`  ${name.slice(0, nameW2).padEnd(nameW2)} ${bar} ${c(String(n), "bold")}`);
}

// ── Top rewatched ───────────────────────────────────────────────────────────
console.log(h1("Top 20 rewatched videos"));
type RW = { title: string; channel: string; count: number; first: Date; last: Date };
const rewMap = new Map<string, RW>();
for (const w of realWatches) {
  // Prefer URL as identity (titles can drift if renamed). Fall back to title.
  const key = w.url || `t:${w.title}`;
  const cur = rewMap.get(key);
  if (cur) {
    cur.count++;
    if (w.date < cur.first) cur.first = w.date;
    if (w.date > cur.last) cur.last = w.date;
  } else {
    rewMap.set(key, { title: w.title, channel: w.channel, count: 1, first: w.date, last: w.date });
  }
}
const rewatched = [...rewMap.values()]
  .filter((r) => r.count > 1)
  .sort((a, b) => b.count - a.count)
  .slice(0, 20);

if (rewatched.length === 0) {
  console.log(c("  (no rewatches found)", "gry"));
} else {
  const maxRew = rewatched[0].count;
  const titleW = 50;
  const chanW = 22;
  for (const r of rewatched) {
    const len = Math.round((r.count / maxRew) * 14);
    const bar = c("█".repeat(len), "mag") + c("·".repeat(14 - len), "gry");
    const title = r.title.length > titleW ? r.title.slice(0, titleW - 1) + "…" : r.title.padEnd(titleW);
    const chan = r.channel.length > chanW ? r.channel.slice(0, chanW - 1) + "…" : r.channel.padEnd(chanW);
    const span = `${fmt(r.first)}→${fmt(r.last)}`;
    console.log(`  ${bar} ${c(String(r.count).padStart(3), "bold")} ${title} ${c(chan, "gry")} ${c(span, "gry")}`);
  }
  const rewTotal = [...rewMap.values()].filter((r) => r.count > 1).reduce((s, r) => s + r.count, 0);
  const rewVideos = [...rewMap.values()].filter((r) => r.count > 1).length;
  console.log(c(`  ${rewVideos.toLocaleString()} videos rewatched (${rewTotal.toLocaleString()} total plays); ` +
    `${(realWatches.length - rewTotal + rewVideos).toLocaleString()} watched exactly once`, "gry"));
}

// ── Play-count distribution ─────────────────────────────────────────────────
console.log(h1("Play-count distribution"));
{
  const buckets = [
    { label: "1 play (watched once)", min: 1,  max: 1 },
    { label: "2 plays",                min: 2,  max: 2 },
    { label: "3–5 plays",              min: 3,  max: 5 },
    { label: "6–10 plays",             min: 6,  max: 10 },
    { label: "11–25 plays",            min: 11, max: 25 },
    { label: "26–50 plays",            min: 26, max: 50 },
    { label: "51+ plays",              min: 51, max: Infinity },
  ];
  const rows = buckets.map((b) => {
    let videos = 0, plays = 0;
    for (const r of rewMap.values()) {
      if (r.count >= b.min && r.count <= b.max) { videos++; plays += r.count; }
    }
    return { ...b, videos, plays };
  });
  const totalVideos = rewMap.size;
  const totalPlays = realWatches.length;
  const maxVideos = Math.max(...rows.map((r) => r.videos));
  const maxPlays = Math.max(...rows.map((r) => r.plays));
  console.log(c(
    `  ${"bucket".padEnd(24)} ${"videos".padStart(7)} ${"%vids".padStart(6)}  ` +
    `${"plays".padStart(7)} ${"%plays".padStart(6)}  distribution`, "gry"));
  for (const r of rows) {
    const pctV = (r.videos / totalVideos) * 100;
    const pctP = (r.plays / totalPlays) * 100;
    const lenV = maxVideos ? Math.round((r.videos / maxVideos) * 18) : 0;
    const lenP = maxPlays ? Math.round((r.plays / maxPlays) * 18) : 0;
    const barV = c("█".repeat(lenV), "cyn") + c("·".repeat(18 - lenV), "gry");
    const barP = c("█".repeat(lenP), "mag") + c("·".repeat(18 - lenP), "gry");
    console.log(`  ${r.label.padEnd(24)} ${String(r.videos).padStart(7)} ${pctV.toFixed(1).padStart(5)}%  ` +
      `${String(r.plays).padStart(7)} ${pctP.toFixed(1).padStart(5)}%  ${barV} ${barP}`);
  }
  console.log(c("  left bar = share of unique videos · right bar = share of total plays", "gry"));
}

// ── Fun extras ──────────────────────────────────────────────────────────────
console.log(h1("Streaks & extras"));
const dayKeys = [...byDay.keys()].sort();
let bestStreak = 0, curStreak = 0, bestStreakEnd = "";
let prev: Date | null = null;
for (const k of dayKeys) {
  const d = new Date(k);
  if (prev && (d.getTime() - prev.getTime()) === 86400000) {
    curStreak++;
  } else {
    curStreak = 1;
  }
  if (curStreak > bestStreak) { bestStreak = curStreak; bestStreakEnd = k; }
  prev = d;
}
const busiestDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
const uniqueChannels = chCount.size;
const uniqueVideos = new Set(realWatches.map((w) => w.title)).size;
console.log(`  ${c("Unique channels:", "bold")} ${uniqueChannels.toLocaleString()}`);
console.log(`  ${c("Unique video titles:", "bold")} ${uniqueVideos.toLocaleString()}`);
console.log(`  ${c("Busiest day:", "bold")} ${busiestDay[0]} with ${c(String(busiestDay[1]), "red")} videos`);
console.log(`  ${c("Longest daily streak:", "bold")} ${c(String(bestStreak), "grn")} days (ending ${bestStreakEnd})`);
console.log(`  ${c("Days watched / days in range:", "bold")} ${dayKeys.length} / ${days} ` +
  `(${((dayKeys.length / days) * 100).toFixed(1)}%)`);

if (skippedMusic || skippedNoTime) {
  console.log(c(`\n(skipped ${skippedMusic} non-YouTube + ${skippedNoTime} undated entries)`, "gry"));
}
console.log("");
