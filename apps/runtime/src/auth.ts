import { createHmac, timingSafeEqual, scryptSync } from "node:crypto";
import type { Request, Response } from "express";
import type { Scope } from "@saygo/contracts";
import { config, pool, RESTAURANT } from "@saygo/db";
import { assert, scopeForToken } from "@saygo/domain";
import { z } from "zod";
export const cookie = (req: { headers: { cookie?: string } }, name: string) =>
  req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? "";
export function setCookie(
  res: Response,
  name: string,
  value: string,
  maxAge = 900,
) {
  res.cookie(name, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.SAYGO_WEB_ORIGIN.startsWith("https:"),
    path: "/",
    maxAge: maxAge * 1000,
  });
}
export function sign(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", config.SAYGO_TOKEN_SECRET).update(body).digest("base64url")}`;
}
export function verify(token: string): Record<string, unknown> {
  assert(token.length < 4096, "AUTH", "Invalid credential.", 401);
  const [body, sig, ...extra] = token.split(".");
  assert(
    body && sig && extra.length === 0,
    "AUTH",
    "Authentication required.",
    401,
  );
  const expected = createHmac("sha256", config.SAYGO_TOKEN_SECRET)
    .update(body)
    .digest();
  const actual = Buffer.from(sig, "base64url");
  assert(
    actual.length === expected.length && timingSafeEqual(actual, expected),
    "AUTH",
    "Invalid credential.",
    401,
  );
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    assert(false, "AUTH", "Invalid credential.", 401);
  }
  const claims = z.record(z.string(), z.unknown()).safeParse(data);
  assert(claims.success, "AUTH", "Invalid credential.", 401);
  assert(
    typeof claims.data.exp === "number" && claims.data.exp > Date.now(),
    "AUTH",
    "Credential expired.",
    401,
  );
  return claims.data;
}
const scopeSchema = z.object({
  restaurant_id: z.literal(RESTAURANT),
  lane_id: z.string(),
  session_id: z.string().uuid(),
  epoch: z.number().int(),
  fence: z.number().int(),
  actor: z.literal("agent"),
});
export function agentToken(scope: Scope) {
  return sign({
    ...scope,
    actor: "agent",
    aud: "mcp",
    exp: Date.now() + 15 * 60000,
  });
}
export function mcpScope(req: Request): Scope {
  const credential = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
    req.headers.authorization ?? "",
  );
  assert(credential, "AUTH", "A scoped Bearer credential is required.", 401);
  const data = verify(credential[1]);
  assert(data.aud === "mcp", "AUTH", "Wrong credential audience.", 403);
  const scope = scopeSchema.safeParse(data);
  assert(scope.success, "AUTH", "Invalid credential scope.", 401);
  return scope.data;
}
export const laneScope = (req: Request) =>
  scopeForToken(cookie(req, "saygo_lane"));
export async function staff(
  req: Request,
  roles = ["admin", "crew", "kitchen"],
) {
  const data = verify(cookie(req, "saygo_staff"));
  assert(
    data.aud === "staff" && typeof data.id === "string",
    "AUTH",
    "Staff authentication required.",
    401,
  );
  const user = (
    await pool.query(
      "SELECT id,role,restaurant_id FROM staff_users WHERE id=$1 AND enabled AND restaurant_id=$2",
      [data.id, RESTAURANT],
    )
  ).rows[0];
  assert(
    user && roles.includes(user.role),
    "ROLE",
    "This staff role cannot perform that operation.",
    403,
  );
  return user as { id: string; role: string; restaurant_id: string };
}
export async function login(username: string, password: string) {
  const user = (
    await pool.query(
      "SELECT * FROM staff_users WHERE id=$1 AND enabled AND restaurant_id=$2",
      [username, RESTAURANT],
    )
  ).rows[0];
  const [salt, digest] = (user?.password_hash ?? "invalid:00").split(":");
  const check = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, "hex");
  assert(
    expected.length === check.length && timingSafeEqual(check, expected),
    "LOGIN",
    "Incorrect username or password.",
    401,
  );
  return sign({ aud: "staff", id: user.id, exp: Date.now() + 8 * 60 * 60000 });
}
