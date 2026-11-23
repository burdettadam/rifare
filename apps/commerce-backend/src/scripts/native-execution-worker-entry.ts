import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { loadSearchIndexes } from "@medusajs/medusa/loaders/search";
import { MedusaModule } from "@medusajs/framework/modules-sdk";
import { initializeContainer } from "@medusajs/medusa/loaders/index";
import { MedusaAppLoader, LinkLoader, WorkflowLoader, SubscriberLoader, container as nativeContainer } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules, getResolvedPlugins, mergePluginModules } from "@medusajs/framework/utils";
import { requireNativeExecutionProfile } from "../modules/operation-journal/execution-claim";
import verifyNativeExecutionWorker from "./verify-native-execution-worker";

/** Internal disposable native-module composition. Server-default provisioning is
 * owned by the controller; this process has no API-key or identity-table access.
 * Native modules, links, workflows, subscribers and lifecycle hooks are upstream.
 * No private completion/payment engine, HTTP server or background job is copied.
 */
async function main() {
  requireNativeExecutionProfile();
  if (!process.env.RIFARE_C12_NATIVE_WORKER || process.env.MEDUSA_WORKER_MODE !== "server")
    throw new Error("NATIVE_MODULE_WORKER_REQUIRED");
  const directory = process.cwd();
  let app: Awaited<ReturnType<MedusaAppLoader["load"]>> | undefined;
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const container = await initializeContainer(directory);
    const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE), logger = container.resolve(ContainerRegistrationKeys.LOGGER);
    if (config.projectConfig.workerMode !== "server")
      throw new Error("NATIVE_MODULE_WORKER_CONFIGURATION_UNSUPPORTED");
    const plugins = await getResolvedPlugins(directory, config, true);
    mergePluginModules(config, plugins, directory);
    await new LinkLoader(plugins.map(plugin => resolve(plugin.resolve, "links")), logger).load();
    await loadSearchIndexes({ plugins, configModule: config, logger });
    app = await new MedusaAppLoader({ container }).load();
    await new WorkflowLoader(plugins.map(plugin => resolve(plugin.resolve, "workflows")), container).load();
    const require = createRequire(resolve(directory, "package.json"));
    const medusa = dirname(require.resolve("@medusajs/medusa/package.json"));
    await new SubscriberLoader([resolve(medusa, "dist/subscribers"), ...plugins.map(plugin => resolve(plugin.resolve, "subscribers"))], undefined, container).load();
    if (container.hasRegistration(Modules.SEARCH) && container.resolve<any>(Modules.SEARCH)?.isWorkerMode !== false)
      throw new Error("NATIVE_MODULE_SEARCH_BACKGROUND_WORK_UNSUPPORTED");
    if (stopping) throw new Error("NATIVE_MODULE_WORKER_INTERRUPTED");
    await app.onApplicationStart();
    if (stopping) throw new Error("NATIVE_MODULE_WORKER_INTERRUPTED");
    await verifyNativeExecutionWorker({ container, args: [] });
    if (stopping) throw new Error("NATIVE_MODULE_WORKER_INTERRUPTED");
  } finally {
    // Attempt every owned cleanup even when loading/start/execution rejects.
    // A fresh process owns this singleton; no controller modules are reused.
    const failures: unknown[] = [];
    const cleanup = async (run: () => Promise<unknown>) => { try { await run(); } catch (error) { failures.push(error); } };
    if (app) {
      await cleanup(() => app!.onApplicationPrepareShutdown());
      await cleanup(() => app!.onApplicationShutdown());
    } else {
      await cleanup(() => MedusaModule.onApplicationPrepareShutdown());
      await cleanup(() => MedusaModule.onApplicationShutdown());
    }
    const postgres = nativeContainer.hasRegistration(ContainerRegistrationKeys.PG_CONNECTION) ?
      nativeContainer.resolve(ContainerRegistrationKeys.PG_CONNECTION) : undefined;
    await cleanup(() => nativeContainer.dispose());
    if (postgres) await cleanup(() => postgres.destroy());
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    if (failures.length) throw new AggregateError(failures, "Native module worker cleanup failed");
    console.log("C12_NATIVE_MODULE_WORKER_SHUTDOWN=complete");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
