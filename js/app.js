(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };

  const els = {
    report: $("report"),
    sample: $("sample"),
    clear: $("clear"),
    explain: $("explain"),
    drop: $("drop"),
    file: $("file"),
    previewWrap: $("preview-wrap"),
    preview: $("preview"),
    previewCaption: $("preview-caption"),
    removeImage: $("remove-image"),
    linuxMinutes: $("linux-minutes"),
    windowsMinutes: $("windows-minutes"),
    macosMinutes: $("macos-minutes"),
    linuxJobs: $("linux-jobs"),
    windowsJobs: $("windows-jobs"),
    macosJobs: $("macos-jobs"),
    output: $("output"),
  };

  let image = null;

  function manualFromForm() {
    return {
      linuxMinutes: els.linuxMinutes.value,
      windowsMinutes: els.windowsMinutes.value,
      macosMinutes: els.macosMinutes.value,
      linuxJobs: els.linuxJobs.value,
      windowsJobs: els.windowsJobs.value,
      macosJobs: els.macosJobs.value,
    };
  }

  function run() {
    const result = Billshot.explain({
      text: els.report.value,
      manual: manualFromForm(),
      image: image,
    });
    render(result);
  }

  function render(result) {
    const B = Billshot;
    const t = result.totals;
    const parts = [];

    if (!result.parsed) {
      parts.push(tipsCard(result));
      parts.push(roundingExplainer(null));
      parts.push(multiplierExplainer(result));
      if (result.imageNotes.length) {
        parts.push(card("Screenshot", result.imageNotes.join(" "), "tip"));
      }
      els.output.innerHTML = parts.join("");
      return;
    }

    parts.push(
      '<div class="totals" aria-label="Totals">' +
        stat(B.fmtNum(t.billedMinutes), "Included minutes after OS weight") +
        stat(B.fmtNum(t.roundedMinutes), "Rounded minutes (before weight)") +
        stat(result.mode === "jobs" ? B.formatDuration(t.wallSeconds) : "—", "Observed wall time") +
        stat(B.fmtNum(t.jobCount), "Jobs / line items") +
      "</div>"
    );

    parts.push(roundingExplainer(result));
    parts.push(multiplierExplainer(result));
    parts.push(driverCard(result));

    if (result.jobs.length) {
      parts.push(jobTable(result));
    }

    if (result.tips.length) {
      parts.push(tipsCard(result));
    }

    if (result.imageNotes.length) {
      parts.push(card("Screenshot", result.imageNotes.join(" "), "tip"));
    }

    els.output.innerHTML = parts.join("");
  }

  function stat(value, label) {
    return '<div class="stat"><b>' + escapeHtml(value) + "</b><span>" + escapeHtml(label) + "</span></div>";
  }

  function card(title, body, extraClass) {
    return (
      '<article class="card ' +
      (extraClass || "") +
      '"><h3>' +
      escapeHtml(title) +
      "</h3><p>" +
      body +
      "</p></article>"
    );
  }

  function roundingExplainer(result) {
    let body =
      "GitHub Actions bills each <em>started job</em> in whole minutes. A job that runs 12 seconds still bills 1 minute. " +
      "The rule is <code>ceil(duration_seconds / 60)</code> per job — not the sum of seconds across the workflow, then rounded once.";
    if (result && result.mode === "jobs") {
      body +=
        " This paste: " +
        Billshot.fmtNum(result.totals.wallMinutes, 1) +
        " minutes of wall time rounded to " +
        Billshot.fmtNum(result.totals.roundedMinutes) +
        " minutes" +
        (result.totals.shortJobs
          ? " (" +
            Billshot.fmtNum(result.totals.shortJobs) +
            " job" +
            (result.totals.shortJobs === 1 ? "" : "s") +
            " under 60s)."
          : ".");
    } else if (result) {
      body +=
        " Per-job durations were not in this paste, so rounding is already baked into the minutes you supplied.";
    }
    return card("1. Minute rounding", body, "");
  }

  function multiplierExplainer(result) {
    const bars = result
      ? osBars(result)
      : '<p class="empty">Linux 1× · Windows 2× · macOS 10× on included (plan) minutes.</p>';
    const body =
      "Included minutes are weighted by runner OS. Linux is 1×, Windows is 2×, macOS is 10×. " +
      "One wall minute on macOS consumes 10 plan minutes. Dollar list prices are a separate SKU table — Billshot reports included-minute burn, not an invoice." +
      bars;
    return card("2. OS multipliers", body, "os");
  }

  function osBars(result) {
    const billed = result.totals.billedMinutes || 1;
    return (
      '<div class="bars" aria-label="Included minutes by OS">' +
      bar("Linux 1×", "linux", result.os.linux.billedMinutes, billed) +
      bar("Windows 2×", "windows", result.os.windows.billedMinutes, billed) +
      bar("macOS 10×", "macos", result.os.macos.billedMinutes, billed) +
      "</div>"
    );
  }

  function bar(label, os, value, total) {
    const width = Math.max(0, Math.round((value / total) * 100));
    return (
      '<div class="bar-row"><span>' +
      escapeHtml(label) +
      '</span><div class="bar ' +
      os +
      '"><i style="width:' +
      width +
      '%"></i></div><span>' +
      Billshot.fmtNum(value) +
      "</span></div>"
    );
  }

  function driverCard(result) {
    if (!result.drivers.length) {
      return card("3. What likely drove the bill", "Nothing parsed yet.", "driver");
    }
    const items = result.drivers
      .map(function (d) {
        return (
          "<li><div class=\"sev " +
          escapeHtml(d.severity) +
          '">' +
          escapeHtml(d.severity) +
          "</div><h4>" +
          escapeHtml(d.title) +
          "</h4><p>" +
          escapeHtml(d.text) +
          "</p></li>"
        );
      })
      .join("");
    return (
      '<article class="card driver"><h3>3. What likely drove the bill</h3><ul class="driver-list">' +
      items +
      "</ul></article>"
    );
  }

  function jobTable(result) {
    const rows = result.jobs
      .map(function (job) {
        return (
          "<tr>" +
          "<td>" +
          escapeHtml(job.name) +
          (job.shortJob ? ' <span class="tag short">under 60s</span>' : "") +
          "</td>" +
          "<td>" +
          escapeHtml(job.runner) +
          "</td>" +
          '<td class="num">' +
          Billshot.formatDuration(job.durationSeconds) +
          "</td>" +
          '<td class="num">' +
          Billshot.fmtNum(job.roundedMinutes) +
          "</td>" +
          '<td class="num">' +
          job.multiplier +
          "×</td>" +
          '<td class="num">' +
          Billshot.fmtNum(job.billedMinutes) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      '<article class="card"><h3>Line items</h3><div class="table-wrap"><table class="jobs"><thead><tr>' +
      "<th>Job</th><th>Runner</th><th>Wall</th><th>Rounded</th><th>OS</th><th>Billed</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div></article>"
    );
  }

  function tipsCard(result) {
    const body = result.tips.map(function (tip) { return escapeHtml(tip); }).join(" ");
    return card(result.parsed ? "Notes" : "Could not parse that paste", body, "tip");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setImage(file) {
    if (!file) return;
    if (!file.type || file.type.indexOf("image/") !== 0) {
      if (/\.(csv|txt|md)$/i.test(file.name) || file.type.indexOf("text/") === 0) {
        const reader = new FileReader();
        reader.onload = function () {
          els.report.value = String(reader.result || "");
          run();
        };
        reader.readAsText(file);
        return;
      }
      return;
    }
    if (image && image.url) URL.revokeObjectURL(image.url);
    const url = URL.createObjectURL(file);
    image = { name: file.name, url: url };
    els.preview.src = url;
    els.preview.alt = "Preview of " + file.name;
    els.previewCaption.textContent = file.name + " — OCR not enabled in v0. Read minutes from the image and fill the fields.";
    els.previewWrap.classList.add("show");
    run();
  }

  function clearImage() {
    if (image && image.url) URL.revokeObjectURL(image.url);
    image = null;
    els.preview.removeAttribute("src");
    els.previewWrap.classList.remove("show");
    run();
  }

  els.sample.addEventListener("click", function () {
    els.report.value = Billshot.SAMPLE_REPORT;
    run();
    els.output.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  els.clear.addEventListener("click", function () {
    els.report.value = "";
    ["linuxMinutes", "windowsMinutes", "macosMinutes", "linuxJobs", "windowsJobs", "macosJobs"].forEach(function (key) {
      els[key].value = "";
    });
    clearImage();
  });

  els.explain.addEventListener("click", run);
  els.report.addEventListener("input", run);
  ["linuxMinutes", "windowsMinutes", "macosMinutes", "linuxJobs", "windowsJobs", "macosJobs"].forEach(function (key) {
    els[key].addEventListener("input", run);
  });

  els.drop.addEventListener("click", function () { els.file.click(); });
  els.file.addEventListener("change", function () {
    if (els.file.files && els.file.files[0]) setImage(els.file.files[0]);
  });

  ["dragenter", "dragover"].forEach(function (type) {
    els.drop.addEventListener(type, function (event) {
      event.preventDefault();
      els.drop.classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach(function (type) {
    els.drop.addEventListener(type, function (event) {
      event.preventDefault();
      els.drop.classList.remove("is-over");
    });
  });
  els.drop.addEventListener("drop", function (event) {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) setImage(file);
  });

  document.addEventListener("paste", function (event) {
    const items = event.clipboardData && event.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image/") === 0) {
        const file = items[i].getAsFile();
        if (file) setImage(file);
        break;
      }
    }
  });

  els.removeImage.addEventListener("click", function (event) {
    event.preventDefault();
    els.file.value = "";
    clearImage();
  });

  els.output.innerHTML = '<p class="empty">Paste a usage report, load the sample, or enter OS minutes. Nothing leaves this browser.</p>';
})();
