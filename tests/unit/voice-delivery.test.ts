import { expect, it, vi } from "vitest";
import {
  NovaSession,
  type VoiceEvent,
} from "../../packages/integrations/src/nova.js";

it("sends change-only speech guidance with tool truth and safety exceptions", async () => {
  const session = new NovaSession({ tools: [], call: async () => ({}) }, () => {});
  const client = (
    session as unknown as {
      client: { send(command: unknown): Promise<unknown> };
    }
  ).client;
  const send = vi.spyOn(client, "send").mockResolvedValue({ body: [] });
  await session.start();
  const command = send.mock.calls[0][0] as {
    input: { body: AsyncIterable<{ chunk: { bytes: Uint8Array } }> };
  };
  const events: { event: Record<string, Record<string, unknown>> }[] = [];
  for await (const chunk of command.input.body)
    events.push(JSON.parse(Buffer.from(chunk.chunk.bytes).toString()));
  const system = events
    .filter((event) => event.event.textInput)
    .map((event) => event.event.textInput.content)
    .join("\n");

  expect(system).toContain("one short, natural sentence");
  expect(system).toContain("Do not announce totals after routine edits");
  expect(system).toContain("Ask only one clarification question at a time");
  expect(system).toContain("Use that example only if the actual tool result matches");
  expect(system).toContain("never imply the change succeeded");
  expect(system).toContain("allergy/staff escalation or customer consent");
  expect(system).toContain("Stop voice and tap Confirm order on the screen");
  expect(system).toContain("Voice yes is not consent");
  expect(system).not.toContain("then report the new canonical cart totals");
  expect(system).toContain("without a rigid word limit");
});

it("keeps a complete final error or safety explanation rather than truncating speech", () => {
  const events: VoiceEvent[] = [];
  const session = new NovaSession({ tools: [], call: async () => ({}) }, (event) =>
    events.push(event),
  );
  const explanation =
    "The change did not go through. Your draft is unchanged. " +
    "Staff need to confirm the allergy information before you order. ".repeat(8);
  session.handle("contentStart", {
    contentId: "important-explanation",
    role: "ASSISTANT",
    additionalModelFields: '{"generationStage":"FINAL"}',
  });
  session.handle("textOutput", {
    contentId: "important-explanation",
    content: explanation,
  });
  session.handle("contentEnd", {
    contentId: "important-explanation",
    stopReason: "END_TURN",
  });
  expect(events.find((event) => event.type === "caption" && event.final)?.text).toBe(
    explanation,
  );
  session.close();
});
