import { DEFAULT_CATEGORY, matchCategory } from '~/lib/category';

describe('matchCategory', () => {
  describe('DirectMatches', () => {
    it('should match a section by name', () => {
      expect(matchCategory('Utilities')).toBe('utilities');
    });

    it('should match an item by name', () => {
      expect(matchCategory('Groceries')).toBe('groceries');
    });

    it('should ignore case and surrounding whitespace', () => {
      expect(matchCategory('  gRoCeRiEs ')).toBe('groceries');
    });
  });

  describe('NestedCategories', () => {
    it('should split on a colon and prefer the specific item', () => {
      expect(matchCategory('Food:Groceries')).toBe('groceries');
    });

    it('should split on a dot', () => {
      expect(matchCategory('Food.Groceries')).toBe('groceries');
    });

    it('should split on a hyphen', () => {
      expect(matchCategory('Food-Groceries')).toBe('groceries');
    });

    it('should fall back to the section when the leaf is unknown', () => {
      expect(matchCategory('Utilities:Telephone/Cellular')).toBe('utilities');
      expect(matchCategory('Utilities:Web Services')).toBe('utilities');
    });

    it('should match an item that appears in a different section', () => {
      // `pets` lives under `home`, but the export nests it under its own heading.
      expect(matchCategory('Pets:Pet Supplies')).toBe('pets');
    });

    it('should handle more than two levels', () => {
      expect(matchCategory('Expenses:Travel:Hotel')).toBe('hotel');
    });
  });

  describe('Normalisation', () => {
    it('should match a multi-word item written with a space', () => {
      expect(matchCategory('Dining Out')).toBe('diningOut');
    });

    it('should match a multi-word item written with a hyphen', () => {
      // The whole string is tried before splitting, so this still resolves.
      expect(matchCategory('Dining-Out')).toBe('diningOut');
    });

    it('should match a multi-word item written in camel case', () => {
      expect(matchCategory('diningOut')).toBe('diningOut');
    });
  });

  describe('Fallback', () => {
    it('should fall back for an unknown category', () => {
      expect(matchCategory('Widgets')).toBe(DEFAULT_CATEGORY);
    });

    it('should fall back for an empty value', () => {
      expect(matchCategory('')).toBe(DEFAULT_CATEGORY);
      expect(matchCategory('   ')).toBe(DEFAULT_CATEGORY);
    });

    it('should fall back for separators alone', () => {
      expect(matchCategory(':::')).toBe(DEFAULT_CATEGORY);
    });

    it('should never resolve to the shared `other` placeholder', () => {
      // `other` is not a storable value -- picking it stores the section name instead.
      expect(matchCategory('Other')).toBe(DEFAULT_CATEGORY);
    });
  });
});
