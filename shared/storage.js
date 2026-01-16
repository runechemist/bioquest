/* Local-first storage (patched)
   - Fixes crash when stored JSON parses to null (e.g., "null")
   - Adds defensive checks so results/settings always resolve to objects
*/

(function () {
  const KEY_PREFIX = "bioquest_v1";

  function k(...parts) {
    return [KEY_PREFIX, ...parts].join(":");
  }

  function isPlainObject(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
  }

  function safeParse(json, fallback) {
    try {
      const v = JSON.parse(json);
      // JSON.parse("null") returns null — treat as invalid and use fallback
      if (v === null || v === undefined) return fallback;
      return v;
    } catch {
      return fallback;
    }
  }

  // ---------- Class Settings ----------
  window.BQ = window.BQ || {};

  BQ.getClassSettings = function (classCode) {
    const raw = localStorage.getItem(k("class", classCode, "settings"));
    const fallback = {
      classCode,
      masteryAccuracy: 70,
      attemptsAllowed: 3,          // assessment mode
      infiniteLives: false,        // practice mode
      worldEnabled: { world1: true }
    };

    const s = safeParse(raw, fallback);
    // If corrupted, reset to fallback
    if (!isPlainObject(s)) {
      localStorage.setItem(k("class", classCode, "settings"), JSON.stringify(fallback));
      return fallback;
    }
    return { ...fallback, ...s };
  };

  BQ.saveClassSettings = function (classCode, settings) {
    const fallback = BQ.getClassSettings(classCode);
    const s = isPlainObject(settings) ? { ...fallback, ...settings } : fallback;
    localStorage.setItem(k("class", classCode, "settings"), JSON.stringify(s));
  };

  // ---------- Results ----------
  BQ.writeResult = function (classCode, studentId, resultObj) {
    const key = k("class", classCode, "results");
    const raw = localStorage.getItem(key);

    let all = safeParse(raw, {});
    if (!isPlainObject(all)) all = {};

    // Ensure student bucket is an array
    if (!Array.isArray(all[studentId])) all[studentId] = [];
    all[studentId].push(resultObj);

    localStorage.setItem(key, JSON.stringify(all));
  };

  BQ.readAllResults = function (classCode) {
    const key = k("class", classCode, "results");
    const v = safeParse(localStorage.getItem(key), {});
    return isPlainObject(v) ? v : {};
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
