import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brèves AMF",
  description: "Publications réglementées info-financière et brèves vérifiées générées par IA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        {/* Same typefaces as clardot.com: DM Sans for UI, Lora for editorial text. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,700&display=swap"
        />
      </head>
      <body>
        <header className="top">
          <div className="wrap">
            <Link href="/" className="brand">brèves<span className="dot">.</span>amf</Link>
            <nav>
              <Link href="/">Publications</Link>
              <Link href="/selection">Sélection</Link>
              <Link href="/briefs">Brèves</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="wrap">
          Source : <a href="https://www.info-financiere.gouv.fr/">info-financiere.gouv.fr</a> (AMF, DILA),
          Licence Ouverte. Exercice technique, les brèves générées par IA doivent être relues.
        </footer>
      </body>
    </html>
  );
}
