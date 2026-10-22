import { money, type VoiceConfirmation } from "@saygo/contracts";

export function VoiceConfirmationPanel({
  confirmation,
}: {
  confirmation: VoiceConfirmation;
}) {
  const expired = Date.parse(confirmation.expires_at) <= Date.now();
  return (
    <div className="notice" role="status" aria-live="polite">
      <h3>
        {expired
          ? "Review this order again"
          : confirmation.status === "reading"
            ? "Listen to your order"
            : "Ready to place this order?"}
      </h3>
      <p>{confirmation.readback_text}</p>
      <p>
        <strong>Total {money(confirmation.totals.total)}</strong>
      </p>
      <p>
        {expired
          ? "Not submitted. Ask SayGo to review the current order again."
          : confirmation.status === "reading"
            ? "Wait for the full readback before confirming. You can still tell us what to change."
            : "Say “Yes, place the order”, or tell us what to change. A simple “okay” will not place it."}
      </p>
      {!expired && (
        <p className="small">
          You can also stop voice and use Confirm order on the screen.
        </p>
      )}
    </div>
  );
}
