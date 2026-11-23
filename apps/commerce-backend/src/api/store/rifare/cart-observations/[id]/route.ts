import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { observeCart } from "../../../../../cart-context/observation";

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (Object.keys(req.query ?? {}).length || Object.keys(req.body ?? {}).length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "This observation accepts only the cart path identifier");
  }
  res.json({ observation: await observeCart(req) });
}
