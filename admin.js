// admin.js — the inbox page (#admin): the site owner reads chat messages and replies.
// In live mode it asks once for the admin code (sent to the owner by email at setup) and keeps it on this device.

import { getBackend, store, isEmail, phoneDigits, ADMIN_KEY } from "./backend.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const paras = (text) => String(text).split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");
const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
};

export function renderAdminShell() {
  return `<header class="top">
    <a href="#" class="back-link" data-action="close-page">→ חזרה לאתר</a>
    <h1 tabindex="-1">תיבת ההודעות</h1>
  </header>
  <div id="admin-root" class="stack"><p class="muted">טוען...</p></div>`;
}

let el = null;
const A = { key: null, list: [], error: null, notice: null, busy: false, drafts: {} };

export async function mountAdmin(container) {
  el = container;
  const backend = getBackend();
  if (!backend) {
    el.innerHTML = `<div class="card"><p>תיבת ההודעות עוד לא מחוברת. אחרי החיבור, ההודעות מהצ'אט יופיעו כאן.</p></div>`;
    return;
  }
  A.key = backend.demo ? "demo" : store.get(ADMIN_KEY);
  A.error = null;
  A.notice = null;
  el.addEventListener("submit", onSubmit);
  el.addEventListener("click", onClick);
  el.addEventListener("input", (e) => { if (e.target.dataset.reply) A.drafts[e.target.dataset.reply] = e.target.value; });
  if (!A.key) return draw();
  await refresh();
}

async function refresh() {
  A.busy = true;
  const res = await getBackend().adminList({ key: A.key });
  A.busy = false;
  if (res && res.ok) {
    A.list = res.conversations || [];
    A.error = null;
  } else if (res && res.error === "unauthorized") {
    store.del(ADMIN_KEY);
    A.key = null;
    A.error = "הקוד לא נכון.";
  } else {
    A.error = "לא הצלחנו לטעון את ההודעות. אפשר לנסות שוב.";
  }
  draw();
}

function draw() {
  if (!el || !el.isConnected) return;
  const demo = getBackend().demo;
  if (!A.key) {
    el.innerHTML = `<form class="card" data-form="login">
      <h2>כניסה</h2>
      <p class="muted small">את קוד הניהול קיבלת במייל כשהגדרנו את תיבת ההודעות.</p>
      <label class="field"><span>קוד ניהול</span><input type="password" name="key" autocomplete="current-password" required></label>
      ${A.error ? `<p class="chat-error small" role="alert">${esc(A.error)}</p>` : ""}
      <button type="submit" class="btn primary small">כניסה</button>
    </form>`;
    return;
  }
  const head = `<div class="admin-bar">
    ${demo ? `<p class="small muted">גרסת בדיקה: כאן רואים רק הודעות שנשלחו מהמכשיר הזה.</p>` : ""}
    <div class="chips-row">
      <button type="button" class="btn small secondary" data-admin="refresh">רענון</button>
      ${demo ? "" : `<button type="button" class="btn small link" data-admin="logout">יציאה</button>`}
    </div>
    ${A.notice ? `<p class="small" role="status">${esc(A.notice)}</p>` : ""}
    ${A.error ? `<p class="chat-error small" role="alert">${esc(A.error)}</p>` : ""}
  </div>`;
  if (!A.list.length) {
    el.innerHTML = head + `<div class="card"><p class="muted">אין עדיין הודעות.</p></div>`;
    return;
  }
  el.innerHTML = head + A.list.map(convCard).join("");
}

function convCard(c) {
  const last = c.messages[c.messages.length - 1];
  const waiting = last && last.from === "visitor";
  const phone = phoneDigits(c.contact);
  const email = isEmail(c.contact);
  const contactLine = c.contact
    ? email ? `<a href="mailto:${esc(c.contact)}">${esc(c.contact)}</a>` : phone ? esc(c.contact) : esc(c.contact)
    : "בלי פרטי קשר";
  const draft = A.drafts[c.conv] || "";
  const wa = phone ? `https://wa.me/972${phone.slice(1)}?text=${encodeURIComponent(draft)}` : null;
  return `<article class="card conv">
    <div class="f-head">
      <div><h2>${esc(c.name || "בלי שם")}</h2><p class="muted small">${contactLine}${c.topic ? " · " + esc(c.topic) : ""}</p></div>
      ${waiting ? `<span class="chip amber">מחכה לתשובה</span>` : `<span class="chip green">ענית</span>`}
    </div>
    <div class="conv-log">${c.messages.map((m) => `<div class="bubble ${m.from === "owner" ? "me" : "bot"}">${m.from === "owner" ? `<span class="bubble-by">אתה</span>` : ""}${paras(m.text)}<span class="bubble-time tiny">${esc(when(m.time))}</span></div>`).join("")}</div>
    <form class="stack" data-form="reply" data-conv="${esc(c.conv)}">
      <label class="field"><span>התשובה שלך</span><textarea rows="3" name="text" data-reply="${esc(c.conv)}" required>${esc(draft)}</textarea></label>
      <p class="tiny muted">${email ? "התשובה תישלח גם למייל של הפונה." : phone ? "לפונה אין מייל. אפשר לענות כאן, וגם לשלוח לו את התשובה בוואטסאפ." : "לפונה אין פרטי קשר. התשובה תופיע לו בצ'אט, אם ייכנס שוב מאותו מכשיר."}</p>
      <div class="chips-row">
        <button type="submit" class="btn primary small" ${A.busy ? "disabled" : ""}>שליחת תשובה</button>
        ${wa ? `<a class="btn small secondary" href="${esc(wa)}" target="_blank" rel="noopener" data-wa="${esc(c.conv)}">לענות בוואטסאפ</a>` : ""}
      </div>
    </form>
  </article>`;
}

async function onSubmit(e) {
  const f = e.target;
  if (f.dataset.form === "login") {
    e.preventDefault();
    A.key = f.elements.key.value.trim();
    if (!A.key) return;
    await refresh();
    if (A.key) store.set(ADMIN_KEY, A.key);
    return;
  }
  if (f.dataset.form === "reply") {
    e.preventDefault();
    const conv = f.dataset.conv;
    const text = f.elements.text.value.trim();
    if (!text) return;
    A.busy = true;
    draw();
    const res = await getBackend().adminReply({ key: A.key, conv, text });
    A.busy = false;
    if (res && res.ok) {
      A.drafts[conv] = "";
      A.notice = res.emailed ? "התשובה נשמרה ונשלחה במייל." : "התשובה נשמרה.";
      await refresh();
    } else {
      A.error = res && res.error === "unauthorized" ? "הקוד לא נכון." : "לא הצלחנו לשלוח את התשובה. אפשר לנסות שוב.";
      draw();
    }
  }
}

async function onClick(e) {
  const b = e.target.closest("[data-admin], [data-wa]");
  if (!b) return;
  if (b.dataset.wa) {
    // Keep the WhatsApp text in step with what was typed.
    const draft = A.drafts[b.dataset.wa] || "";
    b.href = b.href.replace(/text=[^&]*/, "text=" + encodeURIComponent(draft));
    return;
  }
  if (b.dataset.admin === "refresh") { A.notice = null; await refresh(); }
  if (b.dataset.admin === "logout") { store.del(ADMIN_KEY); A.key = null; A.list = []; draw(); }
}
