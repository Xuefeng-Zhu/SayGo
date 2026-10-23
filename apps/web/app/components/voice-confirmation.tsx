import { money, type VoiceConfirmation } from "@saygo/contracts";
import type { SpokenConfirmationPhase } from "./use-voice";

export function VoiceConfirmationPanel({
  confirmation,
  phase,
  onRecord,
  onFinish,
  onChange,
}: {
  confirmation: VoiceConfirmation;
  phase: SpokenConfirmationPhase;
  onRecord: () => void;
  onFinish: () => void;
  onChange: () => void;
}) {
  const expired = Date.parse(confirmation.expires_at) <= Date.now();
  return (
    <div className="notice" role="status" aria-live="polite">
      <h3>
        {expired
          ? "Review this order again"
          : confirmation.status === "reading"
            ? "Listen to your order"
            : phase === "verifying"
              ? "Checking your spoken confirmation"
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
            ? "Wait for the full readback before confirming. You can speak now to change the order instead."
            : phase === "recording"
              ? "Say “Yes, place my order”, then finish the recording after the complete sentence."
              : phase === "verifying"
                ? "Your complete recording is being checked against this quote. Wait for the result."
                : "Record “Yes, place my order” to approve this exact order. A simple “okay” will not place it."}
      </p>
      {!expired && confirmation.status === "awaiting_confirmation" && (
        <>
          {phase === "recording" ? (
            <button className="primary wide" onClick={onFinish}>
              Finish spoken confirmation
            </button>
          ) : (
            <button
              className="primary wide"
              disabled={phase !== "ready"}
              onClick={onRecord}
            >
              {phase === "starting"
                ? "Preparing microphone…"
                : phase === "verifying"
                  ? "Verifying spoken confirmation…"
                  : "Record spoken confirmation"}
            </button>
          )}
          {phase !== "verifying" && (
            <button className="outline wide" onClick={onChange}>
              Change order instead
            </button>
          )}
          <p className="small">
            The buttons start and finish your recording. Only an accepted spoken
            confirmation places the order.
          </p>
        </>
      )}
      {!expired && (
        <p className="small">
          You can also stop voice and use Confirm order on the screen.
        </p>
      )}
    </div>
  );
}
