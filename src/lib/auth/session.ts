import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { User } from "../domain/types";
import { assertCan, createSessionToken, Permission, revokeSessionToken, userForSessionToken } from "./core";

export const SESSION_COOKIE = "rhi_session";

export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  return userForSessionToken(jar.get(SESSION_COOKIE)?.value);
}

/** For pages/layouts: redirect to sign-in when there is no valid session. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For server actions and route handlers: throws ForbiddenError when the permission is missing. */
export async function requirePermission(permission: Permission): Promise<User> {
  return assertCan(await getCurrentUser(), permission);
}

export async function startSession(userId: string) {
  const { token, expiresAt } = createSessionToken(userId);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) revokeSessionToken(token);
  jar.delete(SESSION_COOKIE);
}
