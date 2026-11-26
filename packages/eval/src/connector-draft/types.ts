// SL-52 spike: shared types for drafting a connector spec (CT-12) from an API doc excerpt.
import type { AuthSpec, ConnectorDomain, HttpMethod, SideEffect } from "@hermit/connectors";

export type ParamIn = "path" | "query" | "body";
export type ParamType = "string" | "integer" | "number" | "boolean";

export interface DraftParam {
  name: string;
  in: ParamIn;
  type: ParamType;
  required: boolean;
  description?: string;
}

/** The known correct operation for a fixture. Paths are full paths on the host, placeholders by name. */
export interface GoldOp {
  method: HttpMethod;
  path: string;
  params: DraftParam[];
  sideEffects: SideEffect[];
}

export interface DraftFixture {
  id: string;
  lang: "en" | "es";
  doc: string;
  gold: {
    /** Set when the right outcome is to refuse the connector (why, for the report). */
    refuse?: string;
    name: string;
    baseUrl: string;
    hosts: string[];
    auth: AuthSpec;
    domain: ConnectorDomain;
    operations: GoldOp[];
  };
}
