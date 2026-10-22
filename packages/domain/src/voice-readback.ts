import type { QuoteSnapshot } from "@saygo/contracts";

const small = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const tens = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

export function numberWords(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > 999999999)
    throw new Error("Unsupported readback number");
  if (value < 20) return small[value];
  if (value < 100)
    return (
      tens[Math.floor(value / 10)] + (value % 10 ? "-" + small[value % 10] : "")
    );
  for (const [unit, label] of [
    [1000000, "million"],
    [1000, "thousand"],
    [100, "hundred"],
  ] as const)
    if (value >= unit)
      return (
        numberWords(Math.floor(value / unit)) +
        " " +
        label +
        (value % unit ? " " + numberWords(value % unit) : "")
      );
  throw new Error("Unsupported readback number");
}

export function moneyWords(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error("Unsupported readback total");
  const dollars = Math.floor(cents / 100),
    remainder = cents % 100;
  return (
    numberWords(dollars) +
    (dollars === 1 ? " dollar" : " dollars") +
    (remainder
      ? " and " +
        numberWords(remainder) +
        (remainder === 1 ? " cent" : " cents")
      : "")
  );
}

export function voiceReadback(snapshot: QuoteSnapshot): string {
  const items = snapshot.lines.map((line) => {
    const quantity = numberWords(line.quantity);
    return (
      quantity[0].toUpperCase() +
      quantity.slice(1) +
      " " +
      line.name +
      (line.modifiers.length
        ? ", " + line.modifiers.map((m) => m.toLowerCase()).join(", ")
        : "") +
      "."
    );
  });
  return (
    items.join(" ") +
    " Total " +
    moneyWords(snapshot.totals.total) +
    " including tax. Say yes, place the order to confirm, or tell me what to change."
  );
}
