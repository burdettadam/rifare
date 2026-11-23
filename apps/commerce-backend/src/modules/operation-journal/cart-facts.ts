import { createRawPropertiesFromBigNumber, decorateCartTotals } from "@medusajs/framework/utils";
import type { ModulesSdkUtils } from "@medusajs/framework/utils";
import { factsDigest, projectCart } from "../../cart-context/observation";
import { cartId, unavailable } from "../../cart-context/policy";

type Postgres = ReturnType<typeof ModulesSdkUtils.createPgConnection>;
type Merchant = Parameters<typeof projectCart>[1];

const addressFields = [
  "id", "customer_id", "first_name", "last_name", "phone", "company",
  "address_1", "address_2", "city", "country_code", "province", "postal_code",
];
const taxFields = ["id", "code", "tax_rate_id", "provider_id", "rate"];
const adjustmentFields = ["id", "code", "promotion_id", "provider_id", "is_tax_inclusive", "raw_amount"];

/**
 * Use the existing journal transaction and native Medusa totals. The caller
 * owns the serializable transaction, association checks and journal write.
 * Stable lock order and bounded rows keep the transaction short.
 */
export async function readLockedCartFacts(transaction: Postgres, id: string, merchant: Merchant) {
  if (!transaction.isTransaction) throw new Error("A PostgreSQL transaction is required");
  const { rows } = await transaction.raw("show transaction_isolation");
  if (rows[0]?.transaction_isolation !== "serializable") {
    throw new Error("Serializable isolation is required for cart facts");
  }

  const liveRows = (table: string) => transaction(table).whereNull("deleted_at").orderBy("id").forUpdate();
  const cart = await liveRows("cart").where({ id: cartId(id) }).first(
    "id", "customer_id", "region_id", "sales_channel_id", "currency_code", "email", "completed_at",
    "shipping_address_id", "billing_address_id",
  );
  if (!cart || cart.completed_at != null) throw unavailable();

  const addressIds = [cart.shipping_address_id, cart.billing_address_id].filter(id => id != null);
  const addresses = await liveRows("cart_address").whereIn("id", addressIds).select(addressFields);
  const address = (id: string | null) => {
    if (id == null) return null;
    const value = addresses.find(entry => entry.id === id);
    if (!value) throw unavailable();
    return value;
  };

  const items = await liveRows("cart_line_item").where({ cart_id: id }).limit(201).select(
    "id", "product_id", "variant_id", "quantity", "raw_unit_price", "requires_shipping",
    "is_giftcard", "is_discountable", "is_tax_inclusive", "is_custom_price",
  );
  const shipping = await liveRows("cart_shipping_method").where({ cart_id: id }).limit(21).select(
    "id", "shipping_option_id", "raw_amount", "is_tax_inclusive",
  );
  const credits = await liveRows("credit_line").where({ cart_id: id }).limit(101).select(
    "id", "raw_amount", "reference", "reference_id",
  );
  if (items.length > 200 || shipping.length > 20 || credits.length > 100) throw unavailable();

  const itemIds = items.map(row => row.id);
  const shippingIds = shipping.map(row => row.id);
  const itemTax = await liveRows("cart_line_item_tax_line").whereIn("item_id", itemIds)
    .limit(10001).select("item_id", ...taxFields);
  const itemAdjustments = await liveRows("cart_line_item_adjustment").whereIn("item_id", itemIds)
    .limit(10001).select("item_id", ...adjustmentFields);
  const shippingTax = await liveRows("cart_shipping_method_tax_line").whereIn("shipping_method_id", shippingIds)
    .limit(1001).select("shipping_method_id", ...taxFields);
  const shippingAdjustments = await liveRows("cart_shipping_method_adjustment").whereIn("shipping_method_id", shippingIds)
    .limit(1001).select("shipping_method_id", "id", "code", "promotion_id", "provider_id", "raw_amount");

  const native = decorateCartTotals({
    ...cart,
    shipping_address: address(cart.shipping_address_id),
    billing_address: address(cart.billing_address_id),
    items: items.map(row => ({ ...row,
      tax_lines: itemTax.filter(tax => tax.item_id === row.id),
      adjustments: itemAdjustments.filter(adjustment => adjustment.item_id === row.id),
    })),
    shipping_methods: shipping.map(row => ({ ...row,
      tax_lines: shippingTax.filter(tax => tax.shipping_method_id === row.id),
      adjustments: shippingAdjustments.filter(adjustment => adjustment.shipping_method_id === row.id),
    })),
    credit_lines: credits,
  });
  createRawPropertiesFromBigNumber(native);
  const facts = projectCart(native, merchant);
  return { facts, factsDigest: factsDigest(facts) };
}
