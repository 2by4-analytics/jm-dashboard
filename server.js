const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const port = Number(process.env.PORT || 3000);
const root = __dirname;
const tithesRate = 0.1;
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
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  await client.connect();
  await ensureSchema();
  await ensureSeedData();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname === "/health" && req.method === "GET") {
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === "/api/state" && req.method === "GET") {
        return sendJson(res, 200, { bills: await listBills(), tithesRate });
      }

      if (url.pathname === "/api/bills" && req.method === "POST") {
        const body = await readJsonBody(req);
        const bill = await createBill(body || {});
        return sendJson(res, 201, bill);
      }

      if (url.pathname === "/api/reset" && req.method === "POST") {
        await client.query("UPDATE bills SET paid = 'NO', updated_at = NOW() WHERE deleted_at IS NULL");
        return sendJson(res, 200, { ok: true });
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

      return serveStatic(req, res, url.pathname);
    } catch (error) {
      console.error("Request failed", error);
      sendJson(res, 500, { error: "Internal server error" });
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
      name TEXT NOT NULL DEFAULT '',
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      paid TEXT NOT NULL DEFAULT 'NO',
      sort_order INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ
    )
  `);
}

async function ensureSeedData() {
  const { rows } = await client.query("SELECT COUNT(*)::int AS count FROM bills WHERE deleted_at IS NULL");
  if (rows[0].count > 0) return;

  for (let index = 0; index < seedBills.length; index += 1) {
    const [name, amount, paid] = seedBills[index];
    await client.query(
      "INSERT INTO bills (id, name, amount, paid, sort_order) VALUES ($1, $2, $3, $4, $5)",
      [crypto.randomUUID(), name, amount, paid, index]
    );
  }
}

async function listBills() {
  const { rows } = await client.query(
    "SELECT id, name, amount::float8 AS amount, paid, sort_order FROM bills WHERE deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC"
  );
  return rows;
}

async function createBill(input) {
  const { rows } = await client.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM bills WHERE deleted_at IS NULL");
  const bill = normalizeBillInput(input);
  const created = await client.query(
    `INSERT INTO bills (id, name, amount, paid, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, amount::float8 AS amount, paid, sort_order`,
    [crypto.randomUUID(), bill.name, bill.amount, bill.paid, rows[0].next_order]
  );
  return created.rows[0];
}

async function updateBill(id, input) {
  const bill = normalizeBillInput(input);
  const result = await client.query(
    `UPDATE bills
     SET name = $2, amount = $3, paid = $4, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id, name, amount::float8 AS amount, paid, sort_order`,
    [id, bill.name, bill.amount, bill.paid]
  );
  return result.rows[0] || null;
}

function normalizeBillInput(input) {
  return {
    name: typeof input.name === "string" ? input.name.slice(0, 200) : "",
    amount: Number.isFinite(Number(input.amount)) ? Number(input.amount) : 0,
    paid: input.paid === "YES" ? "YES" : "NO",
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
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

function serveStatic(req, res, pathname) {
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

