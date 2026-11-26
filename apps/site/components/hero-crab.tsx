// The hero's crab: it waves hello (rig/hello.svg), then settles into the logo pose (rig/mark.svg) and blinks now and
// then (rig/blink.svg). Three of the rig's own frames stacked in the same box and swapped by CSS, so the crab is
// always the reference drawing, never redrawn. With reduced motion it just waves, still.
import { BrandImage } from "./brand-image";

const FRAME = { width: 693, height: 601 } as const;

export function HeroCrab({ alt }: { alt: string }) {
  return (
    <div className="crab">
      <span className="crab-frame crab-hello">
        <BrandImage light="mascot/rig/hello.svg" dark="mascot/rig/hello-dark.svg" alt={alt} {...FRAME} eager />
      </span>
      <span className="crab-frame crab-idle" aria-hidden="true">
        <BrandImage light="mascot/rig/mark.svg" dark="mascot/rig/mark-dark.svg" alt="Hermit" {...FRAME} eager />
      </span>
      <span className="crab-frame crab-blink" aria-hidden="true">
        <BrandImage light="mascot/rig/blink.svg" dark="mascot/rig/blink-dark.svg" alt="Hermit" {...FRAME} eager />
      </span>
    </div>
  );
}
