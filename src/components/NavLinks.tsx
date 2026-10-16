"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Camera, Home, ListChecks, Settings, Users } from "lucide-react";

export const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/household", label: "Household", icon: Users },
  { href: "/cameras", label: "Cameras & Zones", icon: Camera },
  { href: "/rules", label: "Rules & Automations", icon: ListChecks },
  { href: "/settings", label: "Privacy & Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-accent/10 text-accent" : "text-muted hover:bg-sunken hover:text-ink"
            }`}
          >
            <Icon aria-hidden className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-6">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 px-1 py-2 text-[10px] font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <Icon aria-hidden className="h-5 w-5" />
                <span className="truncate">{label.split(" ")[0]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
