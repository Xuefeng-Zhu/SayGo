# Undo and human takeover

SayGo keeps the draft visible while a customer makes corrections or asks for help. **Undo last change** restores the preceding draft selection once. **Ask staff** pauses automated ordering and voice; an operator can take control, edit the draft, and return it to the customer. Customer confirmation is still required before submission.

These controls operate on fictional orders in the local POS sandbox. Accepted-order changes require staff assistance; the simulator has no cancellation, refund or staff-audio integration.

## Undo the latest draft change

The **Latest change** receipt shows affected items, before/after selections and the total difference including fixture tax. Choose **Undo last change** to restore the previous selections and stable item IDs. The cart gets a new version, the previous quote is invalidated, and the customer must review the resulting order again before confirming.

Only the latest change can be undone once. It is unavailable while live voice or pending voice tools are active, during staff handling, after submission, or after the menu, cart or ownership has changed beyond that receipt. Stop voice and wait for pending corrections before trying an otherwise eligible Undo. Returning control from staff does not revive an older Undo receipt.

| Current state                                                        | What to do                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Latest draft correction, voice stopped                               | Choose **Undo last change**, then review the restored order.      |
| Voice is active or still finishing a correction                      | Choose **Stop live voice** and wait for the current cart.         |
| Staff is handling the draft                                          | Let the operator finish, resolve the handoff and release control. |
| Another edit, menu update or ownership change superseded the receipt | Check the current cart and make a new explicit correction.        |
| Order is submitted or accepted                                       | Choose **Ask staff**. Undo does not change the existing ticket.   |

For pricing, receipt and API details, see [correction receipts and meal savings](draft-improvements.md).

## Hand the conversation to a person

1. On the order board, choose **Ask staff**. The cart is preserved, automated edits are paused, and the voice session stops. An operator can also initiate takeover from [Crew](http://localhost:3100/crew).
2. In Crew, choose **Take control**. The operator now owns the session. Already committed cart changes remain; late AI requests from the previous control period are rejected.
3. For an unsubmitted draft, edit the relevant item or choose **Add an item**, then save. The operator can also send a typed **Staff message to the customer**.
4. When a handoff is outstanding, choose **Mark staff review handled** after addressing it. An allergy request requires human review; the fictional ingredient fixtures are not an allergen-safety assurance.
5. Choose **Release to SayGo**. The customer gets the current draft back with its modifications intact. Voice does **not** restart automatically: the customer must choose **Start live voice** again if live voice is configured and desired.
6. For screen approval, stop voice, choose **Review order**, check the quote, then select **Confirm order**. With live voice, the customer can instead request a fresh readback and use the [spoken confirmation recording](voice-confirmation.md). Releasing staff control alone never submits an order.

After another operator changes control, use the latest visible state. Identical retries preserve the original result; stale actions cannot change a later ownership period or a different customer.

For a submitted order, **Ask staff** requests assistance while preserving the kitchen ticket. Draft-edit controls are unavailable. Cancellation, payment changes and commercial restaurant follow-up remain a human process outside this POS sandbox.

## Local fixture walkthrough

First follow [local development](local-development.md). Use DynamoDB Local, a separate fictional namespace, and `SAYGO_VOICE_ENABLED=false`. Open the order board on port 3100 and sign in as `admin` with `harbor-demo-only` for a newly seeded local dataset. Keep Crew open in a second tab of the same browser profile; it shows the active Lane 01 customer and shares your operator sign-in. Open Kitchen from that profile too and match the accepted ticket by its order number. If using another browser profile, sign in there with the corresponding local `crew` or `kitchen` account. These steps use predefined fixture phrases over the real MCP/database path; they do not exercise speech recognition.

### Show a correction and Undo

1. Choose **Begin customer session**, then **Start example order**. With the seeded menu this adds two separate cheeseburgers, one without onions, and a medium lemonade.
2. Choose **Apply correction**. The intended burger now has no onions and no cheese, the lemonade is large, and the seeded total is **$18.09**.
3. Inspect **Latest change**, then choose **Undo last change**. The medium lemonade and the prior burger modifications return. The receipt says **Change undone**; it cannot be undone a second time.
4. Choose **Review order** and inspect the restored selections. Do not confirm yet if continuing with the handoff below.

### Take over and return control

1. On the same draft, choose **Ask staff**. The customer board shows that staff is on the way; the cart stays visible.
2. In Crew, choose **Take control**. Edit the no-onion burger, select **No cheese**, and save. Send a short typed message such as “I have your order. Please check the changes.”
3. Choose **Mark staff review handled**, then **Release to SayGo**. Return to the customer board and check that the staff correction remains. No order has been submitted by these steps.
4. Choose **Review order**, then **Confirm order** only when ready to create a fictional sandbox ticket. Verify the matching modifications in [Kitchen](http://localhost:3100/kitchen).
5. To check accepted-order handling, choose **Ask staff** after acceptance. The kitchen ticket remains unchanged, and Crew cannot edit it as a draft.

If starting another customer, use **Operator controls → Vehicle departed**, then begin a new session. The preceding accepted kitchen ticket remains separate.

## What the demonstration verifies

| Evidence                                                        | What it establishes                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local fixture walkthrough                                       | Visible draft corrections, Undo, human ownership, screen confirmation and local POS/kitchen continuity. No speech recognition is involved.                   |
| Automated domain/HTTP tests                                     | Version, receipt, ownership, consent and retry guards against stale or duplicate operations. Test results apply to their recorded source.                    |
| Browser tests with synthetic capture and intercepted WebSockets | UI cleanup, playback/capture lifecycle and late-event handling under controlled inputs. They do not establish current Nova behavior or acoustic reliability. |
| Real Nova or physical audio trial                               | Requires its own authorized run and source-linked evidence. This guide records no new paid provider call or physical microphone/speaker test.                |

See [voice verification](voice.md) for live testing. This walkthrough uses fictional local orders and makes no provider calls.

The [21 October verification record](evidence/undo-takeover-verification-20261021.md) lists the completed local checks and their limits.
