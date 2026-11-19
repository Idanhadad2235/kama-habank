// chat.js — the chat button: short answers by topic, and at the end a message to the site owner.
// The owner answers from the inbox page (#admin). The reply shows here on the same device,
// and is also emailed when the visitor left an email.

import { CHAT_TOPICS, faqById } from "./faq.js";
import { getBackend, store, newConvId, isEmail, phoneDigits, CONV_KEY, SEEN_KEY } from "./backend.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const paras = (text) => String(text).split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");

const CHAT_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z"></path></svg>';

let root, fab, dot, panel, logEl, footEl;
const S = {
  open: false,
  started: false,
  view: "topics",
  sending: false,
  error: null,
  lastTopic: "",
  draft: { msg: "", who: "", contact: "" },
  thread: null,
};

export function mountChat() {
  root = document.createElement("div");
  root.className = "chat";
  root.innerHTML = `
    <button type="button" class="chat-fab" aria-expanded="false" aria-controls="chat-panel">${CHAT_ICON}<span>שאלות?</span><span class="chat-dot" hidden><span class="sr-only">יש תשובה חדשה</span></span></button>
    <section id="chat-panel" class="chat-panel" role="dialog" aria-labelledby="chat-title" hidden>
      <header class="chat-head">
        <h2 id="chat-title">שאלות? כאן עונים</h2>
        <button type="button" class="icon-btn" data-chat="close" aria-label="סגירת הצ'אט">×</button>
      </header>
      <div class="chat-log" role="log" aria-live="polite"></div>
      <div class="chat-foot"></div>
      <p class="chat-demo tiny" hidden>גרסת בדיקה: ההודעות נשמרות רק במכשיר הזה.</p>
    </section>`;
  document.body.appendChild(root);
  fab = root.querySelector(".chat-fab");
  dot = root.querySelector(".chat-dot");
  panel = root.querySelector(".chat-panel");
  logEl = root.querySelector(".chat-log");
  footEl = root.querySelector(".chat-foot");
  if (getBackend() && getBackend().demo) root.querySelector(".chat-demo").hidden = false;

  fab.addEventListener("click", () => (S.open ? closeChat() : openChat()));
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("input", onInput);
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && S.open) { e.preventDefault(); closeChat(); }
  });
  checkUnread();
}

export async function openChat(opts = {}) {
  if (!root) return;
  S.open = true;
  panel.hidden = false;
  root.classList.add("open");
  fab.setAttribute("aria-expanded", "true");
  if (!S.started) {
    S.started = true;
    const had = await showThread();
    bot(had ? "אפשר להמשיך את השיחה, או לבחור נושא:" : "היי! במה אפשר לעזור? אפשר לבחור נושא:");
    setView("topics");
  }
  if (opts.form && canMessage() && S.view !== "form") {
    bot("אפשר לכתוב כאן, ונחזור אליך בהקדם.");
    setView("form");
  }
  markSeen();
  focusInPanel();
}

function closeChat() {
  S.open = false;
  panel.hidden = true;
  root.classList.remove("open");
  fab.setAttribute("aria-expanded", "false");
  fab.focus();
}

// ---- log ----

function bubble(who, html) {
  const el = document.createElement("div");
  el.className = `bubble ${who}`;
  el.innerHTML = html;
  logEl.appendChild(el);
  logEl.scrollTop = logEl.scrollHeight;
}
const bot = (text, extra = "") => bubble("bot", paras(text) + extra);
const me = (text) => bubble("me", paras(text));
const owner = (text) => bubble("owner", `<span class="bubble-by">תשובה</span>${paras(text)}`);

const canMessage = () => !!getBackend();

async function fetchThread() {
  const conv = store.get(CONV_KEY);
  if (!conv || !canMessage()) return [];
  const res = await getBackend().thread({ conv });
  return res && res.ok ? res.messages || [] : [];
}

async function showThread() {
  const msgs = S.thread || (await fetchThread());
  S.thread = msgs;
  if (!msgs.length) return false;
  const div = document.createElement("p");
  div.className = "chat-divider tiny";
  div.textContent = "השיחה שלך";
  logEl.appendChild(div);
  for (const m of msgs) (m.from === "owner" ? owner : me)(m.text);
  return true;
}

async function checkUnread() {
  const msgs = await fetchThread();
  S.thread = msgs;
  const last = msgs.filter((m) => m.from === "owner").pop();
  if (last && last.time > (store.get(SEEN_KEY) || "")) dot.hidden = false;
}

function markSeen() {
  const last = (S.thread || []).filter((m) => m.from === "owner").pop();
  if (last) store.set(SEEN_KEY, last.time);
  dot.hidden = true;
}

// ---- actions under the log ----

function chips(list) {
  return `<div class="chat-chips">${list.join("")}</div>`;
}
const chip = (attrs, label) => `<button type="button" class="chip-btn" ${attrs}>${esc(label)}</button>`;

function setView(view) {
  S.view = view;
  S.error = null;
  renderFoot();
}

function renderFoot() {
  const d = S.draft;
  if (S.view === "topics") {
    footEl.innerHTML = chips([
      ...CHAT_TOPICS.map(([id, label]) => chip(`data-topic="${id}"`, label)),
      ...(canMessage() ? [chip('data-chat="form"', "משהו אחר? להשאיר הודעה")] : []),
    ]);
  } else if (S.view === "after" || S.view === "sent") {
    footEl.innerHTML = chips([
      chip('data-chat="topics"', "שאלה אחרת"),
      ...(canMessage() ? [chip('data-chat="form"', S.view === "sent" ? "לכתוב עוד הודעה" : "לא מצאתי תשובה, להשאיר הודעה")] : []),
    ]);
  } else {
    footEl.innerHTML = `
    <form class="chat-form" novalidate>
      <label class="field"><span>ההודעה</span>
        <textarea name="msg" rows="3" maxlength="2000" required>${esc(d.msg)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>שם <small>(לא חובה)</small></span>
          <input name="who" maxlength="60" autocomplete="name" value="${esc(d.who)}"></label>
        <label class="field"><span>מייל או טלפון <small>(לא חובה)</small></span>
          <input name="contact" maxlength="100" autocomplete="email" value="${esc(d.contact)}"></label>
      </div>
      <input name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      <p class="tiny muted">בלי מייל, התשובה תופיע רק כאן בצ'אט, במכשיר הזה. לא לכתוב בהודעה מספר חשבון, תעודת זהות או סיסמה.</p>
      ${S.error ? `<p class="chat-error small" role="alert">${esc(S.error)}</p>` : ""}
      <div class="chat-form-row">
        <button type="submit" class="btn primary small" ${S.sending ? "disabled" : ""}>${S.sending ? "שולח..." : "שליחה"}</button>
        <button type="button" class="btn link small" data-chat="topics">חזרה לנושאים</button>
      </div>
    </form>`;
  }
}

function focusInPanel() {
  const el = S.view === "form" ? footEl.querySelector("textarea") : footEl.querySelector("button");
  (el || panel.querySelector("[data-chat=close]")).focus();
}

// ---- events ----

function onClick(e) {
  const t = e.target.closest("[data-topic], [data-chat]");
  if (!t) return;
  if (t.dataset.topic) {
    const f = faqById(t.dataset.topic);
    const label = t.textContent;
    S.lastTopic = label;
    me(label);
    const more = f.banks || f.id === "saving" ? `<p><a href="#faq" data-chat="faq">עוד פירוט בעמוד שאלות ותשובות</a></p>` : "";
    bot(f.a.join("\n"), more);
    setView("after");
    focusInPanel();
    return;
  }
  const a = t.dataset.chat;
  if (a === "close") return closeChat();
  if (a === "faq") { closeChat(); return; } // the link itself opens the page
  if (a === "topics") { setView("topics"); focusInPanel(); return; }
  if (a === "form" && canMessage()) {
    bot("אפשר לכתוב כאן, ונחזור אליך בהקדם.");
    setView("form");
    focusInPanel();
  }
}

function onInput(e) {
  const el = e.target;
  if (el.form && el.form.matches(".chat-form") && el.name in S.draft) S.draft[el.name] = el.value;
}

async function onSubmit(e) {
  const f = e.target;
  if (!f.matches(".chat-form")) return;
  e.preventDefault();
  const msg = f.elements.msg.value.trim();
  const who = f.elements.who.value.trim();
  const contact = f.elements.contact.value.trim();
  const hp = f.elements.website.value;
  if (!msg) { S.error = "צריך לכתוב הודעה."; renderFoot(); footEl.querySelector("textarea").focus(); return; }
  if (contact && !isEmail(contact) && !phoneDigits(contact)) { S.error = "המייל או הטלפון לא נראים תקינים."; renderFoot(); footEl.querySelector("[name=contact]").focus(); return; }
  S.sending = true;
  S.error = null;
  renderFoot();
  const conv = store.get(CONV_KEY) || newConvId();
  const res = await getBackend().send({ conv, name: who, contact, topic: S.lastTopic, text: msg, hp });
  S.sending = false;
  if (!res || !res.ok) {
    S.error = res && res.error === "rate_limited" ? "נשלחו הרבה הודעות ברצף. אפשר לנסות שוב בעוד כמה דקות." : "לא הצלחנו לשלוח. אפשר לנסות שוב.";
    renderFoot();
    return;
  }
  store.set(CONV_KEY, conv);
  S.draft = { msg: "", who, contact };
  if (S.thread) S.thread.push({ from: "visitor", text: msg, time: new Date().toISOString() });
  me(msg);
  bot(isEmail(contact)
    ? `ההודעה נשלחה. התשובה תגיע למייל ${contact}, ותופיע גם כאן בצ'אט, במכשיר הזה.`
    : contact
      ? "ההודעה נשלחה. נחזור אליך בוואטסאפ או בטלפון שהשארת, והתשובה תופיע גם כאן בצ'אט, במכשיר הזה."
      : "ההודעה נשלחה. התשובה תופיע כאן בצ'אט, במכשיר הזה.");
  setView("sent");
  focusInPanel();
}
