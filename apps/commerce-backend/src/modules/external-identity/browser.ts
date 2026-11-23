import { createHash, randomBytes } from "node:crypto";

export const loginPath = "/auth/customer/external-oidc";
const cookieName = "rifare_oidc_browser";
export const flowLifetime = 300;
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function browserBinding(cookie: unknown): Promise<string | undefined> {
  if (typeof cookie !== "string" || cookie.length > 16384) return undefined;
  // Reject ambiguous cookie names rather than choosing one browser context.
  if (cookie.split(";").filter((part) => part.trim().split("=", 1)[0] === cookieName).length !== 1) return undefined;
  const { parseCookie } = await import("cookie");
  const value = parseCookie(cookie)[cookieName];
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}

export async function newBrowserBinding() {
  const { stringifySetCookie } = await import("cookie");
  const value = randomBytes(32).toString("base64url");
  return { value, requestCookie: `${cookieName}=${value}`, responseCookie: stringifySetCookie({
    name: cookieName, value, path: loginPath, maxAge: flowLifetime,
    httpOnly: true, sameSite: "lax", secure: false,
    // This application profile serves loopback HTTP only. HTTPS hosting needs qualification.
  }) };
}

export function flowKey(state: string, browser: string) {
  // Wrong-browser attempts cannot consume a legitimate browser's pending flow.
  return `rifare-oidc:${state}:${digest(browser)}`;
}
