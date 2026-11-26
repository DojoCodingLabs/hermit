/**
 * A brand file with its Deep sea twin: the light file in the light theme, the dark one in the dark theme, whether the
 * system or the theme switch picked it. A <picture> can only follow the system, so the pair is two images and the
 * stylesheet shows one (site.css, "Themes"). Both are lazy, so only the one on screen is fetched. No JavaScript, no
 * image optimizer: the files are served exactly as they are in docs/brand.
 */
export function BrandImage(props: { light: string; dark?: string; alt: string; width: number; height: number; className?: string; eager?: boolean }) {
  const img = (file: string, theme?: "on-light" | "on-dark") => (
    <img
      src={`/brand/${file}`}
      alt={props.alt}
      width={props.width}
      height={props.height}
      className={[props.className, theme].filter(Boolean).join(" ") || undefined}
      loading={props.eager && !theme ? "eager" : "lazy"}
      decoding="async"
    />
  );
  if (!props.dark) return img(props.light);
  return (
    <>
      {img(props.light, "on-light")}
      {img(props.dark, "on-dark")}
    </>
  );
}
