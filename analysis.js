// analysis.js — compares the user's numbers with the benchmarks and works out savings.
// Pure functions; the UI renders what this returns.

const sum = (arr) => arr.reduce((s, x) => s + (Number(x) || 0), 0);
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const pos = (v) => (num(v) != null && Number(v) > 0 ? Number(v) : null);

// Monthly payment of an annuity (Spitzer) loan.
export function payment(balance, annualRatePct, months) {
  const i = annualRatePct / 1200;
  if (!months || months <= 0) return 0;
  if (Math.abs(i) < 1e-9) return balance / months;
  return (balance * i) / (1 - Math.pow(1 + i, -months));
}

// Extra paid until the end of the loan at rate `yours` instead of `avg`.
export function remainingSaving(balance, yours, avg, months) {
  if (!months || months <= 0 || yours <= avg) return null;
  return (payment(balance, yours, months) - payment(balance, avg, months)) * months;
}

export const STATUS = {
  above: "מעל הממוצע",
  cancel: "אפשר לבטל",
  save: "אפשר לחסוך",
  ok: "תקין",
};

// Where a loan comes from. Loans from the report are from the bank; the rest are added by hand.
export const LOAN_SOURCES = [
  ["otherBank", "מבנק אחר"],
  ["card", "מחברת כרטיס אשראי"],
  ["nonbank", "מגוף חוץ בנקאי"],
  ["bank", "מהבנק הזה"],
];
const LOAN_TITLE = { report: "הלוואה מהבנק", bank: "הלוואה מהבנק", otherBank: "הלוואה מבנק אחר", card: "הלוואה מחברת אשראי", nonbank: "הלוואה חוץ בנקאית" };
const isExternal = (src) => src === "otherBank" || src === "card" || src === "nonbank";

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
function monthText(asOf) {
  const [y, m] = String(asOf || "").split("-");
  return m ? `${MONTHS[Number(m) - 1]} ${y}` : y || "";
}
const yearText = (y) => (!y ? "" : String(y).includes(",") ? ` לשנים ${y}` : ` לשנת ${y}`);

// What was paid in the report year: fees (including card fees) and interest.
// Interest on loans and the mortgage is an estimate: balance × rate.
export function computePaid(data) {
  const fees = (data.fees || []).filter((f) => num(f.annual) != null);
  const feeSum = (cat) => sum(fees.filter((f) => f.category === cat).map((f) => f.annual));
  const entries = (data.cards && data.cards.entries) || [];
  const sec = data.securities || {};

  const reportFees = sum(fees.filter((f) => f.category !== "securities").map((f) => f.annual));
  const secRate = pos(sec.custodyRate);
  const secValue = pos(sec.value) || pos(sec.avgValue);
  const custody = feeSum("securities") || pos(sec.custodyFee) || (secRate && secValue ? (secValue * secRate) / 100 : 0);
  const cardFees = sum(entries.map((e) => (pos(e.monthlyFee) || 0) * 12));
  const cardFx = sum(entries.map((e) => (pos(e.fxSpend) && pos(e.fxRate) ? (e.fxSpend * e.fxRate) / 100 : 0)));
  const feesPaid = reportFees + custody + cardFees + cardFx;

  const overdraft = pos(data.overdraft && data.overdraft.interestPaid) || 0;
  const credit = sum(entries.map((e) => pos(e.creditInterest) || 0));
  const lineInterest = (l) => (pos(l.balance) && pos(l.rate) ? (l.balance * l.rate) / 100 : 0);
  const loans = sum((data.loans || []).map(lineInterest));
  const mortgage = sum((data.mortgage || []).map(lineInterest));
  const interest = overdraft + credit + loans + mortgage;

  const hasTracks = (data.mortgage || []).some((m) => pos(m.balance) && pos(m.rate));
  return {
    fees: feesPaid,
    interest,
    total: feesPaid + interest,
    estimate: loans + mortgage > 0,
    mortgageMissing: !!pos(data.mortgageBalance) && !hasTracks,
  };
}

export function analyze(data, B, partners = { cards: [], fxCards: [], brokers: [] }) {
  const findings = [];
  const okNotes = [];
  const missing = [];
  const profile = data.profile || {};
  const meta = data.meta || {};
  const yr = yearText(meta.year);
  const fromReport = `שלום, עברתי על תעודת הזהות הבנקאית${yr} וראיתי ש`;
  const fees = (data.fees || []).filter((f) => num(f.annual) != null);
  const feeSum = (cat) => sum(fees.filter((f) => f.category === cat).map((f) => f.annual));

  // ---- overdraft ----
  const od = data.overdraft || {};
  const odInterest = pos(od.interestPaid);
  if (odInterest) {
    const rate = pos(od.rate);
    const avgDebit = pos(od.avgDebit);
    const loanAvg = B.householdLoanAvg.value;
    let alt = null;
    if (avgDebit) alt = odInterest - (avgDebit * loanAvg) / 100;
    else if (rate && rate > loanAvg) alt = odInterest * (1 - loanAvg / rate);
    if (alt != null && alt < 0) alt = 0;
    findings.push({
      id: "overdraft",
      icon: "minus",
      title: "מינוס",
      status: rate && rate > B.overdraftAvg.value ? "above" : "save",
      yearly: odInterest,
      lead: `שילמת ${ils(odInterest)} ריבית על מינוס בשנה. כשיוצאים מהמינוס, חוסכים את כל הסכום הזה.`,
      compare: rate ? [["הריבית שלך", pct(rate)], ["ממוצע המערכת", pct(B.overdraftAvg.value)]] : null,
      note: alt != null && alt > 0 ? `חלופה: הלוואה בריבית הממוצעת, ${pct(loanAvg)}, במקום המינוס. חיסכון של כ-${ils(alt)} בשנה.` : `חלופה: הלוואה בריבית הממוצעת, ${pct(loanAvg)}, במקום המינוס.`,
      tips: [
        "להעביר את ההוצאות הקבועות לתאריך שאחרי המשכורת",
        "אם המינוס קבוע, להחליף אותו בהלוואה בריבית נמוכה יותר",
        rate && rate > B.overdraftAvg.value ? "לבקש מהבנק להוריד את ריבית המינוס לפחות לממוצע" : "לבקש מהבנק להוריד את ריבית המינוס",
      ],
      message: {
        to: "לבנק",
        text: `${fromReport}שילמתי ${ils(odInterest)} ריבית על מינוס.${rate ? ` ריבית המינוס שלי היא ${pct(rate)}, והממוצע במערכת הבנקאית הוא ${pct(B.overdraftAvg.value)}.` : ""} אבקש להוריד את ריבית המינוס, או לקבל הצעה להלוואה בריבית נמוכה יותר שתסגור את המינוס. תודה.`,
      },
    });
  } else {
    okNotes.push("לא שילמת ריבית על מינוס");
  }

  // ---- account fees ----
  const accFees = fees.filter((f) => f.category === "account");
  const accSum = sum(accFees.map((f) => f.annual));
  if (accSum > 0) {
    const tips = ["לבקש מהבנק פטור מעמלות עו״ש", "להצטרף למסלול עמלות שמתאים לך", "לעבור לבנק בלי עמלות עו״ש"];
    if (accFees.some((f) => /פקיד/.test(f.name))) tips.unshift("לעשות את הפעולות באפליקציה או באתר במקום אצל פקיד");
    if (profile.student) tips.unshift("לבקש מסלול סטודנטים. ברוב הבנקים יש מסלול מוזל או פטור");
    if (profile.soldier) tips.unshift("לבקש את ההטבה לחיילים בשירות סדיר");
    if (profile.senior || profile.disabled) {
      tips.unshift("מגיעות לך 4 פעולות פקיד בחודש במחיר של פעולה בדיגיטל, וצירוף למסלול הבסיסי כשהוא משתלם לך");
    }
    const top = accFees.filter((f) => f.annual > 0).sort((a, b) => b.annual - a.annual);
    let who = "";
    if (profile.student) who += "אני בלימודים, ואשמח לשמוע על מסלול לסטודנטים. ";
    if (profile.soldier) who += "אני בשירות צבאי סדיר, ואשמח לקבל את ההטבה לחיילים. ";
    if (profile.senior || profile.disabled) who += "לפי הכללים לאזרחים ותיקים ולאנשים עם מוגבלות, מגיעות לי 4 פעולות פקיד בחודש במחיר של פעולה בערוץ ישיר. ";
    findings.push({
      id: "accountFees",
      icon: "bank",
      title: "עמלות עו״ש",
      status: "cancel",
      yearly: accSum,
      lead: `שילמת ${ils(accSum)} בשנה על עמלות עו״ש. אפשר לבטל אותן.`,
      items: top.slice(0, 5).map((f) => [f.name, ils(f.annual)]),
      tips: tips.slice(0, 4),
      message: {
        to: "לבנק",
        text: `${fromReport}שילמתי ${ils(accSum)} על עמלות בחשבון העו״ש (${top.slice(0, 3).map((f) => `${f.name}: ${ils(f.annual)}`).join(", ")}). ${who}אבקש לבטל את העמלות, או להעביר את החשבון למסלול עמלות שמשתלם לי, כמו המסלול הבסיסי. תודה.`,
      },
    });
  } else if (fees.length) {
    okNotes.push("לא שילמת עמלות עו״ש");
  }

  // ---- credit allocation fee ----
  const alloc = feeSum("creditAllocation");
  if (alloc > 0) {
    findings.push({
      id: "creditAllocation",
      icon: "bank",
      title: "עמלת הקצאת אשראי",
      status: "cancel",
      yearly: alloc,
      lead: `שילמת ${ils(alloc)} בשנה על מסגרת אשראי. אפשר לבטל את העמלה.`,
      tips: ["לבטל את מסגרת האשראי אם אתה לא משתמש בה", "או להקטין אותה לסכום שאתה באמת צריך"],
      message: {
        to: "לבנק",
        text: `${fromReport}שילמתי ${ils(alloc)} עמלת הקצאת אשראי. אבקש לבטל את העמלה, או להקטין את מסגרת האשראי לסכום שבאמת נחוץ לי. תודה.`,
      },
    });
  }

  // ---- card fees (bank cards from the report + cards entered by hand) ----
  const cardsData = data.cards || {};
  const entries = cardsData.entries || [];
  const bankCard = feeSum("card");
  const manualCard = sum(entries.map((e) => (pos(e.monthlyFee) || 0) * 12));
  const cardTotal = bankCard + manualCard;
  if (cardTotal > 0) {
    const withFee = entries.filter((e) => pos(e.monthlyFee));
    const oneFee = withFee.length === 1 ? ` של ${ils2(withFee[0].monthlyFee)} בחודש` : "";
    findings.push({
      id: "cardFees",
      icon: "card",
      title: "דמי כרטיס",
      status: "cancel",
      yearly: cardTotal,
      lead: `שילמת ${ils(cardTotal)} בשנה על דמי כרטיס. אפשר לקבל פטור מדמי כרטיס.`,
      note: "מבקשים מחברת האשראי. אם היא מסרבת, עוברים לכרטיס בלי דמי כרטיס.",
      tips: ["להתקשר או לכתוב בצ׳אט לחברת האשראי ולבקש פטור", "כרטיס שאתה לא משתמש בו: לבטל אותו"],
      partners: partners.cards || [],
      message: {
        to: manualCard > 0 ? "לחברת האשראי" : "לבנק",
        text: `שלום, על הכרטיס שלי נגבים דמי כרטיס${manualCard > 0 ? oneFee : ""}. אבקש פטור מדמי כרטיס. אם אין אפשרות, אשקול לבטל את הכרטיס ולעבור לכרטיס בלי דמי כרטיס. תודה.`,
      },
    });
  }

  // ---- foreign currency ----
  const fxBank = feeSum("fx");
  let fxCard = 0;
  let fxRates = [];
  for (const e of entries) {
    const spend = pos(e.fxSpend);
    const rate = pos(e.fxRate);
    if (spend && rate) { fxCard += (spend * rate) / 100; fxRates.push(rate); }
  }
  const fxTotal = fxBank + fxCard;
  if (fxTotal > 0) {
    const maxRate = fxRates.length ? Math.max(...fxRates) : null;
    findings.push({
      id: "fx",
      icon: "globe",
      title: "מטבע חוץ",
      status: "save",
      yearly: fxTotal,
      lead: `שילמת ${ils(fxTotal)} בשנה על עמלות מטבע חוץ.`,
      compare: maxRate ? [["עמלת המט״ח בכרטיס שלך", pct(maxRate)], ["כרטיס בלי עמלת מט״ח", "0%"]] : null,
      note: fxBank > 0 ? "בהמרות ובהעברות בבנק עצמו, פעולה בערוץ הדיגיטלי זולה יותר מפעולה אצל פקיד." : null,
      tips: ["לשלם בחו״ל ובאתרים בחו״ל עם כרטיס בלי עמלת מט״ח", "בחו״ל לבחור לשלם במטבע המקומי, לא בשקלים"],
      partners: partners.fxCards || [],
      message: fxCard > 0
        ? { to: "לחברת האשראי", text: `שלום, על קניות במטבע חוץ בכרטיס שלי נגבית עמלה${maxRate ? ` של ${pct(maxRate)}` : ""}. אבקש לבטל את עמלת המט״ח או להוריד אותה. תודה.` }
        : { to: "לבנק", text: `${fromReport}שילמתי ${ils(fxBank)} עמלות על פעולות במטבע חוץ. אבקש להוריד את העמלות על המרות והעברות במטבע חוץ. תודה.` },
    });
  }

  // ---- credit transactions (קרדיט) ----
  const credit = sum(entries.map((e) => pos(e.creditInterest) || 0));
  if (credit > 0) {
    findings.push({
      id: "creditTxn",
      icon: "card",
      title: "עסקאות קרדיט",
      status: "save",
      yearly: credit,
      lead: `שילמת ${ils(credit)} ריבית על עסקאות קרדיט בשנה. בלי קרדיט, חוסכים את כל הסכום הזה.`,
      note: `חלופה: הלוואה בריבית הממוצעת, ${pct(B.householdLoanAvg.value)}, או תשלומים בלי ריבית.`,
      tips: ["לבקש מהעסק תשלומים בלי ריבית במקום קרדיט", "לא לפרוס עסקה רגילה לקרדיט אחרי שהיא בוצעה"],
      message: {
        to: "לחברת האשראי",
        text: `שלום, בשנה האחרונה שילמתי ${ils(credit)} ריבית על עסקאות קרדיט. אבקש לדעת מה יתרת הקרדיט שלי ומה הריבית, ולקבל הצעה לפרוע את היתרה מוקדם או להעביר אותה לריבית נמוכה יותר. תודה.`,
      },
    });
  }

  // ---- loans ----
  const loanAvg = B.householdLoanAvg.value;
  (data.loans || []).forEach((l, i) => {
    const bal = pos(l.balance);
    const rate = num(l.rate);
    if (!bal || rate == null) return;
    const src = l.source || "report";
    const title = l.name ? `הלוואה · ${l.name}` : LOAN_TITLE[src] || "הלוואה";
    if (rate > loanAvg + 0.05) {
      const yearly = (bal * (rate - loanAvg)) / 100;
      const months = pos(l.monthsLeft);
      const total = remainingSaving(bal, rate, loanAvg, months);
      const ext = isExternal(src);
      findings.push({
        id: "loan" + i,
        icon: "loan",
        title,
        status: "above",
        yearly,
        total,
        lead: `חיסכון אפשרי: ${ils(yearly)} בשנה${total ? `, ${ils(total)} עד סוף ההלוואה` : ""}.`,
        compare: [["הריבית שלך", pct(rate)], ["ממוצע ההלוואות", pct(loanAvg)]],
        tips: ext
          ? ["לבקש מהבנק שלך הלוואה בריבית נמוכה יותר, כדי לסגור את ההלוואה הזאת", "לבקש ממי שנתן את ההלוואה להוריד את הריבית", "לבדוק מראש אם יש עמלת פירעון מוקדם"]
          : ["לבקש מהבנק להוריד את הריבית לממוצע", "לבדוק הצעה בבנק אחר ולמחזר את ההלוואה", "לבדוק מראש אם יש עמלת פירעון מוקדם"],
        message: ext
          ? { to: "לבנק שלך", text: `שלום, יש לי הלוואה ${LOAN_SOURCES.find((s) => s[0] === src)[1]} ביתרה של ${ils(bal)}, בריבית של ${pct(rate)}. לפי נתוני בנק ישראל, הריבית הממוצעת בהלוואות לצרכן היא ${pct(loanAvg)}. אשמח לקבל הצעה להלוואה בריבית נמוכה יותר, כדי לסגור את ההלוואה הזאת. תודה.` }
          : { to: "לבנק", text: `שלום, יש לי הלוואה ביתרה של ${ils(bal)}, בריבית של ${pct(rate)}. לפי נתוני בנק ישראל, הריבית הממוצעת בהלוואות לצרכן היא ${pct(loanAvg)}. אבקש להוריד את הריבית בהלוואה, או לקבל הצעה למחזר אותה. אשמח לדעת גם אם יש עמלת פירעון מוקדם. תודה.` },
      });
    } else {
      okNotes.push(`הריבית ב${title} לא מעל הממוצע`);
    }
  });

  // ---- mortgage ----
  const T = B.mortgage.tracks;
  (data.mortgage || []).forEach((m, i) => {
    const bal = pos(m.balance);
    const rate = num(m.rate);
    const def = T[m.track];
    if (!bal || rate == null || !def) return;
    let diff;
    let compare;
    let avgText;
    if (m.track === "prime") {
      const margin = rate - B.prime.value;
      diff = margin - def.margin;
      compare = [["המרווח שלך", signed(margin)], ["מרווח ממוצע", signed(def.margin)]];
      avgText = `מרווח של ${signed(def.margin)}, ואצלי ${signed(margin)}`;
    } else {
      diff = rate - def.value;
      compare = [["הריבית שלך", pct(rate)], ["ממוצע בנק ישראל", pct(def.value)]];
      avgText = pct(def.value);
    }
    if (diff > 0.05) {
      const yearly = (bal * diff) / 100;
      const months = pos(m.monthsLeft);
      const total = remainingSaving(bal, rate, rate - diff, months);
      const fixed = m.track === "fixedUnlinked" || m.track === "fixedLinked";
      findings.push({
        id: "mortgage" + i,
        icon: "house",
        title: `משכנתא · ${def.label}`,
        status: "above",
        yearly,
        total,
        lead: `חיסכון אפשרי: ${ils(yearly)} בשנה${total ? `, ${ils(total)} עד סוף המסלול` : ""}.`,
        compare,
        note: fixed ? "במיחזור של מסלול קבוע יש עמלת פירעון מוקדם. כדאי לבקש מהבנק את הסכום לפני שמחליטים." : null,
        tips: ["לבקש מהבנק להוריד את הריבית במסלול הזה", "לבדוק מיחזור מול הצעות של בנקים אחרים"],
        message: {
          to: "לבנק",
          text: `שלום, במסלול \"${def.label}\" של המשכנתא שלי הריבית היא ${pct(rate)}. לפי בנק ישראל, הממוצע במשכנתאות חדשות במסלול הזה ב${monthText(B.mortgage.asOf)} היה ${avgText}. אבקש להוריד את הריבית במסלול, או לקבל הצעה למחזור.${fixed ? " אשמח לדעת גם מה עמלת הפירעון המוקדם." : ""} תודה.`,
        },
      });
    } else {
      okNotes.push(`מסלול ${def.label} במשכנתא לא מעל הממוצע`);
    }
  });
  if (pos(data.mortgageBalance) && !(data.mortgage || []).some((m) => pos(m.balance))) {
    missing.push({
      id: "mortgageTracks",
      text: `יש לך משכנתא עם יתרה של ${ils(data.mortgageBalance)}. כדי לבדוק את הריבית, צריך את המסלולים שלה.`,
      action: "להזין את מסלולי המשכנתא",
    });
  }

  // ---- securities custody ----
  const sec = data.securities || {};
  const cRate = pos(sec.custodyRate);
  const value = pos(sec.value) || pos(sec.avgValue);
  const bankAvg = B.custodyBanksAvg.value;
  if (cRate && value) {
    if (cRate > bankAvg + 0.01) {
      const yearly = (value * (cRate - bankAvg)) / 100;
      findings.push({
        id: "securities",
        icon: "chart",
        title: "דמי משמרת ני״ע",
        status: "above",
        yearly,
        lead: `חיסכון אפשרי: ${ils(yearly)} בשנה, אם דמי המשמרת יירדו לממוצע הבנקים. בדוח שלך: ${ils(feeSum("securities") || pos(sec.custodyFee) || 0)} בשנת הדוח.`,
        compare: [["אצלך", pct(cRate) + " בשנה"], ["ממוצע הבנקים", pct(bankAvg)]],
        tips: ["לבקש מהבנק להוריד את דמי המשמרת", "להעביר את התיק לבית השקעות עם דמי משמרת נמוכים יותר"],
        partners: partners.brokers || [],
        message: {
          to: "לבנק",
          text: `שלום, דמי המשמרת בתיק ניירות הערך שלי הם ${pct(cRate)} בשנה, והממוצע בבנקים הוא ${pct(bankAvg)}. אבקש להוריד את דמי המשמרת. אם אין אפשרות, אשקול להעביר את התיק. תודה.`,
        },
      });
    } else {
      okNotes.push("דמי המשמרת שלך לא מעל ממוצע הבנקים");
    }
  }

  // ---- card companies without data ----
  const companies = cardsData.companies || [];
  for (const c of companies) {
    const e = entries.find((x) => x.company === c);
    const has = e && (pos(e.monthlyFee) != null || pos(e.fxSpend) != null || pos(e.creditInterest) != null || e.checked);
    if (!has) {
      missing.push({
        id: "card-" + c,
        text: `יש לך הרשאות לחיוב של ${c}. דמי הכרטיס ועמלות המט״ח שלה לא מופיעים בדוח של הבנק.`,
        action: "להזין את הנתונים מהכרטיס",
      });
    }
  }

  // ---- other fees ----
  const other = fees.filter((f) => f.category === "loan" && f.annual > 0);
  if (other.length) {
    const s = sum(other.map((f) => f.annual));
    findings.push({
      id: "otherFees",
      icon: "bank",
      title: "עמלות אשראי",
      status: "save",
      yearly: s,
      lead: `שילמת ${ils(s)} בשנה על עמלות שקשורות להלוואות.`,
      items: other.map((f) => [f.name, ils(f.annual)]),
      tips: ["לבקש מהבנק לוותר על עמלות טיפול בהלוואה", "לפני פירעון מוקדם, לבקש את גובה העמלה"],
      message: {
        to: "לבנק",
        text: `${fromReport}שילמתי ${ils(s)} עמלות שקשורות להלוואות. אבקש לבדוק אם אפשר לבטל אותן או להפחית אותן. תודה.`,
      },
    });
  }

  findings.sort((a, b) => (b.yearly || 0) - (a.yearly || 0));
  const yearly = sum(findings.map((f) => f.yearly));
  const total = sum(findings.map((f) => f.total || 0));
  return { findings, okNotes, missing, yearly, total, paid: computePaid(data) };
}

// ---------- formatting ----------

const ilsFmt = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
export function ils(v) {
  return `${ilsFmt.format(Math.round(Number(v) || 0))} ₪`;
}
// Keeps agorot, for amounts like a monthly card fee of 14.90.
export function ils2(v) {
  const n = Number(v) || 0;
  const d = Number.isInteger(n) ? 0 : 2;
  return `${new Intl.NumberFormat("he-IL", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)} ₪`;
}
export function pct(v) {
  return `${Number(Number(v).toFixed(2))}%`;
}
function signed(v) {
  const n = Number(v);
  return `${n >= 0 ? "פריים +" : "פריים −"}${Math.abs(n).toFixed(2)}%`;
}
