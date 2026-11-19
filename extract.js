// extract.js — turns a PDF (loaded by pdf.js) into plain text items per page.
// Works with any pdf.js document object, so the browser and the tests share it.

export async function pagesFromPdf(doc) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      items.push({
        str: it.str,
        x: t[4],
        y: t[5],
        w: it.width || 0,
        h: it.height || Math.abs(t[3]) || 8,
      });
    }
    pages.push({ items });
    page.cleanup();
  }
  return pages;
}

// Browser only: load pdf.js from the site's own files and read a File.
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("./vendor/pdf.min.js").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.js", import.meta.url).href;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function readPdfFile(file) {
  const lib = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  const task = lib.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  try {
    doc = await task.promise;
  } catch (e) {
    if (e && e.name === "PasswordException") {
      const err = new Error("password");
      err.code = "password";
      throw err;
    }
    throw e;
  }
  const pages = await pagesFromPdf(doc);
  const textLength = pages.reduce((s, p) => s + p.items.reduce((t, i) => t + i.str.length, 0), 0);
  try { await task.destroy(); } catch (e) { /* nothing to free */ }
  return { pages, textLength };
}
