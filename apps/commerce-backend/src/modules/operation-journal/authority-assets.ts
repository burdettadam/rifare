import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Source and compiled consumers must load the same concrete adapter namespace. */
export async function authorityAdapters() {
  if (__filename.endsWith(".js")) {
    return import(pathToFileURL(resolve(__dirname, "../../../rifare/authority-adapters.mjs")).href);
  }
  const directory = resolve(process.cwd(), "../../packages/adapters/delegated-commands");
  const [wire, codec, request_json, request_time] = await Promise.all([
    import(pathToFileURL(resolve(directory, "public-use-client.mts")).href),
    import(pathToFileURL(resolve(directory, "command-codec.mts")).href),
    import(pathToFileURL(resolve(directory, "../delegated-receipts/strict-json.mts")).href),
    import(pathToFileURL(resolve(directory, "../../commerce/delegated-receipt-binding.mts")).href),
  ]);
  return { wire, codec, request_json, request_time };
}
