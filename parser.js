// parser.js — reads the text of an Israeli "banking ID" annual report (תעודת זהות בנקאית)
// and of a housing-loan annual report, and returns a normalized data model.
// Pure functions only: the input is the text items pdf.js returns, so the same code
// runs in the browser and in the Node tests.

// ---------- text helpers ----------

const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;

export function normText(s) {
  return String(s || "")
    .replace(BIDI_MARKS, "")
    .replace(/[״“”„″]/g, '"') // gershayim and curly quotes
    .replace(/[׳‘’′]/g, "'") // geresh and curly apostrophes
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HEB = /[֐-׿]/;

// A PDF that stores Hebrew in visual order gives reversed words ("תולמע" for "עמלות").
// Reverse word order and the letters of Hebrew words, keep numbers as they are.
export function fixVisualOrder(s) {
  const tokens = s.split(/(\s+)/).reverse();
  return tokens
    .map((t) => (HEB.test(t) ? [...t].reverse().join("").replace(/[()]/g, (c) => (c === "(" ? ")" : "(")) : t))
    .join("");
}

const NUM_RE = /^[-(]?\d{1,3}(?:,\d{3})+(?:\.\d+)?[-)]?$|^[-(]?\d+(?:\.\d+)?[-)]?$/;

export function isNumToken(t) {
  return NUM_RE.test(t);
}

export function parseNum(t) {
  if (t == null) return null;
  let s = String(t).trim();
  if (!isNumToken(s)) return null;
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  const v = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(v)) return null;
  return neg ? -v : v;
}

function decimals(t) {
  const m = String(t).replace(/[-()]/g, "").match(/\.(\d+)$/);
  return m ? m[1].length : 0;
}

// Numbers that appear inside a string ("סה"כ לתקופה: 1,234.50", "מס' טלפון 058-...").
export function numbersIn(s) {
  const out = [];
  const re = /-?\(?\d{1,3}(?:,\d{3})+(?:\.\d+)?\)?-?|-?\(?\d+(?:\.\d+)?\)?-?/g;
  let m;
  while ((m = re.exec(s))) {
    const raw = m[0];
    // skip parts of dates (12/2025) and ranges (2025--2025)
    const before = s[m.index - 1] || "";
    const after = s[m.index + raw.length] || "";
    if (before === "/" || after === "/") continue;
    const v = parseNum(raw.replace(/-+$/, (x) => (x.length === 1 ? x : "")));
    if (v != null) out.push({ raw, value: v, dec: decimals(raw) });
  }
  return out;
}

// ---------- lines ----------

// items: [{str, x, y, w, h}] for one page, as pdf.js gives them (y grows upward).
export function buildLines(items, pageIndex = 0) {
  const clean = items
    .map((it) => ({ ...it, str: normText(it.str) }))
    .filter((it) => it.str);
  clean.sort((a, b) => b.y - a.y || b.x - a.x);
  const lines = [];
  for (const it of clean) {
    const tol = Math.max(2, 0.45 * (it.h || 8));
    let line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (!line) {
      line = { y: it.y, page: pageIndex, items: [] };
      lines.push(line);
    }
    line.items.push(it);
  }
  for (const l of lines) {
    l.items.sort((a, b) => b.x + b.w / 2 - (a.x + a.w / 2)); // right to left
    l.text = normText(l.items.map((i) => i.str).join(" "));
    l.tokens = l.items.flatMap((i) => i.str.split(" ")).filter(Boolean);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines;
}

function allLines(pages) {
  const out = [];
  pages.forEach((p, i) => out.push(...buildLines(p.items || p, i)));
  return out;
}

const KEYWORDS = ["עמלות", "חשבון", "ריבית", "יתרה", "אשראי", "הלוואות", "בנק"];

function looksVisual(lines) {
  let normal = 0;
  let reversed = 0;
  const text = lines.map((l) => l.text).join(" ");
  for (const k of KEYWORDS) {
    normal += text.split(k).length - 1;
    reversed += text.split([...k].reverse().join("")).length - 1;
  }
  return reversed > normal * 2 && reversed > 3;
}

// ---------- sections ----------

const CHAPTERS = {
  "א": "account",
  "ב": "deposits",
  "ג": "credit",
  "ד": "debits",
  "ה": "assets",
  "ו": "fees",
  "ז": "cards",
  "ח": "glossary",
};

function findSections(lines) {
  // The table of contents on page 1 lists every chapter; the real chapter starts
  // at the LAST occurrence of its heading.
  const marks = [];
  lines.forEach((l, idx) => {
    const m = l.text.match(/^פרק\s*([א-ח])['"]?\s*-?\s*(.*)$/);
    if (m) marks.push({ idx, key: CHAPTERS[m[1]] || m[1], title: m[2] });
    const s = l.text.match(/^חלק\s*([א-ה])['"]?\s*(\d)?\s*[-–]?\s*(.*)$/);
    if (s) marks.push({ idx, key: "short_" + s[1] + (s[2] || ""), title: s[3] });
  });
  const last = new Map();
  for (const m of marks) last.set(m.key, m);
  const starts = [...last.values()].sort((a, b) => a.idx - b.idx);
  const sections = {};
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].idx : lines.length;
    sections[m.key] = lines.slice(m.idx + 1, end);
  });
  return sections;
}

// ---------- helpers on lines ----------

function numTokens(line) {
  const out = [];
  for (const it of line.items) {
    for (const t of it.str.split(" ")) {
      if (isNumToken(t)) out.push({ raw: t, value: parseNum(t), dec: decimals(t), x: it.x + it.w / 2 });
    }
  }
  return out;
}

function lastNumber(text) {
  const n = numbersIn(text);
  return n.length ? n[n.length - 1].value : null;
}

function amountAfterColon(text) {
  const idx = text.lastIndexOf(":");
  const part = idx >= 0 ? text.slice(idx + 1) : text;
  const n = numbersIn(part);
  if (n.length) return n[n.length - 1].value;
  // RTL extraction may put the amount before the colon ("1,234.56 :...")
  return lastNumber(text);
}

function labelX(line, re) {
  const it = line.items.find((i) => re.test(i.str));
  return it ? it.x + it.w / 2 : null;
}

function nearestByX(tokens, x) {
  let best = null;
  for (const t of tokens) {
    if (!best || Math.abs(t.x - x) < Math.abs(best.x - x)) best = t;
  }
  return best;
}

// ---------- bank + meta ----------

// JavaScript's \b does not work with Hebrew letters, so whole words are matched
// with explicit "not a Hebrew letter" edges.
const W0 = "(?:^|[^\\u05d0-\\u05ea])";
const W1 = "(?:$|[^\\u05d0-\\u05ea])";
const word = (w) => W0 + w + W1;

const BANKS = [
  ["הפועלים", new RegExp("הפועלים|bankhapoalim|poalim", "gi")],
  ["לאומי", new RegExp(word("לאומי") + "|leumi\\.co\\.il", "gi")],
  ["דיסקונט", new RegExp("דיסקונט|discountbank", "gi")],
  ["מזרחי טפחות", new RegExp("מזרחי|טפחות|mizrahi", "gi")],
  ["הבינלאומי", new RegExp("הבינלאומי|fibi", "gi")],
  ["מרכנתיל", new RegExp("מרכנתיל|mercantile", "gi")],
  ["ירושלים", new RegExp("בנק ירושלים|bankjerusalem", "gi")],
  ["יהב", new RegExp(word("יהב") + "|bank-yahav", "gi")],
  ["מסד", new RegExp(word("מסד") + "|bankmassad", "gi")],
  ["וואן זירו", new RegExp("one ?zero|וואן זירו", "gi")],
  ["פאג\"י", new RegExp('פאג"י|פועלי אגודת', "gi")],
];

function detectBank(text) {
  // Take the bank named most often (other banks show up in transfers).
  // "ביטוח לאומי" (National Insurance) and "לאומי קארד" are not Bank Leumi.
  const t = text.replace(/ב(?:י)?טוח לאומי|לאומי קארד|ב"ל/g, " ");
  let best = null;
  for (const [name, re] of BANKS) {
    const n = (t.match(re) || []).length;
    if (n && (!best || n > best.n)) best = { name, n };
  }
  return best ? best.name : null;
}

const CARD_COMPANIES = [
  ["כאל", new RegExp('כ\\.א\\.ל|' + word("כאל") + "|ויזה כאל|דיינרס")],
  ["ישראכרט", new RegExp("ישראכרט|ישרכארט|isracard|אמריקן אקספרס", "i")],
  ["מקס", new RegExp(word("מקס") + "|max it|לאומי קארד", "i")],
];

// ---------- the banking ID report ----------

export function parseBankReport(pages) {
  let lines = allLines(pages);
  let visual = false;
  if (looksVisual(lines)) {
    visual = true;
    lines = lines.map((l) => {
      const items = l.items.map((i) => ({ ...i, str: fixVisualOrder(i.str) }));
      return { ...l, items, text: normText(fixVisualOrder(l.text)), tokens: items.flatMap((i) => i.str.split(" ")) };
    });
  }
  const fullText = lines.map((l) => l.text).join("\n");
  const found = new Set(); // which fields came from the file
  const model = {
    meta: { bank: detectBank(fullText), year: null, type: null, visual },
    account: { balance: null, avgBalance: null, avgRate: null, interestNet: null },
    overdraft: { interestPaid: null, rate: null, avgDebit: null },
    credit: { lineUsed: null, lineLimit: null, lineRate: null },
    mortgageBalance: null,
    loans: [],
    fees: [],
    feeTotal: null,
    securities: { custodyFee: null, custodyRate: null, value: null, avgValue: null, tradingFees: null },
    cards: { bankCardFees: null, companies: [] },
    fx: { bankFees: null },
    sections: [],
    found,
  };

  // year and report type
  const ym = fullText.match(/ליום\s*,?\s*31\/12\/(\d{2,4})/) || fullText.match(/31\/12\/(\d{2,4})/);
  if (ym) model.meta.year = ym[1].length === 2 ? 2000 + Number(ym[1]) : Number(ym[1]);
  if (/דוח שנתי מפורט|דו"ח שנתי מפורט|מורחב/.test(fullText)) model.meta.type = "detailed";
  else if (/מקוצר/.test(fullText)) model.meta.type = "short";

  const sec = findSections(lines);
  model.sections = Object.keys(sec);

  // ---- chapter A: current account ----
  const acc = sec.account || [];
  for (let i = 0; i < acc.length; i++) {
    const l = acc[i];
    if (/יתרת עו"ש ליום/.test(l.text) && /ממוצע/.test(l.text)) {
      const xs = {
        balance: labelX(l, /יתרת עו"ש/),
        avgBalance: labelX(l, /יתרה חודשית/),
        avgRate: labelX(l, /שיעור ריבית/),
        interestNet: labelX(l, /סך הכנסות|הוצאות/),
      };
      for (let j = i + 1; j < Math.min(acc.length, i + 5); j++) {
        const toks = numTokens(acc[j]);
        if (toks.length >= 3) {
          for (const [k, x] of Object.entries(xs)) {
            if (x == null) continue;
            const t = nearestByX(toks, x);
            if (t) { model.account[k] = t.value; found.add("account." + k); }
          }
          // fall back to plain right-to-left order when labels were not found
          if (xs.balance == null && toks.length >= 4) {
            ["balance", "avgBalance", "avgRate", "interestNet"].forEach((k, n) => {
              model.account[k] = toks[n].value; found.add("account." + k);
            });
          }
          break;
        }
      }
      break;
    }
  }
  const a = model.account;
  if (a.avgBalance != null && a.avgBalance < 0) {
    model.overdraft.avgDebit = Math.abs(a.avgBalance);
    found.add("overdraft.avgDebit");
  }
  if (a.interestNet != null && a.interestNet < 0) {
    model.overdraft.interestPaid = Math.abs(a.interestNet);
    found.add("overdraft.interestPaid");
  }
  if (a.avgRate != null && a.avgBalance != null && a.avgBalance < 0 && a.avgRate > 0) {
    model.overdraft.rate = a.avgRate;
    found.add("overdraft.rate");
  }

  // ---- chapter C: credit ----
  const cr = sec.credit || [];
  for (const l of cr) {
    if (/ניצול מסגרת אשראי/.test(l.text)) {
      const v = amountAfterColon(l.text);
      if (v != null) { model.credit.lineUsed = v; found.add("credit.lineUsed"); }
    } else if (/יתרת הלוואות לדיור/.test(l.text)) {
      const v = amountAfterColon(l.text);
      if (v != null) { model.mortgageBalance = v; found.add("mortgageBalance"); }
    } else if (/מסגרת/.test(l.text) && /ריבית|%/.test(l.text)) {
      const nums = numbersIn(l.text);
      const rate = nums.find((n) => n.value > 0 && n.value < 40 && n.dec >= 2);
      const limit = nums.filter((n) => n.value >= 500).sort((x, y) => y.value - x.value)[0];
      if (limit) { model.credit.lineLimit = limit.value; found.add("credit.lineLimit"); }
      if (rate) { model.credit.lineRate = rate.value; found.add("credit.lineRate"); }
    } else if (/הלוואה|הלוואות/.test(l.text) && !/לדיור/.test(l.text) && /\d{2}\/\d{2}\/\d{2,4}/.test(l.text)) {
      const nums = numbersIn(l.text);
      const rate = nums.find((n) => n.value > 0 && n.value < 40 && n.dec >= 2 && n.value !== Math.round(n.value));
      const bal = nums.filter((n) => n.value >= 500).sort((x, y) => y.value - x.value)[0];
      if (bal) model.loans.push({ name: "הלוואה", balance: bal.value, rate: rate ? rate.value : null, monthsLeft: null, fromFile: true });
    }
  }

  // ---- chapter D: debits by authorization -> card companies ----
  const deb = sec.debits || [];
  const companies = new Set();
  for (const l of deb) {
    for (const [name, re] of CARD_COMPANIES) if (re.test(l.text)) companies.add(name);
  }
  model.cards.companies = [...companies];

  // ---- chapter E: securities ----
  const as = sec.assets || [];
  for (let i = 0; i < as.length; i++) {
    const l = as[i];
    if (/יתרת תיק ניירות ערך חודשית ממוצעת/.test(l.text)) {
      const own = lastNumber(l.text);
      const next = as[i + 1] ? numTokens(as[i + 1]) : [];
      const v = own != null && own > 100 ? own : next.length ? next[0].value : null;
      if (v != null) { model.securities.avgValue = v; found.add("securities.avgValue"); }
    }
    if (/^סה"כ תיק:?/.test(l.text) || /סה"כ תיק:/.test(l.text)) {
      const toks = numTokens(l);
      const two = toks.filter((t) => t.dec === 2);
      if (two.length) { model.securities.value = two[0].value; found.add("securities.value"); }
    }
  }

  // ---- chapter F: fees ----
  const fe = sec.fees || [];
  let group = null;
  let current = null;
  let inSecurities = false;
  const fees = [];
  for (let i = 0; i < fe.length; i++) {
    const l = fe[i];
    const t = l.text;
    if (/קנייה,? מכירה,? פדיון ודמי ניהול/.test(t) && !/למעט/.test(t)) { inSecurities = true; current = null; continue; }
    if (inSecurities) {
      if (/סה"כ שנתי/.test(t)) {
        const v = lastNumber(t);
        if (v != null) {
          model.securities.custodyFee = (model.securities.custodyFee || 0) + v;
          found.add("securities.custodyFee");
        }
      } else {
        const toks = numTokens(l);
        const rate = toks.find((x) => x.dec === 2 && x.value > 0 && x.value < 3);
        const big = toks.find((x) => x.value > 1000);
        if (rate && big && toks.length >= 3) {
          model.securities.custodyRate = Math.max(model.securities.custodyRate || 0, rate.value);
          found.add("securities.custodyRate");
        }
      }
      continue;
    }
    if (/^עמלות\s/.test(t) && !/המשך|כללי|למעט/.test(t) && numbersIn(t).length === 0) {
      group = t.replace(/:$/, "");
      continue;
    }
    if (/^•/.test(t) || /^[••]/.test(l.items[0]?.str || "")) {
      current = { name: t.replace(/^•\s*/, "").slice(0, 90), group, annual: null, fromFile: true };
      fees.push(current);
      continue;
    }
    if (current && current.annual == null && /^שנתי:?/.test(t)) {
      const v = lastNumber(t);
      if (v != null) current.annual = v;
      continue;
    }
    if (/סה"כ לתקופה/.test(t)) {
      const v = lastNumber(t);
      if (v != null) { model.feeTotal = v; found.add("feeTotal"); }
    }
  }
  // short report or other layouts: "label ..... amount" lines
  if (!fees.length) {
    for (const l of fe) {
      const nums = numbersIn(l.text);
      if (nums.length === 1 && HEB.test(l.text) && !/סה"כ|מחצית|גובה עמלה/.test(l.text)) {
        fees.push({ name: l.text.replace(nums[0].raw, "").replace(/[:.\s]+$/, "").trim(), group: null, annual: nums[0].value, fromFile: true });
      }
    }
  }
  model.fees = fees.filter((f) => f.annual != null).map((f) => ({ ...f, category: categorizeFee(f) }));
  if (model.fees.length) found.add("fees");

  const sumCat = (c) => model.fees.filter((f) => f.category === c).reduce((s, f) => s + f.annual, 0);
  if (model.fees.some((f) => f.category === "card")) { model.cards.bankCardFees = sumCat("card"); found.add("cards.bankCardFees"); }
  if (model.fees.some((f) => f.category === "fx")) { model.fx.bankFees = sumCat("fx"); found.add("fx.bankFees"); }

  // ---- chapter G: cards issued by the bank ----
  // Card fees listed here are added as fee items, unless chapter F already listed card fees.
  const cg = sec.cards || [];
  if (cg.length && !cg.some((l) => /לא קיימים נתונים/.test(l.text)) && !model.fees.some((f) => f.category === "card")) {
    let n = 0;
    for (const l of cg) {
      if (/דמי כרטיס/.test(l.text)) {
        const v = lastNumber(l.text);
        if (v != null && v > 0) {
          model.fees.push({ name: `דמי כרטיס (כרטיס בנקאי ${++n})`, group: "כרטיסי חיוב", annual: v, category: "card", fromFile: true });
          found.add("cards.bankCardFees");
        }
      }
    }
    if (n) model.cards.bankCardFees = model.fees.filter((f) => f.category === "card").reduce((s, f) => s + f.annual, 0);
  }

  model.recognized = !!(model.meta.type || model.sections.length >= 2 || found.size >= 3);
  return model;
}

export function categorizeFee(f) {
  const n = (f.name || "") + " " + (f.group || "");
  if (/הקצאת אשראי/.test(n)) return "creditAllocation";
  if (/מט"ח|מטבע חוץ|המרה|חליפין|לחו"ל|SWIFT|סוויפט/i.test(n)) return "fx";
  if (/דמי כרטיס|כרטיסי חיוב|כרטיס חיוב/.test(n) && !/חיוב בכרטיס אשראי/.test(n)) return "card";
  if (/ניירות ערך|ני"ע|דמי משמרת/.test(n)) return "securities";
  if (/הלוואה|פירעון מוקדם|פרעון מוקדם|ערבות|טיפול באשראי/.test(n)) return "loan";
  return "account";
}

// ---------- the housing loan annual report (beta: no sample seen yet) ----------

const TRACKS = [
  ["prime", /פריים|prime/i],
  ["fixedUnlinked", /קבועה\s*(?:לא|שאינה)\s*צמודה|קל"צ/],
  ["fixedLinked", /קבועה\s*צמודה/],
  ["variableUnlinked", /משתנה\s*(?:לא|שאינה)\s*צמודה/],
  ["variableLinked", /משתנה\s*צמודה/],
];

export function parseMortgageReport(pages) {
  const lines = allLines(pages);
  const tracks = [];
  for (const l of lines) {
    const tr = TRACKS.find(([, re]) => re.test(l.text));
    if (!tr) continue;
    const nums = numbersIn(l.text);
    const rate = nums.find((n) => n.dec >= 2 && n.value > -3 && n.value < 15 && Math.abs(n.value) < 15 && n.value !== Math.round(n.value));
    const bal = nums.filter((n) => n.value >= 1000).sort((x, y) => y.value - x.value)[0];
    if (bal && rate) tracks.push({ track: tr[0], balance: bal.value, rate: rate.value, monthsLeft: null, fromFile: true });
  }
  return { tracks, recognized: tracks.length > 0 };
}
