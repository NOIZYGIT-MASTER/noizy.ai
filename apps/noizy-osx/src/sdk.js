import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { catalog } from "./catalog.js";
import { validate } from "./methods.js";

// Trusted in-process configuration only; never accepted by REST/MCP.
export function createSdk({
  searchPath = process.env.PATH ?? "",
  platform = process.platform,
  timeoutMs = 2000,
  maxOutputBytes = 8192,
  maxConcurrent = 2,
} = {}) {
  if (
    typeof searchPath !== "string" ||
    typeof platform !== "string" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 5000 ||
    !Number.isInteger(maxOutputBytes) ||
    maxOutputBytes < 64 ||
    maxOutputBytes > 32768 ||
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    maxConcurrent > 4
  )
    throw new TypeError("Invalid trusted SDK configuration");
  // Ignore relative/empty PATH entries; no cwd search, recursion or source scanning.
  const directories = [
    ...new Set(searchPath.split(delimiter).filter(isAbsolute)),
  ];
  let active = 0;

  async function locate(tool) {
    if (!tool.foss)
      return { toolId: tool.id, status: "external", available: false };
    if (!tool.platforms.includes(platform)) {
      return { toolId: tool.id, status: "unsupported", available: false };
    }
    for (const directory of directories) {
      const path = join(directory, tool.executable);
      try {
        if (!(await stat(path)).isFile()) continue;
        await access(path, constants.X_OK);
        return { toolId: tool.id, status: "available", available: true, path };
      } catch {
        // Missing or inaccessible executables are not installed integrations.
      }
    }
    return { toolId: tool.id, status: "unavailable", available: false };
  }

  function capabilities(input = {}) {
    const { category } = validate("capabilities", input);
    return {
      application: "NOIZY.OSX",
      version: "0.1.0",
      platform,
      methods: ["capabilities", "discover", "probe", "recommend"],
      execution: "fixed-version-probes-only",
      modelLicensing:
        "Separate from runtime licenses; no model operations in v1.",
      tools: catalog.filter((tool) => !category || tool.category === category),
    };
  }

  async function discover(input = {}) {
    const { toolId } = validate("discover", input);
    return {
      platform,
      tools: await Promise.all(
        catalog.filter((tool) => !toolId || tool.id === toolId).map(locate),
      ),
    };
  }

  async function probe(input) {
    const { toolId } = validate("probe", input);
    const tool = catalog.find((item) => item.id === toolId);
    if (active >= maxConcurrent) return { toolId, status: "busy" };
    active++;
    try {
      const found = await locate(tool);
      if (!found.available) return found;
      return await new Promise((resolve) => {
        let child;
        let bytes = 0;
        const chunks = [];
        let completed = false;
        let timer;
        const terminate = () => {
          try {
            // macOS/Linux process group: also stop descendants of a wrapper.
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child?.kill("SIGKILL");
          }
        };
        const finish = (status, exitCode = null) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          child?.stdout?.destroy();
          child?.stderr?.destroy();
          resolve({
            toolId,
            status,
            exitCode,
            bytes,
            // No raw environment, error objects or unrestricted binary output.
            output: Buffer.concat(chunks)
              .toString("utf8")
              .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
              .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "?"),
          });
        };
        try {
          child = spawn(found.path, [...tool.versionArgs], {
            shell: false,
            detached: true,
            cwd: "/",
            env: {
              PATH: "/usr/bin:/bin",
              LANG: "C",
              LC_ALL: "C",
              HOME: "/nonexistent",
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch {
          finish("error");
          return;
        }
        const collect = (chunk) => {
          if (completed) return;
          const remaining = maxOutputBytes - bytes;
          chunks.push(chunk.subarray(0, remaining));
          bytes += Math.min(remaining, chunk.length);
          if (chunk.length > remaining) {
            terminate();
            finish("output-limit");
          }
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        child.on("error", () => finish("error"));
        child.on("close", (code) => finish(code === 0 ? "ok" : "error", code));
        timer = setTimeout(() => {
          terminate();
          finish("timeout");
        }, timeoutMs);
      });
    } finally {
      active--;
    }
  }

  async function recommend(input) {
    const { category } = validate("recommend", input);
    const tools = catalog.filter(
      (tool) => tool.category === category && tool.foss,
    );
    return {
      category,
      basis:
        "Executable discovery only; no operational readiness or license compliance inferred.",
      recommendations: await Promise.all(
        tools.map(async (tool) => {
          const evidence = await locate(tool);
          return {
            toolId: tool.id,
            available: evidence.available,
            recommendation: evidence.available
              ? "available-for-version-probe"
              : "not-available",
            evidence,
            boundary: tool.boundary,
            upstream: tool.upstream,
            license: tool.license,
          };
        }),
      ),
    };
  }

  return Object.freeze({ capabilities, discover, probe, recommend });
}

const sdk = createSdk();
export const listCapabilities = sdk.capabilities;
export const discoverExecutables = sdk.discover;
export const probeVersion = sdk.probe;
export const recommendTools = sdk.recommend;
export { catalog } from "./catalog.js";
