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
const sessionDurationMs = 1000 * 60 * 60 * 24 * 30;
const pbkdf2Iterations = 120000;
const taxCategories = ["Tax Return", "W-2", "1099", "State Filing", "Receipt", "Other"];
const seedUsers = [
  { name: "Jeremy Martin", phoneDisplay: "(606) 308-4096", phoneNormalized: "6063084096", role: "admin", password: "Jj2175$$" },
  { name: "Alan", phoneDisplay: "630-514-9324", phoneNormalized: "6305149324", role: "admin", password: "C3cilcat" }
];
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
  ["IRS", 600, "NO"]
];

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("proxy.rlwy.net") ? { rejectUnauthorized: false } : false
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
  ".ico": "image/x-icon"
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
  await cleanupExpiredSessions();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const monthKey = getMonthKey(url.searchParams.get("month"));

      if (url.pathname === "/health" && req.method === "GET") return sendJson(res, 200, { ok: true });

      if (url.pathname === "/api/auth/login" && req.method === "POST") {
        const result = await loginUser(await readJsonBody(req));
        return sendJson(res, 200, buildAuthPayload(result.user), { "Set-Cookie": buildSessionCookie(req, result.token, sessionDurationMs) });
      }

      if (url.pathname === "/api/auth/logout" && req.method === "POST") {
        await logoutUser(req);
        return sendJson(res, 200, { ok: true }, { "Set-Cookie": buildExpiredSessionCookie(req) });
      }

      if (url.pathname === "/api/auth/session" && req.method === "GET") {
        const auth = await getAuthContext(req);
        if (!auth) return sendJson(res, 401, { error: "Not authenticated" }, { "Set-Cookie": buildExpiredSessionCookie(req) });
        return sendJson(res, 200, buildAuthPayload(auth.user));
      }

      if (url.pathname.indexOf("/api/") === 0) {
        const auth = await getAuthContext(req);
        if (!auth) return sendJson(res, 401, { error: "Not authenticated" }, { "Set-Cookie": buildExpiredSessionCookie(req) });
        req.auth = auth;
      }

      if (url.pathname === "/api/bootstrap" && req.method === "GET") {
        return sendJson(res, 200, {
          months: listAvailableMonths(),
          selectedMonth: monthKey,
          currentMonth: currentMonthKey,
          tithesRate: tithesRate,
          taxCategories: taxCategories,
          taxYears: listTaxYears(),
          user: buildUserPayload(req.auth.user)
        });
      }

      if (url.pathname === "/api/state" && req.method === "GET") {
        return sendJson(res, 200, {
          bills: await listBills(monthKey),
          month: monthKey,
          months: listAvailableMonths(),
          tithesRate: tithesRate
        });
      }

      if (url.pathname === "/api/bills" && req.method === "POST") {
        ensureWriteAccess(req.auth.user);
        return sendJson(res, 201, await createBill(monthKey, await readJsonBody(req)));
      }

      if (url.pathname === "/api/reset" && req.method === "POST") {
        ensureWriteAccess(req.auth.user);
        await client.query("UPDATE bills SET paid = 'NO', updated_at = NOW() WHERE deleted_at IS NULL AND month_key = $1", [monthKey]);
        return sendJson(res, 200, { ok: true });
      }

      if (url.pathname === "/api/tax-docs" && req.method === "GET") {
        return sendJson(res, 200, { docs: await listTaxDocs(url.searchParams) });
      }

      if (url.pathname === "/api/tax-docs" && req.method === "POST") {
        ensureWriteAccess(req.auth.user);
        return sendJson(res, 201, await createTaxDoc(await parsePdfUpload(req)));
      }

      const billMatch = url.pathname.match(/^\/api\/bills\/([a-f0-9-]+)$/i);
      if (billMatch) {
        ensureWriteAccess(req.auth.user);
        const billId = billMatch[1];
        if (req.method === "PATCH") {
          const bill = await updateBill(billId, await readJsonBody(req));
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
          ensureWriteAccess(req.auth.user);
          await client.query("UPDATE tax_docs SET deleted_at = NOW() WHERE id = $1", [docId]);
          return sendJson(res, 204, null);
        }
        if (req.method === "GET" && (mode === "download" || mode === "view")) return streamTaxDoc(res, docId, mode);
      }

      return serveStatic(res, url.pathname);
    } catch (error) {
      console.error("Request failed", error);
      sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
    }
  });

  server.listen(port, "0.0.0.0", function () {
    console.log("Listening on " + port);
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
      category TEXT NOT NULL DEFAULT 'Other',
      tax_year INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      deleted_at TIMESTAMPTZ,
      file_data BYTEA NOT NULL
    )
  `);
  await client.query("ALTER TABLE tax_docs ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Other'");
  await client.query("ALTER TABLE tax_docs ADD COLUMN IF NOT EXISTS tax_year INTEGER");
  await client.query("ALTER TABLE tax_docs ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''");
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone_display TEXT NOT NULL,
      phone_normalized TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'admin',
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS users_phone_normalized_idx ON users (phone_normalized)");
  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query("CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash)");
}

async function ensureSeedData() {
  var months = listAvailableMonths();
  for (var index = 0; index < months.length; index += 1) {
    var monthKey = months[index].value;
    var countResult = await client.query("SELECT COUNT(*)::int AS count FROM bills WHERE deleted_at IS NULL AND month_key = $1", [monthKey]);
    if (countResult.rows[0].count === 0) {
      for (var billIndex = 0; billIndex < seedBills.length; billIndex += 1) {
        var seed = seedBills[billIndex];
        await client.query("INSERT INTO bills (id, month_key, name, amount, paid, sort_order) VALUES ($1, $2, $3, $4, $5, $6)", [crypto.randomUUID(), monthKey, seed[0], seed[1], seed[2], billIndex]);
      }
    }
  }

  for (var userIndex = 0; userIndex < seedUsers.length; userIndex += 1) {
    var seedUser = seedUsers[userIndex];
    var passwordRecord = hashPassword(seedUser.password);
    await client.query(`
      INSERT INTO users (id, name, phone_display, phone_normalized, role, password_salt, password_hash, is_active, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, NOW())
      ON CONFLICT (phone_normalized)
      DO UPDATE SET
        name = EXCLUDED.name,
        phone_display = EXCLUDED.phone_display,
        role = EXCLUDED.role,
        password_salt = EXCLUDED.password_salt,
        password_hash = EXCLUDED.password_hash,
        is_active = TRUE,
        updated_at = NOW()
    `, [crypto.randomUUID(), seedUser.name, seedUser.phoneDisplay, seedUser.phoneNormalized, seedUser.role, passwordRecord.salt, passwordRecord.hash]);
  }
}

function listAvailableMonths() {
  return [
    { value: "2026-01", label: "January 2026" },
    { value: "2026-02", label: "February 2026" },
    { value: "2026-03", label: "March 2026" }
  ];
}

function listTaxYears() { return [2026, 2025, 2024, 2023, 2022, 2021, 2020]; }

function getMonthKey(candidate) {
  var months = listAvailableMonths();
  for (var i = 0; i < months.length; i += 1) if (months[i].value === candidate) return candidate;
  return currentMonthKey;
}

async function listBills(monthKey) {
  var result = await client.query("SELECT id, month_key, name, amount::float8 AS amount, paid, sort_order FROM bills WHERE deleted_at IS NULL AND month_key = $1 ORDER BY sort_order ASC, created_at ASC", [monthKey]);
  return result.rows;
}

async function createBill(monthKey, input) {
  var rows = await client.query("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM bills WHERE deleted_at IS NULL AND month_key = $1", [monthKey]);
  var bill = normalizeBillInput(input || {});
  var created = await client.query(`INSERT INTO bills (id, month_key, name, amount, paid, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, month_key, name, amount::float8 AS amount, paid, sort_order`, [crypto.randomUUID(), monthKey, bill.name, bill.amount, bill.paid, rows.rows[0].next_order]);
  return created.rows[0];
}

async function updateBill(id, input) {
  var bill = normalizeBillInput(input || {});
  var result = await client.query(`UPDATE bills SET name = $2, amount = $3, paid = $4, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, month_key, name, amount::float8 AS amount, paid, sort_order`, [id, bill.name, bill.amount, bill.paid]);
  return result.rows[0] || null;
}

async function listTaxDocs(searchParams) {
  var values = [];
  var where = ["deleted_at IS NULL"];
  var category = searchParams.get("category");
  if (category && category !== "all") { values.push(category); where.push("category = $" + values.length); }
  var taxYear = searchParams.get("taxYear");
  if (taxYear && /^\d{4}$/.test(taxYear)) { values.push(Number(taxYear)); where.push("tax_year = $" + values.length); }
  var search = searchParams.get("search");
  if (search) { values.push("%" + search.toLowerCase() + "%"); where.push("(LOWER(original_name) LIKE $" + values.length + " OR LOWER(notes) LIKE $" + values.length + ")"); }
  var query = "SELECT id, original_name, category, tax_year, notes, content_type, byte_size, uploaded_at FROM tax_docs WHERE " + where.join(" AND ") + " ORDER BY tax_year DESC NULLS LAST, uploaded_at DESC";
  var result = await client.query(query, values);
  return result.rows;
}

async function createTaxDoc(uploaded) {
  var result = await client.query(`INSERT INTO tax_docs (id, original_name, category, tax_year, notes, content_type, byte_size, file_data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, original_name, category, tax_year, notes, content_type, byte_size, uploaded_at`, [crypto.randomUUID(), uploaded.filename, uploaded.category, uploaded.taxYear, uploaded.notes, uploaded.contentType, uploaded.buffer.length, uploaded.buffer]);
  return result.rows[0];
}

async function streamTaxDoc(res, docId, mode) {
  var result = await client.query("SELECT original_name, content_type, file_data FROM tax_docs WHERE id = $1 AND deleted_at IS NULL", [docId]);
  var row = result.rows[0];
  if (!row) return sendJson(res, 404, { error: "Document not found" });
  var dispositionType = mode === "download" ? "attachment" : "inline";
  res.writeHead(200, {
    "Content-Type": row.content_type,
    "Content-Length": row.file_data.length,
    "Content-Disposition": dispositionType + '; filename="' + sanitizeFilename(row.original_name) + '"',
    "Cache-Control": "no-cache"
  });
  res.end(row.file_data);
}

function parsePdfUpload(req) {
  return new Promise(function (resolve, reject) {
    if (!req.headers["content-type"] || req.headers["content-type"].indexOf("multipart/form-data") !== 0) {
      var contentError = new Error("Upload must use multipart/form-data");
      contentError.statusCode = 400;
      reject(contentError);
      return;
    }
    var busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: maxPdfBytes } });
    var uploadedFile = null;
    var fields = { category: "Other", taxYear: null, notes: "" };
    var finished = false;

    busboy.on("field", function (name, value) {
      if (name === "category") fields.category = normalizeCategory(value);
      if (name === "taxYear") fields.taxYear = normalizeTaxYear(value);
      if (name === "notes") fields.notes = String(value || "").slice(0, 2000);
    });

    busboy.on("file", function (fieldName, file, info) {
      var chunks = [];
      var filename = info && info.filename ? info.filename : "document.pdf";
      var mimeType = info && info.mimeType ? info.mimeType : "application/pdf";
      if (mimeType !== "application/pdf" && !/\.pdf$/i.test(filename)) {
        file.resume();
        var typeError = new Error("Only PDF files are supported");
        typeError.statusCode = 400;
        rejectOnce(typeError);
        return;
      }
      file.on("data", function (chunk) { chunks.push(chunk); });
      file.on("limit", function () {
        var sizeError = new Error("PDF exceeds the 15MB upload limit");
        sizeError.statusCode = 400;
        rejectOnce(sizeError);
      });
      file.on("end", function () {
        if (finished) return;
        uploadedFile = { filename: filename, contentType: "application/pdf", buffer: Buffer.concat(chunks), category: fields.category, taxYear: fields.taxYear, notes: fields.notes };
      });
    });

    busboy.on("finish", function () {
      if (finished) return;
      if (!uploadedFile || !uploadedFile.buffer.length) {
        var missingError = new Error("No PDF file was uploaded");
        missingError.statusCode = 400;
        rejectOnce(missingError);
        return;
      }
      finished = true;
      resolve(uploadedFile);
    });

    busboy.on("error", function (error) { rejectOnce(error); });

    function rejectOnce(error) {
      if (finished) return;
      finished = true;
      reject(error);
    }

    req.pipe(busboy);
  });
}

async function loginUser(input) {
  var phoneNormalized = normalizePhone(input && input.phone);
  var password = String(input && input.password ? input.password : "");
  if (!phoneNormalized || !password) {
    var inputError = new Error("Phone number and password are required");
    inputError.statusCode = 400;
    throw inputError;
  }

  var result = await client.query("SELECT id, name, phone_display, phone_normalized, role, password_salt, password_hash, is_active FROM users WHERE phone_normalized = $1", [phoneNormalized]);
  var user = result.rows[0];
  if (!user || !user.is_active || !verifyPassword(password, user.password_salt, user.password_hash)) {
    var authError = new Error("Invalid phone number or password");
    authError.statusCode = 401;
    throw authError;
  }

  await cleanupExpiredSessions();
  var token = crypto.randomBytes(32).toString("hex");
  var expiresAt = new Date(Date.now() + sessionDurationMs);
  await client.query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)", [crypto.randomUUID(), user.id, hashSessionToken(token), expiresAt.toISOString()]);
  return { token: token, user: user };
}

async function logoutUser(req) {
  var token = extractSessionToken(req);
  if (!token) return;
  await client.query("DELETE FROM sessions WHERE token_hash = $1", [hashSessionToken(token)]);
}

async function getAuthContext(req) {
  var token = extractSessionToken(req);
  if (!token) return null;
  var result = await client.query(`
    SELECT sessions.id AS session_id, users.id, users.name, users.phone_display, users.phone_normalized, users.role, users.is_active, sessions.expires_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = $1
  `, [hashSessionToken(token)]);
  var row = result.rows[0];
  if (!row || !row.is_active || new Date(row.expires_at).getTime() <= Date.now()) {
    await client.query("DELETE FROM sessions WHERE token_hash = $1", [hashSessionToken(token)]);
    return null;
  }
  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      name: row.name,
      phone_display: row.phone_display,
      phone_normalized: row.phone_normalized,
      role: row.role
    }
  };
}

async function cleanupExpiredSessions() {
  await client.query("DELETE FROM sessions WHERE expires_at <= NOW()");
}

function buildAuthPayload(user) {
  return { user: buildUserPayload(user) };
}

function buildUserPayload(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone_display,
    role: user.role
  };
}

function ensureWriteAccess(user) {
  if (!user || user.role !== "admin") {
    var accessError = new Error("You do not have permission to change data");
    accessError.statusCode = 403;
    throw accessError;
  }
}

function hashPassword(password, salt) {
  var resolvedSalt = salt || crypto.randomBytes(16).toString("hex");
  return {
    salt: resolvedSalt,
    hash: crypto.pbkdf2Sync(String(password || ""), resolvedSalt, pbkdf2Iterations, 64, "sha512").toString("hex")
  };
}

function verifyPassword(password, salt, expectedHash) {
  var actual = hashPassword(password, salt).hash;
  var left = Buffer.from(actual, "hex");
  var right = Buffer.from(expectedHash, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function extractSessionToken(req) {
  var cookies = parseCookies(req.headers.cookie || "");
  return cookies.jm_session || "";
}

function parseCookies(cookieHeader) {
  var cookies = {};
  var parts = String(cookieHeader || "").split(";");
  for (var i = 0; i < parts.length; i += 1) {
    var entry = parts[i].trim();
    if (!entry) continue;
    var index = entry.indexOf("=");
    if (index === -1) continue;
    cookies[entry.slice(0, index)] = decodeURIComponent(entry.slice(index + 1));
  }
  return cookies;
}

function buildSessionCookie(req, token, maxAgeMs) {
  var parts = [
    "jm_session=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + Math.floor(maxAgeMs / 1000)
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function buildExpiredSessionCookie(req) {
  var parts = [
    "jm_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0"
  ];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

function isSecureRequest(req) {
  var forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (forwardedProto === "https") return true;
  var host = String(req.headers.host || "").toLowerCase();
  return host.indexOf("localhost") === -1 && host.indexOf("127.0.0.1") === -1;
}

function normalizeBillInput(input) {
  return {
    name: typeof input.name === "string" ? input.name.slice(0, 200) : "",
    amount: Number.isFinite(Number(input.amount)) ? Number(input.amount) : 0,
    paid: input.paid === "YES" ? "YES" : "NO"
  };
}

function normalizeCategory(value) {
  for (var i = 0; i < taxCategories.length; i += 1) if (taxCategories[i] === value) return value;
  return "Other";
}

function normalizeTaxYear(value) {
  if (!value) return null;
  var parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null;
}

function normalizePhone(value) {
  var digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

function sanitizeFilename(name) { return String(name || "document.pdf").replace(/[^a-zA-Z0-9._-]+/g, "-"); }

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    var body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > 1000000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", function () {
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
  var requestPath = pathname === "/" ? "/index.html" : pathname;
  var safePath = path.normalize(requestPath).replace(/^([.][.][/\\])+/, "");
  var filePath = path.join(root, safePath);
  fs.readFile(filePath, function (error, data) {
    if (error) {
      if (error.code === "ENOENT") {
        fs.readFile(path.join(root, "index.html"), function (fallbackError, fallbackData) {
          if (fallbackError) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Server error");
            return;
          }
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
          res.end(fallbackData);
        });
        return;
      }
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Server error");
      return;
    }
    var extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream", "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600" });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload, extraHeaders) {
  if (statusCode === 204) {
    res.writeHead(204, extraHeaders || {});
    res.end();
    return;
  }
  var headers = { "Content-Type": "application/json; charset=utf-8" };
  if (extraHeaders) {
    var keys = Object.keys(extraHeaders);
    for (var i = 0; i < keys.length; i += 1) headers[keys[i]] = extraHeaders[keys[i]];
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}
