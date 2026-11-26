// SL-52 held-out fixtures: written with the dev set, before any prompt or harness tuning, and never tuned on.
// Run them only to check that a harness change did not overfit the dev set. They are public, so they no longer count as
// blind (docs/evals.md).
import { p } from "./fixtures.ts";
import type { DraftFixture } from "./types.ts";

export const HOLDOUT_FIXTURES: DraftFixture[] = [
  {
    id: "refunds_en",
    lang: "en",
    doc: `Paystream API reference: Refunds

Base URL: https://api.paystream.com
Authentication: HTTP Basic. Use your secret key as the username and leave the password empty.

Create a refund
POST /v1/refunds
Refunds a charge that was previously created. Funds are returned to the customer's card.
Parameters (JSON body):
- charge (string, required): the ID of the charge to refund.
- amount (integer, optional): amount in cents; defaults to the whole charge.
- reason (string, optional): duplicate, fraudulent or requested_by_customer.

Retrieve a refund
GET /v1/refunds/{id}
Returns the refund with the given ID.

List refunds
GET /v1/refunds
Query parameters: charge (string, optional) only refunds for this charge; limit (integer, optional) 1 to 100.`,
    gold: {
      name: "Paystream",
      baseUrl: "https://api.paystream.com",
      hosts: ["api.paystream.com"],
      auth: { type: "basic" },
      domain: "payments",
      operations: [
        { method: "POST", path: "/v1/refunds", params: [p("charge", "body", "string", true), p("amount", "body", "integer", false), p("reason", "body", "string", false)], sideEffects: ["creates", "moves_money"] },
        { method: "GET", path: "/v1/refunds/{id}", params: [p("id", "path", "string", true)], sideEffects: [] },
        { method: "GET", path: "/v1/refunds", params: [p("charge", "query", "string", false), p("limit", "query", "integer", false)], sideEffects: [] },
      ],
    },
  },
  {
    id: "boletin_es",
    lang: "es",
    doc: `API de Boletines de Correo Nube

URL base: https://us1.api.correonube.com/3.0
Autenticación: clave de API en el encabezado Authorization con el prefijo "apikey " (por ejemplo, Authorization: apikey TU_CLAVE).

Listar campañas
GET /campaigns
Parámetros de consulta: estado (texto, opcional): borrador, enviada o programada; cantidad (entero, opcional).

Crear una campaña
POST /campaigns
Crea un borrador; no envía nada. Cuerpo: asunto (texto, obligatorio); lista_id (texto, obligatorio); contenido_html (texto, opcional).

Enviar una campaña
POST /campaigns/{campaign_id}/actions/send
Envía la campaña de inmediato a todos los suscriptores de la lista. No se puede deshacer. Sin cuerpo.`,
    gold: {
      name: "Correo Nube",
      baseUrl: "https://us1.api.correonube.com/3.0",
      hosts: ["us1.api.correonube.com"],
      auth: { type: "api_key", in: "header", name: "Authorization", prefix: "apikey " },
      domain: "email",
      operations: [
        { method: "GET", path: "/3.0/campaigns", params: [p("estado", "query", "string", false), p("cantidad", "query", "integer", false)], sideEffects: [] },
        { method: "POST", path: "/3.0/campaigns", params: [p("asunto", "body", "string", true), p("lista_id", "body", "string", true), p("contenido_html", "body", "string", false)], sideEffects: ["creates"] },
        { method: "POST", path: "/3.0/campaigns/{campaign_id}/actions/send", params: [p("campaign_id", "path", "string", true)], sideEffects: ["sends"] },
      ],
    },
  },
];
