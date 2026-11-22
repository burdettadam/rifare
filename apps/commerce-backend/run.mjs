import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const localEnv = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(localEnv)) process.loadEnvFile(localEnv);
// The upstream telemetry singleton reads this before medusa-config is loaded.
process.env.MEDUSA_DISABLE_TELEMETRY = "true";
process.env.MEDUSA_FF_ANALYTICS = "false";
process.env.MEDUSA_FF_RBAC = "false";
process.env.MEDUSA_FF_RBAC_FILTER_FIELDS = "false";
const { setTelemetryEnabled } = await import("@medusajs/telemetry");
setTelemetryEnabled(false);
const args = process.argv.slice(2);
if (!["develop", "start", "build", "db:migrate", "user", "exec"].includes(args[0])) {
  throw new Error("RIFARE_COMMERCE_COMMAND_UNSUPPORTED");
}
const hmrPort = process.env.RIFARE_HMR_PORT ?? "9001";
if (!/^\d{4,5}$/.test(hmrPort) || Number(hmrPort) < 1024 || Number(hmrPort) > 65535) {
  throw new Error("RIFARE_COMMERCE_HMR_PORT_INVALID");
}
// Upstream's explicit port avoids network-interface discovery on restricted hosts.
process.env.HMR_PORT = hmrPort;
process.env.HMR_HOST = "127.0.0.1";
process.env.HMR_PROTOCOL = "ws";
process.env.HMR_CLIENT_PORT = hmrPort;
if (args[0] === "develop") process.env.HMR_BIND_HOST = "127.0.0.1";
else delete process.env.HMR_BIND_HOST;
if (["develop", "start"].includes(args[0])) {
  if (args.some((arg) => /^(-H|--host)(=|$)/.test(arg))) {
    throw new Error("RIFARE_COMMERCE_LOCAL_HOST_FIXED");
  }
  args.push("--host", "127.0.0.1");
}
const child = spawn(process.execPath,
  [fileURLToPath(new URL("node_modules/@medusajs/cli/cli.js", import.meta.url)), ...args],
  { cwd: directory, stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", () => { process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
