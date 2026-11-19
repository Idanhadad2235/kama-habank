// Tests for backend/Code.gs (the chat inbox), run with stand-in Google services. Run: node tests/backend.test.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createGas } = require("./gas-mock.cjs");

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
const conv = "abcdefghij0123456789xyzw";

t("setup creates the sheet, a 32-character admin code, and emails it to the owner", () => {
  const g = createGas();
  g.ctx.setup();
  assert.equal(g.rows.length, 1); // header row
  assert.match(g.props.ADMIN_KEY, /^[a-f0-9]{32}$/);
  assert.equal(g.props.OWNER_EMAIL, "owner@example.com");
  assert.equal(g.sent.length, 1);
  assert.ok(g.sent[0].body.includes(g.props.ADMIN_KEY));
});

function ready() { const g = createGas(); g.ctx.setup(); g.sent.length = 0; return g; }

t("a visitor message is saved and the owner gets an email with reply-to", () => {
  const g = ready();
  const r = g.post({ action: "send", conv, name: "דנה", contact: "dana@example.com", topic: "כרטיסי אשראי", text: "שאלה על דמי כרטיס" });
  assert.deepEqual(r, { ok: true });
  assert.equal(g.rows.length, 2);
  assert.equal(g.rows[1][2], "visitor");
  assert.equal(g.sent.length, 1);
  assert.equal(g.sent[0].to, "owner@example.com");
  assert.equal(g.sent[0].replyTo, "dana@example.com");
  assert.ok(g.sent[0].body.includes("שאלה על דמי כרטיס"));
});

t("the visitor sees only the messages of their own conversation, without contact details", () => {
  const g = ready();
  g.post({ action: "send", conv, contact: "dana@example.com", text: "שלום" });
  g.post({ action: "send", conv: "zzzzzzzzzzzzzzzzzzzz", text: "שיחה אחרת" });
  const r = g.post({ action: "thread", conv });
  assert.equal(r.messages.length, 1);
  assert.deepEqual(Object.keys(r.messages[0]).sort(), ["from", "text", "time"]);
});

t("admin list needs the right code", () => {
  const g = ready();
  g.post({ action: "send", conv, text: "שלום" });
  assert.equal(g.post({ action: "admin_list", key: "wrong" }).error, "unauthorized");
  assert.equal(g.post({ action: "admin_list" }).error, "unauthorized");
  const r = g.post({ action: "admin_list", key: g.props.ADMIN_KEY });
  assert.equal(r.ok, true);
  assert.equal(r.conversations.length, 1);
});

t("owner reply is saved, emailed to a visitor with email, and shows in the visitor's thread", () => {
  const g = ready();
  g.post({ action: "send", conv, contact: "dana@example.com", text: "שלום" });
  g.sent.length = 0;
  const r = g.post({ action: "admin_reply", key: g.props.ADMIN_KEY, conv, text: "היי דנה, הנה התשובה" });
  assert.deepEqual(r, { ok: true, emailed: true });
  assert.equal(g.sent[0].to, "dana@example.com");
  const th = g.post({ action: "thread", conv });
  assert.equal(th.messages[1].from, "owner");
  assert.equal(th.messages[1].text, "היי דנה, הנה התשובה");
});

t("reply to a visitor without email is saved but not emailed", () => {
  const g = ready();
  g.post({ action: "send", conv, contact: "050-1234567", text: "שלום" });
  g.sent.length = 0;
  const r = g.post({ action: "admin_reply", key: g.props.ADMIN_KEY, conv, text: "תשובה" });
  assert.deepEqual(r, { ok: true, emailed: false });
  assert.equal(g.sent.length, 0);
});

t("reply with a wrong code or to an unknown conversation is refused", () => {
  const g = ready();
  assert.equal(g.post({ action: "admin_reply", key: "x", conv, text: "a" }).error, "unauthorized");
  assert.equal(g.post({ action: "admin_reply", key: g.props.ADMIN_KEY, conv, text: "a" }).error, "not_found");
});

t("formulas are stored as text, phone numbers keep their leading zero", () => {
  const g = ready();
  g.post({ action: "send", conv, name: "=HYPERLINK(\"http://x\")", contact: "0501234567", topic: "+1", text: "-2+3" });
  const row = g.rows[1];
  assert.ok(row.every((c) => typeof c !== "object"), "no cell may become a formula");
  assert.equal(row[4], "0501234567");
  const list = g.post({ action: "admin_list", key: g.props.ADMIN_KEY });
  assert.equal(list.conversations[0].contact, "0501234567");
  assert.equal(list.conversations[0].name, "=HYPERLINK(\"http://x\")");
});

t("honeypot: a bot that fills the hidden field gets ok, nothing is saved", () => {
  const g = ready();
  const r = g.post({ action: "send", conv, text: "spam", hp: "http://spam" });
  assert.deepEqual(r, { ok: true });
  assert.equal(g.rows.length, 1);
  assert.equal(g.sent.length, 0);
});

t("rate limit: 5 messages per conversation per 10 minutes", () => {
  const g = ready();
  for (let i = 0; i < 5; i++) assert.equal(g.post({ action: "send", conv, text: "m" + i }).ok, true);
  assert.equal(g.post({ action: "send", conv, text: "m6" }).error, "rate_limited");
  g.clearCache();
  assert.equal(g.post({ action: "send", conv, text: "after" }).ok, true);
});

t("bad input is refused: empty text, bad conversation id, unknown action, broken JSON", () => {
  const g = ready();
  assert.equal(g.post({ action: "send", conv, text: "   " }).error, "empty");
  assert.equal(g.post({ action: "send", conv: "short", text: "x" }).error, "bad_request");
  assert.equal(g.post({ action: "thread", conv: "../x" }).error, "bad_request");
  assert.equal(g.post({ action: "nope" }).error, "unknown_action");
  const raw = JSON.parse(g.ctx.doPost({ postData: { contents: "{not json" } }).content);
  assert.equal(raw.error, "bad_request");
});

t("long text is cut to the limit", () => {
  const g = ready();
  g.post({ action: "send", conv, text: "א".repeat(5000) });
  assert.equal(g.rows[1][6].length, 2000);
});

console.log(`\n${n} tests passed`);
