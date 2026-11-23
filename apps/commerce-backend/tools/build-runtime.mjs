import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const application = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(application, ".medusa/server");
// This runs after the upstream compiler and shared-adapter builder. A partial
// output must fail rather than advertise runtime commands without their inputs.
for (const file of ["medusa-config.js", "src/config/local-commerce.js", "rifare/authority-adapters.mjs"]) {
  readFileSync(resolve(output, file));
}
const manifest = JSON.parse(readFileSync(resolve(application, "package.json"), "utf8"));
manifest.scripts = {
  start: "node run.mjs start",
  "db:migrate": "node run.mjs db:migrate",
  user: "node run.mjs user",
  "test:commerce": "node run.mjs exec ./src/scripts/verify-commerce.js",
  "test:identity": "node run.mjs exec ./src/scripts/verify-identity.js",
};
// The cart-context diagnostic deliberately owns repository-local TLS fixture
// helpers and source mutation checks. Keep its source command in the development
// manifest rather than advertise it as a standalone runtime entry point.
copyFileSync(resolve(application, "run.mjs"), resolve(output, "run.mjs"));
// Keep lock bytes intact. npm ci checks the original dependency graph even
// though scripts in the standalone manifest select compiled entry points.
copyFileSync(resolve(application, "package-lock.json"), resolve(output, "package-lock.json"));
writeFileSync(resolve(output, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ standalone_launcher: true, dependency_lock: "unchanged", runtime: "compiled-backend" }));
