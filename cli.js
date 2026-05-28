// ASCII renderer — takes a Stats object from core.js and writes to stdout.
import { FORMAT } from "./core.js";

const C = {
  reset:"\x1b[0m", dim:"\x1b[2m", bold:"\x1b[1m",
  red:"\x1b[31m", grn:"\x1b[32m", yel:"\x1b[33m",
  blu:"\x1b[34m", mag:"\x1b[35m", cyn:"\x1b[36m", gry:"\x1b[90m",
};
const c  = (s, k) => `${C[k]}${s}${C.reset}`;
const h1 = (s) => c(`\n━━ ${s} ${"━".repeat(Math.max(0, 70 - s.length))}`, "cyn");

const blocks = [" ", "░", "▒", "▓", "█"];
const cellFor = (v, max) => {
  if (v < 0) return " ";
  if (v === 0) return c("·", "gry");
  const r = v / max;
  const idx = r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
  const col = idx >= 4 ? "red" : idx === 3 ? "yel" : idx === 2 ? "grn" : "blu";
  return c(blocks[idx], col);
};

export function renderCli(stats) {
  const s = stats.summary;

  console.log(c("\n╔══════════════════════════════════════════════════════════════════════╗", "mag"));
  console.log(c("║          YouTube Watch History — Personal Stats Report             ║", "mag"));
  console.log(c("╚══════════════════════════════════════════════════════════════════════╝", "mag"));

  console.log(`${c("Entries:", "bold")} ${s.total.toLocaleString()}  ` +
    `${c("Watched:", "bold")} ${s.watched.toLocaleString()}  ` +
    `${c("Ads:", "bold")} ${s.ads.toLocaleString()}  ` +
    `${c("Posts:", "bold")} ${s.posts.toLocaleString()}`);
  console.log(`${c("Range:", "bold")} ${FORMAT.isoDate(s.first)} → ${FORMAT.isoDate(s.last)}  ${c(`(${s.daysSpan} days)`, "gry")}`);
  console.log(`${c("Avg/day:", "bold")} ${s.avgPerDay.toFixed(1)} videos`);

  // ── year × month ────────────────────────────────────────────────────────
  console.log(h1("Year × Month breakdown"));
  const ym = stats.yearMonth;
  const cellW = 5;
  console.log(c("Year  " + ym.months.map((m) => m.padStart(cellW)).join("") + "   Total", "gry"));
  for (const y of ym.years) {
    const row = ym.months.map((_, i) => {
      const v = ym.data[y][i];
      if (v === 0) return c("   . ", "gry");
      const r = v / ym.max;
      const col = r > 0.66 ? "red" : r > 0.33 ? "yel" : "grn";
      return c(String(v).padStart(cellW), col);
    }).join("");
    console.log(`${c(y, "bold")}  ${row}   ${c(String(ym.totals[y]).padStart(5), "cyn")}`);
  }

  // ── daily heatmap (last 53 weeks) ───────────────────────────────────────
  console.log(h1("Daily heatmap — last 53 weeks (GitHub style)"));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weeks = 53;
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1) - start.getDay());
  const grid = Array.from({ length: 7 }, () => new Array(weeks).fill(-1));
  let maxDay = 0;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      if (day > today) continue;
      const k = FORMAT.isoDate(day);
      const v = stats.daily.byDate.get(k) ?? 0;
      grid[d][w] = v;
      if (v > maxDay) maxDay = v;
    }
  }
  const monthLabelRow = new Array(weeks).fill(" ");
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const day = new Date(start);
    day.setDate(start.getDate() + w * 7);
    const m = day.getMonth();
    if (m !== lastMonth) {
      const label = FORMAT.months[m];
      for (let i = 0; i < label.length && w + i < weeks; i++) monthLabelRow[w + i] = label[i];
      lastMonth = m;
    }
  }
  console.log("    " + monthLabelRow.join(""));
  const dayLabels = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (let d = 0; d < 7; d++) {
    console.log(`${c(dayLabels[d], "gry")} ${grid[d].map((v) => cellFor(v, maxDay)).join("")}`);
  }
  console.log(c("legend: ", "gry") + `${c("·","gry")} 0  ${c("░","blu")} low  ${c("▒","grn")}  ${c("▓","yel")}  ${c("█","red")} high (max=${maxDay}/day)`);

  // ── hour × day-of-week ──────────────────────────────────────────────────
  console.log(h1("Hour-of-day × Day-of-week (your local time)"));
  console.log("    " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[0]).join(" "));
  console.log("    " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[1]).join(" "));
  const dayShort = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  for (let d = 0; d < 7; d++) {
    const row = stats.hourDow.grid[d].map((v) => cellFor(v, stats.hourDow.max)).join(" ");
    console.log(`${c(dayShort[d], "gry")} ${row}`);
  }

  // ── day-of-week totals ──────────────────────────────────────────────────
  console.log(h1("Day-of-week totals"));
  const maxDow = Math.max(...stats.dowTotals);
  const barW = 40;
  for (let d = 0; d < 7; d++) {
    const v = stats.dowTotals[d];
    const len = Math.round((v / maxDow) * barW);
    console.log(`${c(dayShort[d], "gry")} ${c("█".repeat(len), "cyn")}${"·".repeat(barW - len)} ${v}`);
  }

  // ── hour-of-day totals ──────────────────────────────────────────────────
  console.log(h1("Hour-of-day totals"));
  const maxHour = Math.max(...stats.hourTotals);
  const barH = 20;
  const hourBars = Array.from({ length: barH }, () => new Array(24).fill(" "));
  for (let h = 0; h < 24; h++) {
    const height = Math.round((stats.hourTotals[h] / maxHour) * barH);
    for (let r = 0; r < height; r++) hourBars[barH - 1 - r][h] = "█";
  }
  for (const row of hourBars) {
    console.log("  " + row.map((ch) => ch === "█" ? c("█", "mag") : " ").join(" "));
  }
  console.log("  " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[0]).join(" "));
  console.log("  " + Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")[1]).join(" "));

  // ── top channels ────────────────────────────────────────────────────────
  const renderTopChannels = (title, list, color) => {
    console.log(h1(title));
    const top = list.slice(0, title.includes("90") ? 15 : 25);
    if (top.length === 0) { console.log(c("  (none)", "gry")); return; }
    const max = top[0].count;
    const nameW = Math.min(40, Math.max(...top.map((t) => t.name.length)));
    for (const t of top) {
      const len = Math.round((t.count / max) * 30);
      const bar = c("█".repeat(len), color) + c("·".repeat(30 - len), "gry");
      console.log(`  ${t.name.slice(0, nameW).padEnd(nameW)} ${bar} ${c(String(t.count), "bold")}`);
    }
  };
  renderTopChannels("Top 25 channels (all-time)", stats.topChannels, "grn");
  renderTopChannels("Top 15 channels (last 90 days)", stats.topChannels90d, "yel");

  // ── top rewatched ───────────────────────────────────────────────────────
  console.log(h1("Top 20 rewatched videos"));
  const rew = stats.rewatched.slice(0, 20);
  if (rew.length === 0) {
    console.log(c("  (no rewatches found)", "gry"));
  } else {
    const maxRew = rew[0].count;
    const titleW = 50, chanW = 22;
    for (const r of rew) {
      const len = Math.round((r.count / maxRew) * 14);
      const bar = c("█".repeat(len), "mag") + c("·".repeat(14 - len), "gry");
      const title = r.title.length > titleW ? r.title.slice(0, titleW - 1) + "…" : r.title.padEnd(titleW);
      const chan  = r.channel.length > chanW ? r.channel.slice(0, chanW - 1) + "…" : r.channel.padEnd(chanW);
      const span  = `${FORMAT.isoDate(r.first)}→${FORMAT.isoDate(r.last)}`;
      console.log(`  ${bar} ${c(String(r.count).padStart(3), "bold")} ${title} ${c(chan, "gry")} ${c(span, "gry")}`);
    }
    const rewTotal = stats.rewatched.reduce((sum, r) => sum + r.count, 0);
    console.log(c(`  ${stats.rewatched.length.toLocaleString()} videos rewatched (${rewTotal.toLocaleString()} total plays); ` +
      `${(s.watched - rewTotal + stats.rewatched.length).toLocaleString()} watched exactly once`, "gry"));
  }

  // ── play-count buckets ──────────────────────────────────────────────────
  console.log(h1("Play-count distribution"));
  const totalUniqueVids = stats.playCountBuckets.reduce((sum, r) => sum + r.videos, 0);
  const maxV = Math.max(...stats.playCountBuckets.map((r) => r.videos));
  const maxP = Math.max(...stats.playCountBuckets.map((r) => r.plays));
  console.log(c(`  ${"bucket".padEnd(24)} ${"videos".padStart(7)} ${"%vids".padStart(6)}  ${"plays".padStart(7)} ${"%plays".padStart(6)}  distribution`, "gry"));
  for (const r of stats.playCountBuckets) {
    const pctV = (r.videos / totalUniqueVids) * 100;
    const pctP = (r.plays / s.watched) * 100;
    const lenV = maxV ? Math.round((r.videos / maxV) * 18) : 0;
    const lenP = maxP ? Math.round((r.plays / maxP) * 18) : 0;
    const barV = c("█".repeat(lenV), "cyn") + c("·".repeat(18 - lenV), "gry");
    const barP = c("█".repeat(lenP), "mag") + c("·".repeat(18 - lenP), "gry");
    console.log(`  ${r.label.padEnd(24)} ${String(r.videos).padStart(7)} ${pctV.toFixed(1).padStart(5)}%  ${String(r.plays).padStart(7)} ${pctP.toFixed(1).padStart(5)}%  ${barV} ${barP}`);
  }
  console.log(c("  left bar = share of unique videos · right bar = share of total plays", "gry"));

  // ── streaks & extras ────────────────────────────────────────────────────
  console.log(h1("Streaks & extras"));
  console.log(`  ${c("Unique channels:", "bold")} ${s.uniqueChannels.toLocaleString()}`);
  console.log(`  ${c("Unique video titles:", "bold")} ${s.uniqueVideos.toLocaleString()}`);
  console.log(`  ${c("Busiest day:", "bold")} ${stats.streaks.busiestDay.date} with ${c(String(stats.streaks.busiestDay.count), "red")} videos`);
  console.log(`  ${c("Longest daily streak:", "bold")} ${c(String(stats.streaks.longestStreak.length), "grn")} days (ending ${stats.streaks.longestStreak.end})`);
  console.log(`  ${c("Days watched / days in range:", "bold")} ${stats.streaks.daysWatched} / ${stats.streaks.daysSpan} (${stats.streaks.pct.toFixed(1)}%)`);

  if (s.skippedMusic || s.skippedNoTime) {
    console.log(c(`\n(skipped ${s.skippedMusic} non-YouTube + ${s.skippedNoTime} undated entries)`, "gry"));
  }
  console.log("");
}
