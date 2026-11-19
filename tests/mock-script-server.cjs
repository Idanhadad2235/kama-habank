// A local stand-in for the Apps Script web app: runs backend/Code.gs with fake Google services.
// Like Apps Script, it answers simple POSTs and refuses CORS preflight (OPTIONS), so the test fails if the client triggers one.
const http = require("http");
const { createGas } = require("./gas-mock.cjs");
const port = Number(process.argv[2] || 8766);
const g = createGas();
g.ctx.setup();
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(405); return res.end(); }
  if (req.url.startsWith("/__state")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ rows: g.rows, sent: g.sent, key: g.props.ADMIN_KEY }));
  }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const out = req.method === "POST" ? g.ctx.doPost({ postData: { contents: body } }) : g.ctx.doGet();
    res.setHeader("Content-Type", "application/json");
    res.end(out.content);
  });
}).listen(port, "127.0.0.1", () => console.log("mock inbox on", port));
