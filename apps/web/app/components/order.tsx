"use client";
import { useEffect, useRef, useState } from "react";
import {
  money,
  type Command,
  type Line,
  type Menu,
  type PricedLine,
  type Product,
  type Totals,
} from "@saygo/contracts";
export function OrderLines({
  lines,
  onEdit,
}: {
  lines: PricedLine[];
  onEdit?: (line: PricedLine) => void;
}) {
  return (
    <ol className="order-lines" aria-label="Current order">
      {lines.map((line) => (
        <li key={line.id} className="order-line">
          <span className="quantity" aria-label={`Quantity ${line.quantity}`}>
            {line.quantity}
          </span>
          <div className="line-description">
            <h3>{line.name}</h3>
            <p
              className={
                line.modifiers.some((m) => m.startsWith("No "))
                  ? "modified"
                  : ""
              }
            >
              {line.modifiers.length ? line.modifiers.join(" · ") : "Standard"}
            </p>
            {onEdit && (
              <button
                className="text-button edit"
                aria-label={`Edit ${line.name} ${line.modifiers.join(" ")}`}
                onClick={() => onEdit(line)}
              >
                Edit
              </button>
            )}
          </div>
          <strong className="line-price">{money(line.line_total)}</strong>
        </li>
      ))}
    </ol>
  );
}
export function OrderTotals({ totals }: { totals: Totals }) {
  return (
    <dl className="totals">
      <div>
        <dt>Subtotal</dt>
        <dd>{money(totals.subtotal)}</dd>
      </div>
      <div>
        <dt>Demo tax (8%)</dt>
        <dd>{money(totals.tax)}</dd>
      </div>
      <div className="grand-total">
        <dt>Total</dt>
        <dd>{money(totals.total)}</dd>
      </div>
    </dl>
  );
}
export function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} className="modal">
      <div className="modal-heading">
        <h2>{title}</h2>
        <button onClick={close} aria-label="Close dialog">
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ItemEditor({
  product,
  line,
  close,
  save,
  remove,
  busy,
}: {
  product: Product;
  line?: Line;
  close: () => void;
  save: (command: Command) => void;
  remove?: () => void;
  busy: boolean;
}) {
  const [variant, setVariant] = useState(
    line?.variant ??
      (Object.keys(product.variants).length === 1
        ? Object.keys(product.variants)[0]
        : ""),
  );
  const [choices, setChoices] = useState<Record<string, string[]>>(
    line?.choices ?? {},
  );
  const [mealDrink, setMealDrink] = useState("cola");
  const [mealSize, setMealSize] = useState("medium");
  return (
    <Modal title={product.name} close={close}>
      <p>{product.description}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(
            line
              ? { type: "update", line_id: line.id, variant, choices }
              : {
                  type: "add",
                  product_id: product.id,
                  variant,
                  choices,
                  quantity: 1,
                },
          );
        }}
      >
        <label>
          Size
          <select
            aria-label="Size"
            value={variant}
            required
            onChange={(e) => setVariant(e.target.value)}
          >
            <option value="" disabled>
              Choose a size
            </option>
            {Object.entries(product.variants).map(([v, price]) => (
              <option key={v} value={v}>
                {v} {price > 0 ? money(price) : "— calculated meal"}
              </option>
            ))}
          </select>
        </label>
        {Object.entries(product.groups).map(([key, g]) => (
          <fieldset key={key}>
            <legend>
              {g.label} {g.min > 0 ? `(choose ${g.min})` : "(optional)"}
            </legend>
            {Object.entries(g.options).map(([id, o]) => (
              <label key={id} className="choice">
                <input
                  type={g.max === 1 ? "radio" : "checkbox"}
                  name={key}
                  checked={choices[key]?.includes(id) ?? false}
                  onChange={(e) =>
                    setChoices({
                      ...choices,
                      [key]:
                        g.max === 1
                          ? [id]
                          : e.target.checked
                            ? [...(choices[key] ?? []), id]
                            : (choices[key] ?? []).filter((v) => v !== id),
                    })
                  }
                />
                {o.label}
                {o.price > 0 ? ` +${money(o.price)}` : ""}
              </label>
            ))}
            {g.min === 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() => setChoices({ ...choices, [key]: [] })}
              >
                Clear {g.label.toLowerCase()}
              </button>
            )}
          </fieldset>
        ))}
        <div className="button-row">
          <button className="primary" disabled={busy || !product.available}>
            {line ? "Save changes" : "Add to order"}
          </button>
          {remove && (
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={remove}
            >
              Remove item
            </button>
          )}
        </div>
      </form>
      {line &&
        !line.meal &&
        ["cheeseburger", "classic", "chicken"].includes(product.id) && (
          <details>
            <summary>Make this sandwich a meal</summary>
            <p className="small">
              Adds medium fries and the selected drink, with a fictional $1
              bundle discount. Review the updated total before confirming.
            </p>
            <label>
              Meal drink
              <select
                value={mealDrink}
                onChange={(e) => setMealDrink(e.target.value)}
              >
                <option value="cola">Fountain Cola</option>
                <option value="lemonade">Lemonade</option>
                <option value="tea">Iced Tea</option>
              </select>
            </label>
            <label>
              Meal drink size
              <select
                value={mealSize}
                onChange={(e) => setMealSize(e.target.value)}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </label>
            <button
              disabled={busy}
              onClick={() =>
                save({
                  type: "meal",
                  line_id: line.id,
                  drink: mealDrink,
                  drink_variant: mealSize,
                })
              }
            >
              Convert this item to a meal
            </button>
          </details>
        )}
      <small>
        Fictional ingredient data. Ask staff about allergies and cross-contact.
      </small>
    </Modal>
  );
}
export function MenuPanel({
  menu,
  choose,
}: {
  menu: Menu;
  choose: (p: Product) => void;
}) {
  return (
    <div className="menu-list">
      {["Burgers", "Chicken", "Sides", "Drinks", "Meals"].map((category) => (
        <section key={category}>
          <h3>{category}</h3>
          {menu.products
            .filter((p) => p.category === category)
            .map((p) => (
              <button
                disabled={!p.available}
                key={p.id}
                onClick={() => choose(p)}
                className="menu-item"
              >
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.available ? p.description : "Currently unavailable"}
                  </small>
                </span>
                <span>
                  {p.category === "Meals"
                    ? "Choose meal"
                    : `from ${money(Math.min(...Object.values(p.variants)))}`}
                </span>
              </button>
            ))}
        </section>
      ))}
    </div>
  );
}
