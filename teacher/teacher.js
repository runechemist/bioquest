const elCode = document.getElementById("classCode");
const elMastery = document.getElementById("mastery");
const elAttempts = document.getElementById("attempts");
const elInfinite = document.getElementById("infiniteLives");
const elResults = document.getElementById("results");

function currentCode() {
  return (elCode.value || "").trim().toUpperCase();
}

document.getElementById("newCodeBtn").addEventListener("click", () => {
  elCode.value = BQ.randomClassCode();
  loadSettings();
  renderResults();
});

document.getElementById("saveBtn").addEventListener("click", () => {
  const code = currentCode();
  if (!code) return alert("Enter a Class Code first.");

  const settings = {
    classCode: code,
    masteryAccuracy: Number(elMastery.value || 70),
    attemptsAllowed: Number(elAttempts.value || 3),
    infiniteLives: elInfinite.value === "true",
    worldEnabled: { world1: true }
  };

  BQ.saveClassSettings(code, settings);
  alert("Saved.");
});

document.getElementById("refreshBtn").addEventListener("click", renderResults);

document.getElementById("clearBtn").addEventListener("click", () => {
  const code = currentCode();
  if (!code) return alert("Enter a Class Code first.");
  if (!confirm("Clear all results stored in THIS browser for this class code?")) return;
  BQ.clearResults(code);
  renderResults();
});

document.getElementById("exportBtn").addEventListener("click", () => {
  const code = currentCode();
  if (!code) return alert("Enter a Class Code first.");
  const all = BQ.readAllResults(code);
  const rows = [];

  rows.push([
    "studentId","levelId","completed","reason","score","answered","correct","accuracy","attempt",
    "durationMs","atISO","masteryMet"
  ].join(","));

  for (const [studentId, attempts] of Object.entries(all)) {
    for (const r of attempts) {
      rows.push([
        csv(studentId),
        csv(r.levelId),
        r.completed,
        csv(r.reason),
        r.score,
        r.answered,
        r.correct,
        r.accuracy,
        r.attempt,
        r.durationMs,
        csv(r.atISO),
        r.masteryMet
      ].join(","));
    }
  }

  download(`bioquest_${code}_results.csv`, rows.join("\n"));
});

function csv(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadSettings() {
  const code = currentCode();
  if (!code) return;
  const s = BQ.getClassSettings(code);
  elMastery.value = s.masteryAccuracy ?? 70;
  elAttempts.value = s.attemptsAllowed ?? 3;
  elInfinite.value = String(!!s.infiniteLives);
}

function renderResults() {
  const code = currentCode();
  if (!code) {
    elResults.innerHTML = `<div class="small">Enter a Class Code to view results.</div>`;
    return;
  }

  loadSettings();

  const all = BQ.readAllResults(code);
  const students = Object.keys(all).sort();

  if (students.length === 0) {
    elResults.innerHTML = `<div class="small">No results yet for ${code} (in this browser).</div>`;
    return;
  }

  let html = `<div class="small">Showing results stored in this browser for <strong>${code}</strong>.</div>`;
  html += `<div style="overflow:auto; margin-top:10px;">`;
  html += `<table style="width:100%; border-collapse:collapse;">`;
  html += `<tr>
    <th style="text-align:left; padding:8px; border-bottom:1px solid #222;">Student</th>
    <th style="text-align:left; padding:8px; border-bottom:1px solid #222;">Last Attempt</th>
    <th style="text-align:left; padding:8px; border-bottom:1px solid #222;">Best Accuracy</th>
    <th style="text-align:left; padding:8px; border-bottom:1px solid #222;">Attempts</th>
  </tr>`;

  for (const studentId of students) {
    const attempts = all[studentId] || [];
    const last = attempts[attempts.length - 1];
    const bestAcc = Math.max(...attempts.map(a => a.accuracy ?? 0), 0);
    html += `<tr>
      <td style="padding:8px; border-bottom:1px solid #1b1b1b;">${escapeHtml(studentId)}</td>
      <td style="padding:8px; border-bottom:1px solid #1b1b1b;">${escapeHtml(last.levelId)} | ${last.accuracy}% | ${escapeHtml(last.atISO)}</td>
      <td style="padding:8px; border-bottom:1px solid #1b1b1b;">${bestAcc}%</td>
      <td style="padding:8px; border-bottom:1px solid #1b1b1b;">${attempts.length}</td>
    </tr>`;
  }

  html += `</table></div>`;
  elResults.innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

elCode.addEventListener("input", () => { loadSettings(); renderResults(); });
renderResults();
