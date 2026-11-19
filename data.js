// data.js — the numbers the user reviews: built from the parsed report, and merged when a second account is added.
// Pure functions, no DOM.

export function emptyData() {
  return {
    meta: { bank: null, year: null, type: null, banks: [], prints: [], merged: false },
    account: {},
    overdraft: { interestPaid: "", rate: "", avgDebit: "" },
    fees: [],
    feeTotal: null,
    cards: { companies: [], entries: [] },
    loans: [],
    mortgageBalance: null,
    mortgage: [],
    securities: { custodyRate: "", value: "", avgValue: "", custodyFee: "" },
    profile: { student: false, soldier: false, senior: false, disabled: false },
    found: new Set(),
  };
}

export function toNumber(x) {
  if (x === "" || x == null) return "";
  const s = String(x).replace(/[,₪%\s]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : "";
}

// Identifies one report, so the same file is not added twice.
export function fingerprint(d) {
  const a = d.account || {};
  return [d.meta.bank, d.meta.year, a.balance, a.avgBalance, d.feeTotal].map((x) => (x == null ? "" : String(x))).join("|");
}

export function fromParsed(m) {
  const d = emptyData();
  d.meta = { ...d.meta, ...m.meta, banks: m.meta.bank ? [m.meta.bank] : [], merged: false };
  d.found = m.found;
  d.account = { ...(m.account || {}) };
  d.overdraft = {
    interestPaid: m.overdraft.interestPaid ?? "",
    rate: m.overdraft.rate ?? "",
    avgDebit: m.overdraft.avgDebit ?? "",
  };
  d.fees = m.fees.map((f) => ({ name: f.name, annual: f.annual, category: f.category, fromFile: true }));
  d.feeTotal = m.feeTotal;
  d.cards.companies = m.cards.companies.slice();
  d.cards.entries = m.cards.companies.map((c) => ({ company: c, monthlyFee: "", fxSpend: "", fxRate: "", creditInterest: "", checked: false }));
  d.loans = m.loans.map((l) => ({ name: l.name || "", balance: l.balance ?? "", rate: l.rate ?? "", years: "", source: "report" }));
  d.mortgageBalance = m.mortgageBalance;
  const s = m.securities;
  d.securities = { custodyRate: s.custodyRate ?? "", value: s.value ?? s.avgValue ?? "", avgValue: s.avgValue ?? "", custodyFee: s.custodyFee ?? "" };
  if (s.value != null) d.found.add("securities.value");
  d.meta.prints = [fingerprint(d)];
  return d;
}

export function isDuplicate(base, add) {
  const p = add.meta.prints && add.meta.prints[0];
  return !!p && (base.meta.prints || []).includes(p);
}

const sumOrEmpty = (x, y) => (x === "" && y === "" ? "" : (Number(x) || 0) + (Number(y) || 0));
const sumOrNull = (x, y) => (x == null && y == null ? null : (Number(x) || 0) + (Number(y) || 0));
const round2 = (x) => Math.round(x * 100) / 100;

// A rate for two accounts together, weighted by how much each one carries.
function weighted(rx, wx, ry, wy) {
  if (rx === "" && ry === "") return "";
  if (rx === "") return ry;
  if (ry === "") return rx;
  return wx + wy > 0 ? round2((rx * wx + ry * wy) / (wx + wy)) : Math.max(rx, ry);
}

function yearsOf(y) {
  return String(y || "").split(",").map((s) => s.trim()).filter(Boolean);
}

// Adds account `b` to the summary `a`. Item names get the bank's name so the user can tell them apart.
export function mergeData(a, b) {
  const n = toNumber;
  const out = emptyData();
  const banksA = a.meta.banks && a.meta.banks.length ? a.meta.banks.slice() : [a.meta.bank || "חשבון 1"];
  let labelB = b.meta.bank || `חשבון ${banksA.length + 1}`;
  if (banksA.includes(labelB)) labelB = `${labelB} ${banksA.filter((x) => x.startsWith(labelB)).length + 1}`;
  const first = !a.meta.merged;
  const tagA = (name) => (first ? `${banksA[0]} · ${name}` : name);
  const tagB = (name) => `${labelB} · ${name}`;
  const banks = [...banksA, labelB];
  const years = [...new Set([...yearsOf(a.meta.year), ...yearsOf(b.meta.year)])].sort();

  out.meta = {
    ...a.meta,
    merged: true,
    banks,
    bank: banks.join(" + "),
    year: years.length ? years.join(", ") : null,
    prints: [...(a.meta.prints || []), ...(b.meta.prints || [])],
  };
  out.found = new Set([...(a.found || []), ...(b.found || [])]);
  out.account = {
    balance: sumOrNull(a.account && a.account.balance, b.account && b.account.balance),
    avgBalance: sumOrNull(a.account && a.account.avgBalance, b.account && b.account.avgBalance),
  };

  const oa = a.overdraft, ob = b.overdraft;
  out.overdraft = {
    interestPaid: sumOrEmpty(n(oa.interestPaid), n(ob.interestPaid)),
    avgDebit: sumOrEmpty(n(oa.avgDebit), n(ob.avgDebit)),
    rate: weighted(n(oa.rate), n(oa.avgDebit) || n(oa.interestPaid) || 0, n(ob.rate), n(ob.avgDebit) || n(ob.interestPaid) || 0),
  };

  out.fees = [...a.fees.map((f) => ({ ...f, name: f.fromFile ? tagA(f.name) : f.name })), ...b.fees.map((f) => ({ ...f, name: tagB(f.name) }))];
  out.feeTotal = sumOrNull(a.feeTotal, b.feeTotal);

  const companies = [...new Set([...a.cards.companies, ...b.cards.companies])];
  out.cards = {
    companies,
    entries: [...a.cards.entries, ...b.cards.entries.filter((e) => !a.cards.entries.some((x) => x.company === e.company))],
  };

  out.loans = [
    ...a.loans.map((l) => (l.source === "report" ? { ...l, name: tagA(l.name || "הלוואה") } : l)),
    ...b.loans.map((l) => (l.source === "report" ? { ...l, name: tagB(l.name || "הלוואה") } : l)),
  ];
  out.mortgageBalance = sumOrNull(a.mortgageBalance, b.mortgageBalance);
  out.mortgage = [...a.mortgage, ...b.mortgage];

  const sa = a.securities, sb = b.securities;
  const va = n(sa.value) || n(sa.avgValue) || 0;
  const vb = n(sb.value) || n(sb.avgValue) || 0;
  out.securities = {
    custodyRate: weighted(n(sa.custodyRate), va, n(sb.custodyRate), vb),
    value: sumOrEmpty(n(sa.value), n(sb.value)),
    avgValue: sumOrEmpty(n(sa.avgValue), n(sb.avgValue)),
    custodyFee: sumOrEmpty(n(sa.custodyFee), n(sb.custodyFee)),
  };
  out.profile = { ...a.profile };
  return out;
}
