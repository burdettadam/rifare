import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import FencedSystemPaymentProvider from "./service";

export default ModuleProvider(Modules.PAYMENT, { services: [FencedSystemPaymentProvider] });
