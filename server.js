const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.env.PORT || 3000);
const root = __dirname;

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

const server = http.createServer((req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
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
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Listening on ${port}`);
});
