export const CATEGORIES = {
  entertainment: ['games', 'movies', 'music', 'sports', 'other'],
  food: ['diningOut', 'groceries', 'liquor', 'other'],
  home: [
    'electronics',
    'furniture',
    'supplies',
    'maintenance',
    'mortgage',
    'pets',
    'rent',
    'services',
    'other',
  ],
  life: ['childcare', 'clothing', 'education', 'gifts', 'insurance', 'medical', 'taxes', 'other'],
  travel: ['bicycle', 'bus', 'train', 'car', 'fuel', 'hotel', 'parking', 'plane', 'taxi', 'other'],
  utilities: ['cleaning', 'electricity', 'gas', 'internet', 'trash', 'phone', 'water', 'other'],
  general: ['other'],
} as const satisfies Record<string, string[]>;

export const DEFAULT_CATEGORY = 'general';

export type CategorySection = keyof typeof CATEGORIES;

type CategoryValues = (typeof CATEGORIES)[CategorySection][number];
type CategoryWithoutOther = Exclude<CategoryValues, 'other'>;

export type CategoryItem = CategoryWithoutOther | CategorySection;

/** Separators used by finance exports to nest categories, e.g. `Food:Groceries`. */
const CATEGORY_SEPARATORS = /[:.-]/;

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const toLookup = (values: readonly string[]) =>
  new Map(values.map((value) => [normalize(value), value]));

const SECTION_LOOKUP = toLookup(Object.keys(CATEGORIES));

/* `other` is excluded: picking it stores the section name, so it is not a value of its own. */
const ITEM_LOOKUP = toLookup(
  Object.values(CATEGORIES)
    .flat()
    .filter((item) => 'other' !== item),
);

/**
 * Maps a category from an external system onto a SplitPro category.
 *
 * The whole string is tried first, then each part after splitting on `:`, `.` and `-`, so
 * both `Dining-Out` and `Food:Groceries` resolve. A specific item wins over a section --
 * `Food:Groceries` becomes `groceries`, not `food`. Anything unrecognised falls back to
 * the default category rather than failing the row.
 */
export const matchCategory = (value: string): string => {
  const candidates = [value, ...value.split(CATEGORY_SEPARATORS)]
    .map(normalize)
    .filter((candidate) => '' !== candidate);

  const item = candidates.find((candidate) => ITEM_LOOKUP.has(candidate));
  if (item) {
    return ITEM_LOOKUP.get(item)!;
  }

  const section = candidates.find((candidate) => SECTION_LOOKUP.has(candidate));
  if (section) {
    return SECTION_LOOKUP.get(section)!;
  }

  return DEFAULT_CATEGORY;
};
