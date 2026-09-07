"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Billshot = require("../js/engine.js");

test("12 seconds on Linux bills 1 included minute", function () {
  assert.equal(Billshot.billedMinutesForJob(12, "linux"), 1);
  assert.equal(Billshot.roundedMinutesFromSeconds(12), 1);
});

test("jobs under 60s still bill 1 rounded minute", function () {
  assert.equal(Billshot.roundedMinutesFromSeconds(1), 1);
  assert.equal(Billshot.roundedMinutesFromSeconds(59), 1);
  assert.equal(Billshot.roundedMinutesFromSeconds(60), 1);
  assert.equal(Billshot.roundedMinutesFromSeconds(61), 2);
});

test("OS multipliers: Linux 1×, Windows 2×, macOS 10×", function () {
  assert.equal(Billshot.billedMinutesForJob(12, "windows"), 2);
  assert.equal(Billshot.billedMinutesForJob(18, "macos"), 10);
  assert.equal(Billshot.billedMinutesForJob(251, "macos"), 50);
  assert.equal(Billshot.billedMinutesForJob(202, "windows"), 8);
});

test("zero or invalid duration does not invent minutes", function () {
  assert.equal(Billshot.roundedMinutesFromSeconds(0), 0);
  assert.equal(Billshot.billedMinutesForJob(0, "macos"), 0);
  assert.equal(Billshot.roundedMinutesFromSeconds(-3), 0);
});

test("sample paste explains rounding, multipliers, and macOS as the driver", function () {
  const result = Billshot.explain({ text: Billshot.SAMPLE_REPORT });
  assert.equal(result.parsed, true);
  assert.equal(result.mode, "jobs");
  assert.equal(result.totals.jobCount, 10);
  assert.equal(result.totals.roundedMinutes, 20);
  assert.equal(result.totals.billedMinutes, 81);
  assert.equal(result.os.macos.billedMinutes, 60);
  assert.equal(result.totals.shortJobs, 6);
  const ids = result.drivers.map(function (d) { return d.id; });
  assert.ok(ids.indexOf("macos") !== -1);
  assert.ok(ids.indexOf("rounding") !== -1);
  assert.ok(ids.indexOf("windows") !== -1);
  assert.deepEqual(
    result.jobs.map(function (j) { return j.name; }),
    [
      "lint",
      "unit-linux",
      "unit-linux-2",
      "typecheck",
      "build-windows",
      "test-windows",
      "macos-notarize",
      "macos-test",
      "e2e-linux",
      "e2e-windows",
    ]
  );
});

test("usage CSV sku + quantity applies multipliers without inventing jobs", function () {
  const csv = [
    "date,product,sku,quantity,unit_type",
    "2026-08-12,actions,actions_linux,142,minutes",
    "2026-08-12,actions,actions_windows,88,minutes",
    "2026-08-13,actions,actions_macos,41,minutes",
  ].join("\n");
  const result = Billshot.explain({ text: csv });
  assert.equal(result.parsed, true);
  assert.equal(result.mode, "sku");
  assert.equal(result.os.linux.billedMinutes, 142);
  assert.equal(result.os.windows.billedMinutes, 176);
  assert.equal(result.os.macos.billedMinutes, 410);
  assert.equal(result.totals.billedMinutes, 728);
});

test("parse failure returns tips and accepts manual OS minutes", function () {
  const failed = Billshot.explain({ text: "hello finance team please explain this bill" });
  assert.equal(failed.parsed, false);
  assert.ok(failed.tips.length >= 2);

  const manual = Billshot.explain({
    text: "unreadable screenshot notes",
    manual: { linuxMinutes: 40, windowsMinutes: 20, macosMinutes: 10 },
  });
  assert.equal(manual.parsed, true);
  assert.equal(manual.mode, "manual");
  assert.equal(manual.totals.billedMinutes, 40 + 40 + 100);
});

test("manual job counts assume 1 rounded minute each", function () {
  const result = Billshot.explain({
    text: "",
    manual: { linuxJobs: 3, macosJobs: 1 },
  });
  assert.equal(result.totals.billedMinutes, 3 + 10);
  assert.ok(result.drivers.some(function (d) { return d.id === "rounding"; }));
});

test("duration parser accepts 12s, 3m 22s, and 1:04", function () {
  assert.equal(Billshot.parseDuration("12s"), 12);
  assert.equal(Billshot.parseDuration("3m 22s"), 202);
  assert.equal(Billshot.parseDuration("1:04"), 64);
  assert.equal(Billshot.parseDuration("4m 11s"), 251);
});
