import { redirect } from "next/navigation";
import { countUsers } from "@/lib/auth/core";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/forms";
import { signIn } from "../actions";
import { AuthCard } from "../AuthCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if ((await countUsers()) === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  return (
    <AuthCard title="Sign in" subtitle="Use your Home Intelligence account (not your Ring account).">
      <ActionForm action={signIn} className="space-y-3">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
