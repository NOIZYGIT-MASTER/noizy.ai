import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createSdk, catalog, listCapabilities } from "../src/sdk.js";
import { InputError, invoke } from "../src/methods.js";
import { createRestServer, listenRest } from "../src/rest.js";

async function fixture(code, executable = "ddrescue", mode = 0o700) {
  const directory = await mkdtemp(join(tmpdir(), "noizy-osx-test-"));
  await writeFile(
    join(directory, executable),
    `#!${process.execPath}\n${code}\n`,
    { mode },
  );
  return { directory, sdk: createSdk({ searchPath: directory }) };
}

test("catalog covers six FOSS categories and explicitly excludes non-FOSS integrations", () => {
  assert.equal(
    new Set(catalog.filter((tool) => tool.foss).map((tool) => tool.category))
      .size,
    6,
  );
  for (const tool of catalog) {
    assert.match(tool.upstream, /^https:\/\//);
    assert.ok(tool.license && tool.licenseUrl && tool.boundary);
    if (!tool.foss) {
      assert.equal(tool.executable, null);
      assert.equal(tool.versionArgs, null);
      assert.equal(tool.integration, "external-only");
    }
  }
  assert.throws(() => catalog[0].versionArgs.push("/dev/disk1"), TypeError);
  assert.throws(() => {
    catalog[0].executable = "sh";
  }, TypeError);
  assert.equal(listCapabilities().execution, "fixed-version-probes-only");
});

test("discovery uses executable fixtures, reports absence and never executes", async () => {
  const { sdk } = await fixture(
    'throw new Error("discovery must not execute");',
  );
  const result = await sdk.discover({ toolId: "ddrescue" });
  assert.equal(result.tools[0].available, true);
  const absent = await sdk.discover({ toolId: "smartmontools" });
  assert.deepEqual(absent.tools, [
    { toolId: "smartmontools", status: "unavailable", available: false },
  ]);
  assert.equal(
    (await sdk.probe({ toolId: "smartmontools" })).status,
    "unavailable",
  );
});

test("discovery ignores nonexecutable files, directories and relative PATH entries", async () => {
  const { directory } = await fixture("process.exit(0)", "ddrescue", 0o600);
  await mkdir(join(directory, "smartctl"));
  const sdk = createSdk({ searchPath: `.:relative::${directory}` });
  assert.equal(
    (await sdk.discover({ toolId: "ddrescue" })).tools[0].available,
    false,
  );
  assert.equal(
    (await sdk.discover({ toolId: "smartmontools" })).tools[0].available,
    false,
  );
});

test("external and unsupported tools remain non-executable", async () => {
  const sdk = createSdk({ searchPath: "", platform: "win32" });
  assert.equal((await sdk.probe({ toolId: "ddrescue" })).status, "unsupported");
  for (const toolId of ["parallels", "prl-devops-service"]) {
    assert.deepEqual(await sdk.probe({ toolId }), {
      toolId,
      status: "external",
      available: false,
    });
  }
});

test("fixed version command has exactly catalog arguments and no parent secrets", async () => {
  const name = "NOIZY_TEST_SECRET";
  const previousToken = process.env.NOIZY_OSX_TOKEN;
  process.env.NOIZY_OSX_TOKEN = randomBytes(32).toString("hex");
  process.env[name] = randomBytes(32).toString("hex");
  try {
    const { sdk } = await fixture(
      "console.log(JSON.stringify({args:process.argv.slice(2), env:Object.keys(process.env), cwd:process.cwd()}));",
    );
    const result = await sdk.probe({ toolId: "ddrescue" });
    assert.equal(result.status, "ok");
    const output = JSON.parse(result.output);
    assert.deepEqual(output.args, ["--version"]);
    assert.equal(output.env.includes(name), false);
    assert.equal(output.env.includes("NOIZY_OSX_TOKEN"), false);
    assert.equal(output.cwd, "/");
  } finally {
    delete process.env[name];
    if (previousToken === undefined) delete process.env.NOIZY_OSX_TOKEN;
    else process.env.NOIZY_OSX_TOKEN = previousToken;
  }
});

test("every FOSS integration uses only its immutable version arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "noizy-osx-commands-"));
  for (const tool of catalog.filter((item) => item.foss)) {
    await writeFile(
      join(directory, tool.executable),
      `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`,
      { mode: 0o700 },
    );
  }
  const sdk = createSdk({ searchPath: directory });
  for (const tool of catalog.filter((item) => item.foss)) {
    const result = await sdk.probe({ toolId: tool.id });
    assert.equal(result.status, "ok", tool.id);
    assert.deepEqual(JSON.parse(result.output), tool.versionArgs, tool.id);
  }
});

test("SDK rejects arbitrary flags, paths, commands, invalid IDs and unknown properties", async () => {
  const sdk = createSdk({ searchPath: "" });
  for (const input of [
    {},
    null,
    [],
    { toolId: "sh" },
    { toolId: "/bin/sh" },
    { toolId: "ddrescue; touch x" },
    { toolId: "ddrescue", args: ["--force"] },
    { toolId: "ddrescue", path: "/dev/disk1" },
    { toolId: "ddrescue", command: "id" },
    { toolId: 1 },
    { toolId: "ddrescue", __proto__: null, extra: true },
  ])
    await assert.rejects(sdk.probe(input), InputError);
  assert.throws(() => sdk.capabilities({ category: "unknown" }), InputError);
  await assert.rejects(sdk.discover({ searchPath: "/bin" }), InputError);
  await assert.rejects(
    sdk.recommend({ category: "disk-rescue", flags: [] }),
    InputError,
  );
  await assert.rejects(invoke(sdk, "constructor", {}), InputError);
});

test("timeout and output limits bound actual child processes", async () => {
  const slow = await fixture("setInterval(() => {}, 1000);");
  const timed = createSdk({ searchPath: slow.directory, timeoutMs: 80 });
  const start = performance.now();
  assert.equal((await timed.probe({ toolId: "ddrescue" })).status, "timeout");
  assert.ok(performance.now() - start < 2000);
  const noisy = await fixture(
    'process.stdout.write("x".repeat(100000)); setInterval(() => {}, 1000);',
  );
  const bounded = createSdk({
    searchPath: noisy.directory,
    maxOutputBytes: 128,
  });
  const result = await bounded.probe({ toolId: "ddrescue" });
  assert.equal(result.status, "output-limit");
  assert.equal(result.bytes, 128);
  assert.equal(Buffer.byteLength(result.output), 128);
  const stderr = await fixture('process.stderr.write("x".repeat(100000));');
  assert.equal(
    (
      await createSdk({
        searchPath: stderr.directory,
        maxOutputBytes: 128,
      }).probe({ toolId: "ddrescue" })
    ).status,
    "output-limit",
  );
});

test("a child holding inherited pipes is terminated within timeout", async () => {
  const { directory } = await fixture(`
    const {spawn} = require("node:child_process");
    spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio: ["ignore", 1, 2]});
  `);
  const sdk = createSdk({ searchPath: directory, timeoutMs: 100 });
  assert.equal((await sdk.probe({ toolId: "ddrescue" })).status, "timeout");
});

test("concurrent probes are capped without an unbounded queue", async () => {
  const { directory } = await fixture("setTimeout(() => {}, 150);");
  const sdk = createSdk({ searchPath: directory, maxConcurrent: 1 });
  const first = sdk.probe({ toolId: "ddrescue" });
  assert.equal((await sdk.probe({ toolId: "ddrescue" })).status, "busy");
  assert.equal((await first).status, "ok");
});

test("probe errors and terminal escape output are structured and sanitized", async () => {
  const { sdk } = await fixture(
    'process.stderr.write("\\x1b[31mfailed\\x1b[0m\\x00"); process.exitCode=2;',
  );
  const result = await sdk.probe({ toolId: "ddrescue" });
  assert.equal(result.status, "error");
  assert.equal(result.exitCode, 2);
  assert.equal(result.output, "failed?");
  const broken = await fixture("not executable source");
  assert.equal(
    (await broken.sdk.probe({ toolId: "ddrescue" })).status,
    "error",
  );
  await writeFile(
    join(broken.directory, "ddrescue"),
    "#!/noizy-nonexistent-interpreter\n",
  );
  assert.equal(
    (await broken.sdk.probe({ toolId: "ddrescue" })).status,
    "error",
  );
});

test("recommendations expose discovery evidence rather than fabricated installations", async () => {
  const { sdk } = await fixture("process.exit(0)");
  const result = await sdk.recommend({ category: "disk-rescue" });
  assert.equal(
    result.recommendations.find((tool) => tool.toolId === "ddrescue")
      .recommendation,
    "available-for-version-probe",
  );
  assert.equal(
    result.recommendations.find((tool) => tool.toolId === "smartmontools")
      .recommendation,
    "not-available",
  );
  assert.equal(
    (await sdk.recommend({ category: "virtualization" })).recommendations.some(
      (tool) => tool.toolId === "parallels",
    ),
    false,
  );
});

test("trusted SDK bounds and required REST token are validated", () => {
  for (const config of [
    { timeoutMs: 0 },
    { timeoutMs: 999999 },
    { maxOutputBytes: -1 },
    { maxConcurrent: 100 },
    { searchPath: [] },
  ])
    assert.throws(() => createSdk(config), TypeError);
  for (const token of [
    undefined,
    "",
    "short",
    " ".repeat(32),
    "\n".repeat(32),
  ]) {
    assert.throws(() => createRestServer({ token }), TypeError);
  }
});

function request(
  port,
  token,
  { path = "/v1/capabilities", method = "GET", headers = {}, body } = {},
) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: { Authorization: `Bearer ${token}`, ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("REST loopback security and equivalent read-only SDK methods", async (t) => {
  const { sdk } = await fixture('console.log("fixture version 1");');
  const token = randomBytes(32).toString("hex");
  const server = await listenRest({ token, port: 0, sdk });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port, address } = server.address();
  assert.equal(address, "127.0.0.1");
  const call = (options = {}, credential = token) =>
    request(port, credential, options);
  await t.test("authentication", async () => {
    for (const credential of ["", "wrong"])
      assert.equal((await call({}, credential)).status, 401);
    assert.equal((await call({ headers: { Authorization: "" } })).status, 401);
    assert.equal((await call()).status, 200);
  });
  await t.test("Host and Origin validation", async () => {
    for (const Host of [
      "evil.test",
      `localhost:${port}`,
      `127.0.0.1.evil.test:${port}`,
      "127.0.0.1",
    ]) {
      assert.equal((await call({ headers: { Host } })).status, 403);
    }
    for (const Origin of [
      "null",
      "https://evil.test",
      `http://localhost:${port}`,
      `http://127.0.0.1:${port + 1}`,
    ]) {
      assert.equal((await call({ headers: { Origin } })).status, 403);
    }
    assert.equal(
      (await call({ headers: { Origin: `http://127.0.0.1:${port}` } })).status,
      200,
    );
  });
  await t.test("duplicate security headers rejected", async () => {
    for (const duplicate of ["Host", "Origin", "Authorization"]) {
      const status = await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        const chunks = [];
        socket.on("error", reject);
        socket.on("data", (chunk) => chunks.push(chunk));
        socket.on("end", () =>
          resolve(Number(Buffer.concat(chunks).toString().split(" ")[1])),
        );
        socket.on("connect", () =>
          socket.end(
            `GET /v1/capabilities HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n` +
              `Origin: http://127.0.0.1:${port}\r\nAuthorization: Bearer ${token}\r\n` +
              `${duplicate}: invalid\r\nConnection: close\r\n\r\n`,
          ),
        );
      });
      assert.ok([400, 401, 403].includes(status));
    }
  });
  await t.test(
    "writes, request bodies and unknown routes rejected",
    async () => {
      for (const method of [
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
        "HEAD",
      ]) {
        assert.equal((await call({ method })).status, 405);
      }
      assert.equal(
        (await call({ headers: { "Content-Length": "1" }, body: "x" })).status,
        400,
      );
      assert.equal((await call({ path: "/v1/execute" })).status, 404);
      assert.equal(
        (await call({ path: "http://evil.test/v1/capabilities" })).status,
        404,
      );
    },
  );
  await t.test(
    "strict arguments including duplicates and arbitrary execution",
    async () => {
      for (const path of [
        "/v1/probe",
        "/v1/probe?toolId=sh",
        "/v1/probe?toolId=ddrescue&args=--force",
        "/v1/discover?path=/dev/disk1",
        "/v1/discover?toolId=ddrescue&toolId=gzip",
        "/v1/capabilities?__proto__=x",
        "/v1/recommend?category=unknown",
      ])
        assert.equal((await call({ path })).status, 400);
    },
  );
  await t.test("all methods match SDK output and disable caching", async () => {
    for (const [method, args] of [
      ["capabilities", {}],
      ["discover", { toolId: "ddrescue" }],
      ["probe", { toolId: "ddrescue" }],
      ["recommend", { category: "disk-rescue" }],
    ]) {
      const result = await call({
        path: `/v1/${method}?${new URLSearchParams(args)}`,
      });
      assert.equal(result.status, 200);
      assert.equal(result.headers["cache-control"], "no-store");
      assert.deepEqual(JSON.parse(result.body), await sdk[method](args));
      assert.equal(result.body.includes(token), false);
    }
  });
});

test("REST startup without an environment token fails without leaking values", async () => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../src/rest.js", import.meta.url))],
    {
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const chunks = [];
  child.stderr.on("data", (chunk) => chunks.push(chunk));
  const [code] = await once(child, "close");
  assert.equal(code, 1);
  assert.equal(
    JSON.parse(Buffer.concat(chunks).toString()).error,
    "STARTUP_FAILED",
  );
});

test("real MCP initialize, list and call enforce strict read-only tools", async (t) => {
  const { directory, sdk } = await fixture('console.log("fixture version 1");');
  const client = new Client({ name: "noizy-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../src/mcp.js", import.meta.url))],
    env: { PATH: directory },
    stderr: "pipe",
  });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, "noizy-osx");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    "noizy_capabilities",
    "noizy_discover",
    "noizy_probe",
    "noizy_recommend",
  ]);
  for (const tool of tools) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.openWorldHint, false);
  }
  for (const [method, args] of [
    ["capabilities", {}],
    ["discover", { toolId: "ddrescue" }],
    ["probe", { toolId: "ddrescue" }],
    ["recommend", { category: "disk-rescue" }],
  ]) {
    const result = await client.callTool({
      name: `noizy_${method}`,
      arguments: args,
    });
    assert.ok(!result.isError);
    assert.deepEqual(result.structuredContent, await sdk[method](args));
  }
  for (const args of [
    { toolId: "/bin/sh" },
    { toolId: "ddrescue", flags: ["--force"] },
    { toolId: "ddrescue", device: "/dev/disk1" },
    {},
  ]) {
    const result = await client.callTool({
      name: "noizy_probe",
      arguments: args,
    });
    assert.equal(result.isError, true);
  }
  assert.equal(
    (
      await client.callTool({
        name: "noizy_probe",
        arguments: { toolId: "parallels" },
      })
    ).structuredContent.status,
    "external",
  );
});
