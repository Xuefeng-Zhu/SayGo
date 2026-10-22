"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Command,
  type Line,
  type Product,
  type View,
  type Order,
} from "@saygo/contracts";
import { api } from "./api";
import { ItemEditor, MenuPanel, Modal, OrderLines, OrderTotals } from "./order";
type CrewData = {
  view: View | null;
  handoffs: {
    id: string;
    reason: string;
    concern: string | null;
    resolved: boolean;
  }[];
};
const crewScope = (view: View | null | undefined) =>
  view
    ? `${view.session.id}:${view.session.epoch}:${view.session.fence}:${view.session.owner}:${view.session.needs_staff_review}:${view.order?.id ?? ""}`
    : "";
const crewEditScope = (view: View) => `${crewScope(view)}:${view.cart_version}`;
export function Crew() {
  const [data, setData] = useState<CrewData | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [edit, setEdit] = useState<{
      product: Product;
      line?: Line;
      scope: string;
    } | null>(null),
    [menu, setMenu] = useState(false);
  const currentView = useRef<View | null>(null),
    request = useRef(0),
    busyRef = useRef(false),
    mounted = useRef(true);
  const refresh = useCallback(async (force = false) => {
    if (busyRef.current && !force) return;
    const seq = ++request.current;
    try {
      const next = await api<CrewData>("/crew");
      if (!mounted.current || seq !== request.current) return;
      const previous = currentView.current;
      if (
        previous &&
        next.view &&
        previous.session.id === next.view.session.id &&
        (next.view.session.epoch < previous.session.epoch ||
          next.view.session.fence < previous.session.fence ||
          next.view.cart_version < previous.cart_version)
      )
        return;
      if (crewScope(previous) !== crewScope(next.view)) {
        setEdit(null);
        setMenu(false);
        setMessage("");
        setError("");
      }
      currentView.current = next.view;
      setData(next);
    } catch (e) {
      if (mounted.current && seq === request.current)
        setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), 1000);
    return () => {
      mounted.current = false;
      ++request.current;
      clearInterval(t);
    };
  }, [refresh]);
  const v = data?.view;
  const act = async (action: string) => {
    if (
      !v ||
      busyRef.current ||
      crewScope(v) !== crewScope(currentView.current)
    )
      return;
    busyRef.current = true;
    ++request.current;
    setBusy(true);
    try {
      await api("/crew/action", {
        session_id: v.session.id,
        expected_fence: v.session.fence,
        request_id: crypto.randomUUID(),
        action,
        ...(action === "message" ? { message } : {}),
      });
      setMessage("");
      await refresh(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
      await refresh(true);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const change = async (command: Command) => {
    if (
      !v ||
      !edit ||
      !currentView.current ||
      busyRef.current ||
      v.session.owner !== "staff" ||
      v.order ||
      edit.scope !== crewEditScope(v) ||
      edit.scope !== crewEditScope(currentView.current)
    )
      return;
    busyRef.current = true;
    ++request.current;
    setBusy(true);
    try {
      await api("/crew/cart", {
        session_id: v.session.id,
        expected_fence: v.session.fence,
        changes: {
          expected_version: v.cart_version,
          request_id: crypto.randomUUID(),
          commands: [command],
        },
      });
      setEdit(null);
      await refresh(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
      await refresh(true);
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!v ? (
        <p>No active customer. Start a session from the order board.</p>
      ) : (
        <div className="crew-grid">
          <section>
            <h2>Lane 01</h2>
            <p>
              Control:{" "}
              <strong>{v.session.owner === "staff" ? "Staff" : "SayGo"}</strong>{" "}
              · Cart version {v.cart_version}
              {v.order ? ` · Order #${v.order.number}: ${v.order.status}` : ""}
            </p>
            <OrderLines
              lines={v.lines}
              onEdit={
                v.session.owner === "staff" && !v.order && !busy
                  ? (line) =>
                      setEdit({
                        product: v.menu.products.find(
                          (p) => p.id === line.product_id,
                        )!,
                        line,
                        scope: crewEditScope(v),
                      })
                  : undefined
              }
            />
            <OrderTotals totals={v.totals} />
            {v.session.owner === "staff" && !v.order && (
              <button disabled={busy} onClick={() => setMenu(true)}>
                Add an item
              </button>
            )}
          </section>
          <aside className="crew-panel">
            <h2>Keep the order moving.</h2>
            <p>
              {v.session.owner === "staff"
                ? "You have control. AI changes and live voice are stopped. Customer confirmation is still required after staff edits."
                : "Take control to pause AI changes and live voice, then help with this draft."}
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || v.session.owner === "staff"}
                onClick={() => void act("takeover")}
              >
                Take control
              </button>
              <button
                disabled={
                  busy ||
                  v.session.owner !== "staff" ||
                  v.session.needs_staff_review
                }
                onClick={() => void act("release")}
              >
                Release to SayGo
              </button>
            </div>
            <p className="small" role="status">
              {v.session.needs_staff_review
                ? "Handle the customer’s request before releasing control."
                : "Release returns the draft to the customer. Voice stays off until they choose Start live voice."}
            </p>
            {v.unresolved_choices.map((i, n) => (
              <div className="notice" key={n}>
                {i.message}
              </div>
            ))}
            {data?.handoffs
              .filter((h) => !h.resolved)
              .map((h) => (
                <div className="notice" key={h.id}>
                  <h3>{h.reason.replaceAll("_", " ")}</h3>
                  <p>{h.concern ?? "Customer needs staff assistance."}</p>
                  {h.reason === "allergy" && (
                    <small>
                      Restricted concern. Verify with restaurant staff;
                      ingredient fixtures do not establish safety.
                    </small>
                  )}
                </div>
              ))}
            {v.session.needs_staff_review && (
              <button
                className="wide"
                disabled={busy || v.session.owner !== "staff"}
                onClick={() => void act("resolve")}
              >
                Mark staff review handled
              </button>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("message");
              }}
            >
              <label>
                Staff message to the customer
                <textarea
                  disabled={busy || v.session.owner !== "staff"}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={300}
                />
              </label>
              <button
                disabled={
                  busy || v.session.owner !== "staff" || !message.trim()
                }
              >
                Send staff message
              </button>
            </form>
            <p className="small">
              Typed messages only; no live staff intercom. Submitted order
              changes require a human process outside this sandbox. Tickets
              cannot be silently edited.
            </p>
          </aside>
        </div>
      )}
      {menu && v && v.session.owner === "staff" && !v.order && (
        <Modal title="Add to this draft" close={() => setMenu(false)}>
          <MenuPanel
            menu={v.menu}
            choose={(product) => {
              setMenu(false);
              setEdit({ product, scope: crewEditScope(v) });
            }}
          />
        </Modal>
      )}
      {edit &&
        v &&
        edit.scope === crewEditScope(v) &&
        v.session.owner === "staff" &&
        !v.order && (
          <ItemEditor
            product={edit.product}
            line={edit.line}
            close={() => setEdit(null)}
            busy={busy}
            save={(c) => void change(c)}
            remove={
              edit.line
                ? () => void change({ type: "remove", line_id: edit.line!.id })
                : undefined
            }
          />
        )}
    </>
  );
}
export function Kitchen() {
  const [orders, setOrders] = useState<Order[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(
    () =>
      api<{ orders: Order[] }>("/kitchen")
        .then((d) => setOrders(d.orders))
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [refresh]);
  const next: Record<string, string> = {
    accepted: "preparing",
    preparing: "ready",
    ready: "handed_off",
  };
  const labels: Record<string, string> = {
    accepted: "Start preparing",
    preparing: "Mark ready",
    ready: "Handed off",
  };
  return (
    <>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {orders.length === 0 ? (
        <div className="empty-order">
          <h2>The rail is clear.</h2>
          <p>
            Only accepted sandbox orders appear here. Drafts and uncertain
            acknowledgements stay off the kitchen rail.
          </p>
        </div>
      ) : (
        <div className="tickets">
          {orders.map((o) => (
            <article className={`ticket ${o.status}`} key={o.id}>
              <div className="ticket-header">
                <h2>#{String(o.number).padStart(3, "0")}</h2>
                <strong>{o.status}</strong>
              </div>
              <small>
                {Math.max(
                  0,
                  Math.floor(
                    (Date.now() - new Date(o.created_at).getTime()) / 60000,
                  ),
                )}{" "}
                min · Lane 01 · Pay at window
              </small>
              <ul>
                {o.snapshot.lines.map((l) => (
                  <li key={l.id}>
                    <strong>
                      {l.quantity} × {l.name}
                    </strong>
                    <p>
                      {l.modifiers.length
                        ? l.modifiers.join(" · ")
                        : "Standard"}
                    </p>
                  </li>
                ))}
              </ul>
              <button
                className="primary wide"
                disabled={busy === o.id}
                onClick={async () => {
                  setBusy(o.id);
                  try {
                    await api("/kitchen/transition", {
                      order_id: o.id,
                      status: next[o.status],
                    });
                    await refresh();
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {labels[o.status]}
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function ProductSettings({ p, done }: { p: Product; done: () => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="admin-product"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const d = new FormData(e.currentTarget);
        const variants = Object.fromEntries(
          Object.keys(p.variants).map((v) => [v, Number(d.get(`price-${v}`))]),
        );
        const groups = structuredClone(p.groups);
        for (const [key, g] of Object.entries(groups)) {
          g.min = Number(d.get(`min-${key}`));
          g.max = Number(d.get(`max-${key}`));
          for (const [id, o] of Object.entries(g.options))
            o.price = Number(d.get(`modifier-${key}-${id}`));
        }
        try {
          await api("/admin/product", {
            id: p.id,
            patch: { available: d.has("available"), variants, groups },
          });
          setError("");
          done();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <h2>{p.name}</h2>
        <p className="small">{p.description}</p>
        <label className="choice">
          <input
            name="available"
            type="checkbox"
            defaultChecked={p.available}
          />
          Available
        </label>
      </div>
      <div>
        <div className="admin-prices">
          {Object.entries(p.variants).map(([v, n]) => (
            <label key={v}>
              {v} · cents
              <input
                type="number"
                name={`price-${v}`}
                defaultValue={n}
                min={0}
                max={50000}
                step={1}
                required
              />
            </label>
          ))}
        </div>
        {Object.keys(p.groups).length > 0 && (
          <details>
            <summary>Allowed choices & modifier prices</summary>
            {Object.entries(p.groups).map(([key, g]) => (
              <fieldset key={key}>
                <legend>{g.label}</legend>
                <div className="admin-prices">
                  <label>
                    Minimum
                    <input
                      type="number"
                      name={`min-${key}`}
                      min={0}
                      max={8}
                      defaultValue={g.min}
                    />
                  </label>
                  <label>
                    Maximum
                    <input
                      type="number"
                      name={`max-${key}`}
                      min={0}
                      max={8}
                      defaultValue={g.max}
                    />
                  </label>
                  {Object.entries(g.options).map(([id, o]) => (
                    <label key={id}>
                      {o.label} · cents
                      <input
                        name={`modifier-${key}-${id}`}
                        type="number"
                        min={0}
                        max={50000}
                        defaultValue={o.price}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </details>
        )}
        <button disabled={busy}>Save {p.name}</button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
type AdminData = {
  products: Product[];
  settings: { instructions: string; upsell_enabled: boolean; pos_mode: string };
  users: { id: string; role: string; enabled: boolean }[];
};
export function Admin() {
  const [data, setData] = useState<AdminData | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      api<AdminData>("/admin")
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>
            Changes invalidate active quotes. Customers must review the new
            selection and price.
          </p>
          <form
            className="admin-settings"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              try {
                await api("/admin/settings", {
                  instructions: d.get("instructions"),
                  upsell_enabled: d.has("upsell"),
                });
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Next-window instructions
              <textarea
                name="instructions"
                maxLength={300}
                defaultValue={data.settings.instructions}
              />
            </label>
            <label className="choice">
              <input
                name="upsell"
                type="checkbox"
                defaultChecked={data.settings.upsell_enabled}
              />
              Allow at most one optional add-on question
            </label>
            <button>Save operating instructions</button>
          </form>
          <details>
            <summary>Staff access</summary>
            <p className="small">
              Separate admin, crew and kitchen roles. Demo passwords are
              provisioned by the seed command; replace before shared use.
            </p>
            {data.users
              .filter((u) => u.id !== "admin")
              .map((u) => (
                <label className="choice" key={u.id}>
                  <input
                    type="checkbox"
                    checked={u.enabled}
                    onChange={async (e) => {
                      try {
                        await api("/admin/user", {
                          id: u.id,
                          enabled: e.target.checked,
                        });
                        await refresh();
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  />
                  {u.role} enabled
                </label>
              ))}
          </details>
          {data.products.map((p) => (
            <ProductSettings p={p} key={p.id} done={() => void refresh()} />
          ))}
        </>
      )}
    </>
  );
}
export function Demo() {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [mode, setMode] = useState("");
  const refresh = () =>
    api<AdminData>("/admin")
      .then((d) => setMode(d.settings.pos_mode))
      .catch((e) => setError(e.message));
  useEffect(() => {
    void refresh();
  }, []);
  const act = async (action: string) => {
    try {
      await api("/demo", {
        action,
        ...(action === "reset" ? { confirmation } : {}),
      });
      setMessage(
        action === "reset"
          ? "Fictional Harbor Burger interactions and tickets cleared."
          : "Demo control applied.",
      );
      setError("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="demo-controls">
      <p>
        Development-only controls, gated by SAYGO_DEMO. No commercial POS is
        connected.
      </p>
      <h2>Sandbox acknowledgement</h2>
      <p>
        Current mode: <strong>{mode || "Loading…"}</strong>
      </p>
      <div className="button-row">
        {["accept", "reject", "delay", "unknown"].map((a) => (
          <button key={a} onClick={() => void act(a)}>
            {a === "unknown"
              ? "Timeout after acceptance"
              : a === "delay"
                ? "Delay 8 seconds"
                : a === "accept"
                  ? "Accept"
                  : "Reject"}
          </button>
        ))}
      </div>
      <button onClick={() => void act("retry")}>
        Retry pending reconciliation
      </button>
      <p className="small">
        Retries use the original external key and look up an existing acceptance
        before sending again.
      </p>
      <fieldset>
        <legend>Reset fictional data</legend>
        <p>
          Clears only this dedicated Harbor Burger demo’s sessions and tickets.
          Menu settings and staff accounts remain.
        </p>
        <label>
          Type RESET HARBOR DEMO
          <input
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </label>
        <button
          className="danger"
          disabled={confirmation !== "RESET HARBOR DEMO"}
          onClick={() => void act("reset")}
        >
          Reset fictional data
        </button>
      </fieldset>
      {message && <p role="status">{message}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
