/** Deletes all demo rows and re-seeds the sample household and timeline. Real data is untouched. */
import { ensureInitialized, resetDemo } from "../src/lib/bootstrap";
import { listEvents } from "../src/lib/repo/events";
import { getSettings, updateSettings } from "../src/lib/repo/settings";

async function main() {
  await ensureInitialized();
  if (!getSettings().demoEnabled) updateSettings({ demoEnabled: true });
  await resetDemo("cli");
  const demo = listEvents({ limit: 1000 }).events.filter((e) => e.demo).length;
  console.log(`Demo data reset: ${demo} demo events.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
