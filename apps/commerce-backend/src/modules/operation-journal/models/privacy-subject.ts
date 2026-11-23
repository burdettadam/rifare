import { model } from "@medusajs/framework/utils";

const PrivacySubject = model.define("rifare_operation_privacy_subject", {
  id: model.text().primaryKey(),
  suppressed: model.boolean().default(false),
}).checks([
  { name: "rifare_operation_privacy_subject_key", expression: "id ~ '^hmac-sha256:[0-9a-f]{64}$'" },
  { name: "rifare_operation_privacy_subject_no_delete", expression: "deleted_at is null" },
]);

export default PrivacySubject;
