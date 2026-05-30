// Pure stats core — no I/O, no Deno or browser APIs.
// Consumed by both the CLI (yt-stats.ts) and the web UI (web/app.js).

/**
 * @typedef {Object} RawEntry
 * @property {string=} header
 * @property {string=} title
 * @property {string=} titleUrl
 * @property {{name?: string, url?: string}[]=} subtitles
 * @property {string=} time
 * @property {{name: string}[]=} details
 */

/**
 * @typedef {Object} Watch
 * @property {Date}   date
 * @property {string} title
 * @property {string} url
 * @property {string} channel
 * @property {string} channelUrl
 * @property {boolean} isAd
 * @property {boolean} isPost
 * @property {boolean} isWatched
 */

/**
 * @param {RawEntry[]} raw
 * @returns {{ watches: Watch[], skippedMusic: number, skippedNoTime: number }}
 */
export function parseEntries(raw) {
  const watches = [];
  let skippedMusic = 0;
  let skippedNoTime = 0;
  for (const e of raw) {
    if (!e.time) { skippedNoTime++; continue; }
    if (e.header && e.header !== "YouTube") { skippedMusic++; continue; }
    const t = e.title ?? "";
    const isAd = (e.details ?? []).some((d) => d.name === "From Google Ads");
    const isPost = t.startsWith("Viewed a post") || !!e.titleUrl?.includes("/post/");
    const isWatched = t.startsWith("Watched ");
    watches.push({
      date: new Date(e.time),
      title: t.replace(/^Watched /, ""),
      url: e.titleUrl ?? "",
      channel: e.subtitles?.[0]?.name ?? "(unknown / removed)",
      channelUrl: e.subtitles?.[0]?.url ?? "",
      isAd, isPost, isWatched,
    });
  }
  watches.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { watches, skippedMusic, skippedNoTime };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** @param {string} url */
export function videoIdFromUrl(url) {
  if (!url) return "";
  const m = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : "";
}

/** @param {Map<string, number>} vids */
function topVideoId(vids) {
  let best = "", bestCount = 0;
  for (const [id, c] of vids) {
    if (c > bestCount) { best = id; bestCount = c; }
  }
  return best;
}

/**
 * @param {Watch[]} watches
 * @param {{ skippedMusic?: number, skippedNoTime?: number, tz?: 'local'|'utc' }} [meta]
 */
export function computeStats(watches, meta = {}) {
  const { skippedMusic = 0, skippedNoTime = 0, tz = "local" } = meta;
  const total = watches.length;
  const ads = watches.filter((w) => w.isAd).length;
  const posts = watches.filter((w) => w.isPost).length;
  const realWatches = watches.filter((w) => w.isWatched && !w.isAd);

  const get = {
    year:  (d) => tz === "utc" ? d.getUTCFullYear() : d.getFullYear(),
    month: (d) => tz === "utc" ? d.getUTCMonth()    : d.getMonth(),
    day:   (d) => tz === "utc" ? d.getUTCDay()      : d.getDay(),
    hour:  (d) => tz === "utc" ? d.getUTCHours()    : d.getHours(),
    dateKey: (d) => {
      const y = tz === "utc" ? d.getUTCFullYear() : d.getFullYear();
      const m = (tz === "utc" ? d.getUTCMonth() : d.getMonth()) + 1;
      const day = tz === "utc" ? d.getUTCDate() : d.getDate();
      return `${y}-${String(m).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    },
  };

  const first = watches[0]?.date ?? new Date();
  const last  = watches[watches.length - 1]?.date ?? new Date();
  const daysSpan = Math.max(1, Math.round((last.getTime() - first.getTime()) / 86400000));

  // ── year × month ─────────────────────────────────────────────────────────
  /** @type {Record<string, number[]>} */
  const yearMonthData = {};
  /** @type {Record<string, number>} */
  const yearTotals = {};
  let maxYearMonth = 0;
  for (const w of realWatches) {
    const y = String(get.year(w.date));
    const m = get.month(w.date);
    if (!yearMonthData[y]) yearMonthData[y] = new Array(12).fill(0);
    yearMonthData[y][m]++;
    yearTotals[y] = (yearTotals[y] ?? 0) + 1;
    if (yearMonthData[y][m] > maxYearMonth) maxYearMonth = yearMonthData[y][m];
  }
  const years = Object.keys(yearMonthData).sort();

  // ── daily heatmap ────────────────────────────────────────────────────────
  /** @type {Map<string, number>} */
  const byDate = new Map();
  for (const w of realWatches) {
    const k = get.dateKey(w.date);
    byDate.set(k, (byDate.get(k) ?? 0) + 1);
  }
  const maxDaily = Math.max(0, ...byDate.values());

  // ── hour × day-of-week ───────────────────────────────────────────────────
  /** @type {number[][]} */
  const hourDow = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const dowTotals = new Array(7).fill(0);
  const hourTotals = new Array(24).fill(0);
  for (const w of realWatches) {
    const d = get.day(w.date), h = get.hour(w.date);
    hourDow[d][h]++;
    dowTotals[d]++;
    hourTotals[h]++;
  }
  const maxHourDow = Math.max(0, ...hourDow.flat());

  // ── channels ─────────────────────────────────────────────────────────────
  // Track the most-watched video per channel so the web UI can use its
  // thumbnail as a stand-in avatar (i.ytimg.com hotlinks need no API key).
  /** @type {Map<string, {count: number, url: string, vids: Map<string, number>}>} */
  const chMap = new Map();
  for (const w of realWatches) {
    let cur = chMap.get(w.channel);
    if (!cur) {
      cur = { count: 0, url: w.channelUrl, vids: new Map() };
      chMap.set(w.channel, cur);
    }
    cur.count++;
    const vid = videoIdFromUrl(w.url);
    if (vid) cur.vids.set(vid, (cur.vids.get(vid) ?? 0) + 1);
  }
  const topChannels = [...chMap.entries()]
    .map(([name, v]) => ({ name, count: v.count, url: v.url, videoId: topVideoId(v.vids) }))
    .sort((a, b) => b.count - a.count);

  // ── channels last 90 days ────────────────────────────────────────────────
  const cutoff = new Date(last.getTime() - 90 * 86400000);
  /** @type {Map<string, {count: number, url: string, vids: Map<string, number>}>} */
  const ch90 = new Map();
  for (const w of realWatches) {
    if (w.date < cutoff) continue;
    let cur = ch90.get(w.channel);
    if (!cur) {
      cur = { count: 0, url: w.channelUrl, vids: new Map() };
      ch90.set(w.channel, cur);
    }
    cur.count++;
    const vid = videoIdFromUrl(w.url);
    if (vid) cur.vids.set(vid, (cur.vids.get(vid) ?? 0) + 1);
  }
  const topChannels90d = [...ch90.entries()]
    .map(([name, v]) => ({ name, count: v.count, url: v.url, videoId: topVideoId(v.vids) }))
    .sort((a, b) => b.count - a.count);

  // ── rewatched ────────────────────────────────────────────────────────────
  /** @type {Map<string, {title: string, channel: string, channelUrl: string, url: string, count: number, first: Date, last: Date}>} */
  const rewMap = new Map();
  for (const w of realWatches) {
    const key = w.url || `t:${w.title}`;
    const cur = rewMap.get(key);
    if (cur) {
      cur.count++;
      if (w.date < cur.first) cur.first = w.date;
      if (w.date > cur.last)  cur.last  = w.date;
    } else {
      rewMap.set(key, {
        title: w.title, channel: w.channel, channelUrl: w.channelUrl,
        url: w.url, count: 1, first: w.date, last: w.date,
      });
    }
  }
  const rewatched = [...rewMap.values()]
    .filter((r) => r.count > 1)
    .sort((a, b) => b.count - a.count);

  // ── play-count buckets ───────────────────────────────────────────────────
  const bucketDefs = [
    { label: "1 play (watched once)", min: 1,  max: 1 },
    { label: "2 plays",                min: 2,  max: 2 },
    { label: "3–5 plays",              min: 3,  max: 5 },
    { label: "6–10 plays",             min: 6,  max: 10 },
    { label: "11–25 plays",            min: 11, max: 25 },
    { label: "26–50 plays",            min: 26, max: 50 },
    { label: "51+ plays",              min: 51, max: Infinity },
  ];
  const playCountBuckets = bucketDefs.map((b) => {
    let videos = 0, plays = 0;
    for (const r of rewMap.values()) {
      if (r.count >= b.min && r.count <= b.max) { videos++; plays += r.count; }
    }
    return { ...b, videos, plays };
  });

  // ── streaks & extras ─────────────────────────────────────────────────────
  const dayKeys = [...byDate.keys()].sort();
  let bestStreak = 0, curStreak = 0, bestStreakEnd = "";
  let prev = null;
  for (const k of dayKeys) {
    const d = new Date(k);
    if (prev && (d.getTime() - prev.getTime()) === 86400000) curStreak++;
    else curStreak = 1;
    if (curStreak > bestStreak) { bestStreak = curStreak; bestStreakEnd = k; }
    prev = d;
  }
  const busiestEntry = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

  return {
    summary: {
      total, watched: realWatches.length, ads, posts,
      first, last, daysSpan,
      avgPerDay: realWatches.length / daysSpan,
      uniqueChannels: chMap.size,
      uniqueVideos: new Set(realWatches.map((w) => w.title)).size,
      skippedMusic, skippedNoTime,
    },
    yearMonth: { years, data: yearMonthData, totals: yearTotals, max: maxYearMonth, months: MONTHS },
    daily: { byDate, max: maxDaily },
    hourDow: { grid: hourDow, max: maxHourDow },
    dowTotals,
    hourTotals,
    topChannels,
    topChannels90d,
    rewatched,
    playCountBuckets,
    streaks: {
      busiestDay: { date: busiestEntry[0], count: busiestEntry[1] },
      longestStreak: { length: bestStreak, end: bestStreakEnd },
      daysWatched: dayKeys.length,
      daysSpan,
      pct: (dayKeys.length / daysSpan) * 100,
    },
  };
}

export const FORMAT = {
  isoDate: (d) => d.toISOString().slice(0, 10),
  months: MONTHS,
  // Friendly localized date — accepts a Date or a "YYYY-MM-DD" string.
  // Parsing the string by hand avoids the UTC midnight pitfall of
  // `new Date("2024-05-20")`, which can shift a day in negative offsets.
  niceDate: (input, opts = {}) => {
    const d = typeof input === "string" ? parseDateKey(input) : input;
    return d.toLocaleDateString(undefined, {
      weekday: opts.weekday ? "short" : undefined,
      year: "numeric", month: "short", day: "numeric",
    });
  },
};

function parseDateKey(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
