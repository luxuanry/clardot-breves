"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Publications" },
  { href: "/selection", label: "Sélection" },
  { href: "/briefs", label: "Brèves" },
];

/** Main navigation; marks the current page with aria-current for styling and screen readers. */
export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
