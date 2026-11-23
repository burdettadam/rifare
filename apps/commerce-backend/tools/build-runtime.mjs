import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const application = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(application, ".medusa/server");
// This runs after the upstream compiler and shared-adapter builder. A partial
// output must fail rather than advertise runtime commands without their inputs.
for (const file of ["medusa-config.js", "src/config/local-commerce.js", "rifare/authority-adapters.mjs"]) {
  readFileSync(resolve(output, file));
}
// Read the actual compiled configuration, including its normal environment-file
// selection. A parent-shell flag alone can differ from the upstream build.
const require = createRequire(import.meta.url);
require("@medusajs/framework/utils").loadEnv(process.env.NODE_ENV || "development", application);
const previousDirectory = process.cwd();
let config;
try {
  // defineConfig resolves custom modules against CWD. Select compiled modules,
  // rather than accidentally requiring the repository's TypeScript sources.
  process.chdir(output);
  config = require(resolve(output, "medusa-config.js"));
} finally { process.chdir(previousDirectory); }
let adminEntryAssets = 0;
if (config.admin?.disable !== true) {
  try {
    const directory = resolve(output, "public/admin");
    const html = readFileSync(resolve(directory, "index.html"), "utf8");
    const scripts = new Set([...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1]));
    if (!scripts.size) throw new Error();
    const origin = "http://rifare-build.invalid";
    const prefix = `${(config.admin?.path ?? "/app").replace(/\/$/, "")}/`;
    for (const reference of new Set([...html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(match => match[1]))) {
      if (reference === "data:," && !scripts.has(reference)) continue; // Upstream's empty favicon.
      const url = new URL(reference, origin);
      if (url.origin !== origin || url.search || url.hash || !url.pathname.startsWith(prefix)) throw new Error();
      const asset = resolve(directory, decodeURIComponent(url.pathname.slice(prefix.length)));
      const path = relative(directory, asset);
      if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path) || !statSync(asset).isFile()) throw new Error();
      readFileSync(asset); adminEntryAssets++;
    }
    if (!adminEntryAssets) throw new Error();
  } catch {
    throw new Error("RIFARE_STANDALONE_ADMIN_BUILD_INCOMPLETE");
  }
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
console.log(JSON.stringify({ standalone_launcher: true, dependency_lock: "unchanged", runtime: "compiled-backend",
  standalone_admin: config.admin?.disable === true ? "disabled" : "bundled", admin_entry_assets: adminEntryAssets }));
