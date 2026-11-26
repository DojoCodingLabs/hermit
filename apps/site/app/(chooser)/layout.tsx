import type { ReactNode } from "react";
import "../site.css";
import { Head, ThemeScript } from "../../components/head";

/** The root address: a static page offers both languages; vercel.json redirects by Accept-Language first. */
export default function ChooserLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-419">
      <Head />
      <body>
        {children}
        <ThemeScript />
      </body>
    </html>
  );
}
