/**
 * Applies pending schema migrations — to Netlify Database when NETLIFY_DB_URL is set, otherwise to
 * the SQLite file at DATABASE_PATH (default ./data/rhi.db). Also runs automatically on startup.
 */
import { defaultDbPath, openDb } from "../src/lib/db";

async function main() {
  const db = await openDb();
  const all = await db.all<{ id: number; name: string }>("SELECT id, name FROM schema_migrations ORDER BY id");
  console.log(`Database: ${db.dialect === "postgres" ? "Netlify Database (Postgres)" : defaultDbPath()}`);
  console.log("Schema up to date. Applied migrations:");
  for (const m of all) console.log(`  ${m.id}  ${m.name}`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
