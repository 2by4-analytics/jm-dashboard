const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Busboy = require("busboy");
const { Client } = require("pg");

const port = Number(process.env.PORT || 3000);
const root = __dirname;
const tithesRate = 0.1;
const currentMonthKey = "2026-03";
const maxPdfBytes = 15 * 1024 * 1024;
const seedBills = [
  ["Child Support", 650, "NO"],
  ["Health Insurance", 300, "NO"],
  ["Jacobs Car", 600, "NO"],
  ["Car Hauler", 168, "NO"],
  ["Shed Trailer - Paducah", 2400, "NO"],
  ["Side by Side", 600, "NO"],
  ["New Truck", 1600, "NO"],
  ["Shed Truck", 1100, "NO"],
  ["Forcht Bank Credit Card", 0, "NO"],
  ["Personal Loan", 1000, "NO"],
  ["RCR Hunting Blind", 166.85, "NO"],
  ["Ford Financial - Car & Bronco", 1800, "NO"],
  ["Shed Geek", 1040, "NO"],
  ["State Farm Insurance", 900, "NO"],
  ["Motor Carrier", 150, "NO"],
  ["Bee Garbage", 100, "NO"],
  ["Dish", 200, "NO"],
  ["Jackson Propane", 0, "NO"],
  ["KU", 350, "NO"],
  ["Windstream", 100, "NO"],
  ["Western Rockcastle Water", 100, "NO"],
  ["Truck", 1600, "NO"],
  ["House", 2500, "NO"],
  ["Land", 400, "NO"],
  ["State Revenue", 100, "NO"],
  ["IRS", 600, "NO"],
];

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : false,
});

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

start().catch((error) => {
  console.error("Startup failed", error);
  process.exit(1);
});

async function start() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  await client.connect();
  await ensureSchema();
  await ensureSeedData();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const monthKey = getMonthKey(url.searchParams.get("month"));

      if (url.pathname === "/health" && req.method === "GET") return sendJson(res, 200, { ok: true });

      if (url.pathname === "/api/bootstrap" && req.method === "GET") {
        return sendJson(res, 200, {
          months: listAvailableMonths(),
          selectedMonth: monthKey,
          currentMonth: currentMonthKey,
          tithesRate: tithesRate,
        });
      }

      if (url.pathname === "/api/state" && req.method === "GET") {
        return sendJson(res, 200, {
          bills: await listBills(monthKey),
          month: monthKey,
          months: listAvailableMonths(),
          tithesRate: tithesRate,
        });
      }

      if (url.pathname === "/api/bills" && req.method === "POST") {
        const body = await readJsonBody(req);
        const bill = await createBill(monthKey, body || {});
        return sendJson(res, 201, bill);
      }

      if (url.pathname === "/api/reset" && req.method === "POST") {
        await client.query("UPDATE bills SET paid = 'NO', updated_at = NOW() WHERE deleted_at IS NULL AND month_key = $1", [monthKey]);
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === "/api/tax-docs" && req.method === "GET") {
        return sendJson(res, 200, { docs: await listTaxDocs() });
      }

      if (url.pathname === "/api/tax-docs" && req.method === "POST") {
        const uploaded = await parsePdfUpload(req);
        const doc = await createTaxDoc(uploaded);
        return sendJson(res, 201, doc);
      }

      const billMatch = url.pathname.match(/^\/api\/bills\/([a-f0-9-]+)$/i);
      if (billMatch) {
        const billId = billMatch[1];
        if (req.method === "PATCH") {
          const body = await readJsonBody(req);
          const bill = await updateBill(billId, body || {});
          if (!bill) return sendJson(res, 404, { error: "Bill not found" });
          return sendJson(res, 200, bill);
        }
        if (req.method === "DELETE") {
          await client.query("UPDATE bills SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1", [billId]);
          return sendJson(res, 204, null);
        }
      }

      const taxDocMatch = url.pathname.match(/^\/api\/tax-docs\/([a-f0-9-]+)(?:\/(download|view))?$/i);
      if (taxDocMatch) {
        const docId = taxDocMatch[1];
        const mode = taxDocMatch[2] || "meta";

        if (req.method === "DELETE" && mode === "meta") {
          await client.query("UPDATE tax_docs SET deleted_at = NOW() WHERE id = $1", [docId]);
          return sendJson(res, 204, null);
        }

        if (req.method === "GET" && (mode === "download" || mode === "view")) {
          return streamTaxDoc(res, docId, mode);
        }
      }

      return serveStatic(res, url.pathname);
    } catch (error) {
      console.error("Request failed", error);
      sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Listening on ${port}`);
  });
}

async function ensureSchema() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY,
      month_key TEXT,
      name TEXT NOT NULL DEFAULT '',
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid TEXT NOT NULL DEFAULT 'NO',
      sort_order INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await client.query("ALTER TABLE bills ADD COLUMN IF NOT EXISTS month_key TEXT");
  await client.query("UPDATE bills SET month_key = $1 WHERE month_key IS NULL", [currentMonthKey]);
  await client.query("CREATE INDEX IF NOT EXISTS bills_month_key_sort_idx ON bills (month_key, sort_order)");

  await client.query(`
    CREATE TABLE IF NOT EXISTS tax_docs (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      file_data BYTEA NOT NULL
    )
  `);
}

async function ensureSeedData() {
  const months = listAvailableMonths();
  for (let index = 0; index < months.length; index += 1) {
    const monthKey = months[index].value;
    const { rows } = await client.query("SELECT COUNT(*)::int AS count FROM bills WHERE deleted_at IS NULL AND month_key = $1", [monthKey]);
    if (rows[0].count > 0) continue;

    for (let billIndex = 0; billIndex < seedBills.length; billIndex += 1) {
      const seed = seedBills[billIndex];
      await client.query(
        "INSERT INTO bills (id, month_key, name, amount, paid, sort_order) VALUES ($1, $2, $3, $4, $5, $6)",
        [crypto.randomUUID(), monthKey, seed[0], seed[1], seed[2], billIndex]
      );
    }
  }
}

function listAvailableMonths() {
  return [
    { value: "2026-01", label: "January 2026" },
    { value: "2026-02", label: "February 2026" },
    { value: "2026-03", label: "March 2026" },
  ];
}

function getMonthKey(candidate) {
  const months = listAvailableMonths();
  for (let i = 0; i < months.length; i += 1) {
    if (months[i].value === candidate) return candidate;
  }
  return currentMonthKey;
}

async function listBills(monthKey) {
  const { rows } = await client.query(
    "SELECT id, month_key, name, amount::float8 AS amount, paid, sort_order FROM bills WHERE deleted_at IS NULL AND month_key = $1 ORDER BY sort_order ASC, created_at ASC",
    [monthKey]
  );
  return rows;
}

async function createBill(monthKey, input) {
  const { rows } = await client.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM bills WHERE deleted_at IS NULL AND month_key = $1", [monthKey]);
  const bill = normalizeBillInput(input);
  const created = await client.query(
    `INSERT INTO bills (id, month_key, name, amount, paid, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, month_key, name, amount::float8 AS amount, paid, sort_order`,
    [crypto.randomUUID(), monthKey, bill.name, bill.amount, bill.paid, rows[0].next_order]
  );
  return created.rows[0];
}

async function updateBill(id, input) {
  const bill = normalizeBillInput(input);
  const result = await client.query(
    `UPDATE bills
     SET name = $2, amount = $3, paid = $4, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, month_key, name, amount::float8 AS amount, paid, sort_order`,
    [id, bill.name, bill.amount, bill.paid]
  );
  return result.rows[0] || null;
}

async function listTaxDocs() {
  const { rows } = await client.query(
    "SELECT id, original_name, content_type, byte_size, uploaded_at FROM tax_docs WHERE deleted_at IS NULL ORDER BY uploaded_at DESC"
  );
  return rows;
}

async function createTaxDoc(uploaded) {
  const result = await client.query(
    `INSERT INTO tax_docs (id, original_name, content_type, byte_size, file_data)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, original_name, content_type, byte_size, uploaded_at`,
    [crypto.randomUUID(), uploaded.filename, uploaded.contentType, uploaded.buffer.length, uploaded.buffer]
  );
  return result.rows[0];
}

async function streamTaxDoc(res, docId, mode) {
  const result = await client.query(
    "SELECT original_name, content_type, file_data FROM tax_docs WHERE id = $1 AND deleted_at IS NULL",
    [docId]
  );
  const row = result.rows[0];
  if (!row) return sendJson(res, 404, { error: "Document not found" });

  const dispositionType = mode === "download" ? "attachment" : "inline";
  res.writeHead(200, {
    "Content-Type": row.content_type,
    "Content-Length": row.file_data.length,
    "Content-Disposition": dispositionType + '; filename="' + sanitizeFilename(row.original_name) + '"',
    "Cache-Control": "no-cache",
  });
  res.end(row.file_data);
}

function parsePdfUpload(req) {
  return new Promise((resolve, reject) => {
    if (!req.headers["content-type"] || req.headers["content-type"].indexOf("multipart/form-data") !== 0) {
      const error = new Error("Upload must use multipart/form-data");
      error.statusCode = 400;
      reject(error);
      return;
    }

    const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxPdfBytes } });
    let uploadedFile = null;
    let finished = false;

    busboy.on("file", function (fieldName, file, info) {
      const chunks = [];
      const filename = info && info.filename ? info.filename : "document.pdf";
      const mimeType = info && info.mimeType ? info.mimeType : "application/pdf";

      if (mimeType !== "application/pdf" && !/\.pdf$/i.test(filename)) {
        file.resume();
        const error = new Error("Only PDF files are supported");
        error.statusCode = 400;
        rejectOnce(error);
        return;
      }

      file.on("data", function (chunk) {
        chunks.push(chunk);
      });

      file.on("limit", function () {
        const error = new Error("PDF exceeds the 15MB upload limit");
        error.statusCode = 400;
        rejectOnce(error);
      });

      file.on("end", function () {
        if (finished) return;
        uploadedFile = {
          filename: filename,
          contentType: "application/pdf",
          buffer: Buffer.concat(chunks),
        };
      });
    });

    busboy.on("finish", function () {
      if (finished) return;
      if (!uploadedFile || !uploadedFile.buffer.length) {
        const error = new Error("No PDF file was uploaded");
        error.statusCode = 400;
        rejectOnce(error);
        return;
      }
      finished = true;
      resolve(uploadedFile);
    });

    busboy.on("error", function (error) {
      rejectOnce(error);
    });

    function rejectOnce(error) {
      if (finished) return;
      finished = true;
      reject(error);
    }

    req.pipe(busboy);
  });
}

function normalizeBillInput(input) {
  return {
    name: typeof input.name === "string" ? input.name.slice(0, 200) : "",
    amount: Number.isFinite(Number(input.amount)) ? Number(input.amount) : 0,
    paid: input.paid === "YES" ? "YES" : "NO",
  };
}

function sanitizeFilename(name) {
  return String(name || "document.pdf").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1000000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(res, pathname) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, "");
  const filePath = path.join(root, safePath);

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (error.code === "ENOENT") {
        fs.readFile(path.join(root, "index.html"), (fallbackError, fallbackData) => {
          if (fallbackError) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Server error");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(fallbackData);
        });
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload) {
  if (statusCode === 204) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
