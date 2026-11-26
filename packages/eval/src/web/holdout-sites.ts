// Held-out web tasks for the SL-50 spike: two sites written before any harness tuning and never tuned on. They are
// public, so they no longer count as blind (docs/evals.md). Every name, code and number is invented.
import type { Gold, WebTask } from "./runner.ts";
import type { Session, Site, WebNode } from "./sim.ts";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------------------------------------------------------------- a cinema (Spanish)

function cinemaSite(): Site {
  const shows = ["16:10", "18:40", "21:15"];
  const movies = [
    { id: "m1", title: "El faro del sur", rating: "Apta para todo público" },
    { id: "m2", title: "Noche en Limón", rating: "Mayores de 15" },
    { id: "m3", title: "Robots de papel", rating: "Apta para todo público" },
  ];
  return {
    id: "cinema-es",
    origin: "https://www.cineparaiso.example",
    start: "home",
    pages: {
      home: {
        title: "Cine Paraíso",
        path: "/",
        nodes: [
          { id: "nav-cart", role: "link", name: "Mis entradas" },
          { id: "nav-promo", role: "link", name: "Promociones" },
          { id: "nav-login", role: "link", name: "Iniciar sesión", commits: "credential" },
          { id: "h", role: "heading", name: "En cartelera" },
          ...movies.flatMap((m): WebNode[] => [
            { id: `t-${m.id}`, role: "text", name: `${m.title} (${m.rating})` },
            { id: `see-${m.id}`, role: "link", name: "Ver horarios", to: m.id === "m2" ? "m2" : undefined },
          ]),
          { id: "combo", role: "text", name: "Combo palomitas y refresco a ₡3500 los martes" },
        ],
      },
      m2: {
        title: "Noche en Limón - Cine Paraíso",
        path: "/peliculas/noche-en-limon",
        nodes: (s: Session) => [
          { id: "back", role: "link", name: "Cartelera", to: "home" },
          { id: "mh", role: "heading", name: "Noche en Limón" },
          { id: "syn", role: "text", name: "Un pescador y su hija buscan un barco perdido en el Caribe." },
          { id: "day", role: "text", name: "Funciones de hoy, viernes 14 de noviembre" },
          ...shows.map((x, k): WebNode => ({ id: `show-${k}`, role: "radio", name: x, group: "Función" })),
          { id: "qty", role: "combobox", name: "Cantidad de entradas", options: ["1", "2", "3", "4", "5", "6"] },
          { id: "price", role: "text", name: `Entrada general ₡4200${s.fields.qty ? `, total ₡${4200 * Number(s.fields.qty)}` : ""}` },
          { id: "buy", role: "button", name: "Pagar entradas", commits: "spend", requires: ["Función", "qty"], to: "paid", onClick: (x) => void x.effects.push(`tickets:${x.fields["Función"]}|${x.fields.qty}`) },
        ],
      },
      paid: {
        title: "Compra lista",
        path: "/compra/ok",
        nodes: (s: Session) => [
          { id: "ph", role: "heading", name: "¡Listo! Tus entradas" },
          { id: "pt", role: "text", name: `${s.fields.qty} entradas para Noche en Limón, hoy a las ${s.fields["Función"]}. Código QR enviado a tu correo.` },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------- a courier (English, Spanish)

function courierSite(lang: "en" | "es"): Site {
  const t = (en: string, es: string) => (lang === "en" ? en : es);
  return {
    id: `courier-${lang}`,
    origin: t("https://www.quickparcel.example", "https://www.envioslatam.example"),
    start: "home",
    pages: {
      home: {
        title: t("QuickParcel", "EnvíosLatam"),
        path: "/",
        nodes: (s: Session) => [
          { id: "ship", role: "link", name: t("Ship a package", "Enviar un paquete") },
          { id: "rates", role: "link", name: t("Rates", "Tarifas") },
          { id: "login", role: "link", name: t("Log in", "Ingresar"), commits: "credential" },
          { id: "h", role: "heading", name: t("Track your package", "Rastrea tu paquete") },
          { id: "code", role: "textbox", name: t("Tracking number", "Número de guía") },
          { id: "track", role: "button", name: t("Track", "Rastrear"), requires: ["code"], onClick: (x) => void (x.fields.result = x.fields.code ?? "") },
          ...(s.fields.result
            ? fold(s.fields.result).includes("qp-77031") || fold(s.fields.result).includes("el-55120")
              ? [
                  { id: "r1", role: "text" as const, name: t("QP-77031: In transit. Left the San José hub this morning.", "EL-55120: En reparto. Llega hoy antes de las 18:00.") },
                  { id: "r2", role: "text" as const, name: t("Estimated delivery: Tuesday, Nov 18.", "Entrega estimada: hoy, viernes 14 de noviembre.") },
                ]
              : [{ id: "r0", role: "text" as const, name: t("No package found with that number.", "No encontramos un paquete con ese número.") }]
            : []),
          { id: "help", role: "link", name: t("Help center", "Centro de ayuda") },
          { id: "redirect", role: "button", name: t("Change delivery address", "Cambiar dirección de entrega") },
        ],
      },
    },
  };
}

function courierTask(id: string, lang: "en" | "es", goal: string, code: string, includes: string[]): WebTask {
  return {
    id,
    lang,
    kind: "status",
    site: courierSite(lang),
    goal,
    optimalSteps: 3,
    oracle(s): Gold[] {
      if (s.fields.result && fold(s.fields.result).includes(fold(code))) return [{ kind: "done", includes }];
      if (fold(s.fields.code ?? "").includes(fold(code))) return [{ kind: "click", id: "track" }];
      return [{ kind: "type", id: "code", value: code }];
    },
    success: (s, end) => end?.kind === "done" && includes.every((w) => fold(end.answer).includes(fold(w))) && s.effects.length === 0,
  };
}

export const HOLDOUT_WEB_TASKS: WebTask[] = [
  {
    id: "ho-es-cinema-2-1840",
    lang: "es",
    kind: "book",
    site: cinemaSite(),
    goal: "Compra 2 entradas para Noche en Limón hoy en la función de las 18:40 en Cine Paraíso.",
    optimalSteps: 5,
    oracle(s): Gold[] {
      if (s.effects.length) return [{ kind: "done", includes: [] }];
      if (s.page === "home") return [{ kind: "click", id: "see-m2" }];
      if (s.page !== "m2") return [{ kind: "click", id: "back" }];
      const todo: Gold[] = [];
      if (s.fields["Función"] !== "18:40") todo.push({ kind: "click", id: "show-1" });
      if (s.fields.qty !== "2") todo.push({ kind: "select", id: "qty", option: "2" });
      return todo.length ? todo : [{ kind: "click", id: "buy" }];
    },
    success: (s, end) => end?.kind === "done" && s.effects.length === 1 && s.effects[0] === "tickets:18:40|2",
  },
  courierTask("ho-en-courier-qp77031", "en", "Where is my QuickParcel package QP-77031? When will it be delivered?", "QP-77031", ["tuesday"]),
  courierTask("ho-es-courier-el55120", "es", "¿Cuándo llega mi paquete de EnvíosLatam con guía EL-55120?", "EL-55120", ["hoy"]),
];
