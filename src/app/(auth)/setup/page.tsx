import { redirect } from "next/navigation";
import { countUsers } from "@/lib/auth/core";
import { ActionForm, SubmitButton } from "@/components/forms";
import { createOwner } from "../actions";
import { AuthCard } from "../AuthCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage() {
  if ((await countUsers()) > 0) redirect("/login");
  return (
    <AuthCard
      title="Create the owner account"
      subtitle="This account controls household profiles, rules, privacy settings and the Ring connection. You'll start in demo mode with sample data."
    >
      <ActionForm action={createOwner} className="space-y-3">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="input" id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-describedby="pw-hint" />
          <p className="hint" id="pw-hint">At least 10 characters. Stored only as a salted scrypt hash.</p>
        </div>
        <div>
          <label className="label" htmlFor="confirm">Confirm password</label>
          <input className="input" id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        </div>
        <SubmitButton className="btn-primary w-full" pendingText="Creating…">Create account</SubmitButton>
      </ActionForm>
    </AuthCard>
  );
}
