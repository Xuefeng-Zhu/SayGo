"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  type Command,
  type Line,
  type Product,
  type View,
} from "@saygo/contracts";
import { api, ApiError } from "./api";
import { Header, Footer, Login } from "./shell";
import { ItemEditor, MenuPanel, Modal, OrderLines, OrderTotals } from "./order";
import { useVoice, type ResetProposal } from "./use-voice";
import { CorrectionReceipt, MealSavingsCard } from "./draft-improvements";
import { VoiceConfirmationPanel } from "./voice-confirmation";
type Config = {
  demo: boolean;
  voice: boolean;
  voice_url: string;
  fixtures: { id: string; text: string }[];
};
const resetMatches = (proposal: ResetProposal, view: View) =>
  proposal.session_id === view.session.id &&
  proposal.epoch === view.session.epoch &&
  proposal.fence === view.session.fence &&
  proposal.cart_version === view.cart_version &&
  view.session.owner === "ai" &&
  !view.session.needs_staff_review &&
  !view.order;
const controlScope = (view: View | null) =>
  view
    ? `${view.session.id}:${view.session.epoch}:${view.session.fence}:${view.session.owner}:${view.session.needs_staff_review}:${view.order?.id ?? ""}`
    : "";
const editScope = (view: View) => `${controlScope(view)}:${view.cart_version}`;
export function LaneBoard() {
  const [view, setView] = useState<View | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [staff, setStaff] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [summary, setSummary] = useState(
      "You can make a change, or review your order.",
    ),
    [menu, setMenu] = useState(false),
    [edit, setEdit] = useState<{
      product: Product;
      line?: Line;
      scope: string;
    } | null>(null),
    [reset, setReset] = useState<ResetProposal | null>(null),
    [text, setText] = useState("");
  const request = useRef(0),
    busyRef = useRef(false),
    mounted = useRef(true),
    session = useRef<string | undefined>(undefined),
    lastQuote = useRef<string | undefined>(undefined),
    currentView = useRef<View | null>(null);
  const accept = useCallback((v: View) => {
    const previous = currentView.current;
    if (
      previous?.session.id === v.session.id &&
      (v.session.epoch < previous.session.epoch ||
        v.session.fence < previous.session.fence ||
        v.cart_version < previous.cart_version)
    )
      return false;
    if (controlScope(previous) !== controlScope(v)) {
      session.current = v.session.id;
      setEdit(null);
      setMenu(false);
      setReset(null);
      setText("");
      setSummary(
        previous?.session.id === v.session.id && v.session.owner === "ai"
          ? "You’re back in control. Check the draft, then start voice when you’re ready."
          : "You can make a change, or review your order.",
      );
    } else if (lastQuote.current && !v.quote && !v.order) {
      setSummary(
        "Your review changed or expired. Please review the current order again.",
      );
    }
    // A proposal may arrive just before its cart refresh. Keep it hidden until
    // that exact version is visible, and discard it if state moves past it.
    setReset((proposal) =>
      proposal &&
      (proposal.session_id !== v.session.id ||
        proposal.epoch !== v.session.epoch ||
        proposal.fence !== v.session.fence ||
        proposal.cart_version < v.cart_version ||
        v.session.owner !== "ai" ||
        v.session.needs_staff_review ||
        v.order)
        ? null
        : proposal,
    );
    lastQuote.current = v.quote?.id;
    currentView.current = v;
    setView(v);
    return true;
  }, []);
  const refresh = useCallback(
    async (force = false) => {
      if (busyRef.current && !force) return;
      const seq = ++request.current;
      try {
        const v = await api<View>("/lane/state");
        if (mounted.current && seq === request.current) accept(v);
      } catch (e) {
        if (
          mounted.current &&
          seq === request.current &&
          e instanceof ApiError &&
          e.status === 401
        ) {
          currentView.current = null;
          setView(null);
          setReset(null);
          session.current = undefined;
        }
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [accept],
  );
  const voice = useVoice(
    view?.session.id,
    view?.session.epoch,
    config?.voice_url ?? "",
    () => void refresh(),
    (proposal) => {
      const current = currentView.current;
      if (
        !current ||
        proposal.session_id !== current.session.id ||
        proposal.epoch !== current.session.epoch ||
        proposal.fence !== current.session.fence ||
        proposal.cart_version < current.cart_version ||
        current.session.owner !== "ai" ||
        current.session.needs_staff_review ||
        current.order
      )
        return;
      setReset(proposal);
      void refresh();
    },
    view
      ? {
          fence: view.session.fence,
          cartVersion: view.cart_version,
          enabled:
            view.session.owner === "ai" &&
            !view.session.needs_staff_review &&
            !view.order,
        }
      : undefined,
  );
  const voiceConfirmation =
    view &&
    voice.active &&
    !voice.confirmationUnavailable &&
    view.session.owner === "ai" &&
    !view.session.needs_staff_review &&
    !view.order &&
    view.voice_confirmation?.session_id === view.session.id &&
    view.voice_confirmation.epoch === view.session.epoch &&
    view.voice_confirmation.fence === view.session.fence &&
    view.voice_confirmation.cart_version === view.cart_version &&
    view.voice_confirmation.quote_id === view.quote?.id
      ? view.voice_confirmation
      : null;
  useEffect(() => {
    mounted.current = true;
    void api<Config>("/config")
      .then(setConfig)
      .catch(() => setError("Runtime unavailable. Start pnpm dev."));
    void api("/me")
      .then(() => setStaff(true))
      .catch(() => setStaff(false));
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (
      view?.session.owner === "staff" ||
      view?.session.needs_staff_review ||
      view?.order
    )
      voice.stop();
  }, [
    view?.session.owner,
    view?.session.needs_staff_review,
    view?.order?.id,
    voice.stop,
  ]);
  const act = async (path: string, body: unknown) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const seq = ++request.current;
    const startedScope = controlScope(currentView.current);
    try {
      const result = await api<View>(path, body);
      const accepted =
        mounted.current &&
        seq === request.current &&
        startedScope === controlScope(currentView.current) &&
        result.session &&
        accept(result);
      if (accepted) {
        if (result.summary) setSummary(result.summary);
        if (result.reset_token)
          setReset({
            reset_token: result.reset_token,
            cart_version: result.cart_version,
            session_id: result.session.id,
            epoch: result.session.epoch,
            fence: result.session.fence,
          });
      }
      await refresh(true);
      return accepted ? result : null;
    } catch (e) {
      if (mounted.current && startedScope === controlScope(currentView.current))
        setError((e as Error).message);
      await refresh(true);
      return null;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const call = (name: string, args: object = {}) =>
    act("/lane/tool", { name, arguments: args });
  const change = async (command: Command) => {
    if (
      !view ||
      !currentView.current ||
      !edit ||
      voice.pending ||
      edit.scope !== editScope(view) ||
      edit.scope !== editScope(currentView.current) ||
      view.session.owner !== "ai" ||
      view.session.needs_staff_review ||
      view.order
    )
      return;
    const result = await call("apply_cart_changes", {
      expected_version: view.cart_version,
      request_id: crypto.randomUUID(),
      commands: [command],
    });
    if (result) setEdit(null);
  };
  const locked =
    busy ||
    voice.pending ||
    view?.session.owner === "staff" ||
    view?.session.needs_staff_review ||
    Boolean(view?.order);
  const review = async () => {
    voice.stop();
    await call("prepare_order_review", {
      expected_version: view?.cart_version,
      request_id: crypto.randomUUID(),
    });
  };
  const depart = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    voice.stop();
    setBusy(true);
    try {
      await api("/lane/depart", {});
      ++request.current;
      currentView.current = null;
      setView(null);
      setSummary("");
      setEdit(null);
      setMenu(false);
      setReset(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };
  const status = view?.order?.status;
  return (
    <div className="board-shell">
      <Header>
        <span className="lane-label">Lane 01</span>
        {view && (
          <button
            className="header-help"
            disabled={
              busy ||
              view.session.owner === "staff" ||
              view.session.needs_staff_review
            }
            onClick={() => {
              voice.stop();
              void call("request_staff_help", {
                reason: view.order ? "accepted_change" : "assistance",
              });
            }}
          >
            Ask staff
          </button>
        )}
      </Header>
      <main className="lane-main">
        {!view ? (
          <section className="welcome">
            <div>
              <h1>
                Good food.
                <br />
                Your way.
              </h1>
              <p className="welcome-tagline">Say it. See it. Go.</p>
              <p>
                Welcome to Harbor Burger. Begin a fictional customer interaction
                to start an order.
              </p>
              <p className="muted">
                For use while stopped at the ordering station. No real
                restaurant orders or payments.
              </p>
            </div>
            <div>
              {loading ? (
                <p>Connecting to the order board…</p>
              ) : !staff ? (
                <Login done={() => setStaff(true)} />
              ) : (
                <>
                  <h2>Ready at lane one?</h2>
                  <p>
                    The operator starts and ends each customer interaction. The
                    next session clears the previous customer’s screen.
                  </p>
                  <button
                    className="primary wide"
                    disabled={busy}
                    onClick={() =>
                      void act("/lane/start", { lane_id: "lane-1" })
                    }
                  >
                    Begin customer session
                  </button>
                  <Link className="quiet-link" href="/crew">
                    Open crew console
                  </Link>
                </>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="order-board" aria-labelledby="order-heading">
              <div className="board-title">
                <h1 id="order-heading">
                  {view.quote
                    ? "Review your order"
                    : view.order
                      ? "Your order"
                      : "Your order"}
                </h1>
                <p>
                  {view.order
                    ? `Order #${String(view.order.number).padStart(3, "0")} · ${view.order.status.replaceAll("_", " ")}`
                    : "Make it just right."}
                </p>
              </div>
              {view.lines.length ? (
                <OrderLines
                  changedLineIds={
                    !view.order &&
                    view.last_change?.cart_version === view.cart_version
                      ? view.last_change.changes.map((change) => change.line_id)
                      : []
                  }
                  lines={
                    view.quote?.snapshot.lines ??
                    view.order?.snapshot.lines ??
                    view.lines
                  }
                  onEdit={
                    !locked
                      ? (line) =>
                          setEdit({
                            product: view.menu.products.find(
                              (p) => p.id === line.product_id,
                            )!,
                            line,
                            scope: editScope(view),
                          })
                      : undefined
                  }
                />
              ) : (
                <div className="empty-order">
                  <h2>What sounds good?</h2>
                  <p>
                    Choose from the menu, try the example order, or enable live
                    voice when configured.
                  </p>
                  <button
                    disabled={locked}
                    onClick={() => setMenu(true)}
                    className="outline"
                  >
                    Browse menu
                  </button>
                </div>
              )}
              {view.lines.length > 0 && (
                <OrderTotals
                  totals={
                    view.quote?.snapshot.totals ??
                    view.order?.snapshot.totals ??
                    view.totals
                  }
                />
              )}
              {view.unresolved_choices.length > 0 && (
                <div className="notice" role="status">
                  <h3>A quick question</h3>
                  <p>{view.unresolved_choices[0].message}</p>
                  <p className="small">
                    Use Edit on the intended item, or choose a supported menu
                    item.
                  </p>
                </div>
              )}
              {!view.order && view.last_change && (
                <CorrectionReceipt
                  receipt={view.last_change}
                  disabled={Boolean(locked)}
                  voiceActive={voice.active}
                  disabledReason={
                    view.session.owner === "staff" ||
                    view.session.needs_staff_review
                      ? "Undo is paused while staff handles this draft."
                      : busy
                        ? "Wait for the current change to finish."
                        : undefined
                  }
                  undo={() =>
                    void act("/lane/undo", {
                      receipt_id: view.last_change!.id,
                      expected_version: view.cart_version,
                      request_id: crypto.randomUUID(),
                    })
                  }
                />
              )}
              {view.order && (
                <p className="small">
                  This ticket has been submitted. Undo only changes a draft; ask
                  staff about changes or cancellation.
                </p>
              )}
              {view.session.staff_message && (
                <div className="notice">
                  <strong>Message from staff</strong>
                  <p>{view.session.staff_message}</p>
                </div>
              )}
            </section>
            <aside className="conversation-rail">
              <section className="next-step" aria-live="polite">
                <h2>
                  {view.session.owner === "staff"
                    ? "You’re with our crew."
                    : view.session.needs_staff_review
                      ? "Staff is on the way."
                      : view.order
                        ? [
                            "accepted",
                            "preparing",
                            "ready",
                            "handed_off",
                          ].includes(status!)
                          ? "Your order is in."
                          : status === "rejected"
                            ? "Please see staff."
                            : status === "unknown"
                              ? "Checking with the kitchen…"
                              : "Sending your order…"
                        : view.quote
                          ? "Everything right?"
                          : "Looking good?"}
                </h2>
                <p>
                  {view.session.owner === "staff"
                    ? "A team member is handling your order. Automated ordering is paused."
                    : view.session.needs_staff_review
                      ? "Your order is saved. A team member needs to review your request."
                      : view.order
                        ? [
                            "accepted",
                            "preparing",
                            "ready",
                            "handed_off",
                          ].includes(status!)
                          ? view.menu.instructions
                          : status === "unknown"
                            ? "Acceptance is not yet known. Staff has been notified. We will reconcile the same order—please do not submit again."
                            : status === "rejected"
                              ? "The sandbox did not accept this order. Staff can help with the next step."
                              : "Waiting for the POS sandbox to acknowledge. This is not yet restaurant acceptance."
                        : view.quote
                          ? "Check the items, modifications, and exact total. Payment is due at the window."
                          : summary}
                </p>
                {voiceConfirmation && (
                  <VoiceConfirmationPanel confirmation={voiceConfirmation} />
                )}
                {view.quote && !view.order ? (
                  <>
                    <p className="small">
                      Quote expires{" "}
                      {new Date(view.quote.expires_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      . Any change requires a new review.
                    </p>
                    <button
                      className="primary wide"
                      disabled={locked || voice.active}
                      onClick={() =>
                        void act("/lane/confirm", { quote_id: view.quote!.id })
                      }
                    >
                      Confirm order
                    </button>
                    {voice.active && (
                      <p className="small">
                        {voice.confirmationUnavailable
                          ? "Stop voice and confirm this order on screen. Voice confirmation is unavailable for this connection."
                          : voiceConfirmation
                            ? "Voice confirmation is available after the full readback. Stop voice to use this button instead."
                            : "Ask SayGo to review this order for voice confirmation, or stop voice to use this button."}
                      </p>
                    )}
                    <button
                      className="outline wide"
                      disabled={locked}
                      onClick={() => setMenu(true)}
                    >
                      Make a change
                    </button>
                  </>
                ) : !view.order &&
                  !view.session.needs_staff_review &&
                  view.session.owner !== "staff" ? (
                  <>
                    <button
                      className="primary wide"
                      disabled={
                        locked ||
                        !view.lines.length ||
                        view.unresolved_choices.length > 0 ||
                        voice.active
                      }
                      onClick={() => void review()}
                    >
                      Review order
                    </button>
                    <button
                      className="outline wide"
                      disabled={locked}
                      onClick={() => setMenu(true)}
                    >
                      Browse menu
                    </button>
                    {voice.active && (
                      <small>
                        {voice.confirmationUnavailable
                          ? "Stop voice to review and confirm on screen."
                          : "Say “review my order” for a voice readback, or stop voice to review on screen."}
                      </small>
                    )}
                  </>
                ) : null}
                {!view.order &&
                  view.lines.length > 0 &&
                  view.session.owner === "ai" &&
                  !view.session.needs_staff_review && (
                    <button
                      className="text-button wide"
                      disabled={locked}
                      onClick={() =>
                        void call("cancel_draft_order", {
                          expected_version: view.cart_version,
                        })
                      }
                    >
                      Start over
                    </button>
                  )}
              </section>
              {!view.order &&
                view.lines.length > 0 &&
                view.session.owner === "ai" &&
                !view.session.needs_staff_review && (
                  <MealSavingsCard
                    key={view.session.id}
                    proposal={view.meal_savings}
                    disabled={
                      Boolean(locked) || view.unresolved_choices.length > 0
                    }
                    voiceActive={voice.active}
                    check={() => void call("find_meal_savings")}
                    apply={(proposal) =>
                      void act("/lane/meal-savings/apply", {
                        proposal_id: proposal.id,
                        expected_version: proposal.cart_version,
                        request_id: crypto.randomUUID(),
                      })
                    }
                  />
                )}
              {!view.order &&
                view.session.owner === "ai" &&
                !view.session.needs_staff_review && (
                  <section className="fixture-panel">
                    <h3>
                      {voice.active
                        ? "Live Nova speech"
                        : "No-key fixture mode"}
                    </h3>
                    <p className="small">
                      {voice.active
                        ? "Speak naturally. You can interrupt a response."
                        : "Predefined phrases, real MCP calls and database changes."}
                    </p>
                    {config?.demo && !voice.active && (
                      <>
                        <div className="fixture-buttons">
                          <button
                            disabled={locked}
                            onClick={() =>
                              void act("/lane/fixture", { text: "first" })
                            }
                          >
                            Start example order
                          </button>
                          <button
                            disabled={locked || !view.lines.length}
                            onClick={() =>
                              void act("/lane/fixture", { text: "correct" })
                            }
                          >
                            Apply correction
                          </button>
                        </div>
                        <details>
                          <summary>More example phrases</summary>
                          {config.fixtures
                            .filter((f) => !["first", "correct"].includes(f.id))
                            .map((f) => (
                              <button
                                key={f.id}
                                className="phrase"
                                disabled={locked}
                                onClick={() =>
                                  void act("/lane/fixture", { text: f.id })
                                }
                              >
                                {f.text}
                              </button>
                            ))}
                        </details>
                      </>
                    )}
                    <button
                      className="voice-button wide"
                      disabled={busy || (!voice.active && !config?.voice)}
                      onClick={() =>
                        voice.active ? voice.stop() : void voice.start()
                      }
                    >
                      {voice.active ? "Stop live voice" : "Start live voice"}
                    </button>
                    <p className="small" role="status">
                      {config?.voice
                        ? voice.status
                        : "Live voice is not configured. No microphone is active."}
                    </p>
                    <small>AI-generated speech when enabled.</small>
                    {voice.active && (
                      <button
                        className="outline wide"
                        onClick={voice.interrupt}
                      >
                        Interrupt response
                      </button>
                    )}
                    <details>
                      <summary>Captions & text fallback</summary>
                      {voice.caption && (
                        <p className="caption">{voice.caption}</p>
                      )}
                      <form
                        className="text-fallback"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (voice.active) voice.text(text);
                          else void act("/lane/fixture", { text });
                          setText("");
                        }}
                      >
                        <label>
                          {voice.active
                            ? "Type to Nova"
                            : "Type a displayed example phrase"}
                          <input
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            maxLength={500}
                          />
                        </label>
                        <button disabled={locked || !text.trim()}>Send</button>
                      </form>
                      {voice.active && (
                        <p className="small">
                          Typed messages do not confirm an order. Use your voice
                          after the readback or the screen button.
                        </p>
                      )}
                    </details>
                  </section>
                )}
              {staff && (
                <div className="operator-controls">
                  <details>
                    <summary>Operator controls</summary>
                    <button disabled={busy} onClick={() => void depart()}>
                      Vehicle departed
                    </button>
                    <Link href="/crew">Crew console</Link>
                  </details>
                </div>
              )}
            </aside>
          </>
        )}
      </main>
      {error && (
        <div className="global-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
      <Footer />
      {menu && view && !locked && (
        <Modal title="Harbor Burger menu" close={() => setMenu(false)}>
          <MenuPanel
            menu={view.menu}
            choose={(p) => {
              setMenu(false);
              setEdit({ product: p, scope: editScope(view) });
            }}
          />
        </Modal>
      )}
      {edit &&
        view &&
        edit.scope === editScope(view) &&
        view.session.owner === "ai" &&
        !view.session.needs_staff_review &&
        !view.order && (
          <ItemEditor
            product={edit.product}
            line={edit.line}
            close={() => setEdit(null)}
            busy={busy || voice.pending}
            save={(c) => void change(c)}
            remove={
              edit.line
                ? () => void change({ type: "remove", line_id: edit.line!.id })
                : undefined
            }
          />
        )}
      {reset && view && resetMatches(reset, view) && (
        <Modal title="Start this draft over?" close={() => setReset(null)}>
          <p>
            This removes every item in this draft. Submitted kitchen orders are
            not cancelled.
          </p>
          {voice.active && (
            <p className="small">
              Confirming stops live voice and waits for pending changes before
              clearing this draft.
            </p>
          )}
          <button
            className="danger"
            disabled={busy || voice.pending}
            onClick={() => {
              const proposal = reset;
              voice.stop();
              void act("/lane/reset", {
                expected_version: proposal.cart_version,
                reset_token: proposal.reset_token,
              }).then((result) => {
                if (result)
                  setReset((current) =>
                    current === proposal ? null : current,
                  );
              });
            }}
          >
            Confirm reset
          </button>
        </Modal>
      )}
    </div>
  );
}
