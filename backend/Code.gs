/**
 * כמה הבנק לוקח לי? · תיבת ההודעות של הצ'אט
 *
 * Runs in Google Apps Script, inside a Google Sheet that belongs to the site owner.
 * Visitors' messages are saved in the sheet, the owner gets an email for each new message,
 * and the owner's replies (from the site's #admin page) are saved and emailed to visitors who left an email.
 *
 * Setup (once):
 *   1. Create a Google Sheet. Extensions → Apps Script. Paste this file instead of the empty code.
 *   2. Fill SITE_URL below with the site's address.
 *   3. Choose the function "setup" and press Run. Approve the permissions.
 *      The admin code is emailed to you (and written to the log).
 *   4. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
 *      Copy the web app URL into config.js (messagesUrl).
 */

const SITE_URL = ""; // e.g. "https://kama-habank.co.il/"
const SITE_NAME = "כמה הבנק לוקח לי?";
const SHEET = "הודעות";
const HEAD = ["זמן", "שיחה", "מי", "שם", "פרטי קשר", "נושא", "הודעה"];

const LIMITS = { text: 2000, reply: 4000, name: 60, contact: 100, topic: 80 };
const RATE = { perConv: 5, all: 60, windowSec: 600 };

// ---------- setup ----------

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(HEAD);
  sh.setFrozenRows(1);
  const props = PropertiesService.getScriptProperties();
  props.setProperty("SHEET_ID", ss.getId());
  let key = props.getProperty("ADMIN_KEY");
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").slice(0, 32);
    props.setProperty("ADMIN_KEY", key);
  }
  const owner = Session.getEffectiveUser().getEmail();
  props.setProperty("OWNER_EMAIL", owner);
  MailApp.sendEmail({
    to: owner,
    subject: "קוד הניהול של תיבת ההודעות",
    body: "זה קוד הניהול של תיבת ההודעות באתר " + SITE_NAME + ":\n\n" + key +
      "\n\nבפעם הראשונה שנכנסים לעמוד הניהול (" + adminLink_() + ") מקלידים את הקוד, והוא נשמר במכשיר. לא לשתף אותו.",
    name: SITE_NAME,
  });
  Logger.log("קוד הניהול: " + key);
}

// ---------- web app ----------

function doGet() {
  return json_({ ok: true, service: "messages" });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ ok: false, error: "bad_request" });
  }
  try {
    switch (req.action) {
      case "send": return json_(send_(req));
      case "thread": return json_(thread_(req));
      case "admin_list": return json_(adminList_(req));
      case "admin_reply": return json_(adminReply_(req));
      default: return json_({ ok: false, error: "unknown_action" });
    }
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: "server_error" });
  }
}

// ---------- actions ----------

function send_(req) {
  const conv = str_(req.conv, 40);
  if (!/^[a-z0-9]{16,40}$/.test(conv)) return { ok: false, error: "bad_request" };
  if (str_(req.hp, 200)) return { ok: true }; // the hidden field was filled: a bot. Say ok, keep nothing.
  const text = str_(req.text, LIMITS.text);
  if (!text) return { ok: false, error: "empty" };
  if (!allow_("c_" + conv, RATE.perConv, RATE.windowSec) || !allow_("all", RATE.all, RATE.windowSec)) {
    return { ok: false, error: "rate_limited" };
  }
  const name = str_(req.name, LIMITS.name);
  const contact = str_(req.contact, LIMITS.contact);
  const topic = str_(req.topic, LIMITS.topic);
  const time = new Date().toISOString();
  append_([time, conv, "visitor", name, contact, topic, text]);
  try {
    const owner = prop_("OWNER_EMAIL");
    if (owner) {
      const mail = {
        to: owner,
        subject: "הודעה חדשה באתר" + (topic ? ": " + topic : ""),
        body: (name || "בלי שם") + (contact ? " · " + contact : "") + "\n\n" + text + "\n\nלענות: " + adminLink_(),
        name: SITE_NAME,
      };
      if (isEmail_(contact)) mail.replyTo = contact;
      MailApp.sendEmail(mail);
    }
  } catch (err) {
    console.error(err); // the message is saved even if the email quota ran out
  }
  return { ok: true };
}

function thread_(req) {
  const conv = str_(req.conv, 40);
  if (!/^[a-z0-9]{16,40}$/.test(conv)) return { ok: false, error: "bad_request" };
  const messages = rows_()
    .filter((r) => r.conv === conv)
    .map((r) => ({ from: r.from, text: r.text, time: r.time }));
  return { ok: true, messages };
}

function adminList_(req) {
  if (!checkKey_(req.key)) return { ok: false, error: "unauthorized" };
  const byConv = {};
  for (const r of rows_()) {
    const c = byConv[r.conv] || (byConv[r.conv] = { conv: r.conv, name: "", contact: "", topic: "", messages: [], last: "" });
    if (r.from === "visitor") {
      if (r.name) c.name = r.name;
      if (r.contact) c.contact = r.contact;
      if (r.topic && !c.topic) c.topic = r.topic;
    }
    c.messages.push({ from: r.from, text: r.text, time: r.time });
    if (r.time > c.last) c.last = r.time;
  }
  const conversations = Object.keys(byConv).map((k) => byConv[k]).sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 200);
  return { ok: true, conversations };
}

function adminReply_(req) {
  if (!checkKey_(req.key)) return { ok: false, error: "unauthorized" };
  const conv = str_(req.conv, 40);
  const text = str_(req.text, LIMITS.reply);
  if (!/^[a-z0-9]{16,40}$/.test(conv) || !text) return { ok: false, error: "bad_request" };
  const rows = rows_().filter((r) => r.conv === conv);
  if (!rows.length) return { ok: false, error: "not_found" };
  let contact = "";
  for (const r of rows) if (r.from === "visitor" && r.contact) contact = r.contact;
  append_([new Date().toISOString(), conv, "owner", "", "", "", text]);
  let emailed = false;
  if (isEmail_(contact)) {
    try {
      MailApp.sendEmail({
        to: contact,
        subject: "תשובה מ" + SITE_NAME,
        body: text + "\n\nאפשר לראות את התשובה גם בצ'אט באתר, באותו מכשיר שממנו נשלחה ההודעה." + (SITE_URL ? "\n" + SITE_URL : ""),
        name: SITE_NAME,
      });
      emailed = true;
    } catch (err) {
      console.error(err);
    }
  }
  return { ok: true, emailed };
}

// ---------- helpers ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function prop_(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}

function sheet_() {
  const id = prop_("SHEET_ID");
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET);
}

// Text from the visitor: trimmed, without control characters, cut to a length.
function str_(v, max) {
  return String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
}

// A leading apostrophe keeps a cell as plain text: a value that starts with = + - @ would run as a formula,
// and a phone number like 0501234567 would turn into a number and lose its leading zero.
function cell_(v) {
  const s = String(v == null ? "" : v);
  return /^[=+\-@\t\r]/.test(s) || /^[\d\s().\/-]+$/.test(s) ? "'" + s : s;
}

function append_(values) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow(values.map(cell_));
  } finally {
    lock.releaseLock();
  }
}

function rows_() {
  const values = sheet_().getDataRange().getValues();
  return values.slice(1).map((v) => ({
    time: v[0] instanceof Date ? v[0].toISOString() : String(v[0]),
    conv: String(v[1]),
    from: String(v[2]) === "owner" ? "owner" : "visitor",
    name: String(v[3] || ""),
    contact: String(v[4] || ""),
    topic: String(v[5] || ""),
    text: String(v[6] || ""),
  }));
}

function allow_(key, max, windowSec) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key) || 0);
  if (n >= max) return false;
  cache.put(key, String(n + 1), windowSec);
  return true;
}

function checkKey_(key) {
  // The code is 32 random characters, so guessing it is not practical.
  const real = prop_("ADMIN_KEY");
  return !!real && String(key || "") === real;
}

function isEmail_(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
}

function adminLink_() {
  return SITE_URL ? SITE_URL.replace(/#.*$/, "") + "#admin" : "עמוד הניהול באתר (#admin)";
}
