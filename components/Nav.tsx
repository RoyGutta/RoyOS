"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Assistant" },
  { href: "/command", label: "Command" },
  { href: "/brief", label: "Brief" },
  { href: "/projects", label: "Projects" },
  { href: "/factory", label: "Factory" },
  { href: "/dashboards", label: "Dashboards" },
  { href: "/agents", label: "Agents" },
  { href: "/integrations", label: "Integrations" },
  { href: "/runs", label: "Runs" },
  { href: "/map", label: "Map" },
  { href: "/leads", label: "Leads" },
  { href: "/business", label: "Business" },
  { href: "/content", label: "Content" },
  { href: "/continuous", label: "Continuous" },
  { href: "/system", label: "System" },
  { href: "/royos", label: "RoyOS" },
];

/** Hosted builds serve only the Continuous Mode surface (middleware.ts); every other link would be a 404 there. */
const HOSTED_LINKS = [
  { href: "/continuous", label: "Continuous" },
  { href: "/logout", label: "Sign out" },
];

/** One navigation for every workspace. Each link is a real page; nothing here is a dead end. */
export default function Nav({ hosted = false }: { hosted?: boolean }) {
  const path = usePathname() || "/";
  const links = hosted ? HOSTED_LINKS : LINKS;
  return (
    <header className="panel px-3 py-2 flex flex-wrap items-center gap-3">
      <a href={hosted ? "/continuous" : "/"} className="flex items-center gap-2 pr-2 no-underline">
        <span className="text-[15px] tracking-[0.16em] text-ink">JARVIS</span>
        <span className="eyebrow hidden sm:inline">{hosted ? "continuous mode" : "assistant"}</span>
      </a>
      <nav className="nav" aria-label="Workspaces">
        {links.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <a key={l.href} href={l.href} className={`nav__link ${active ? "nav__link--active" : ""}`} aria-current={active ? "page" : undefined}>
              {l.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
