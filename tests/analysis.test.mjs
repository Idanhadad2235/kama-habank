// Unit tests for analysis.js. Run: node tests/analysis.test.mjs
import assert from "node:assert/strict";
import { analyze, payment, remainingSaving, computePaid } from "../analysis.js";
import { emptyData, mergeData, isDuplicate, fingerprint } from "../data.js";
import { BENCHMARKS as B } from "../benchmarks.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

t("annuity payment", () => {
  near(payment(100000, 6, 120), 1110.21, 0.05);
  near(payment(12000, 0, 12), 1000, 0.001);
});

t("remaining saving only when above average", () => {
  assert.equal(remainingSaving(100000, 4, 5, 120), null);
  near(remainingSaving(100000, 6, 5, 120), (payment(100000, 6, 120) - payment(100000, 5, 120)) * 120, 0.01);
});

t("overdraft: full interest + cheaper alternative", () => {
  const r = analyze({ overdraft: { interestPaid: 1200, rate: 13, avgDebit: 9000 } }, B);
  const f = r.findings.find((x) => x.id === "overdraft");
  assert.equal(f.status, "above"); // 13% > 11.51%
  assert.equal(f.yearly, 1200);
  near(1200 - (9000 * B.householdLoanAvg.value) / 100, 486.3, 0.1);
  assert.match(f.note, /486/);
});

t("overdraft below average is 'save', not 'above'", () => {
  const r = analyze({ overdraft: { interestPaid: 500, rate: 9 } }, B);
  assert.equal(r.findings[0].status, "save");
});

t("no overdraft -> ok note", () => {
  const r = analyze({ overdraft: {}, fees: [] }, B);
  assert.ok(r.okNotes.includes("לא שילמת ריבית על מינוס"));
});

t("account fees: cancel, with student tip first", () => {
  const r = analyze({ fees: [{ name: "פעולה ע\"י פקיד", annual: 60, category: "account" }, { name: "דמי ניהול", annual: 120, category: "account" }], profile: { student: true } }, B);
  const f = r.findings.find((x) => x.id === "accountFees");
  assert.equal(f.status, "cancel");
  assert.equal(f.yearly, 180);
  assert.match(f.lead, /אפשר לבטל/);
  assert.match(f.tips[0], /סטודנטים/);
});

t("zero account fees -> ok note", () => {
  const r = analyze({ fees: [{ name: "x", annual: 0, category: "account" }] }, B);
  assert.ok(!r.findings.some((x) => x.id === "accountFees"));
  assert.ok(r.okNotes.includes("לא שילמת עמלות עו״ש"));
});

t("card fees: bank card + manual entry, wording", () => {
  const r = analyze({ fees: [{ name: "דמי כרטיס", annual: 100, category: "card" }], cards: { companies: ["מקס"], entries: [{ company: "מקס", monthlyFee: 14.9 }] } }, B);
  const f = r.findings.find((x) => x.id === "cardFees");
  near(f.yearly, 100 + 14.9 * 12, 0.01);
  assert.match(f.lead, /אפשר לקבל פטור מדמי כרטיס/);
  assert.ok(!r.missing.some((m) => m.id === "card-מקס"));
});

t("card company with no data -> missing item", () => {
  const r = analyze({ cards: { companies: ["כאל"], entries: [] } }, B);
  assert.ok(r.missing.some((m) => m.id === "card-כאל"));
});

t("fx: card spend x rate + bank fees", () => {
  const r = analyze({ fees: [{ name: "המרת מט\"ח", annual: 40, category: "fx" }], cards: { entries: [{ company: "ישראכרט", fxSpend: 10000, fxRate: 3 }] } }, B);
  const f = r.findings.find((x) => x.id === "fx");
  near(f.yearly, 340, 0.01);
  assert.equal(f.compare[1][1], "0%");
});

t("credit transactions", () => {
  const r = analyze({ cards: { entries: [{ company: "כאל", creditInterest: 250 }] } }, B);
  assert.equal(r.findings.find((x) => x.id === "creditTxn").yearly, 250);
});

t("loan above average: yearly and until the end", () => {
  const r = analyze({ loans: [{ name: "רכב", balance: 50000, rate: 10, monthsLeft: 36 }] }, B);
  const f = r.findings.find((x) => x.id === "loan0");
  near(f.yearly, (50000 * (10 - B.householdLoanAvg.value)) / 100, 0.01);
  assert.ok(f.total > 0);
});

t("loan below average -> ok", () => {
  const r = analyze({ loans: [{ balance: 50000, rate: 6, monthsLeft: 36 }] }, B);
  assert.ok(!r.findings.some((x) => x.id === "loan0"));
});

t("mortgage fixed unlinked above average", () => {
  const r = analyze({ mortgage: [{ track: "fixedUnlinked", balance: 300000, rate: 5.2, monthsLeft: 240 }] }, B);
  const f = r.findings.find((x) => x.id === "mortgage0");
  near(f.yearly, (300000 * (5.2 - 4.65)) / 100, 0.01);
  assert.ok(f.total > f.yearly);
  assert.match(f.note, /פירעון מוקדם/);
});

t("mortgage prime compared by margin", () => {
  // prime 4.75, user's rate 4.45 -> margin -0.30, average margin -0.67 -> 0.37 above
  const r = analyze({ mortgage: [{ track: "prime", balance: 200000, rate: 4.45, monthsLeft: 200 }] }, B);
  const f = r.findings.find((x) => x.id === "mortgage0");
  near(f.yearly, 200000 * 0.0037, 0.5);
  assert.equal(f.note, null);
});

t("mortgage balance without tracks -> missing", () => {
  const r = analyze({ mortgageBalance: 300000, mortgage: [] }, B);
  assert.ok(r.missing.some((m) => m.id === "mortgageTracks"));
});

t("securities custody above the bank average", () => {
  const r = analyze({ securities: { custodyRate: 0.6, value: 40000 } }, B);
  const f = r.findings.find((x) => x.id === "securities");
  near(f.yearly, (40000 * (0.6 - 0.32)) / 100, 0.01);
});

t("totals add up and findings are sorted", () => {
  const r = analyze({ overdraft: { interestPaid: 100 }, fees: [{ name: "a", annual: 300, category: "account" }] }, B);
  assert.equal(r.yearly, 400);
  assert.equal(r.findings[0].id, "accountFees");
});

// ---- what was paid ----

t("paid: fees and interest are separate, loans and mortgage are estimates", () => {
  const p = computePaid({
    fees: [{ name: "דמי ניהול", annual: 120, category: "account" }, { name: "דמי משמרת", annual: 70, category: "securities" }],
    securities: { custodyFee: 64.5, custodyRate: 0.6, value: 48000 }, // the fee item wins, no double count
    cards: { entries: [{ monthlyFee: 10, fxSpend: 5000, fxRate: 3, creditInterest: 200 }] },
    overdraft: { interestPaid: 300 },
    loans: [{ balance: 20000, rate: 10 }],
    mortgage: [{ balance: 100000, rate: 5 }],
  });
  assert.equal(p.fees, 120 + 70 + 120 + 150);
  assert.equal(p.interest, 300 + 200 + 2000 + 5000);
  assert.equal(p.estimate, true);
  assert.equal(p.mortgageMissing, false);
});

t("paid: custody from the securities section when there is no fee item", () => {
  const p = computePaid({ fees: [], securities: { custodyFee: 64.5 } });
  near(p.fees, 64.5, 0.001);
  assert.equal(p.interest, 0);
  assert.equal(p.estimate, false);
});

t("paid: mortgage balance without tracks is flagged", () => {
  const p = computePaid({ mortgageBalance: 300000, mortgage: [] });
  assert.equal(p.mortgageMissing, true);
});

// ---- ready messages ----

t("every finding with a saving has a ready message, with the numbers in it", () => {
  const r = analyze({
    meta: { year: 2025 },
    overdraft: { interestPaid: 900, rate: 13 },
    fees: [{ name: "פעולה ע\"י פקיד", annual: 60, category: "account" }, { name: "הקצאת אשראי", annual: 48, category: "creditAllocation" }, { name: "טיפול בהלוואה", annual: 30, category: "loan" }],
    cards: { entries: [{ company: "מקס", monthlyFee: 14.9, fxSpend: 3000, fxRate: 3, creditInterest: 120 }] },
    loans: [{ balance: 30000, rate: 12, source: "card" }],
    mortgage: [{ track: "fixedUnlinked", balance: 200000, rate: 5.5 }],
    securities: { custodyRate: 0.6, value: 50000 },
    profile: { student: true },
  }, B);
  for (const f of r.findings) {
    assert.ok(f.message && f.message.text.length > 30, f.id + " has a message");
    assert.ok(f.message.text.endsWith("תודה."), f.id + " ends politely");
  }
  const by = Object.fromEntries(r.findings.map((f) => [f.id, f]));
  assert.match(by.overdraft.message.text, /לשנת 2025/);
  assert.match(by.overdraft.message.text, /900 ₪/);
  assert.match(by.accountFees.message.text, /אני בלימודים/);
  assert.equal(by.cardFees.message.to, "לחברת האשראי");
  assert.match(by.cardFees.message.text, /14\.90 ₪ בחודש/);
  assert.equal(by.fx.message.to, "לחברת האשראי");
  assert.equal(by.loan0.message.to, "לבנק שלך");
  assert.match(by.loan0.message.text, /מחברת כרטיס אשראי/);
  assert.match(by.mortgage0.message.text, /ספטמבר 2026/);
  assert.match(by.mortgage0.message.text, /עמלת הפירעון המוקדם/);
  assert.match(by.securities.message.text, /0\.6%/);
});

t("loan source sets the title and the advice", () => {
  const r = analyze({ loans: [{ balance: 10000, rate: 15, source: "nonbank" }, { balance: 10000, rate: 15, source: "report", name: "הלוואה אישית" }] }, B);
  const [a, b] = r.findings.sort((x, y) => x.id.localeCompare(y.id));
  assert.equal(a.title, "הלוואה חוץ בנקאית");
  assert.match(a.tips[0], /לסגור את ההלוואה הזאת/);
  assert.equal(b.title, "הלוואה · הלוואה אישית");
  assert.equal(b.message.to, "לבנק");
});

t("message without a year does not mention one", () => {
  const r = analyze({ overdraft: { interestPaid: 500 } }, B);
  assert.doesNotMatch(r.findings[0].message.text, /לשנת/);
});

// ---- two accounts in one summary ----

function account(bank, over = {}) {
  const d = emptyData();
  d.meta = { ...d.meta, bank, year: 2025, banks: [bank] };
  d.account = { balance: 1000, avgBalance: 900 };
  Object.assign(d, over);
  d.meta.prints = [fingerprint(d)];
  return d;
}

t("merge: sums what adds up, weights the rates, and names items by bank", () => {
  const a = account("הפועלים", {
    overdraft: { interestPaid: 1000, rate: 12, avgDebit: 8000 },
    fees: [{ name: "דמי ניהול", annual: 100, category: "account", fromFile: true }],
    feeTotal: 100,
    securities: { custodyRate: 0.6, value: 50000, avgValue: "", custodyFee: 300 },
    mortgageBalance: 200000,
    cards: { companies: ["מקס"], entries: [{ company: "מקס", monthlyFee: 10 }] },
  });
  const b = account("לאומי", {
    overdraft: { interestPaid: 500, rate: 9, avgDebit: 4000 },
    fees: [{ name: "דמי ניהול", annual: 50, category: "account", fromFile: true }],
    feeTotal: 50,
    securities: { custodyRate: 0.2, value: 50000, avgValue: "", custodyFee: 100 },
    loans: [{ name: "הלוואה", balance: 10000, rate: 9, source: "report" }],
    cards: { companies: ["מקס", "כאל"], entries: [{ company: "מקס", monthlyFee: "" }, { company: "כאל", monthlyFee: "" }] },
  });
  const m = mergeData(a, b);
  assert.deepEqual(m.meta.banks, ["הפועלים", "לאומי"]);
  assert.equal(m.meta.bank, "הפועלים + לאומי");
  assert.equal(m.meta.year, "2025");
  assert.equal(m.overdraft.interestPaid, 1500);
  assert.equal(m.overdraft.avgDebit, 12000);
  assert.equal(m.overdraft.rate, 11); // (12×8000 + 9×4000) / 12000
  assert.deepEqual(m.fees.map((f) => f.name), ["הפועלים · דמי ניהול", "לאומי · דמי ניהול"]);
  assert.equal(m.feeTotal, 150);
  assert.equal(m.securities.custodyRate, 0.4);
  assert.equal(m.securities.value, 100000);
  assert.equal(m.mortgageBalance, 200000);
  assert.equal(m.loans[0].name, "לאומי · הלוואה");
  assert.deepEqual(m.cards.companies, ["מקס", "כאל"]);
  assert.equal(m.cards.entries.length, 2); // מקס kept once, with the amount already entered
  assert.equal(m.cards.entries[0].monthlyFee, 10);
});

t("merge: the saving on two accounts equals the two savings added up", () => {
  const a = account("הפועלים", { overdraft: { interestPaid: 1000, rate: 12, avgDebit: 8000 } });
  const b = account("לאומי", { overdraft: { interestPaid: 500, rate: 9, avgDebit: 4000 } });
  const one = (d) => analyze({ ...d, overdraft: { ...d.overdraft } }, B);
  const alt = (r) => Number(/כ-([\d,]+)/.exec(r.findings[0].note)[1].replace(/,/g, ""));
  const merged = one(mergeData(a, b));
  near(alt(merged), alt(one(a)) + alt(one(b)), 1);
  assert.equal(merged.yearly, 1500);
});

t("merge: a third account, the same bank twice, and different years", () => {
  const a = account("הפועלים");
  const b = account("הפועלים", { account: { balance: 5, avgBalance: 5 } });
  b.meta.year = 2024;
  b.meta.prints = [fingerprint(b)];
  const m = mergeData(a, b);
  assert.deepEqual(m.meta.banks, ["הפועלים", "הפועלים 2"]);
  assert.equal(m.meta.year, "2024, 2025");
  const c = account("דיסקונט", { fees: [{ name: "עמלה", annual: 5, category: "account", fromFile: true }] });
  const m3 = mergeData(m, c);
  assert.deepEqual(m3.meta.banks, ["הפועלים", "הפועלים 2", "דיסקונט"]);
  assert.equal(m3.fees[0].name, "דיסקונט · עמלה");
});

t("merge: the same report twice is caught", () => {
  const a = account("הפועלים");
  const same = account("הפועלים");
  const other = account("הפועלים", { account: { balance: 2, avgBalance: 2 } });
  other.meta.prints = [fingerprint(other)];
  assert.equal(isDuplicate(a, same), true);
  assert.equal(isDuplicate(a, other), false);
  assert.equal(isDuplicate(mergeData(a, other), same), true);
});

console.log(`\n${n} tests passed`);
