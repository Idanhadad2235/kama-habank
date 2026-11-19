// backend.js — where chat messages go.
// With CONFIG.messagesUrl set, messages go to the site owner's Google Apps Script inbox (backend/Code.gs).
// Without it (test mode), they are kept in this browser only, so the whole flow can be tried on one device.

import { CONFIG } from "./config.js";

const mem = {};
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] ?? null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } },
};

export function newConvId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join("") + Date.now().toString(36);
}

export const CONV_KEY = "kbl_chat_conv";
export const SEEN_KEY = "kbl_chat_seen";
export const ADMIN_KEY = "kbl_admin_key";

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
export function phoneDigits(s) {
  let d = String(s || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (d.startsWith("972")) d = "0" + d.slice(3);
  return /^0\d{8,9}$/.test(d) ? d : null;
}

// ---- test mode: this browser only ----
const DEMO_KEY = "kbl_demo_inbox";
const now = () => new Date().toISOString();
function load() {
  try { return JSON.parse(store.get(DEMO_KEY) || "{}"); } catch (e) { return {}; }
}
function save(db) { store.set(DEMO_KEY, JSON.stringify(db)); }

const demoBackend = {
  demo: true,
  async send({ conv, name, contact, topic, text }) {
    const db = load();
    const c = db[conv] || (db[conv] = { name: "", contact: "", topic: "", messages: [] });
    if (name) c.name = name;
    if (contact) c.contact = contact;
    if (topic && !c.topic) c.topic = topic;
    c.messages.push({ from: "visitor", text, time: now() });
    save(db);
    return { ok: true };
  },
  async thread({ conv }) {
    const c = load()[conv];
    return { ok: true, messages: c ? c.messages : [] };
  },
  async adminList() {
    const db = load();
    const conversations = Object.entries(db)
      .map(([conv, c]) => ({ conv, name: c.name, contact: c.contact, topic: c.topic, messages: c.messages, last: c.messages.length ? c.messages[c.messages.length - 1].time : "" }))
      .sort((a, b) => (a.last < b.last ? 1 : -1));
    return { ok: true, conversations };
  },
  async adminReply({ conv, text }) {
    const db = load();
    const c = db[conv];
    if (!c) return { ok: false, error: "not_found" };
    c.messages.push({ from: "owner", text, time: now() });
    save(db);
    return { ok: true, emailed: false };
  },
};

// ---- live mode: the Apps Script web app ----
function scriptBackend(url) {
  async function call(action, payload) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      // A plain string body is sent as text/plain, so the browser does not need a CORS preflight.
      const res = await fetch(url, { method: "POST", body: JSON.stringify({ action, ...payload }), signal: ctl.signal, redirect: "follow" });
      return await res.json();
    } catch (e) {
      return { ok: false, error: "network" };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    demo: false,
    send: (p) => call("send", p),
    thread: (p) => call("thread", p),
    adminList: (p) => call("admin_list", p),
    adminReply: (p) => call("admin_reply", p),
  };
}

let backend = null;
export function getBackend() {
  if (backend === null) backend = CONFIG.messagesUrl ? scriptBackend(CONFIG.messagesUrl) : CONFIG.testInbox ? demoBackend : false;
  return backend || null; // null = no inbox yet: the chat gives answers only
}
// For tests.
export function setBackend(b) { backend = b; }
