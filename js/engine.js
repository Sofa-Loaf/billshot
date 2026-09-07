/**
 * Billshot billing engine — runs in the browser and in Node tests.
 * Included-minute burn: ceil(duration_seconds / 60) per job, then × OS multiplier.
 * Linux 1× · Windows 2× · macOS 10×. Estimate, not a GitHub invoice.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.Billshot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MULTIPLIERS = { linux: 1, windows: 2, macos: 10 };

  const SAMPLE_REPORT = [
    "GitHub Actions usage — acme/desktop",
    "Period: 2026-08-01 → 2026-08-31  (private repo)",
    "",
    "Workflow              Job                 Runner           Duration",
    "CI                    lint                ubuntu-latest    12s",
    "CI                    unit-linux          ubuntu-latest    47s",
    "CI                    unit-linux-2        ubuntu-latest    38s",
    "CI                    typecheck           ubuntu-latest    8s",
    "Release               build-windows       windows-latest   3m 22s",
    "Release               test-windows        windows-latest   55s",
    "Desktop               macos-notarize      macos-latest     4m 11s",
    "Desktop               macos-test          macos-latest     18s",
    "Nightly               e2e-linux           ubuntu-latest    2m 3s",
    "Nightly               e2e-windows         windows-latest   1m 4s",
  ].join("\n");

  const HEADER_RE =
    /^(workflow|job|runner|duration|status|date|product|sku|quantity|unit_type|repository|os|minutes|wall|rounded)\b/i;
  const SEPARATOR_RE = /^[-|=+_\s]{4,}$/;

  function detectOs(text) {
    if (!text) return null;
    const t = String(text).toLowerCase();
    if (
      /\b(macos|mac\s*os|osx|darwin|apple-silicon|macos[-_ ]?\d|actions_macos|macos_l)\b/.test(t) ||
      /\bmac(?:os)?[-_](?:latest|13|14|15|l)\b/.test(t)
    ) {
      return "macos";
    }
    if (
      /\b(windows|win32|win64|actions_windows|windows[-_ ]?(?:latest|2019|2022|2025|arm))\b/.test(t)
    ) {
      return "windows";
    }
    if (
      /\b(ubuntu|linux|debian|actions_linux|ubuntu[-_ ]?(?:latest|20\.04|22\.04|24\.04))\b/.test(t)
    ) {
      return "linux";
    }
    return null;
  }

  function parseClock(h, m, s) {
    const hours = Number(h || 0);
    const minutes = Number(m || 0);
    const seconds = Number(s || 0);
    if (![hours, minutes, seconds].every(function (n) { return Number.isFinite(n); })) {
      return null;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  function parseDuration(token) {
    if (token == null) return null;
    const raw = String(token).trim().replace(/,/g, "");
    if (!raw) return null;

    let m = raw.match(/^(\d+):(\d{2}):(\d{2})(?:\.\d+)?$/);
    if (m) return parseClock(m[1], m[2], m[3]);

    m = raw.match(/^(\d+):(\d{2})(?:\.\d+)?$/);
    if (m) return parseClock(0, m[1], m[2]);

    m = raw.match(
      /^(?:(\d+(?:\.\d+)?)\s*h(?:ou)?rs?\s*)?(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?\s*)?(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?)?$/i
    );
    if (m && (m[1] || m[2] || m[3])) {
      const hours = m[1] ? Number(m[1]) : 0;
      const minutes = m[2] ? Number(m[2]) : 0;
      const seconds = m[3] ? Number(m[3]) : 0;
      if (![hours, minutes, seconds].every(function (n) { return Number.isFinite(n); })) {
        return null;
      }
      return Math.round(hours * 3600 + minutes * 60 + seconds);
    }

    m = raw.match(/^(\d+(?:\.\d+)?)\s*(h(?:ou)?rs?|m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)$/i);
    if (m) {
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return null;
      const unit = m[2].toLowerCase();
      if (unit.charAt(0) === "h") return Math.round(n * 3600);
      if (unit.charAt(0) === "m") return Math.round(n * 60);
      return Math.round(n);
    }

    return null;
  }

  function extractDurationFromLine(line) {
    const compact = line.replace(/\s+/g, " ").trim();
    const patterns = [
      /(\d+):(\d{2}):(\d{2})(?:\.\d+)?/,
      /(\d+):(\d{2})(?:\.\d+)?/,
      /(\d+(?:\.\d+)?\s*h(?:ou)?rs?(?:\s+\d+(?:\.\d+)?\s*m(?:in(?:ute)?s?)?)?(?:\s+\d+(?:\.\d+)?\s*s(?:ec(?:ond)?s?)?)?)/i,
      /(\d+(?:\.\d+)?\s*m(?:in(?:ute)?s?)?(?:\s+\d+(?:\.\d+)?\s*s(?:ec(?:ond)?s?)?)?)/i,
      /(\d+(?:\.\d+)?\s*s(?:ec(?:ond)?s?)?)/i,
    ];
    for (let i = 0; i < patterns.length; i++) {
      const m = compact.match(patterns[i]);
      if (!m) continue;
      const seconds = parseDuration(m[0]);
      if (seconds != null && seconds >= 0) return { seconds: seconds, raw: m[0] };
    }
    return null;
  }

  function roundedMinutesFromSeconds(durationSeconds) {
    const sec = Number(durationSeconds);
    if (!Number.isFinite(sec) || sec <= 0) return 0;
    return Math.ceil(sec / 60);
  }

  function billedMinutesForJob(durationSeconds, os) {
    const rounded = roundedMinutesFromSeconds(durationSeconds);
    const multiplier = MULTIPLIERS[os] || 1;
    return rounded * multiplier;
  }

  function splitCsvLine(line) {
    const out = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    out.push(current.trim());
    return out;
  }

  function splitRow(line) {
    if (line.indexOf(",") !== -1) return splitCsvLine(line).filter(Boolean);
    return String(line).split(/\s{2,}|\t/).map(function (c) { return c.trim(); }).filter(Boolean);
  }

  function looksLikeHeader(line) {
    const cells = splitRow(line).join(" ").replace(/\s+/g, " ").trim();
    return HEADER_RE.test(cells);
  }

  function headerMap(line) {
    const cells = splitRow(line).map(function (c) {
      return c.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    });
    const map = {};
    cells.forEach(function (name, i) {
      map[name] = i;
    });
    return map;
  }

  function jobNameFromCells(cells, skip) {
    const skipSet = {};
    (skip || []).forEach(function (s) {
      skipSet[String(s).toLowerCase()] = true;
    });
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell) continue;
      if (skipSet[cell.toLowerCase()]) continue;
      if (detectOs(cell)) continue;
      if (parseDuration(cell) != null) continue;
      if (/^(success|failure|cancelled|skipped|completed|queued)$/i.test(cell)) continue;
      if (/^\d{4}-\d{2}-\d{2}/.test(cell)) continue;
      return cell;
    }
    return cells[0] || "job";
  }

  function parseSkuRow(row, headers) {
    const skuIdx = headers.sku != null ? headers.sku : headers.product;
    const qtyIdx = headers.quantity != null ? headers.quantity : headers.minutes;
    if (skuIdx == null || qtyIdx == null) return null;
    const sku = row[skuIdx] || "";
    const os = detectOs(sku) || detectOs(row.join(" "));
    if (!os) return null;
    const qty = Number(String(row[qtyIdx]).replace(/,/g, ""));
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const product = (headers.product != null ? row[headers.product] : "") || "";
    if (product && !/actions/i.test(product) && !/actions_/i.test(sku)) return null;
    return {
      kind: "sku",
      name: sku || os,
      runner: sku || os,
      os: os,
      roundedMinutes: qty,
      durationSeconds: qty * 60,
      source: "usage-csv",
    };
  }

  function parseJobRow(row, headers) {
    const runnerIdx =
      headers.runner != null
        ? headers.runner
        : headers.os != null
          ? headers.os
          : headers.sku;
    const durationIdx =
      headers.duration != null
        ? headers.duration
        : headers.wall != null
          ? headers.wall
          : headers.time != null
            ? headers.time
            : headers.wall_time;
    const nameIdx =
      headers.job != null ? headers.job : headers.name != null ? headers.name : headers.workflow;
    const runner = runnerIdx != null ? row[runnerIdx] : row.join(" ");
    const os = detectOs(runner) || detectOs(row.join(" "));
    if (!os) return null;
    let durationSeconds = null;
    if (durationIdx != null) {
      durationSeconds = parseDuration(row[durationIdx]);
      if (durationSeconds == null) {
        const extracted = extractDurationFromLine(row[durationIdx] || "");
        durationSeconds = extracted ? extracted.seconds : null;
      }
    }
    if (durationSeconds == null) {
      const extracted = extractDurationFromLine(row.join(" "));
      durationSeconds = extracted ? extracted.seconds : null;
    }
    if (durationSeconds == null || durationSeconds <= 0) return null;
    const name =
      (nameIdx != null && row[nameIdx] ? row[nameIdx] : null) ||
      jobNameFromCells(row, [runner]);
    return {
      kind: "job",
      name: name,
      runner: runner || os,
      os: os,
      durationSeconds: durationSeconds,
      source: "job-row",
    };
  }

  function parseFreeformLine(line) {
    const os = detectOs(line);
    if (!os) return null;
    const extracted = extractDurationFromLine(line);
    if (!extracted || extracted.seconds <= 0) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(line.trim())) return null;
    const withoutDuration = line.replace(extracted.raw, " ").replace(/\s+/g, " ").trim();
    const name = jobNameFromCells(
      withoutDuration.split(/\s{2,}|\t|,/).map(function (s) { return s.trim(); }).filter(Boolean),
      []
    );
    return {
      kind: "job",
      name: name,
      runner: os,
      os: os,
      durationSeconds: extracted.seconds,
      source: "freeform",
    };
  }

  function parseAggregateLine(line) {
    const os = detectOs(line);
    if (!os) return null;
    const m = line.match(
      /(\d[\d,]*(?:\.\d+)?)\s*(?:billed\s+)?(?:included[- ]?)?(?:rounded\s+)?min(?:ute)?s?\b/i
    );
    if (!m) return null;
    if (extractDurationFromLine(line) && /\b(job|runner|ubuntu|windows-latest|macos-latest)\b/i.test(line)) {
      return null;
    }
    const minutes = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return {
      kind: "aggregate",
      name: os + " minutes",
      runner: os,
      os: os,
      roundedMinutes: minutes,
      durationSeconds: minutes * 60,
      source: "aggregate",
    };
  }

  function parseText(text) {
    const raw = String(text || "").replace(/\r\n/g, "\n");
    const lines = raw.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    const jobs = [];
    const skuRows = [];
    const aggregates = [];
    let headers = null;
    let headerKind = null;
    const tips = [];

    lines.forEach(function (line) {
      if (SEPARATOR_RE.test(line)) return;
      if (looksLikeHeader(line) && headers == null) {
        headers = headerMap(line);
        if (headers.sku != null && (headers.quantity != null || headers.minutes != null)) {
          headerKind = "sku";
        } else {
          headerKind = "job";
        }
        return;
      }

      if (headers && (line.indexOf(",") !== -1 || line.indexOf("\t") !== -1 || /\s{2,}/.test(line))) {
        const row = splitRow(line);
        if (headerKind === "sku") {
          const sku = parseSkuRow(row, headers);
          if (sku) {
            skuRows.push(sku);
            return;
          }
        }
        const job = parseJobRow(row, headers);
        if (job) {
          jobs.push(job);
          return;
        }
      }

      const free = parseFreeformLine(line);
      if (free) {
        jobs.push(free);
        return;
      }

      const agg = parseAggregateLine(line);
      if (agg) aggregates.push(agg);
    });

    if (!jobs.length && !skuRows.length && !aggregates.length && raw.trim()) {
      tips.push("No job durations or OS minutes were recognized.");
    }

    return {
      jobs: jobs,
      skuRows: skuRows,
      aggregates: aggregates,
      tips: tips,
    };
  }

  function numberOrZero(value) {
    if (value == null || value === "") return 0;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function manualItems(manual) {
    const m = manual || {};
    const items = [];
    ["linux", "windows", "macos"].forEach(function (os) {
      const minutes = numberOrZero(m[os + "Minutes"]);
      const jobCount = numberOrZero(m[os + "Jobs"]);
      if (minutes > 0) {
        items.push({
          kind: "manual",
          name: os + " (manual minutes)",
          runner: os,
          os: os,
          roundedMinutes: minutes,
          durationSeconds: minutes * 60,
          source: "manual-minutes",
        });
      } else if (jobCount > 0) {
        items.push({
          kind: "manual",
          name: os + " (" + jobCount + " jobs, 1 min each assumed)",
          runner: os,
          os: os,
          roundedMinutes: jobCount,
          durationSeconds: jobCount * 60,
          jobCount: jobCount,
          source: "manual-jobs",
        });
      }
    });
    return items;
  }

  function emptyOs() {
    return {
      linux: { jobs: 0, wallSeconds: 0, roundedMinutes: 0, billedMinutes: 0, shortJobs: 0 },
      windows: { jobs: 0, wallSeconds: 0, roundedMinutes: 0, billedMinutes: 0, shortJobs: 0 },
      macos: { jobs: 0, wallSeconds: 0, roundedMinutes: 0, billedMinutes: 0, shortJobs: 0 },
    };
  }

  function explain(input) {
    const text = (input && input.text) || "";
    const parsed = parseText(text);
    const manual = manualItems(input && input.manual);
    let items = parsed.jobs.slice();
    let mode = "jobs";

    if (!items.length && parsed.skuRows.length) {
      items = parsed.skuRows;
      mode = "sku";
    }
    if (!items.length && parsed.aggregates.length) {
      items = parsed.aggregates;
      mode = "aggregate";
    }
    if (!items.length && manual.length) {
      items = manual;
      mode = "manual";
    }

    const osStats = emptyOs();
    const explainedJobs = [];
    let wallSeconds = 0;
    let roundedMinutes = 0;
    let billedMinutes = 0;
    let shortJobs = 0;
    let assumedShortJobs = false;

    items.forEach(function (item, index) {
      const os = item.os;
      const multiplier = MULTIPLIERS[os] || 1;
      const isJob = item.kind === "job";
      const durationSeconds = isJob ? item.durationSeconds : item.durationSeconds || 0;
      const rounded = isJob
        ? roundedMinutesFromSeconds(durationSeconds)
        : item.roundedMinutes || roundedMinutesFromSeconds(durationSeconds);
      const billed = rounded * multiplier;
      const short = isJob && durationSeconds > 0 && durationSeconds < 60;
      if (item.source === "manual-jobs") assumedShortJobs = true;
      if (short) shortJobs += 1;

      if (isJob) wallSeconds += durationSeconds;
      else wallSeconds += rounded * 60;

      roundedMinutes += rounded;
      billedMinutes += billed;
      osStats[os].jobs += item.jobCount || 1;
      osStats[os].wallSeconds += isJob ? durationSeconds : rounded * 60;
      osStats[os].roundedMinutes += rounded;
      osStats[os].billedMinutes += billed;
      osStats[os].shortJobs += short ? 1 : 0;

      explainedJobs.push({
        id: index + 1,
        name: item.name,
        runner: item.runner,
        os: os,
        durationSeconds: isJob ? durationSeconds : rounded * 60,
        roundedMinutes: rounded,
        multiplier: multiplier,
        billedMinutes: billed,
        shortJob: short,
        source: item.source,
      });
    });

    const wallMinutes = wallSeconds / 60;
    const roundingWaste = mode === "jobs" ? Math.max(0, roundedMinutes - wallMinutes) : 0;
    const parsedOk = explainedJobs.length > 0;
    const tips = parsed.tips.slice();

    if (!parsedOk) {
      tips.push(
        "Paste a job list with a runner (ubuntu-latest, windows-latest, macos-latest) and a duration (12s, 3m 22s, 1:04)."
      );
      tips.push(
        "Or paste a GitHub usage CSV that includes sku and quantity (actions_linux, actions_windows, actions_macos)."
      );
      tips.push(
        "If you only have a billing screenshot, fill Linux / Windows / macOS minutes below — OCR is optional in v0."
      );
    } else if (mode !== "jobs") {
      tips.push(
        "Per-job wall times were not found, so minute rounding cannot be shown job-by-job. Multipliers still apply to the minutes you provided."
      );
    }

    const drivers = buildDrivers({
      mode: mode,
      jobs: explainedJobs,
      osStats: osStats,
      billedMinutes: billedMinutes,
      roundedMinutes: roundedMinutes,
      wallMinutes: wallMinutes,
      roundingWaste: roundingWaste,
      shortJobs: shortJobs,
      assumedShortJobs: assumedShortJobs,
      image: (input && input.image) || null,
    });

    return {
      parsed: parsedOk,
      mode: mode,
      jobs: explainedJobs,
      os: osStats,
      totals: {
        jobCount: explainedJobs.reduce(function (n, j) { return n + (j.source === "manual-jobs" ? 0 : 1); }, 0) ||
          explainedJobs.length,
        wallSeconds: wallSeconds,
        wallMinutes: wallMinutes,
        roundedMinutes: roundedMinutes,
        billedMinutes: billedMinutes,
        roundingWaste: roundingWaste,
        shortJobs: shortJobs,
      },
      multipliers: Object.assign({}, MULTIPLIERS),
      drivers: drivers,
      tips: tips,
      imageNotes: imageNotes(input && input.image),
    };
  }

  function share(part, whole) {
    if (!whole) return 0;
    return part / whole;
  }

  function buildDrivers(ctx) {
    const drivers = [];
    const billed = ctx.billedMinutes;
    const macosShare = share(ctx.osStats.macos.billedMinutes, billed);
    const windowsShare = share(ctx.osStats.windows.billedMinutes, billed);
    const linuxShare = share(ctx.osStats.linux.billedMinutes, billed);
    const jobCount = ctx.jobs.length;

    if (ctx.osStats.macos.billedMinutes > 0 && (macosShare >= 0.25 || ctx.osStats.macos.billedMinutes >= 10)) {
      const macJobs = ctx.jobs.filter(function (j) { return j.os === "macos"; });
      const top = macJobs.slice().sort(function (a, b) { return b.billedMinutes - a.billedMinutes; })[0];
      drivers.push({
        id: "macos",
        title: "macOS jobs",
        severity: macosShare >= 0.5 ? "high" : "medium",
        text:
          "macOS billed minutes are 10× Linux. " +
          ctx.osStats.macos.jobs +
          (ctx.osStats.macos.jobs === 1 ? " macOS item accounts for " : " macOS items account for ") +
          pct(macosShare) +
          " of included-minute burn (" +
          fmtNum(ctx.osStats.macos.billedMinutes) +
          " of " +
          fmtNum(billed) +
          "). " +
          (top
            ? top.name +
              " is " +
              fmtNum(top.roundedMinutes) +
              " rounded minute" +
              (top.roundedMinutes === 1 ? "" : "s") +
              " × 10 = " +
              fmtNum(top.billedMinutes) +
              " billed minutes."
            : ""),
      });
    }

    if (ctx.mode === "jobs" && (ctx.shortJobs >= 2 || (ctx.roundingWaste >= 2 && share(ctx.roundingWaste, ctx.roundedMinutes) >= 0.2))) {
      drivers.push({
        id: "rounding",
        title: "Short jobs rounding up",
        severity: ctx.shortJobs >= 4 || share(ctx.roundingWaste, ctx.roundedMinutes) >= 0.35 ? "high" : "medium",
        text:
          ctx.shortJobs +
          (ctx.shortJobs === 1 ? " job finished" : " jobs finished") +
          " in under 60 seconds. Each still bills 1 rounded minute before the OS multiplier. " +
          fmtNum(ctx.wallMinutes, 1) +
          " minutes of wall time became " +
          fmtNum(ctx.roundedMinutes) +
          " rounded minutes — about " +
          fmtNum(ctx.roundingWaste, 1) +
          " extra minutes from rounding alone.",
      });
    } else if (ctx.assumedShortJobs) {
      drivers.push({
        id: "rounding",
        title: "Short jobs rounding up",
        severity: "medium",
        text:
          "Job counts were entered without durations, so Billshot assumed 1 rounded minute per job — the same as a 12-second job. If those jobs were actually longer, billed minutes will be higher.",
      });
    }

    if (ctx.osStats.windows.billedMinutes > 0 && (windowsShare >= 0.15 || ctx.osStats.windows.billedMinutes >= 8)) {
      drivers.push({
        id: "windows",
        title: "Windows runners",
        severity: windowsShare >= 0.4 ? "high" : "medium",
        text:
          "Windows billed minutes are 2× Linux. Windows is " +
          pct(windowsShare) +
          " of included-minute burn (" +
          fmtNum(ctx.osStats.windows.billedMinutes) +
          " minutes after the 2× multiplier).",
      });
    }

    if (jobCount >= 8 || (ctx.mode === "jobs" && jobCount >= 6 && ctx.shortJobs >= 3)) {
      drivers.push({
        id: "job-count",
        title: "High job count",
        severity: jobCount >= 12 ? "high" : "low",
        text:
          fmtNum(jobCount) +
          " billed items are in this paste. A wide matrix (OS × version × shard) multiplies rounding: every extra job is at least 1 minute, then the OS weight.",
      });
    }

    if (linuxShare >= 0.85 && ctx.mode === "jobs" && ctx.shortJobs < 2 && ctx.osStats.macos.jobs === 0) {
      drivers.push({
        id: "linux-heavy",
        title: "Mostly Linux wall time",
        severity: "low",
        text:
          "This paste is mostly Linux (1×). Included-minute burn is close to rounded wall time. Surprise bills more often come from macOS, Windows, or a pile of sub-minute jobs.",
      });
    }

    if (ctx.image && ctx.image.name) {
      drivers.push({
        id: "screenshot",
        title: "Screenshot attached",
        severity: "low",
        text:
          "A billing/usage image is on the page for reference. v0 does not OCR it. Read the Linux / Windows / macOS minutes from the image and enter them if the text paste is incomplete.",
      });
    }

    if (!drivers.length && billed > 0) {
      drivers.push({
        id: "mixed",
        title: "Mixed runners",
        severity: "low",
        text:
          "Included-minute burn is " +
          fmtNum(billed) +
          " after rounding and OS multipliers. No single OS dominates this paste.",
      });
    }

    return drivers;
  }

  function imageNotes(image) {
    if (!image || !image.name) return [];
    const notes = ["Previewing “" + image.name + "”. OCR is stubbed in v0 — type minutes from what you see."];
    const os = detectOs(image.name);
    if (os) {
      notes.push("The filename mentions " + os + ". Confirm against the image before trusting that.");
    }
    return notes;
  }

  function fmtNum(n, digits) {
    const d = digits == null ? (Math.abs(n - Math.round(n)) < 1e-9 ? 0 : 1) : digits;
    return Number(n).toLocaleString("en-US", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }

  function pct(fraction) {
    return Math.round(fraction * 100) + "%";
  }

  function formatDuration(seconds) {
    const s = Math.round(seconds);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return rem ? m + "m " + rem + "s" : m + "m";
    const h = Math.floor(m / 60);
    const min = m % 60;
    return min || rem ? h + "h " + min + "m " + rem + "s" : h + "h";
  }

  return {
    MULTIPLIERS: MULTIPLIERS,
    SAMPLE_REPORT: SAMPLE_REPORT,
    detectOs: detectOs,
    parseDuration: parseDuration,
    roundedMinutesFromSeconds: roundedMinutesFromSeconds,
    billedMinutesForJob: billedMinutesForJob,
    parseText: parseText,
    explain: explain,
    fmtNum: fmtNum,
    formatDuration: formatDuration,
    pct: pct,
  };
});
