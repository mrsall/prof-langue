"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Barre d'onglets fixe en bas : Accueil, Carnet, Prononciation, Suivi, Réglages.
 * Zones de toucher d'au moins 44 × 44 px, icônes, onglet courant en couleur.
 * Les pages qui l'affichent gardent une marge basse (pb ≥ 6rem).
 */
const TABS: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/",
    label: "Accueil",
    icon: <path d="M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10" />,
  },
  {
    href: "/carnet",
    label: "Carnet",
    icon: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zm0 13a3 3 0 0 1 3-3h11M9 8h6" />,
  },
  {
    href: "/prononciation",
    label: "Prononciation",
    icon: <path d="M9 3a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0V3zM5 11a7 7 0 0 0 14 0M12 18v3" />,
  },
  {
    href: "/suivi",
    label: "Suivi",
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
  {
    href: "/reglages",
    label: "Réglages",
    icon: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4 1.5-1-1.2-2.1-1.8.4a7 7 0 0 0-1.3-1.3l.4-1.8L16 5l-1 1.5a7 7 0 0 0-1.8 0L12.2 5 10.1 6.2l.4 1.8a7 7 0 0 0-1.3 1.3L7.4 9 6.2 11.1l1.5 1a7 7 0 0 0 0 1.8l-1.5 1 1.2 2.1 1.8-.4a7 7 0 0 0 1.3 1.3l-.4 1.8 2.1 1.2 1-1.5a7 7 0 0 0 1.8 0l1 1.5 2.1-1.2-.4-1.8a7 7 0 0 0 1.3-1.3l1.8.4 1.2-2.1-1.5-1a7 7 0 0 0 0-1.8z" />,
  },
];

export function TabBar({ badges }: { badges?: Partial<Record<string, string>> } = {}) {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="Écrans de l'app"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-elevated/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid w-full max-w-md grid-cols-5">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          const badge = badges?.[t.href];
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {t.icon}
                </svg>
                <span>{t.label}</span>
                {badge && <span className="absolute top-1.5 right-[calc(50%-20px)] rounded-full bg-accent px-1.5 text-[10px] font-bold text-accent-contrast">{badge}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
