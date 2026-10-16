import "server-only";
import { requireUser } from "./auth/session";
import { ensureInitialized } from "./bootstrap";

/**
 * Entry point for every signed-in page. Layouts and pages render in parallel in the App Router,
 * so each page must itself wait for first-run initialization before reading data.
 */
export async function requireAppUser() {
  const user = await requireUser();
  await ensureInitialized();
  return user;
}
