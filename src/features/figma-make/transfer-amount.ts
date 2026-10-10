const ungrouped = /^\d+(?:\.\d*)?$/;
const grouped = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
const submittable = /^\d+(?:\.\d+)?$/;

export function normalizeTransferAmount(value: string): string | null {
  const trimmed = value.trim();
  if (!ungrouped.test(trimmed) && !grouped.test(trimmed)) return null;
  const plain = trimmed.replaceAll(",", "");
  return plain.length <= 128 && submittable.test(plain) && /[1-9]/.test(plain) ? plain : null;
}

export function formatTransferAmount(value: string): string {
  if (!ungrouped.test(value) && !grouped.test(value)) return value;
  const [integer, fraction] = value.replaceAll(",", "").split(".");
  const formatted = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? formatted : `${formatted}.${fraction}`;
}

export function transferAmountCaret(value: string, meaningfulCharacters: number): number {
  if (meaningfulCharacters === 0) return 0;
  let seen = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ",") seen += 1;
    if (seen === meaningfulCharacters) return index + 1;
  }
  return value.length;
}
