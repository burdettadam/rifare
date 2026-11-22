import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import ExternalIdentityProvider from "./provider";

export default ModuleProvider(Modules.AUTH, { services: [ExternalIdentityProvider] });
