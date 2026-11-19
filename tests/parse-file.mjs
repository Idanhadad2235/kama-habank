// Test harness: parse a report PDF with the site's own parser and print the model.
// Usage: node tests/parse-file.mjs <file.pdf> [--lines]
import fs from "node:fs";
import * as pdfjs from "/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import { pagesFromPdf } from "../extract.js";
import { parseBankReport, buildLines } from "../parser.js";

const file = process.argv[2];
const showLines = process.argv.includes("--lines");
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
const pages = await pagesFromPdf(doc);
if (showLines) {
  pages.forEach((p, i) => buildLines(p.items, i).forEach((l) => console.log(i + 1, "|", l.text)));
}
const model = parseBankReport(pages);
const out = { ...model, found: [...model.found] };
console.log(JSON.stringify(out, null, 2));
