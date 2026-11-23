import { defineConfig, loadEnv } from "@medusajs/framework/utils";
import { localCommerceConfig } from "./src/config/local-commerce";
import { logger } from "@medusajs/framework/logger";

loadEnv(process.env.NODE_ENV || "development", process.cwd());
process.env.MEDUSA_DISABLE_TELEMETRY = "true";
process.env.MEDUSA_FF_ANALYTICS = "false";
if (process.env.RIFARE_IDENTITY_PROVIDER) logger.setLogLevel("info");

module.exports = defineConfig(localCommerceConfig(process.env));
