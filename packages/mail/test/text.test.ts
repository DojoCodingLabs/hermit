import { describe, expect, it } from "vitest";
import { base64ToBytes, clip, decodeBase64Text, decodeEntities, htmlToText, plainText, splitAddresses, utf8Decode } from "../src/text.ts";

// FR-MAIL-02: the helpers that turn Gmail, Outlook and IMAP bodies into plain text. Made-up people and example.com only.
const bytes = (...b: number[]) => new Uint8Array(b);

describe("base64ToBytes", () => {
  it("reads plain base64", () => {
    expect(base64ToBytes("SG9sYQ==")).toEqual(bytes(0x48, 0x6f, 0x6c, 0x61));
  });

  it("reads base64url, with - and _ in place of + and /", () => {
    expect(base64ToBytes("-_8")).toEqual(bytes(0xfb, 0xff));
    expect(base64ToBytes("-_8")).toEqual(base64ToBytes("+/8="));
  });

  it("skips padding and line breaks", () => {
    expect(base64ToBytes("SG9s\r\nYSBB\nbmE=\n")).toEqual(base64ToBytes("SG9sYSBBbmE"));
    expect(new TextDecoder().decode(base64ToBytes("SG9s\r\nYSBB\nbmE=\n"))).toBe("Hola Ana");
  });
});

describe("utf8Decode and decodeBase64Text", () => {
  it("decodes Spanish accents and ñ", () => {
    expect(utf8Decode(bytes(0x61, 0xc3, 0xb1, 0x6f, 0x20, 0x63, 0x61, 0x6d, 0x69, 0xc3, 0xb3, 0x6e))).toBe("año camión");
    expect(decodeBase64Text("TWHDsWFuYSB2ZW5nbyBhIGxhIHJldW5pw7NuLg==")).toBe("Mañana vengo a la reunión.");
  });

  it("decodes a four-byte character", () => {
    expect(utf8Decode(bytes(0xf0, 0x9f, 0xa6, 0x80))).toBe("🦀");
    expect(decodeBase64Text("8J+mgA")).toBe("🦀");
  });

  it("turns a broken sequence into U+FFFD instead of throwing", () => {
    expect(utf8Decode(bytes(0x61, 0xc3, 0x28))).toBe("a�(");
    expect(utf8Decode(bytes(0xff, 0x62))).toBe("�b");
  });
});

describe("decodeEntities", () => {
  it("decodes named references", () => {
    expect(decodeEntities("Mar&iacute;a &amp; Jos&eacute;: ma&ntilde;ana a las 3")).toBe("María & José: mañana a las 3");
    expect(decodeEntities("&aacute;rbol")).toBe("árbol");
  });

  it("decodes decimal and hex references", () => {
    expect(decodeEntities("se&#241;or")).toBe("señor");
    expect(decodeEntities("se&#xF1;or y se&#xf1;ora")).toBe("señor y señora");
  });

  it("leaves an unknown name as it is", () => {
    expect(decodeEntities("&notaname; y &amp;")).toBe("&notaname; y &");
  });
});

describe("htmlToText", () => {
  it("drops script, style, head and title with their contents", () => {
    const html =
      "<html><head><title>Asunto</title><style>p { color: red }</style></head>" +
      "<body><script>alert('hola')</script><p>Hola Ana</p></body></html>";
    expect(htmlToText(html)).toBe("Hola Ana");
  });

  it("drops comments", () => {
    expect(htmlToText("<p>Hola<!-- nota interna --> Luis</p>")).toBe("Hola Luis");
  });

  it("breaks lines at br, p, div, li and headings", () => {
    const html = "<h1>Agenda</h1><p>Uno<br>Dos<br/>Tres</p><div>Cuatro</div><ul><li>Cinco</li><li>Seis</li></ul><h3>Fin</h3>";
    expect(htmlToText(html)).toBe("Agenda\nUno\nDos\nTres\nCuatro\nCinco\nSeis\nFin");
  });

  it("leaves no blank lines", () => {
    const text = htmlToText("<p>Hola</p>\n\n<p>&nbsp;</p><div>   </div>\r\n<p>Chao</p>");
    expect(text).toBe("Hola\nChao");
    expect(text.split("\n").every((l) => l.trim())).toBe(true);
  });
});

describe("plainText", () => {
  it("turns CRLF into LF", () => {
    expect(plainText("Hola\r\nAna\r\n")).toBe("Hola\nAna");
  });

  it("collapses runs of spaces", () => {
    expect(plainText("Hola    Ana,\t\tnos  vemos")).toBe("Hola Ana, nos vemos");
  });

  it("keeps at most one blank line in a row", () => {
    expect(plainText("Hola\n\n\n\nAna\n\n\nChao")).toBe("Hola\n\nAna\n\nChao");
    expect(plainText("Hola\r\n\r\n\r\n\r\nAna")).toBe("Hola\n\nAna");
  });
});

describe("clip", () => {
  it("leaves text at or under the limit unchanged", () => {
    expect(clip("Hola Ana", 8)).toBe("Hola Ana");
    expect(clip("Hola", 8)).toBe("Hola");
  });

  it("cuts longer text and ends it with ...", () => {
    const cut = clip("Nos vemos el lunes en la oficina", 12);
    expect(cut).toBe("Nos vemos...");
    expect(cut.length).toBeLessThanOrEqual(12);
  });

  it("leaves no space before the ...", () => {
    expect(clip("uno dos tres", 7)).toBe("uno...");
    expect(clip("uno dos tres", 7)).not.toMatch(/\s\.\.\.$/);
  });
});

describe("splitAddresses", () => {
  it("splits at commas between addresses", () => {
    expect(splitAddresses("Ana Torres <ana@example.com>, luis@example.com")).toEqual(["Ana Torres <ana@example.com>", "luis@example.com"]);
  });

  it("doesn't split at a comma inside quotes", () => {
    expect(splitAddresses("\"Pérez, Luis\" <luis@example.com>, Ana <ana@example.com>")).toEqual([
      "\"Pérez, Luis\" <luis@example.com>",
      "Ana <ana@example.com>",
    ]);
  });

  it("doesn't split at a comma inside angle brackets", () => {
    expect(splitAddresses("Ana <ana,torres@example.com>, Luis <luis@example.com>")).toEqual([
      "Ana <ana,torres@example.com>",
      "Luis <luis@example.com>",
    ]);
  });

  it("gives an empty list for an empty or missing header", () => {
    expect(splitAddresses("")).toEqual([]);
    expect(splitAddresses(undefined)).toEqual([]);
    expect(splitAddresses(" , ")).toEqual([]);
  });
});

describe("decodeEntities numeric references", () => {
  it("replaces a surrogate reference with U+FFFD", () => {
    expect(decodeEntities("a&#xD800;b")).toBe("a\uFFFDb");
    expect(decodeEntities("a&#55296;b")).toBe("a\uFFFDb");
  });

  it("replaces zero and out-of-range references with U+FFFD", () => {
    expect(decodeEntities("a&#0;b")).toBe("a\uFFFDb");
    expect(decodeEntities("a&#x110000;b")).toBe("a\uFFFDb");
  });

  it("keeps valid references as before", () => {
    expect(decodeEntities("a&#xE9;b")).toBe("a\u00E9b");
    expect(decodeEntities("a&#128512;b")).toBe("a\uD83D\uDE00b");
    expect(decodeEntities("a&amp;b")).toBe("a&b");
  });
});
