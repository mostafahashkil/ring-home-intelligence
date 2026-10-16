export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <svg aria-hidden viewBox="0 0 32 32" className="h-10 w-10">
            <rect width="32" height="32" rx="8" fill="rgb(var(--accent))" />
            <path d="M16 7 7 14.5V25h6.5v-6h5v6H25V14.5z" fill="none" stroke="rgb(var(--accent-ink))" strokeWidth="2.2" strokeLinejoin="round" />
          </svg>
          <div>
            <p className="font-semibold">Home Intelligence</p>
            <p className="text-xs text-muted">Concept companion for Ring cameras</p>
          </div>
        </div>
        <div className="card p-5">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mb-4 mt-1 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
        <p className="mt-4 text-center text-xs text-muted">
          Not affiliated with or endorsed by Amazon or Ring. This app never asks for your Ring password.
        </p>
      </div>
    </main>
  );
}
