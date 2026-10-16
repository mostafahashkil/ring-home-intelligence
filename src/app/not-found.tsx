import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-lg font-semibold">Page not found</p>
      <Link className="btn-secondary" href="/">
        Go home
      </Link>
    </main>
  );
}
