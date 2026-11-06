import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createSdk } from "./sdk.js";
import { InputError, invoke } from "./methods.js";

const digest = (value) => createHash("sha256").update(value).digest();

export function createRestServer({ token, sdk = createSdk() } = {}) {
  if (typeof token !== "string" || !/^[\x21-\x7e]{32,512}$/.test(token)) {
    throw new TypeError(
      "NOIZY_OSX_TOKEN must contain 32–512 printable non-space ASCII characters",
    );
  }
  const expected = digest(`Bearer ${token}`);
  const server = http.createServer(
    { maxHeaderSize: 8192 },
    async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          Connection: "close",
        });
        res.end(JSON.stringify(body));
      };
      try {
        const port = server.address()?.port;
        const host = `127.0.0.1:${port}`;
        const single = (name) =>
          req.rawHeaders.filter(
            (_, index) =>
              index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name,
          ).length === 1;
        if (!single("host") || req.headers.host !== host) {
          send(403, { error: "INVALID_HOST" });
          return;
        }
        if (
          req.headers.origin !== undefined &&
          (!single("origin") || req.headers.origin !== `http://${host}`)
        ) {
          send(403, { error: "INVALID_ORIGIN" });
          return;
        }
        if (
          !single("authorization") ||
          !timingSafeEqual(digest(req.headers.authorization ?? ""), expected)
        ) {
          send(401, { error: "UNAUTHORIZED" });
          return;
        }
        if (req.method !== "GET") {
          res.setHeader("Allow", "GET");
          send(405, { error: "READ_ONLY" });
          return;
        }
        if (
          req.headers["transfer-encoding"] ||
          (req.headers["content-length"] &&
            req.headers["content-length"] !== "0")
        ) {
          send(400, { error: "BODY_NOT_ALLOWED" });
          return;
        }
        if (!/^\/v1\/[a-z]+(?:\?[^#]*)?$/.test(req.url ?? "")) {
          send(404, { error: "NOT_FOUND" });
          return;
        }
        const url = new URL(req.url, `http://${host}`);
        const method = url.pathname.slice("/v1/".length);
        if (
          !["capabilities", "discover", "probe", "recommend"].includes(method)
        ) {
          send(404, { error: "NOT_FOUND" });
          return;
        }
        const args = Object.create(null);
        for (const [key, value] of url.searchParams) {
          if (Object.hasOwn(args, key)) throw new InputError();
          args[key] = value;
        }
        send(200, await invoke(sdk, method, args));
      } catch (error) {
        send(error instanceof InputError ? 400 : 500, {
          error:
            error instanceof InputError
              ? "INVALID_ARGUMENTS"
              : "INTERNAL_ERROR",
        });
      }
    },
  );
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxRequestsPerSocket = 1;
  server.on("clientError", (_error, socket) => {
    socket.end(
      "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  return server;
}

// Binding is fixed; no CLI/API host override.
export async function listenRest({ token, port = 4318, sdk } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new TypeError("Invalid port");
  const server = createRestServer({ token, sdk });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const rawPort = process.env.NOIZY_OSX_PORT ?? "4318";
  try {
    if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) === 0) throw new Error();
    const server = await listenRest({
      token: process.env.NOIZY_OSX_TOKEN,
      port: Number(rawPort),
    });
    process.stderr.write(
      JSON.stringify({
        event: "listening",
        host: "127.0.0.1",
        port: server.address().port,
      }) + "\n",
    );
  } catch {
    process.stderr.write(
      '{"error":"STARTUP_FAILED","hint":"Set a valid NOIZY_OSX_TOKEN and optional NOIZY_OSX_PORT"}\n',
    );
    process.exitCode = 1;
  }
}
