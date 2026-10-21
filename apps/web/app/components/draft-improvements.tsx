"use client";

import { useState } from "react";
import {
  money,
  type CartReceipt,
  type MealSavingsProposal,
  type PricedLine,
} from "@saygo/contracts";

function selection(line: PricedLine) {
  const details = line.modifiers.length
    ? line.modifiers.join(" · ")
    : "Standard";
  return line.quantity === 1 ? details : `${line.quantity} × ${details}`;
}

export function CorrectionReceipt({
  receipt,
  disabled,
  voiceActive,
  disabledReason,
  undo,
}: {
  receipt: CartReceipt;
  disabled: boolean;
  voiceActive: boolean;
  disabledReason?: string;
  undo: () => void;
}) {
  const delta = receipt.total_delta_cents;
  return (
    <section className="correction-receipt" aria-labelledby="change-heading">
      <div className="draft-card-heading">
        <div>
          <span className="eyebrow">Latest change</span>
          <h2 id="change-heading">
            {receipt.kind === "undo"
              ? "Change undone"
              : receipt.kind === "meal_savings"
                ? "Meal savings applied"
                : "Order updated"}
          </h2>
        </div>
        {receipt.kind !== "undo" && (
          <button
            disabled={!receipt.undo_available || disabled || voiceActive}
            onClick={undo}
          >
            Undo last change
          </button>
        )}
      </div>
      <ul className="change-list" aria-label="What changed">
        {receipt.changes.map(({ line_id, before, after }) => (
          <li key={line_id}>
            <strong>{after?.name ?? before?.name}</strong>
            <span>
              {!before && after
                ? `Added: ${selection(after)}`
                : before && !after
                  ? `Removed: ${selection(before)}`
                  : before && after
                    ? `${selection(before)} → ${selection(after)}`
                    : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="change-total" role="status">
        {delta === 0
          ? `Total unchanged · ${money(receipt.after_totals.total)}`
          : `Total ${delta > 0 ? "+" : "−"}${money(Math.abs(delta))} · ${money(receipt.before_totals.total)} → ${money(receipt.after_totals.total)}`}
        <small>Includes demo tax at the time of this change.</small>
      </p>
      {voiceActive && receipt.undo_available && (
        <p className="small">Stop live voice to undo this change.</p>
      )}
      {!voiceActive && disabled && receipt.undo_available && disabledReason && (
        <p className="small">{disabledReason}</p>
      )}
      {!receipt.undo_available && receipt.undo_unavailable_reason && (
        <p className="small">{receipt.undo_unavailable_reason}</p>
      )}
    </section>
  );
}

export function MealSavingsCard({
  proposal,
  disabled,
  voiceActive,
  check,
  apply,
}: {
  proposal: MealSavingsProposal | null;
  disabled: boolean;
  voiceActive: boolean;
  check: () => void;
  apply: (proposal: MealSavingsProposal) => void;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!proposal || dismissed === proposal.id)
    return (
      <div className="savings-check">
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => {
            setDismissed(null);
            check();
          }}
        >
          Check meal savings
        </button>
        <p className="small">
          Find meal combinations for the items already in your order.
        </p>
      </div>
    );
  return (
    <section className="meal-savings" aria-labelledby="savings-heading">
      <span className="eyebrow">Same food. Better price.</span>
      <h2 id="savings-heading">
        Save {money(proposal.savings_cents)} with meals
      </h2>
      <p>
        Keep your food, sizes, and modifications. Group these items into meals:
      </p>
      <ul className="savings-groups">
        {proposal.groups.map((group, index) => (
          <li key={`${group.sandwich_line_id}-${index}`}>{group.summary}</li>
        ))}
      </ul>
      <dl className="savings-totals">
        <div>
          <dt>Current total</dt>
          <dd>{money(proposal.before.total)}</dd>
        </div>
        <div>
          <dt>With meals</dt>
          <dd>{money(proposal.after.total)}</dd>
        </div>
      </dl>
      <p className="small">
        Save {money(proposal.subtotal_savings_cents)} before tax,{" "}
        {money(proposal.savings_cents)} including demo tax. You’ll review the
        updated order before confirming.
      </p>
      <button
        className="primary wide"
        disabled={disabled || voiceActive}
        onClick={() => apply(proposal)}
      >
        Apply meal savings
      </button>
      <button
        className="text-button"
        disabled={disabled}
        onClick={() => setDismissed(proposal.id)}
      >
        Keep items separate
      </button>
      {voiceActive && (
        <p className="small">Stop live voice to apply these savings.</p>
      )}
    </section>
  );
}
