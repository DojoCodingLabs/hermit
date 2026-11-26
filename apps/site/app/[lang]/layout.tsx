import type { ReactNode } from "react";
import "../site.css";
import { LANGS, LOCALE, langOf } from "../../lib/i18n";
import { Head, ThemeScript } from "../../components/head";

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export default async function LangLayout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return (
    <html lang={LOCALE[lang].tag}>
      <Head />
      <body>
        {children}
        <ThemeScript />
      </body>
    </html>
  );
}
