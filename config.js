// config.js — settings that change when the site goes live.

export const CONFIG = {
  // The public address, for the WhatsApp share text. Empty = the address the page was opened from.
  siteUrl: "",

  // Address of the message inbox (a Google Apps Script web app, see backend/Code.gs).
  // Empty = test mode: chat messages are kept only on this device.
  messagesUrl: "",

  // Test mode for the preview: with no messagesUrl, chat messages are kept on this device so the flow can be tried.
  // On the live site this stays false: until the inbox is connected, the chat offers answers only, no message box.
  testInbox: false,

  // Cloudflare Web Analytics token. Empty = no visit counting.
  analyticsToken: "",

  // Shown on the legal pages. Fill in before going live.
  owner: { name: "[שם בעל האתר]", email: "[כתובת מייל]", court: "[מחוז]", a11yContact: "[שם, מייל וטלפון של רכז הנגישות]" },

  // Shows a "draft for the lawyer" note on the legal pages.
  legalDraft: true,
  legalUpdated: "2026-11-03",
};
