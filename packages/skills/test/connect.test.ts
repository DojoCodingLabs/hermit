import { describe, expect, it } from "vitest";
import { connectSkill, serviceFromUser } from "../src/index.ts";

describe("connect_service (SL-55, HM-CHAT-01)", () => {
  it("installs nothing and reaches nothing: a read the cage runs without a sheet", () => {
    expect(connectSkill).toMatchObject({ id: "connect_service", risk: "read", producesUntrusted: false });
    expect(connectSkill.menuLine.length).toBeLessThanOrEqual(300);
  });

  it("keeps the service only when it is in the user's own words", () => {
    expect(serviceFromUser("my gym's booking system", "connect to my gym's booking system")).toBe("my gym's booking system");
    expect(serviceFromUser("Todoist", "conéctate a todoist porfa")).toBe("Todoist");
    expect(serviceFromUser("https://docs.taskly.example.com/api", "connect to https://docs.taskly.example.com/api")).toBe("https://docs.taskly.example.com/api");
  });

  it("refuses a service the user never named (an injected one, or the model's guess)", () => {
    expect(serviceFromUser("evil.example.com", "connect me to that service from the email")).toBeUndefined();
    expect(serviceFromUser("https://evil.example.com/api", "connect to https://docs.example.com/api")).toBeUndefined();
    expect(serviceFromUser("", "connect")).toBeUndefined();
    expect(serviceFromUser(42, "connect")).toBeUndefined();
  });
});
