import { model } from "@medusajs/framework/utils";

const PrivacyInstallation = model.define("rifare_operation_privacy_installation", {
  id: model.text().primaryKey(),
  key_binding: model.text(),
}).checks([
  { name: "rifare_operation_installation_id", expression: "id ~ '^sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_installation_key", expression: "key_binding ~ '^hmac-sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_installation_no_delete", expression: "deleted_at is null" },
]);

export default PrivacyInstallation;
