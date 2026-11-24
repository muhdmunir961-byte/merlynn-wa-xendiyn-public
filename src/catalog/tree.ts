import type { PriceListItem } from '../digiflazz/client.js';

export interface SubCategory {
  key: string;
  label: string;
  total: number;
  active: number;
  inactive: number;
}

export interface CategoryNode {
  key: string;
  label: string;
  total: number;
  active: number;
  inactive: number;
  subcategories: SubCategory[];
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24) || 'lain';

const isActive = (item: PriceListItem): boolean =>
  Boolean(item.seller_product_status) && Boolean(item.buyer_product_status);

/** Build a category -> subcategory (brand) tree with active/inactive counters. */
export const buildTree = (items: PriceListItem[]): CategoryNode[] => {
  const categories = new Map<string, { label: string; subs: Map<string, SubCategory> }>();

  for (const item of items) {
    const categoryLabel = (item.category || 'Lain-lain').trim();
    const categoryKey = slug(categoryLabel);
    const subLabel = (item.brand || item.category || 'Lain-lain').trim();
    const subKey = slug(subLabel);
    const active = isActive(item);

    const category = categories.get(categoryKey) ?? { label: categoryLabel, subs: new Map<string, SubCategory>() };
    const sub = category.subs.get(subKey) ?? { key: subKey, label: subLabel, total: 0, active: 0, inactive: 0 };

    sub.total += 1;
    if (active) sub.active += 1;
    else sub.inactive += 1;

    category.subs.set(subKey, sub);
    categories.set(categoryKey, category);
  }

  return [...categories.entries()]
    .map(([key, value]) => {
      const subs = [...value.subs.values()].sort((a, b) => b.total - a.total);
      return {
        key,
        label: value.label,
        total: subs.reduce((sum, sub) => sum + sub.total, 0),
        active: subs.reduce((sum, sub) => sum + sub.active, 0),
        inactive: subs.reduce((sum, sub) => sum + sub.inactive, 0),
        subcategories: subs
      };
    })
    .sort((a, b) => b.total - a.total);
};

/** Resolve a user keyboard/text input to a category or subcategory node. */
export const resolveNode = (
  tree: CategoryNode[],
  input: string
): { category: CategoryNode; subcategory?: SubCategory } | undefined => {
  const needle = slug(input);
  if (!needle) return undefined;

  for (const category of tree) {
    if (category.key === needle) return { category };
    const sub = category.subcategories.find((candidate) =>
      candidate.key === needle || candidate.label.toLowerCase().includes(needle));
    if (sub) return { category, subcategory: sub };
  }

  for (const category of tree) {
    if (category.label.toLowerCase().includes(needle)) return { category };
  }

  return undefined;
};

export const filterItems = (
  items: PriceListItem[],
  input: { categoryKey?: string; subKey?: string; query?: string; mode?: 'all' | 'active' | 'inactive' }
): PriceListItem[] => {
  const mode = input.mode ?? 'all';
  const query = (input.query ?? '').trim().toLowerCase();

  return items.filter((item) => {
    if (input.categoryKey && slug(item.category || 'Lain-lain') !== input.categoryKey) return false;
    if (input.subKey && slug(item.brand || item.category || 'Lain-lain') !== input.subKey) return false;
    if (query) {
      const haystack = [item.buyer_sku_code, item.product_name, item.brand, item.category]
        .map((value) => value.toLowerCase());
      if (!haystack.some((value) => value.includes(query))) return false;
    }
    if (mode === 'active') return isActive(item);
    if (mode === 'inactive') return !isActive(item);
    return true;
  });
};

export { isActive, slug };
