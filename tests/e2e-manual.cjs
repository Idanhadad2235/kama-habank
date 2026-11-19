// Manual-entry path: every finding type, checked in the browser.
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const out = process.argv[2] || "/tmp/e2e";
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto("http://127.0.0.1:8765/index.html");
  await p.click('[data-action="manual"]');
  await p.waitForSelector("text=בודקים את המספרים");
  // overdraft
  await p.fill('input[data-path="overdraft.interestPaid"]', "1200");
  await p.fill('input[data-path="overdraft.rate"]', "13");
  await p.fill('input[data-path="overdraft.avgDebit"]', "9000");
  // fees
  await p.click('[data-action="add-fee"]');
  await p.fill('input[data-path="fees.0.name"]', "דמי ניהול חשבון");
  await p.fill('input[data-path="fees.0.annual"]', "300");
  await p.click('[data-action="add-fee"]');
  await p.fill('input[data-path="fees.1.name"]', "עמלת הקצאת אשראי");
  await p.fill('input[data-path="fees.1.annual"]', "60");
  await p.selectOption('select[data-path="fees.1.category"]', "creditAllocation");
  // card
  await p.click('[data-action="add-card"][data-company="כאל"]');
  await p.fill('input[data-path="cards.entries.0.monthlyFee"]', "19.9");
  await p.fill('input[data-path="cards.entries.0.fxSpend"]', "8000");
  await p.fill('input[data-path="cards.entries.0.creditInterest"]', "250");
  // loan
  await p.click('[data-action="add-loan"]');
  await p.fill('input[data-path="loans.0.balance"]', "50000");
  await p.fill('input[data-path="loans.0.rate"]', "10");
  await p.fill('input[data-path="loans.0.years"]', "3");
  // mortgage prime
  await p.click('[data-action="add-track"]');
  await p.selectOption('select[data-path="mortgage.0.track"]', "prime");
  await p.fill('input[data-path="mortgage.0.balance"]', "200000");
  await p.fill('input[data-path="mortgage.0.rate"]', "4.45");
  await p.fill('input[data-path="mortgage.0.years"]', "20");
  // securities
  await p.fill('input[data-path="securities.custodyRate"]', "0.2");
  await p.fill('input[data-path="securities.value"]', "100000");
  await p.check('input[data-path="profile.student"]');
  await p.screenshot({ path: out + "/m-review.png", fullPage: true });
  await p.click('[data-action="results"]');
  await p.waitForSelector("text=חיסכון אפשרי");
  await p.screenshot({ path: out + "/m-results.png", fullPage: true });
  fs.writeFileSync(out + "/m-results.txt", await p.locator("#app").innerText());
  // open every "how" section to check tips render
  console.log("errors:", errors.length ? errors.join("\n") : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
