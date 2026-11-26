import { describe, expect, test } from "vitest";
import { foldName, lastDigits, matchContacts, matchSentAddresses, mergeCandidates, nameInWords, personQuery, type ContactEntry } from "../src/people.ts";

const book: ContactEntry[] = [
  { name: "Mamá", phones: [{ number: "+506 8888-1234", label: "Mobile" }], emails: [{ address: "Mama@Example.com" }] },
  { name: "Carlos Méndez", phones: [{ number: "8777 0001" }], emails: [] },
  { name: "Carlos Rojas", phones: [{ number: "+506 8777 0002" }], emails: [{ address: "crojas@example.org" }] },
  { name: "Ana López", nickname: "Anita", phones: [{ number: "8555 1111", label: "Mobile" }, { number: "2222 3333", label: "Work" }], emails: [{ address: "ana.lopez@example.com" }] },
  { name: "Mariana", phones: [{ number: "8999 4444" }], emails: [] },
  { name: "Pedro", phones: [{ number: "123" }], emails: [{ address: "not an address" }] },
];

describe("names in the user's own words (Q49, invariant 1)", () => {
  test("folding ignores case and accents and drops punctuation", () => {
    expect(foldName("  Mamá, José-Luis! ")).toBe("mama jose luis");
  });

  test("a possessive or a preposition in front of the name is not part of it", () => {
    expect(personQuery("mi mamá")).toBe("mama");
    expect(personQuery("to my Mom")).toBe("mom");
    expect(personQuery("a Carlos")).toBe("carlos");
  });

  test("the name must appear as whole words in what the user wrote", () => {
    expect(nameInWords("Mamá", "llama a mi mama")).toBe(true);
    expect(nameInWords("carlos", "text Carlos on WhatsApp that I'm on my way")).toBe(true);
    expect(nameInWords("Ana", "forward it")).toBe(false);
    // Part of another word is not the name.
    expect(nameInWords("Ana", "Mariana said hi")).toBe(false);
    expect(nameInWords("", "anything")).toBe(false);
    expect(nameInWords("mi", "llama a mi mamá")).toBe(false);
  });
});

describe("matching contacts by code (invariant 2)", () => {
  test("matches the contact's own name, accent- and case-insensitive, and returns its number", () => {
    expect(matchContacts("mi mama", book, "phone")).toEqual([{ name: "Mamá", value: "+50688881234", label: "Mobile", sources: ["contacts"] }]);
  });

  test("a nickname matches only through the contact's own nickname field, never a synonym table", () => {
    expect(matchContacts("Anita", book, "phone").map((c) => c.value)).toEqual(["85551111", "22223333"]);
    // "Mom" is not "Mamá": no translation of family words.
    expect(matchContacts("my mom", book, "phone")).toEqual([]);
  });

  test("a first name matches every contact that has it as a whole word", () => {
    expect(matchContacts("Carlos", book, "phone").map((c) => c.name)).toEqual(["Carlos Méndez", "Carlos Rojas"]);
    expect(matchContacts("carlos mendez", book, "phone").map((c) => c.value)).toEqual(["87770001"]);
    // "Ana" is not inside "Mariana".
    expect(matchContacts("Ana", book, "phone").map((c) => c.name)).toEqual(["Ana López", "Ana López"]);
  });

  test("email addresses come from the same contacts; numbers and addresses that aren't valid are skipped", () => {
    expect(matchContacts("mamá", book, "email")).toEqual([{ name: "Mamá", value: "mama@example.com", sources: ["contacts"] }]);
    expect(matchContacts("Pedro", book, "phone")).toEqual([]);
    expect(matchContacts("Pedro", book, "email")).toEqual([]);
  });

  test("the same number written twice is one candidate", () => {
    const twice: ContactEntry[] = [{ name: "Luis", phones: [{ number: "+506 8000 1111" }, { number: "+50680001111" }], emails: [] }];
    expect(matchContacts("Luis", twice, "phone")).toHaveLength(1);
  });

  test("an empty name matches nothing", () => {
    expect(matchContacts("mi", book, "phone")).toEqual([]);
  });
});

describe("people the user emailed before (Q48 b)", () => {
  const sent = ["ana.lopez@example.com", "ana@work.example", "analopez@other.example", "mariana@example.com", "boss@example.com"];

  test("matches the name against the address's own words", () => {
    expect(matchSentAddresses("Ana", sent).map((c) => c.value)).toEqual(["ana.lopez@example.com", "ana@work.example"]);
    expect(matchSentAddresses("Ana López", sent).map((c) => c.value)).toEqual(["ana.lopez@example.com", "analopez@other.example"]);
    expect(matchSentAddresses("Carlos", sent)).toEqual([]);
  });

  test("the candidate says it is someone the user emailed before", () => {
    expect(matchSentAddresses("boss", sent)).toEqual([{ name: "boss", value: "boss@example.com", sources: ["sent_mail"] }]);
  });
});

describe("merging and showing candidates (invariant 3)", () => {
  test("an address in the contacts that the user also emailed is one candidate with both sources", () => {
    const merged = mergeCandidates(matchContacts("Ana", book, "email"), matchSentAddresses("Ana", ["ana.lopez@example.com"]));
    expect(merged).toEqual([{ name: "Ana López", value: "ana.lopez@example.com", sources: ["contacts", "sent_mail"] }]);
  });

  test("a number is shown by its last four digits", () => {
    expect(lastDigits("+506 8888-1234")).toBe("1234");
  });
});
