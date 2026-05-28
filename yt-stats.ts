#!/usr/bin/env -S deno run --allow-read
import { parseEntries, computeStats } from "./core.js";
import { renderCli } from "./cli.js";

const file = Deno.args[0] ?? "watch-history.json";
const raw = JSON.parse(await Deno.readTextFile(file));
const { watches, skippedMusic, skippedNoTime } = parseEntries(raw);
const stats = computeStats(watches, { skippedMusic, skippedNoTime });
renderCli(stats);
