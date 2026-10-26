const ZERO = BigInt(0), SIXTY = BigInt(60), MAX_MINUTES = BigInt(Number.MAX_SAFE_INTEGER);

function positiveMinutes(value: bigint): number | null {
  return value > ZERO && value <= MAX_MINUTES ? Number(value) : null;
}

/** Convert UI hours to the canonical whole-minute RPC value, without rounding. */
export function parsePrepaidHours(value: string): number | null {
  const input = value.trim();
  // Whole minutes whose hour fraction repeats retain an exact, editable form.
  const clock = /^(\d+)\s*h(?:\s*(\d{1,2})(?:\s*min)?)?$/i.exec(input);
  if (clock) {
    const minutes = BigInt(clock[2] ?? "0");
    return minutes < SIXTY ? positiveMinutes(BigInt(clock[1]) * SIXTY + minutes) : null;
  }
  if (!/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(input)) return null;
  const [whole = "", fraction = ""] = input.replace(",", ".").split(".");
  const denominator = BigInt(10) ** BigInt(fraction.length);
  const numerator = BigInt((whole || "0") + fraction) * SIXTY;
  if (numerator % denominator !== ZERO) return null;
  return positiveMinutes(numerator / denominator);
}

function splitMinutes(minutes: number): [bigint, bigint] {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new RangeError("Expected non-negative whole minutes");
  const total = BigInt(minutes);
  return [total / SIXTY, total % SIXTY];
}

/** Exact editable hours: finite decimals when possible, otherwise hours/minutes. */
export function prepaidHoursInput(minutes: number, language = "fr"): string {
  const [hours, remainder] = splitMinutes(minutes);
  if (remainder === ZERO) return String(hours);
  if (remainder % BigInt(3) !== ZERO) return `${hours} h ${String(remainder).padStart(2, "0")}`;
  const fraction = String(remainder * BigInt(100) / SIXTY).padStart(2, "0").replace(/0+$/, "");
  return `${hours}${language === "en" ? "." : ","}${fraction}`;
}

/** Exact readable summaries and history; no decimal-hour display rounding. */
export function formatPrepaidHours(minutes: number): string {
  const [hours, remainder] = splitMinutes(minutes);
  return remainder === ZERO ? `${hours} h` : `${hours} h ${String(remainder).padStart(2, "0")}`;
}
