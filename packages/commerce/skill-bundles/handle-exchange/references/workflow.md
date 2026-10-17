# Handle a variant exchange: canonical workflow

Use return.status, return.exchange.quote, action.preview, action.approve, action.execute and return.operation.read contracts at version 1.0.0. These action requirements grant no authority.

The server's merchant profile controls policy, fees, evidence and permitted outcomes. Platform packs describe capability limits; actual native calls remain in qualified adapters. Read-only status remains separate from write execution. Approved exceptions require current server evidence, not an edited skill.

A return has separate authorization, receipt, inspection, inventory, refund/credit and replacement states. Report each independently. A carrier delivery is not warehouse receipt. A refund marked accepted is not settled. An issued credit is not cash. A created replacement is not shipped. Cancellation preserves completed effects. Native changes invalidate pending decisions; never overwrite native history to match a plan.

If the server requires handoff, preserve the request ID and original receipts. Do not invent a successful final answer. Models and runtimes may be replaced without re-creating obligations.
