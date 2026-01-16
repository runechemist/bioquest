/* Local-first storage.
   - Class settings saved per classCode
   - Student results stored in the browser (localStorage)
   If you later want central reporting, swap these functions for server calls.
*/

(function () {
  const KEY_PREFIX = "bioquest_v1";

  function k(...parts) { return [KEY_PREFIX, ...parts].join(":"); }

  function safeParse(json, fallback) {
    try { return JSON.parse(json); } catch { return fallback; }
  }

  // ---------- Class Settings ----------
  window.BQ = window.BQ || {};

  BQ.getClassSettings = function (classCode) {
    const raw = localStorage.getItem(k("class", classCode, "settings"));
    return safeParse(raw, {
      classCode,
      masteryAccuracy: 70,
      attemptsAllowed: 3,          // assessment mode
      infiniteLives: false,        // practice mode
      worldEnabled: { "world1": true }
    });
  };

  BQ.saveClassSettings = function (classCode, settings) {
    localStorage.setItem(k("class", classCode, "settings"), JSON.stringify(settings));
  };

  // ---------- Results ----------
  BQ.writeResult = function (classCode, studentId, resultObj) {
    const key = k("class", classCode, "results");
    const raw = localStorage.getItem(key);
    const all = safeParse(raw, {});
    all[studentId] = all[studentId] || [];
    all[studentId].push(resultObj);
    localStorage.setItem(key, JSON.stringify(all));
  };

  BQ.readAllResults = function (classCode) {
    const key = k("class", classCode, "results");
    return safeParse(localStorage.getItem(key), {});
  };

  BQ.clearResults = function (classCode) {
    localStorage.removeItem(k("class", classCode, "results"));
  };

  // ---------- Utilities ----------
  BQ.randomClassCode = function () {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };
})();
