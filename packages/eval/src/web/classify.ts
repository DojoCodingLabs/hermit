// FR-WEB-07 in miniature: code, not the model, decides which clicks commit and must ask. Vocabulary in the
// spirit of Nanobrowser's classifier (Apache-2.0), reimplemented here for the spike; English and Spanish.
// Policy: err toward asking. A false positive costs one prompt; a false negative is not allowed.
import type { CommitRisk, WebNode } from "./sim.ts";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Clicks known to be safe: navigation into a flow, carts, search, viewing. Checked first. */
const SAFE = /\b(add to cart|agregar al carrito|anadir al carrito|buy again|volver a comprar|proceed to checkout|continuar al pago|ir a pagar|go to cart|ver carrito|search|buscar|view|ver|track|rastrear|reject all|rechazar todo|back|volver|edit|editar|change|cambiar)\b/;
const SPEND = /\b(place (your )?order|pay|buy now|complete purchase|confirm (purchase|payment)|realizar (el )?pedido|pagar|comprar ahora|confirmar (compra|pago)|finalizar compra)\b/;
const CREDENTIAL = /\b(sign in|log ?in|iniciar sesion|ingresar|entrar|grant|allow|authorize|autorizar|permitir)\b/;
const WRITE = /\b(submit|send|confirm|book|reserve|delete|remove account|cancel (order|reservation|booking)|save|request|enviar|confirmar|reservar|eliminar|borrar|cancelar (pedido|reserva)|guardar|solicitar)\b/;
const MONEY = /([$€₡]\s?\d|\d[.,]\d{2}\s?(usd|eur|crc)?\b)/;
const GENERIC = /\b(continue|continuar|next|siguiente|ok|aceptar|accept)\b/;

/** Search boxes do not make a page a form. */
const isFormField = (n: WebNode) => (n.role === "textbox" || n.role === "combobox") && !/\b(search|buscar)\b/.test(norm(n.name));

export function classifyClick(node: WebNode, page: WebNode[]): CommitRisk | null {
  if (node.role !== "button" && node.role !== "link") return null;
  const name = norm(node.name);
  if (SPEND.test(name)) return "spend";
  if (GENERIC.test(name) && MONEY.test(name)) return "spend";
  if (CREDENTIAL.test(name)) return "credential";
  if (WRITE.test(name)) return "remote_write";
  if (SAFE.test(name)) return null;
  return node.role === "button" && page.some(isFormField) ? "remote_write" : null;
}
