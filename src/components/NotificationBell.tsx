"use client";

import { Bell, BellRing, FlaskConical, HelpCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface Item {
  id: string;
  eventId: string | null;
  title: string;
  body: string;
  channel: "push" | "in_app" | "review";
  createdAt: number;
  readAt: number | null;
  demo: boolean;
}

const POLL_MS = 20_000;

/**
 * In-app notification center. Polls the server; for "push" items it also shows a browser
 * notification when the person has granted permission (this is the MVP push channel — no
 * third-party push service is used).
 */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const seen = useRef<Set<string> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 401 ? "Signed out" : "Couldn't load notifications");
      const data = (await res.json()) as { unread: number; items: Item[] };
      setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
      setItems(data.items);
      setUnread(data.unread);
      setError(null);
      if (seen.current === null) {
        seen.current = new Set(data.items.map((i) => i.id));
      } else {
        for (const i of data.items) {
          if (seen.current.has(i.id)) continue;
          seen.current.add(i.id);
          if (i.channel === "push" && typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(i.demo ? `[Demo] ${i.title}` : i.title, { body: i.body, tag: i.id });
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function markRead() {
    await fetch("/api/notifications", { method: "POST" });
    load();
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="btn-ghost relative"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        {unread ? <BellRing aria-hidden className="h-5 w-5" /> : <Bell aria-hidden className="h-5 w-5" />}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-5 text-accent-ink">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="card absolute right-0 z-40 mt-2 w-[min(92vw,380px)] p-2 shadow-xl">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-sm font-semibold">Notifications</p>
            <button type="button" className="text-xs text-accent hover:underline disabled:opacity-50" onClick={markRead} disabled={!unread}>
              Mark all read
            </button>
          </div>
          {permission === "default" && (
            <button
              type="button"
              className="mx-2 mb-2 w-[calc(100%-1rem)] rounded-lg border border-dashed border-line p-2 text-left text-xs text-muted hover:bg-sunken"
              onClick={async () => setPermission(await Notification.requestPermission())}
            >
              Enable browser alerts for push-level notifications while this app is open.
            </button>
          )}
          {error && <p className="px-2 py-3 text-sm text-danger">{error}</p>}
          {!error && items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted">You&apos;re all caught up.</p>}
          <ul className="max-h-96 overflow-y-auto">
            {items.map((i) => (
              <li key={i.id}>
                <Link
                  href={i.eventId ? `/activity/${i.eventId}` : "/activity"}
                  onClick={() => setOpen(false)}
                  className={`flex gap-2 rounded-lg px-2 py-2 hover:bg-sunken ${i.readAt ? "opacity-70" : ""}`}
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: i.readAt ? "transparent" : "rgb(var(--accent))" }} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-snug">
                      {i.channel === "review" && <HelpCircle aria-label="Needs review" className="mr-1 inline h-3.5 w-3.5 text-warn" />}
                      {i.title}
                    </span>
                    <span className="block text-xs text-muted">
                      {i.demo && (
                        <span className="mr-1 inline-flex items-center gap-0.5 text-demo">
                          <FlaskConical aria-hidden className="h-3 w-3" />
                          Demo ·
                        </span>
                      )}
                      {i.body}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
