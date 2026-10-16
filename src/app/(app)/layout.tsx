import { FlaskConical, LogOut } from "lucide-react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { ensureInitialized } from "@/lib/bootstrap";
import { countUnread } from "@/lib/repo/notifications";
import { getSettings } from "@/lib/repo/settings";
import { getProviders } from "@/lib/providers/registry";
import { ConnectionPill } from "@/components/badges";
import { BottomNav, SideNav } from "@/components/NavLinks";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeMenu } from "@/components/ThemeMenu";
import { signOut } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await ensureInitialized();
  const settings = getSettings();
  const providers = getProviders();
  const ring = providers.find((p) => p.id === "ring")!.connection();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-2">
        Skip to content
      </a>
      <aside className="hidden border-r border-line bg-surface lg:flex lg:flex-col lg:gap-6 lg:p-4">
        <Brand />
        <SideNav />
        <div className="mt-auto space-y-3 text-xs text-muted">
          <p>Signed in as {user.email.replace(/^(.).*(@.*)$/, "$1•••$2")} ({user.role})</p>
          <form action={signOut}>
            <button className="btn-ghost -ml-3" type="submit">
              <LogOut aria-hidden className="h-4 w-4" /> Sign out
            </button>
          </form>
          <p className="leading-relaxed">Concept app. Not affiliated with or endorsed by Amazon or Ring.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-chrome/90 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="lg:hidden">
            <Brand compact />
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label="Connection status">
            <Link href="/settings#integrations" className="hidden sm:block">
              <ConnectionPill state={ring.state} label="Ring" />
            </Link>
            {settings.demoEnabled && (
              <Link href="/settings#demo">
                <ConnectionPill state="demo" label="Data" compact />
              </Link>
            )}
          </div>
          <ThemeMenu />
          <NotificationBell initialUnread={countUnread(!settings.hideDemoData)} />
          <form action={signOut} className="lg:hidden">
            <button className="btn-ghost" type="submit" aria-label="Sign out">
              <LogOut aria-hidden className="h-5 w-5" />
            </button>
          </form>
        </header>

        {settings.demoEnabled && (
          <div className="demo-stripe border-b border-demo/30 px-4 py-2 text-sm sm:px-6" role="note">
            <span className="inline-flex items-center gap-2 font-medium text-demo">
              <FlaskConical aria-hidden className="h-4 w-4" /> Demo mode
            </span>{" "}
            <span className="text-muted">
              Items marked “Demo” are sample data, not from your cameras. Alex, Emily, Jack and Sarah are example profiles.{" "}
              <Link href="/settings#demo" className="text-accent underline-offset-2 hover:underline">
                Manage demo data
              </Link>
            </span>
          </div>
        )}

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg aria-hidden viewBox="0 0 32 32" className="h-8 w-8 shrink-0">
        <rect width="32" height="32" rx="8" fill="rgb(var(--accent))" />
        <path d="M16 7 7 14.5V25h6.5v-6h5v6H25V14.5z" fill="none" stroke="rgb(var(--accent-ink))" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
      {!compact && (
        <span className="leading-tight">
          <span className="block text-sm font-semibold">Home Intelligence</span>
          <span className="block text-xs text-muted">for Ring cameras · concept</span>
        </span>
      )}
    </Link>
  );
}
