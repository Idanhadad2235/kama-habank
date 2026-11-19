// app.js — the page: upload, review the numbers, results, download. Plus the Q&A, legal and inbox pages.
import { readPdfFile } from "./extract.js";
import { parseBankReport, parseMortgageReport } from "./parser.js";
import { analyze, ils, pct, STATUS, LOAN_SOURCES } from "./analysis.js";
import { BENCHMARKS as B } from "./benchmarks.js";
import { PARTNERS } from "./partners.js";
import { CONFIG } from "./config.js";
import { BANK_PATHS } from "./faq.js";
import { PAGES } from "./pages.js";
import { renderAdminShell, mountAdmin } from "./admin.js";
import { mountChat, openChat } from "./chat.js";
import { getBackend } from "./backend.js";
import { emptyData, fromParsed, mergeData, isDuplicate, toNumber } from "./data.js";
import { summaryPng, summaryPdf } from "./summary.js";

const app = document.getElementById("app");
const statusEl = document.getElementById("status");

const CARD_COMPANY_NAMES = ["כאל", "ישראכרט", "מקס", "כרטיס בנקאי", "אחר"];
const FEE_CATEGORIES = [
  ["account", "עו״ש"],
  ["creditAllocation", "הקצאת אשראי"],
  ["card", "דמי כרטיס"],
  ["fx", "מטבע חוץ"],
  ["securities", "ניירות ערך"],
  ["loan", "הלוואות"],
];
const TRACK_OPTIONS = [
  ["fixedUnlinked", "קבועה לא צמודה"],
  ["prime", "פריים"],
  ["fixedLinked", "קבועה צמודה"],
  ["variableUnlinked", "משתנה לא צמודה"],
  ["variableLinked", "משתנה צמודה"],
];

const state = {
  stage: "start",
  files: { report: null, mortgage: null },
  data: emptyData(),
  notice: null,
  error: null,
  busy: null,
  result: null,
  manual: false,
  adding: false, // uploading a second account that joins the same summary
  msgEdits: {},
};

// ---------- helpers ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const v = (x) => (x == null || x === "" ? "" : String(x));

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

const ICONS = {
  minus: '<circle cx="12" cy="12" r="9"></circle><path d="M8 12h8"></path>',
  bank: '<path d="M3 10l9-6 9 6"></path><path d="M5 10v8"></path><path d="M10 10v8"></path><path d="M14 10v8"></path><path d="M19 10v8"></path><path d="M3 20h18"></path>',
  card: '<rect x="3" y="6" width="18" height="12" rx="2"></rect><path d="M3 10h18"></path>',
  globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9"></path><path d="M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9"></path>',
  house: '<path d="M4 11l8-7 8 7"></path><path d="M6 10v10h12V10"></path>',
  chart: '<path d="M4 19h16"></path><path d="M7 15l4-4 3 3 5-6"></path>',
  loan: '<path d="M4 7h16v10H4z"></path><circle cx="12" cy="12" r="2.5"></circle>',
  upload: '<path d="M12 16V4"></path><path d="M7 9l5-5 5 5"></path><path d="M5 20h14"></path>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path>',
  share: '<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M12 3v12"></path><path d="M7 8l5-5 5 5"></path>',
};
const icon = (name, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d ? `${Number(d)}.${Number(m)}.${y}` : `${Number(m)}/${y}`;
}

// Big numbers: the ₪ stays on the same line as the number.
const big = (x) => ils(x).replace(" ₪", "\u00A0₪");

const banksOf = (meta) => (meta.banks && meta.banks.length ? meta.banks : meta.bank ? [meta.bank] : []);

function announce(text) {
  if (!statusEl) return;
  statusEl.textContent = "";
  setTimeout(() => { statusEl.textContent = text; }, 50);
}

// ---------- start ----------

function renderStart() {
  const r = state.files.report;
  const m = state.files.mortgage;
  const adding = state.adding;
  const banks = banksOf(state.data.meta);
  return `
  <header class="top">
    <h1 tabindex="-1">${adding ? "מוסיפים חשבון נוסף" : "כמה הבנק לוקח לי?"}</h1>
    <p class="muted">${adding
      ? `הדוח של החשבון הנוסף יתווסף לסיכום${banks.length ? " של " + esc(banks.join(" + ")) : ""}. אחר כך בודקים את המספרים, ורואים סיכום אחד לכל החשבונות.`
      : "מעלים את תעודת הזהות הבנקאית ורואים מה אתם משלמים לבנק, איפה זה מעל הממוצע וכמה אפשר לחסוך."}</p>
  </header>
  ${state.error ? `<div class="card alert" role="alert"><p>${esc(state.error)}</p>${state.errorManual && !adding ? `<button type="button" class="btn secondary" data-action="manual">להמשיך בהזנה ידנית</button>` : ""}</div>` : ""}
  <section class="card">
    <h2>1. תעודת הזהות הבנקאית${adding ? " של החשבון הנוסף" : ""}</h2>
    <p class="muted">הדוח המפורט (בחלק מהבנקים נקרא "מורחב") או המקוצר, כקובץ PDF.</p>
    <label class="drop ${r ? "has" : ""}">
      <input type="file" accept="application/pdf,.pdf" data-file="report">
      ${icon("upload", 24)}
      <span>${r ? esc(r.name) : "בחירת קובץ"}</span>
    </label>
    <details class="how">
      <summary>איפה מוצאים את הדוח?</summary>
      <ul>${BANK_PATHS.map(([b, p]) => `<li><b>${esc(b)}:</b> ${esc(p)}</li>`).join("")}</ul>
    </details>
  </section>
  <section class="card">
    <h2>2. הדוח השנתי של המשכנתא <span class="muted small">(לא חובה)</span></h2>
    <p class="muted">אם יש ${adding ? "בחשבון הזה" : "לך"} משכנתא, הדוח הזה מגיע בנפרד ובו המסלולים והריביות.</p>
    <label class="drop ${m ? "has" : ""}">
      <input type="file" accept="application/pdf,.pdf" data-file="mortgage">
      ${icon("upload", 24)}
      <span>${m ? esc(m.name) : "בחירת קובץ"}</span>
    </label>
  </section>
  <p class="privacy">${icon("lock", 18)} הדוחות נקראים בתוך הדפדפן שלך ולא נשלחים לשום מקום. כשסוגרים את העמוד, הנתונים נמחקים.</p>
  <button type="button" class="btn primary big" data-action="analyze" ${r && !state.busy ? "" : "disabled"}>${state.busy ? esc(state.busy) : adding ? "להוסיף לסיכום" : "לנתח את הדוח"}</button>
  ${adding
    ? `<button type="button" class="btn link" data-action="cancel-add">ביטול, חזרה לתוצאות</button>`
    : `<button type="button" class="btn link" data-action="manual">אין לי דוח, אני רוצה להזין ידנית</button>`}
  ${footer()}`;
}

// ---------- review ----------

function badge(path) {
  return state.data.found.has(path) ? `<span class="found">מהדוח</span>` : "";
}

function numField(label, path, opts = {}) {
  const val = getPath(state.data, path);
  return `<label class="field">
    <span>${esc(label)} ${badge(opts.found || path)}</span>
    <input type="text" inputmode="decimal" data-path="${esc(path)}" value="${esc(v(val))}" placeholder="${esc(opts.placeholder || "")}" autocomplete="off">
    ${opts.hint ? `<small class="muted">${esc(opts.hint)}</small>` : ""}
  </label>`;
}

function select(path, options, val, label) {
  return `<select data-path="${esc(path)}" ${label ? `aria-label="${esc(label)}"` : ""}>${options.map(([k, l]) => `<option value="${k}" ${k === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
}

function renderReview() {
  const d = state.data;
  const banks = banksOf(d.meta);
  const metaLine = banks.length > 1
    ? `בסיכום ${banks.length} חשבונות: ${banks.join(", ")}${d.meta.year ? ". שנת " + d.meta.year : ""}.`
    : d.meta.bank || d.meta.year
      ? `מצאנו בדוח: ${[d.meta.bank ? "בנק " + d.meta.bank : null, d.meta.year ? "שנת " + d.meta.year : null].filter(Boolean).join(", ")}.`
      : "";
  // Fee types the report lists with 0 ₪ do not change the result, so they are only counted.
  const isZero = (f) => f.fromFile && Number(f.annual) === 0;
  const zeroFees = d.fees.filter(isZero).length;
  const feeRows = d.fees.map((f, i) => (isZero(f) ? "" : `
    <div class="row-edit">
      <input type="text" class="grow" data-path="fees.${i}.name" value="${esc(f.name)}" placeholder="שם העמלה" aria-label="שם העמלה">
      <input type="text" inputmode="decimal" class="amount" data-path="fees.${i}.annual" value="${esc(v(f.annual))}" placeholder="₪ בשנה" aria-label="סכום בשנה">
      ${select(`fees.${i}.category`, FEE_CATEGORIES, f.category, "סוג העמלה")}
      <button type="button" class="icon-btn" data-action="del" data-list="fees" data-i="${i}" aria-label="מחיקת העמלה">×</button>
    </div>`)).join("");
  const cardRows = d.cards.entries.map((e, i) => `
    <div class="sub">
      <div class="sub-head"><b>${esc(e.company)}</b>
        <button type="button" class="icon-btn" data-action="del" data-list="cards.entries" data-i="${i}" aria-label="מחיקת הכרטיס של ${esc(e.company)}">×</button></div>
      <div class="grid2">
        ${numField("דמי כרטיס לחודש (₪)", `cards.entries.${i}.monthlyFee`)}
        ${numField("ריבית קרדיט בשנה (₪)", `cards.entries.${i}.creditInterest`)}
        ${numField("קניות במט״ח בשנה (₪)", `cards.entries.${i}.fxSpend`)}
        ${numField("עמלת מט״ח (%)", `cards.entries.${i}.fxRate`, { placeholder: `בדרך כלל ${B.fxCardTypical.value}` })}
      </div>
      <label class="check"><input type="checkbox" data-path="cards.entries.${i}.checked" ${e.checked ? "checked" : ""}> בדקתי, אין בכרטיס הזה תשלומים כאלה</label>
    </div>`).join("");
  const loanRows = d.loans.map((l, i) => {
    const fromFile = l.source === "report";
    return `
    <div class="sub">
      <div class="sub-head"><input type="text" class="grow" data-path="loans.${i}.name" value="${esc(l.name || "")}" placeholder="שם ההלוואה (לא חובה)" aria-label="שם ההלוואה">
        <button type="button" class="icon-btn" data-action="del" data-list="loans" data-i="${i}" aria-label="מחיקת ההלוואה">×</button></div>
      ${fromFile
        ? `<p class="small muted">הלוואה מהבנק <span class="found">מהדוח</span></p>`
        : `<label class="field"><span>מאיפה ההלוואה</span>${select(`loans.${i}.source`, LOAN_SOURCES, l.source)}</label>`}
      <div class="grid3">
        ${numField("יתרה (₪)", `loans.${i}.balance`)}
        ${numField("ריבית (%)", `loans.${i}.rate`)}
        ${numField("שנים שנשארו", `loans.${i}.years`)}
      </div>
    </div>`;
  }).join("");
  const loansFromFile = d.loans.some((l) => l.source === "report");
  const mortRows = d.mortgage.map((m, i) => `
    <div class="sub">
      <div class="sub-head">${select(`mortgage.${i}.track`, TRACK_OPTIONS, m.track, "מסלול")}
        <button type="button" class="icon-btn" data-action="del" data-list="mortgage" data-i="${i}" aria-label="מחיקת המסלול">×</button></div>
      <div class="grid3">
        ${numField("יתרה (₪)", `mortgage.${i}.balance`)}
        ${numField("ריבית היום (%)", `mortgage.${i}.rate`)}
        ${numField("שנים שנשארו", `mortgage.${i}.years`)}
      </div>
    </div>`).join("");
  const companyButtons = CARD_COMPANY_NAMES.map((c) => `<button type="button" class="btn small secondary" data-action="add-card" data-company="${esc(c)}">${esc(c)}</button>`).join("");

  return `
  <header class="top">
    <h1 tabindex="-1">בודקים את המספרים</h1>
    <p class="muted">${esc(metaLine)} בדוק שהמספרים נכונים, תקן אם צריך והשלם את מה שחסר. שדה ריק לא נכלל בחישוב.</p>
  </header>
  ${state.notice ? `<div class="card note-card" role="status"><p>${esc(state.notice)}</p></div>` : ""}

  <details class="card section" ${state.manual || d.overdraft.interestPaid || d.found.has("overdraft.interestPaid") ? "open" : ""}>
    <summary><h2>מינוס</h2></summary>
    ${numField("ריבית ששילמת על מינוס בשנה (₪)", "overdraft.interestPaid")}
    <div class="grid2">
      ${numField("ריבית המינוס (%)", "overdraft.rate")}
      ${numField("יתרת חובה ממוצעת (₪)", "overdraft.avgDebit")}
    </div>
  </details>

  <details class="card section" ${state.manual || d.fees.length ? "open" : ""} id="sec-fees">
    <summary><h2>עמלות</h2></summary>
    ${d.feeTotal != null ? `<p class="muted small">סה״כ עמלות בדוח: ${ils(d.feeTotal)} ${badge("feeTotal")}</p>` : ""}
    ${feeRows}
    ${zeroFees ? `<p class="muted small">בדוח מופיעים עוד ${zeroFees} סוגי פעולות שלא שילמת עליהם עמלה.</p>` : ""}
    ${!d.fees.length ? `<p class="muted">${state.manual ? "אפשר להוסיף כל עמלה ששילמת." : "לא מצאנו פירוט עמלות בדוח."}</p>` : ""}
    <button type="button" class="btn small secondary" data-action="add-fee">הוספת עמלה</button>
  </details>

  <details class="card section" open id="sec-cards">
    <summary><h2>כרטיסי אשראי</h2></summary>
    <p class="muted small">דמי כרטיס, קרדיט ועמלות מט״ח של כרטיסים מחברות אשראי לא מופיעים בדוח של הבנק. אפשר למצוא אותם באפליקציה של חברת האשראי.</p>
    ${cardRows}
    <div class="chips-row"><span class="muted small">הוספת כרטיס:</span> ${companyButtons}</div>
  </details>

  <details class="card section" ${state.manual || d.loans.length ? "open" : ""} id="sec-loans">
    <summary><h2>הלוואות</h2>${state.manual ? "" : `<span class="sum-hint">גם הלוואות שלא בדוח</span>`}</summary>
    ${state.manual
      ? `<p class="muted small">אפשר להוסיף כל הלוואה: מהבנק, מבנק אחר, מחברת כרטיס אשראי או מגוף חוץ בנקאי. משכנתא מוסיפים בסעיף הבא.</p>`
      : `${loansFromFile ? "" : `<p class="muted small">לא מצאנו בדוח הלוואות מהבנק${d.mortgageBalance ? ", חוץ מהמשכנתא" : ""}.</p>`}
    <p class="muted small">הלוואות מבנק אחר, מחברת כרטיס אשראי או מגוף חוץ בנקאי לא מופיעות בדוח של הבנק. יש לך הלוואה כזאת? אפשר להוסיף אותה כאן, ונבדוק אם הריבית שלה מעל הממוצע.</p>`}
    ${loanRows}
    <button type="button" class="btn small secondary" data-action="add-loan">${state.manual ? "הוספת הלוואה" : "הוספת הלוואה שלא מופיעה בדוח"}</button>
  </details>

  <details class="card section" ${state.manual || d.mortgage.length || d.mortgageBalance ? "open" : ""} id="sec-mortgage">
    <summary><h2>משכנתא</h2></summary>
    ${d.mortgageBalance ? `<p class="small">יתרת המשכנתא בדוח: <b>${ils(d.mortgageBalance)}</b> ${badge("mortgageBalance")}</p>
    <p class="muted small">את המסלולים והריביות אפשר למצוא בדוח השנתי של המשכנתא, או באתר הבנק.</p>` : ""}
    ${mortRows}
    <p class="muted small">בפריים כותבים את הריבית שמשלמים היום. ריבית הפריים היום היא ${pct(B.prime.value)}</p>
    <button type="button" class="btn small secondary" data-action="add-track">הוספת מסלול</button>
  </details>

  <details class="card section" ${state.manual || d.securities.custodyRate || d.securities.value ? "open" : ""}>
    <summary><h2>ניירות ערך</h2></summary>
    <div class="grid2">
      ${numField("דמי משמרת בשנה (%)", "securities.custodyRate")}
      ${numField("שווי התיק (₪)", "securities.value")}
    </div>
  </details>

  <section class="card">
    <h2>קצת עליך</h2>
    <p class="muted small">לא חובה. זה עוזר להציע הטבות שמגיעות לך.</p>
    <label class="check"><input type="checkbox" data-path="profile.student" ${d.profile.student ? "checked" : ""}> סטודנט או סטודנטית</label>
    <label class="check"><input type="checkbox" data-path="profile.soldier" ${d.profile.soldier ? "checked" : ""}> בשירות צבאי סדיר</label>
    <label class="check"><input type="checkbox" data-path="profile.senior" ${d.profile.senior ? "checked" : ""}> אזרח ותיק או אזרחית ותיקה</label>
    <label class="check"><input type="checkbox" data-path="profile.disabled" ${d.profile.disabled ? "checked" : ""}> אדם עם מוגבלות (נכות 40% ומעלה)</label>
  </section>

  <button type="button" class="btn primary big" data-action="results">לתוצאות</button>
  <button type="button" class="btn link" data-action="restart">להתחיל מחדש</button>
  ${footer()}`;
}

// ---------- results ----------

function chip(status) {
  const cls = status === "above" ? "amber" : status === "ok" ? "gray" : "green";
  return `<span class="chip ${cls}">${esc(STATUS[status] || "")}</span>`;
}

function partnerBox(p) {
  return `<div class="partner">
    <div><p class="muted tiny">קישור שותפים · האתר מקבל עמלה</p><p class="pname">${esc(p.name)}${p.offer ? " · " + esc(p.offer) : ""}</p></div>
    <a class="btn small primary" href="${esc(p.url)}" target="_blank" rel="sponsored noopener">לפרטים</a>
  </div>`;
}

function messageBox(f) {
  if (!f.message) return "";
  const id = `msg-${f.id}`;
  const text = state.msgEdits[f.id] ?? f.message.text;
  return `<details class="how msg">
    <summary>הודעה מוכנה ${esc(f.message.to)}</summary>
    <p class="muted small">אפשר לשנות את הנוסח, להעתיק אותו ולשלוח בצ'אט שבאפליקציה או במייל.</p>
    <textarea id="${id}" data-msg="${esc(f.id)}" rows="6" aria-label="נוסח ההודעה ${esc(f.message.to)}">${esc(text)}</textarea>
    <button type="button" class="btn small primary" data-action="copy" data-target="${id}">העתקה</button>
  </details>`;
}

function findingCard(f) {
  const how = f.status === "cancel" ? "איך מבטלים" : f.status === "above" ? "מה עושים" : "איך חוסכים";
  return `<article class="card finding">
    <div class="f-head">
      <div class="f-title">${icon(f.icon)}<h2>${esc(f.title)}</h2></div>
      ${chip(f.status)}
    </div>
    <p>${esc(f.lead)}</p>
    ${f.items && f.items.length ? `<ul class="items">${f.items.map(([n, a]) => `<li><span>${esc(n)}</span><b>${esc(a)}</b></li>`).join("")}</ul>` : ""}
    ${f.compare ? `<div class="grid2">${f.compare.map(([l, x]) => `<div class="tile"><p class="muted tiny">${esc(l)}</p><p class="tile-v">${esc(x)}</p></div>`).join("")}</div>` : ""}
    ${f.note ? `<p class="muted small">${esc(f.note)}</p>` : ""}
    ${(f.partners || []).map(partnerBox).join("")}
    ${f.tips && f.tips.length ? `<details class="how"><summary>${how}</summary><ol>${f.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ol></details>` : ""}
    ${messageBox(f)}
  </article>`;
}

function shareHref() {
  const url = CONFIG.siteUrl || location.origin + location.pathname;
  const text = `בדקתי כמה הבנק לוקח לי. אפשר לבדוק גם אצלך, והדוח לא יוצא מהטלפון: ${url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function renderResults() {
  const r = state.result;
  const d = state.data;
  const p = r.paid;
  const banks = banksOf(d.meta);
  const anyPartner = r.findings.some((f) => (f.partners || []).length);
  const sources = [B.overdraftAvg, B.householdLoanAvg, B.mortgage, B.custodyBanksAvg, B.prime, B.fxCardTypical, B.debitCardCap]
    .map((x) => x.source)
    .filter((s, i, arr) => arr.findIndex((y) => y.url === s.url) === i);
  const cardsMissing = r.missing.some((m) => m.id.startsWith("card-"));
  const paidNotes = [
    p.estimate ? "הריבית על הלוואות ועל המשכנתא היא הערכה, לפי היתרה והריבית." : null,
    p.mortgageMissing ? "בלי ריבית המשכנתא, כי חסרים המסלולים שלה." : null,
    cardsMissing ? "בלי חברות האשראי שלא הוזנו להן נתונים." : null,
  ].filter(Boolean);
  return `
  <header class="top row">
    <div>
      <h1 tabindex="-1">כמה הבנק לוקח לי?</h1>
      <p class="muted small">${banks.length ? esc(banks.join(" + ")) + " · " : ""}${d.meta.year ? "דוח " + esc(d.meta.year) + " · " : ""}נתוני השוואה מעודכנים ל-${fmtDate(B.updated)}</p>
    </div>
    <button type="button" class="icon-btn big" data-action="restart" aria-label="לבדוק דוח חדש מההתחלה">${icon("upload", 20)}</button>
  </header>

  <section class="card summary">
    <h2 class="sum-title">כמה שילמת בשנה</h2>
    <div class="grid2">
      <div class="tile"><p class="muted tiny">עמלות ודמי כרטיס</p><p class="big-num ink">${big(p.fees)}</p></div>
      <div class="tile"><p class="muted tiny">ריביות</p><p class="big-num ink">${big(p.interest)}</p></div>
    </div>
    ${paidNotes.length ? `<p class="muted small">${esc(paidNotes.join(" "))}</p>` : ""}
  </section>

  <section class="card summary">
    <h2 class="sum-title">חיסכון אפשרי</h2>
    <div class="grid2">
      <div class="tile accent"><p class="tiny">בשנה</p><p class="big-num">${big(r.yearly)}</p></div>
      ${r.total > 0 ? `<div class="tile"><p class="muted tiny">עד סוף ההלוואות</p><p class="big-num ink">${big(r.total)}</p></div>` : ""}
    </div>
    <p class="muted small">${r.findings.length} ממצאים${r.missing.length ? ` · ${r.missing.length} ${r.missing.length === 1 ? "נושא לא נמצא" : "נושאים לא נמצאו"} בדוח` : ""}</p>
  </section>

  ${r.findings.map(findingCard).join("")}

  ${r.okNotes.length ? `<section class="card"><h2>מה בסדר אצלך</h2><ul class="oks">${r.okNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>` : ""}

  ${r.missing.length ? `<section class="card dashed"><h2>לא נמצא בדוח</h2>${r.missing.map((m) => `<p>${esc(m.text)}</p>`).join("")}
    <button type="button" class="btn small secondary" data-action="back">להשלים את הנתונים</button></section>` : ""}

  <section class="downloads">
    <button type="button" class="btn primary" data-action="pdf">הורדה כ-PDF</button>
    <button type="button" class="btn secondary" data-action="png">הורדה כתמונה</button>
  </section>
  ${state.notice ? `<p class="muted small center" role="status">${esc(state.notice)}</p>` : ""}
  <a class="btn secondary wide" href="${esc(shareHref())}" target="_blank" rel="noopener">${icon("share", 20)} שיתוף האתר בוואטסאפ</a>

  <section class="card next">
    <h2>בודקים עוד תעודת זהות בנקאית?</h2>
    <div class="stack">
      <button type="button" class="btn primary" data-action="restart">לבדוק דוח חדש מההתחלה</button>
      <button type="button" class="btn secondary" data-action="add-report">להוסיף חשבון נוסף לסיכום</button>
    </div>
    <p class="muted small">בדוח חדש, הנתונים של הדוח הזה נמחקים מהמסך, אז כדאי להוריד קודם את הסיכום. חשבון נוסף, למשל בבנק אחר, מצטרף לאותו סיכום.</p>
  </section>

  <section class="sources">
    <p class="muted small">מקורות ההשוואה:</p>
    <ul>${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join("")}</ul>
  </section>
  ${footer(anyPartner)}`;
}

function footer(partners = false) {
  return `<footer class="foot muted small">
    <nav class="foot-links" aria-label="מידע על האתר">
      <a href="#faq">שאלות ותשובות</a><a href="#terms">תנאי שימוש</a><a href="#privacy">פרטיות</a><a href="#accessibility">נגישות</a>
    </nav>
    <p>המידע אינו ייעוץ פיננסי. החיסכון בהלוואות ובמשכנתא הוא הערכה.${partners ? " הצעות השותפים הן לא השוואה של כל השוק, ועל חלק מהקישורים האתר מקבל עמלה." : ""}</p>
    ${getBackend() && getBackend().demo ? `<p><a href="#admin">תיבת ההודעות שלך (בגרסת הבדיקה)</a></p>` : ""}
  </footer>`;
}

// ---------- flow ----------

const PAGE_IDS = ["faq", "terms", "privacy", "accessibility", "admin"];
const pageFromHash = () => {
  const h = decodeURIComponent(location.hash.replace(/^#/, ""));
  return PAGE_IDS.includes(h) ? h : null;
};

function render() {
  const page = pageFromHash();
  document.body.classList.toggle("no-chat", page === "admin"); // the inbox is for the site owner
  if (page === "admin") {
    app.innerHTML = renderAdminShell() + footer();
    mountAdmin(document.getElementById("admin-root"));
    return;
  }
  if (page) {
    app.innerHTML = PAGES[page]() + footer();
    return;
  }
  app.innerHTML = state.stage === "start" ? renderStart() : state.stage === "review" ? renderReview() : renderResults();
}

function focusHeading() {
  const h = app.querySelector("h1");
  if (h) h.focus({ preventScroll: true });
}

function go(stage) {
  state.stage = stage;
  if (pageFromHash()) history.replaceState(null, "", location.pathname + location.search);
  render();
  window.scrollTo(0, 0);
  focusHeading();
}

async function readMortgage(file, into) {
  try {
    const mp = await readPdfFile(file);
    const mm = parseMortgageReport(mp.pages);
    if (mm.recognized) {
      into.mortgage = mm.tracks.map((t) => ({ track: t.track, balance: t.balance, rate: t.rate, years: "" }));
      return `מצאנו בדוח המשכנתא ${mm.tracks.length} מסלולים. בדוק שהם נכונים והוסף כמה שנים נשארו.`;
    }
    return "לא הצלחנו לקרוא את המסלולים מדוח המשכנתא. אפשר להזין אותם ידנית בסעיף משכנתא.";
  } catch (e) {
    return "לא הצלחנו לפתוח את דוח המשכנתא. אפשר להזין את המסלולים ידנית.";
  }
}

async function doAnalyze() {
  state.error = null;
  state.errorManual = false;
  state.busy = "קורא את הדוח...";
  render();
  try {
    const { pages, textLength } = await readPdfFile(state.files.report);
    if (textLength < 40) {
      state.busy = null;
      state.error = "הקובץ הזה נראה סרוק, בלי טקסט. האתר לא יכול לקרוא אותו, אבל אפשר להזין את המספרים ידנית.";
      state.errorManual = true;
      return render();
    }
    const model = parseBankReport(pages);
    if (!model.recognized) {
      state.busy = null;
      state.error = "לא זיהינו בקובץ תעודת זהות בנקאית. בדוק שהעלית את הדוח השנתי מהבנק, או המשך בהזנה ידנית.";
      state.errorManual = true;
      return render();
    }
    const next = fromParsed(model);
    if (state.adding && isDuplicate(state.data, next)) {
      state.busy = null;
      state.error = "נראה שזה אותו דוח שכבר נמצא בסיכום. אפשר להעלות את הדוח של החשבון האחר.";
      return render();
    }
    const notes = [];
    if (state.files.mortgage) notes.push(await readMortgage(state.files.mortgage, next));
    if (state.adding) {
      state.data = mergeData(state.data, next);
      state.adding = false;
      notes.unshift(`הוספנו את הדוח${next.meta.bank ? " של " + next.meta.bank : ""} לסיכום. בדוק את המספרים ולחץ שוב "לתוצאות".`);
    } else {
      state.data = next;
      state.manual = false;
    }
    state.notice = notes.length ? notes.join(" ") : null;
    state.busy = null;
    go("review");
  } catch (e) {
    state.busy = null;
    state.error = e && e.code === "password"
      ? "הקובץ נעול בסיסמה. שמור אותו מחדש בלי סיסמה, או הזן את המספרים ידנית."
      : "לא הצלחנו לפתוח את הקובץ. בדוק שזה קובץ PDF, או המשך בהזנה ידנית.";
    state.errorManual = true;
    render();
  }
}

function analysisInput() {
  const d = state.data;
  return {
    ...d,
    loans: d.loans.map((l) => ({ ...l, balance: toNumber(l.balance), rate: toNumber(l.rate), monthsLeft: toNumber(l.years) ? toNumber(l.years) * 12 : null })),
    mortgage: d.mortgage.map((m) => ({ ...m, balance: toNumber(m.balance), rate: toNumber(m.rate), monthsLeft: toNumber(m.years) ? toNumber(m.years) * 12 : null })),
    fees: d.fees.map((f) => ({ ...f, annual: toNumber(f.annual) })),
    overdraft: Object.fromEntries(Object.entries(d.overdraft).map(([k, x]) => [k, toNumber(x)])),
    securities: Object.fromEntries(Object.entries(d.securities).map(([k, x]) => [k, toNumber(x)])),
    cards: { ...d.cards, entries: d.cards.entries.map((e) => ({ ...e, monthlyFee: toNumber(e.monthlyFee), fxSpend: toNumber(e.fxSpend), fxRate: toNumber(e.fxRate) || (toNumber(e.fxSpend) ? B.fxCardTypical.value : ""), creditInterest: toNumber(e.creditInterest) })) },
  };
}

async function saveFile(blob, filename) {
  const cl = window.claude;
  if (cl && typeof cl.use === "function") {
    try {
      const dl = await cl.use("downloads");
      if (dl) {
        await dl.save({ filename, data: blob });
        return "saved";
      }
    } catch (e) {
      if (e && e.code === "declined") return "declined";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  return "saved";
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) { /* fall back below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

function resetAll() {
  state.files = { report: null, mortgage: null };
  state.data = emptyData();
  state.result = null;
  state.notice = null;
  state.error = null;
  state.manual = false;
  state.adding = false;
  state.msgEdits = {};
}

// ---------- events ----------

app.addEventListener("change", (e) => {
  const el = e.target;
  if (el.dataset.file) {
    state.files[el.dataset.file] = el.files && el.files[0] ? el.files[0] : null;
    state.error = null;
    render();
    return;
  }
  if (el.dataset.path) {
    if (el.type === "checkbox") setPath(state.data, el.dataset.path, el.checked);
    else if (el.tagName === "SELECT") setPath(state.data, el.dataset.path, el.value);
  }
});

app.addEventListener("input", (e) => {
  const el = e.target;
  if (el.dataset.path && el.type === "text") setPath(state.data, el.dataset.path, el.value);
  if (el.dataset.msg) state.msgEdits[el.dataset.msg] = el.value;
});

app.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const a = btn.dataset.action;
  const d = state.data;
  if (a === "close-page") {
    e.preventDefault();
    location.hash = "";
    return;
  }
  if (a === "open-chat") return openChat({ form: true });
  if (a === "analyze") return doAnalyze();
  if (a === "manual") { state.data = emptyData(); state.manual = true; state.error = null; state.notice = null; return go("review"); }
  if (a === "restart") { resetAll(); return go("start"); }
  if (a === "add-report") {
    state.adding = true;
    state.files = { report: null, mortgage: null };
    state.error = null;
    state.notice = null;
    return go("start");
  }
  if (a === "cancel-add") { state.adding = false; state.error = null; return go(state.result ? "results" : "review"); }
  if (a === "back") { state.notice = null; return go("review"); }
  if (a === "results") {
    state.result = analyze(analysisInput(), B, PARTNERS);
    state.notice = null;
    state.msgEdits = {};
    return go("results");
  }
  if (a === "add-fee") { d.fees.push({ name: "", annual: "", category: "account" }); return render(); }
  if (a === "add-loan") { d.loans.push({ name: "", balance: "", rate: "", years: "", source: state.manual ? "bank" : "otherBank" }); return render(); }
  if (a === "add-track") { d.mortgage.push({ track: "fixedUnlinked", balance: "", rate: "", years: "" }); return render(); }
  if (a === "add-card") {
    const c = btn.dataset.company;
    d.cards.entries.push({ company: c, monthlyFee: "", fxSpend: "", fxRate: "", creditInterest: "", checked: false });
    if (!d.cards.companies.includes(c) && c !== "אחר") d.cards.companies.push(c);
    return render();
  }
  if (a === "del") {
    const list = getPath(d, btn.dataset.list);
    const removed = list.splice(Number(btn.dataset.i), 1)[0];
    if (btn.dataset.list === "cards.entries" && removed) d.cards.companies = d.cards.companies.filter((c) => c !== removed.company || d.cards.entries.some((x) => x.company === c));
    return render();
  }
  if (a === "copy") {
    const ta = document.getElementById(btn.dataset.target);
    if (!ta) return;
    const ok = await copyText(ta.value);
    if (ok) {
      btn.textContent = "הועתק";
      announce("ההודעה הועתקה");
      setTimeout(() => { btn.textContent = "העתקה"; }, 2000);
    } else {
      ta.focus();
      ta.select();
      btn.textContent = "הטקסט מסומן, אפשר להעתיק";
      announce("לא הצלחנו להעתיק. הטקסט מסומן, ואפשר להעתיק אותו ידנית.");
    }
    return;
  }
  if (a === "pdf" || a === "png") {
    btn.disabled = true;
    const meta = { year: d.meta.year, bank: banksOf(d.meta).join(" + ") };
    try {
      const blob = a === "pdf" ? await summaryPdf(state.result, meta, B) : await summaryPng(state.result, meta, B);
      const name = `כמה-הבנק-לוקח-לי-${String(d.meta.year || "סיכום").replace(/[,\s]+/g, "-")}.${a}`;
      const res = await saveFile(blob, name);
      state.notice = res === "declined" ? "ההורדה בוטלה." : null;
    } catch (err) {
      state.notice = "לא הצלחנו ליצור את הקובץ. נסה שוב.";
    }
    render();
  }
});

window.addEventListener("hashchange", () => {
  render();
  window.scrollTo(0, 0);
  focusHeading();
});

function initAnalytics() {
  if (!CONFIG.analyticsToken) return;
  const s = document.createElement("script");
  s.defer = true;
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", JSON.stringify({ token: CONFIG.analyticsToken }));
  document.head.appendChild(s);
}

render();
mountChat();
initAnalytics();
