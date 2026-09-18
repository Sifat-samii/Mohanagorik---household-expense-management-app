export const EXPENSE_CATEGORIES = [
  "Groceries",
  "Electricity",
  "Gas",
  "Internet",
  "Cleaning",
  "Household",
  "Maintenance",
  "Transport",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const CATEGORY_SET = new Set<string>(EXPENSE_CATEGORIES);

/** A null value means the member participates in every expense category. */
export function parseApplicableCategories(value: unknown): string[] | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return [];
    const categories = [...new Set(parsed.filter((item): item is string => typeof item === "string" && CATEGORY_SET.has(item)))];
    return categories;
  } catch {
    return [];
  }
}

export function normalizeApplicableCategories(value: unknown): string[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) throw new Error("Choose all categories or at least one category");
  const rawCategories = value.map((item) => String(item));
  if (rawCategories.some((item) => !CATEGORY_SET.has(item))) throw new Error("Choose valid expense categories");
  const categories = [...new Set(rawCategories)];
  if (!categories.length) throw new Error("Choose at least one applicable category");
  return categories.length === EXPENSE_CATEGORIES.length ? null : categories;
}

export function isCategoryApplicable(value: unknown, category: string) {
  const applicable = parseApplicableCategories(value);
  return applicable === null || applicable.includes(category);
}
