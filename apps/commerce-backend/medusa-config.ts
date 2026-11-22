import { defineConfig, loadEnv } from "@medusajs/framework/utils";
import { localCommerceConfig } from "./src/config/local-commerce";

loadEnv(process.env.NODE_ENV || "development", process.cwd());
process.env.MEDUSA_DISABLE_TELEMETRY = "true";
process.env.MEDUSA_FF_ANALYTICS = "false";

module.exports = defineConfig(localCommerceConfig(process.env));
