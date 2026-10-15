# Platform notes

The shared workflow uses canonical actions. The platform pack maps them to tested APIs and reports unsupported capabilities.

Shopify: preserve native return/reverse-fulfillment records and qualified order-edit lifecycle semantics. See source S04/S05 in the roadmap.

WooCommerce: distinguish the platform's refund record, an actual gateway refund and our proposed local return case. Do not claim a manual refund record proves that money moved. See source S07. Each gateway and extension combination must be separately qualified.

These are design notes, not a certified adapter or complete integration specification.
