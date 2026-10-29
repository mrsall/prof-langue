import Link from "next/link";

export const metadata = { title: "Page introuvable · Prof de langues" };

/** Page 404 en français, aux couleurs de l'app (le modèle Next.js par défaut était en anglais sur fond blanc). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-6xl font-bold text-accent">404</p>
      <h1 className="text-2xl font-bold">Cette page n&apos;existe pas</h1>
      <p className="text-sm text-muted">Le lien est peut-être ancien. Reviens à l&apos;accueil pour lancer une séance.</p>
      <Link href="/" className="flex h-14 w-full items-center justify-center rounded-2xl bg-accent text-base font-bold text-accent-contrast">
        Accueil
      </Link>
    </main>
  );
}
