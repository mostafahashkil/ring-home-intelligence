"use server";

import { redirect } from "next/navigation";
import { fail, type ActionResult } from "@/lib/action-result";
import { countUsers, createUser, CredentialsSchema, verifyLogin } from "@/lib/auth/core";
import { endSession, startSession } from "@/lib/auth/session";
import { audit } from "@/lib/repo/audit";

export async function signIn(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const r = await verifyLogin(email, password);
  if (!r.ok) {
    return fail(
      r.reason === "locked"
        ? "Too many attempts. Wait 15 minutes and try again."
        : "That email and password don't match an account.",
    );
  }
  await startSession(r.user.id);
  await audit(r.user.id, "auth.signed_in");
  redirect("/");
}

/** First-run only: creates the household owner. Disabled once any account exists. */
export async function createOwner(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  if ((await countUsers()) > 0) return fail("Setup is already complete. Sign in instead.");
  const parsed = CredentialsSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the email and password.");
  if (form.get("password") !== form.get("confirm")) return fail("Passwords don't match.");
  const user = await createUser(parsed.data.email, parsed.data.password, "owner");
  await audit(user.id, "auth.owner_created");
  await startSession(user.id);
  redirect("/");
}

export async function signOut() {
  await endSession();
  redirect("/login");
}
