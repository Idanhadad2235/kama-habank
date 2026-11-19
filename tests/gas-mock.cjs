// gas-mock.cjs — runs backend/Code.gs in Node with stand-ins for the Google Apps Script services.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

function createGas() {
  const rows = [];
  const props = {};
  const cache = {};
  const sent = [];
  let sheetExists = false;

  const sheet = {
    appendRow(values) {
      rows.push(values.map((v) => {
        const s = String(v);
        if (s.startsWith("'")) return s.slice(1); // a leading apostrophe means "text", and is not part of the value
        if (/^[=+\-@]/.test(s)) return { FORMULA: s }; // would run as a formula: must never happen
        if (/^[\d.]+$/.test(s)) return Number(s); // plain digits turn into a number
        return s;
      }));
    },
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map((r) => r.slice()) }),
    setFrozenRows() {},
  };
  const ss = {
    getId: () => "sheet-1",
    getSheetByName: (n) => (sheetExists && n === "הודעות" ? sheet : null),
    insertSheet: () => { sheetExists = true; return sheet; },
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    MailApp: { sendEmail: (m) => { sent.push(m); } },
    Session: { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) },
    Utilities: { getUuid: () => crypto.randomUUID() },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }) },
    Logger: { log() {} },
    console: { error() {}, log: console.log },
    Date, JSON, String, Number, Object, Math,
  };
  vm.createContext(ctx);
  const file = [path.join(__dirname, "../backend/Code.gs"), path.join(__dirname, "../../backend/Code.gs")].find((f) => fs.existsSync(f));
  const code = fs.readFileSync(file, "utf8");
  vm.runInContext(code, ctx, { filename: "Code.gs" });
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  return { ctx, rows, props, cache, sent, post, clearCache: () => { for (const k of Object.keys(cache)) delete cache[k]; } };
}

module.exports = { createGas };
