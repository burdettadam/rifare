import NativePaymentModule, { discoveryPath } from "@medusajs/medusa/payment";

/** Resource-preserving native service extension. C12 must prove actual provider
 * edge enforcement before this module can claim to fence payment calls. */
class NativeExecutionPaymentService extends NativePaymentModule.service {
  nativeExecutionQualificationProfile() {
    if (process.env.NODE_ENV !== "test" || process.env.RIFARE_COMMERCE_VERIFY !== "disposable" ||
        process.env.RIFARE_TEST_NATIVE_EXECUTION !== "worker-identity") throw new Error("NATIVE_EXECUTION_PROFILE_UNAVAILABLE");
    return Object.freeze({ native_service_extension: true, execution_authorized: false, production_qualified: false });
  }
}

// Use the public resource discovery contract so upstream models, loaders and
// migrations stay upstream. No provider identity or vendor implementation changes.
export default { ...NativePaymentModule, service: NativeExecutionPaymentService, discoveryPath };
export { discoveryPath };
