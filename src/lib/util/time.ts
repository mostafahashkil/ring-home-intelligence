/** Request-time clock for dynamic server pages (kept in one place so it is easy to stub). */
export function currentTime(): number {
  return Date.now();
}

/** Minutes since local midnight for `ts` in the given IANA timezone. */
export function minutesOfDay(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when `ts` falls inside [start, end). Windows may wrap midnight (e.g. 22:00–06:00). */
export function inWindow(ts: number, window: { start: string; end: string }, timeZone: string): boolean {
  const now = minutesOfDay(ts, timeZone);
  const start = parseHHMM(window.start);
  const end = parseHHMM(window.end);
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

export function formatTime(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(ts));
}

export function formatDateTime(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ts));
}

export function formatDay(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(
    new Date(ts),
  );
}

export function dayKey(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(ts),
  );
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
