# Owning service boundaries

Use ShoppingCart for grounded recommendation, proposal, current preview and
explicit customer cart confirmation. Its synchronous current cart read reports
an original source purchase observation for recovery; it never performs checkout.

Use PreFulfillmentUpsells to offer and explicitly confirm a native catalog item.
The existing OrderEdits and ActionGateway own review, dispatch, holds, invoice,
settlement, reconciliation and release. Preserve their original identities.

Use CatalogVisibility for permitted fixture observation and immutable history.
Use ReviewedCatalogChanges for factual diffs, independent merchant review,
original effect dispatch/lookup and conflict-aware reviewed rollback.

This bundle is portable guidance in the Rifare repository. Installation is subject
to the existing installer and approval contract. It adds no permission, provider,
live qualification or autonomous checkout action.
