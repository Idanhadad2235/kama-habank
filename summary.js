// summary.js — draws the results summary on a canvas and exports it as PNG or PDF.
// The PDF is built by hand: each A4 page holds one JPEG slice of the canvas.

import { ils } from "./analysis.js";

const W = 1080;
const M = 72;
const FONT = "Heebo, 'Segoe UI', Arial, sans-serif";
const C = { ink: "#111827", muted: "#4B5563", accent: "#1D4ED8", line: "#E3E7EE", bg: "#FFFFFF", soft: "#F3F5F8" };

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function layout(ctx, res, meta, B, draw) {
  let y = M;
  const right = W - M;
  const maxW = W - 2 * M;
  const text = (s, size, weight, color, lh = 1.45) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const lines = wrap(ctx, s, maxW);
    for (const l of lines) {
      y += size;
      if (draw) { ctx.fillStyle = color; ctx.fillText(l, right, y); }
      y += size * (lh - 1);
    }
  };
  const gap = (h) => { y += h; };
  const rule = () => {
    gap(18);
    if (draw) { ctx.fillStyle = C.line; ctx.fillRect(M, y, maxW, 2); }
    gap(26);
  };

  text("כמה הבנק לוקח לי?", 52, 800, C.ink);
  const years = String(meta.year || "");
  text(`סיכום תעודת הזהות הבנקאית${years ? (years.includes(",") ? " לשנים " : " לשנת ") + years : ""}${meta.bank ? " · " + meta.bank : ""}`, 26, 400, C.muted);
  gap(24);
  if (res.paid) {
    text("כמה שילמת בשנה", 28, 500, C.muted);
    text(`עמלות ודמי כרטיס: ${ils(res.paid.fees)}   ·   ריביות: ${ils(res.paid.interest)}`, 34, 700, C.ink);
    const notes = [
      res.paid.estimate ? "הריבית על הלוואות ועל המשכנתא היא הערכה, לפי היתרה והריבית." : null,
      res.paid.mortgageMissing ? "בלי ריבית המשכנתא, כי חסרים המסלולים שלה." : null,
    ].filter(Boolean);
    if (notes.length) text(notes.join(" "), 24, 400, C.muted);
    gap(20);
  }
  text("חיסכון אפשרי בשנה", 28, 500, C.muted);
  text(ils(res.yearly), 76, 800, C.accent, 1.2);
  if (res.total > 0) text(`ועוד ${ils(res.total)} עד סוף ההלוואות והמשכנתא (הערכה)`, 28, 500, C.ink);
  rule();

  for (const f of res.findings) {
    text(f.title, 36, 700, C.ink);
    gap(4);
    text(f.lead, 28, 400, C.ink);
    if (f.compare) text(f.compare.map((c) => `${c[0]}: ${c[1]}`).join("   ·   "), 26, 500, C.muted);
    if (f.note) text(f.note, 26, 400, C.muted);
    if (f.tips && f.tips[0]) text(`מה עושים: ${f.tips[0]}`, 26, 500, C.ink);
    rule();
  }
  if (res.okNotes.length) {
    text("מה בסדר אצלך", 32, 700, C.ink);
    for (const n of res.okNotes) text(`✓ ${n}`, 26, 400, C.ink);
    rule();
  }
  if (res.missing.length) {
    text("לא נמצא בדוח", 32, 700, C.ink);
    for (const m of res.missing) text(m.text, 26, 400, C.muted);
    rule();
  }
  text(`נתוני ההשוואה: עדכון ${B.updated.split("-").reverse().join(".")}. מקורות: בנק ישראל ופרסומים שמבוססים עליו.`, 22, 400, C.muted);
  text("המידע אינו ייעוץ פיננסי. החיסכון בהלוואות ובמשכנתא הוא הערכה.", 22, 400, C.muted);
  gap(M);
  return Math.ceil(y);
}

export async function drawSummary(res, meta, B) {
  try { await document.fonts.load(`700 40px Heebo`); } catch (e) { /* fallback fonts */ }
  const probe = document.createElement("canvas").getContext("2d");
  probe.direction = "rtl";
  probe.textAlign = "right";
  const h = layout(probe, res, meta, B, false);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, h);
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  layout(ctx, res, meta, B, true);
  return canvas;
}

const toBlob = (canvas, type, q) => new Promise((ok) => canvas.toBlob(ok, type, q));

export async function summaryPng(res, meta, B) {
  const canvas = await drawSummary(res, meta, B);
  return toBlob(canvas, "image/png");
}

export async function summaryPdf(res, meta, B) {
  const canvas = await drawSummary(res, meta, B);
  const pageH = Math.round((W * 842) / 595);
  const jpegs = [];
  for (let top = 0; top < canvas.height; top += pageH) {
    const h = Math.min(pageH, canvas.height - top);
    const slice = document.createElement("canvas");
    slice.width = W;
    slice.height = pageH;
    const c = slice.getContext("2d");
    c.fillStyle = "#FFFFFF";
    c.fillRect(0, 0, W, pageH);
    c.drawImage(canvas, 0, top, W, h, 0, 0, W, h);
    const blob = await toBlob(slice, "image/jpeg", 0.92);
    jpegs.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return new Blob([buildPdf(jpegs, W, pageH)], { type: "application/pdf" });
}

// Minimal PDF: catalog, pages, and per page a content stream + a JPEG image.
export function buildPdf(jpegs, imgW, imgH) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (data) => {
    const b = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(b);
    length += b.length;
  };
  const obj = (id, body) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    for (const part of body) push(part);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const n = jpegs.length;
  const pageIds = jpegs.map((_, i) => 3 + i * 3);
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`]);
  jpegs.forEach((jpg, i) => {
    const pid = 3 + i * 3;
    const content = `q 595 0 0 842 0 0 cm /Im${i} Do Q`;
    obj(pid, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im${i} ${pid + 2} 0 R >> >> /Contents ${pid + 1} 0 R >>`]);
    obj(pid + 1, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    obj(pid + 2, [`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"]);
  });
  const size = 3 + n * 3;
  const xref = length;
  let table = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let id = 1; id < size; id++) table += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
