// benchmarks.js — the averages the site compares against.
// Updated once a month by a scheduled task. Every value keeps its date and source.

export const BENCHMARKS = {
  updated: "2026-11-01",

  boiRate: {
    value: 3.25,
    asOf: "2026-10-21",
    nextDecision: "2026-11-23",
    source: { name: "סופרמרקר", url: "https://www.supermarker.themarker.com/Mortgage/PrimeInterestEffectsOnLoansAndMortgages.aspx" },
  },
  prime: {
    value: 4.75,
    asOf: "2026-10-21",
    source: { name: "סופרמרקר", url: "https://www.supermarker.themarker.com/Mortgage/PrimeInterestEffectsOnLoansAndMortgages.aspx" },
  },

  // Average interest actually charged on overdraft, all banks.
  overdraftAvg: {
    value: 11.51,
    asOf: "2026-07",
    source: { name: "סופרמרקר, לפי נתוני בנק ישראל", url: "https://www.supermarker.themarker.com/Account/CompareBankAccount.aspx" },
  },

  // Average interest on new household loans, banks and card companies.
  householdLoanAvg: {
    value: 7.93,
    asOf: "2026-09",
    source: { name: "ביזפורטל, לפי קו המשווה של בנק ישראל", url: "https://www.bizportal.co.il/financialconsumerism/news/article/20018015" },
  },

  // Average rate on new mortgages, by track. Prime is compared by its margin over prime.
  mortgage: {
    asOf: "2026-09",
    source: { name: "בנק ישראל, דוח חודשי על הלוואות לדיור", url: "https://boi.org.il/roles/statistics/banking/mortgage/monthly-report-on-housing-loans/" },
    tracks: {
      prime: { margin: -0.67, label: "פריים" },
      fixedUnlinked: { value: 4.65, label: "קבועה לא צמודה" },
      fixedLinked: { value: 3.33, label: "קבועה צמודה" },
      variableUnlinked: { value: 4.56, label: "משתנה לא צמודה" },
      variableLinked: { value: 3.46, label: "משתנה צמודה" },
    },
  },

  // Effective custody fee on Israeli securities, simple average of 9 banks (portfolio of 100-200K).
  custodyBanksAvg: {
    value: 0.32,
    asOf: "2026",
    source: { name: "ביזפורטל", url: "https://www.bizportal.co.il/capitalmarket/news/article/828018" },
  },

  basicTrackMax: {
    value: 10,
    source: { name: "סופרמרקר", url: "https://www.supermarker.themarker.com/Account/CompareBankAccount.aspx" },
  },
  debitCardCap: {
    value: 7,
    from: "2026-10-01",
    source: { name: "חוזר בנק ישראל", url: "https://www.boi.org.il/media/0cgabv01/h2851.pdf" },
  },
  fxCardTypical: {
    value: 3,
    asOf: "2026-07",
    source: { name: "מאקו", url: "https://www.mako.co.il/finances-money/Article-0d5524f275f5f91026.htm" },
  },
  fxZeroCard: {
    example: "ישראכרט BASIC",
    source: { name: "ישראכרט", url: "https://www.isracard.co.il/credit-cards/basic" },
  },
};
