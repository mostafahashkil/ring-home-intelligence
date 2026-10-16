/** Applies pending schema migrations to DATABASE_PATH (default ./data/rhi.db). Also runs automatically on startup. */
import { defaultDbPath, migrate, openDb } from "../src/lib/db";

const db = openDb(defaultDbPath());
const ran = migrate(db);
const all = db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all() as { id: number; name: string }[];
console.log(`Database: ${defaultDbPath()}`);
console.log(ran.length ? `Applied migrations: ${ran.join(", ")}` : "Schema already up to date.");
for (const m of all) console.log(`  ${m.id}  ${m.name}`);
db.close();
