import { format, isValid, parse, startOfDay } from 'date-fns';

import { matchCategory } from '~/lib/category';
import { getCurrencyHelpers } from '~/utils/numbers';

/**
 * Which side of zero the source file uses for spending. The opposite sign is money
 * received (a refund or reimbursement) and is imported as a negative expense.
 */
export const AMOUNT_SIGNS = ['expenses_negative', 'expenses_positive'] as const;

export type AmountSign = (typeof AMOUNT_SIGNS)[number];

export const isAmountSign = (value: string): value is AmountSign =>
  (AMOUNT_SIGNS as readonly string[]).includes(value);

export type CsvColumn = 'date' | 'description' | 'amount' | 'category';

/**
 * Which CSV column fills each role. Exports often spread the description across several
 * fields -- payee, note, memo -- so `description` takes any number of columns and joins
 * them in the given order.
 */
export interface ColumnMapping {
  date: number | null;
  amount: number | null;
  category: number | null;
  description: number[];
}

/** Placed between description columns when more than one contributes a value. */
export const DESCRIPTION_SEPARATOR = ' - ';

export type CsvRowError = 'invalid_date' | 'invalid_amount' | 'zero_amount' | 'missing_name';

export interface ParsedRow {
  /** 1-based line in the source file, counting the header, for error messages. */
  lineNumber: number;
  date: Date | null;
  name: string;
  /** Signed, in the currency's smallest unit. Positive is an expense, negative money received. */
  amount: bigint;
  /** A SplitPro category, resolved from the file's own category column where possible. */
  category: string;
  raw: Record<CsvColumn, string>;
  error?: CsvRowError;
}

/**
 * Header names we recognise per role, most specific first. Earlier keywords win over
 * later ones, so `Transaction Payee` beats `Note` for the description column.
 */
const COLUMN_KEYWORDS = {
  date: ['transaction date', 'date', 'posted', 'day'],
  description: [
    'payee',
    'description',
    'merchant',
    'narrative',
    'details',
    'note',
    'memo',
    'reference',
    'name',
  ],
  amount: ['amount', 'value', 'debit', 'total', 'sum'],
  category: ['category'],
} as const satisfies Record<CsvColumn, string[]>;

/**
 * Date layouts we try to recognise, most common first. Ambiguous values such as
 * `7/5/26` match the first entry that fits, which the user can override.
 */
export const DATE_FORMATS = [
  'M/d/yy',
  'MM/dd/yy',
  'M/d/yyyy',
  'MM/dd/yyyy',
  'd/M/yy',
  'dd/MM/yy',
  'd/M/yyyy',
  'dd/MM/yyyy',
  'yyyy-MM-dd',
  'yyyy/MM/dd',
  'd.M.yyyy',
  'dd.MM.yyyy',
  'd MMM yyyy',
  'dd MMM yyyy',
  'MMM d, yyyy',
  'MMM dd, yyyy',
] as const;

export type DateFormat = (typeof DATE_FORMATS)[number];

export const isDateFormat = (value: string): value is DateFormat =>
  (DATE_FORMATS as readonly string[]).includes(value);

/**
 * `date-fns` accepts more than the pattern strictly describes -- `yyyy` happily reads a
 * two-digit year, for instance. Requiring the parsed date to format back to the original
 * text keeps detection honest without hand-written per-format rules.
 */
export const parseDate = (value: string, dateFormat: DateFormat): Date | null => {
  const trimmed = value.trim();
  if ('' === trimmed) {
    return null;
  }

  /* Midnight today: `parse` fills unspecified units from the reference date, and a
     real "now" is what resolves a two-digit year to the right century. */
  const parsed = parse(trimmed, dateFormat, startOfDay(new Date()));

  if (!isValid(parsed) || format(parsed, dateFormat) !== trimmed) {
    return null;
  }

  return parsed;
};

/**
 * The layout that reads the most samples, preferring the first listed on a tie. Scoring
 * rather than requiring a clean sweep means one malformed row cannot derail the whole file.
 */
export const detectDateFormat = (samples: string[]): DateFormat => {
  const values = samples.map((s) => s.trim()).filter((s) => '' !== s);

  const best = DATE_FORMATS.reduce<{ dateFormat: DateFormat; matches: number }>(
    (acc, dateFormat) => {
      const matches = values.filter((value) => parseDate(value, dateFormat)).length;
      return matches > acc.matches ? { dateFormat, matches } : acc;
    },
    { dateFormat: DATE_FORMATS[0], matches: 0 },
  );

  return best.dateFormat;
};

const scoreHeader = (header: string, keywords: readonly string[]): number => {
  const normalized = header.trim().toLowerCase();

  const keywordIndex = keywords.findIndex((keyword) => normalized.includes(keyword));
  if (-1 === keywordIndex) {
    return 0;
  }

  const keyword = keywords[keywordIndex]!;
  const exactness = normalized === keyword ? 3 : normalized.endsWith(keyword) ? 2 : 1;

  // Keyword priority dominates: a `payee` substring beats an exact `note`.
  return (keywords.length - keywordIndex) * 10 + exactness;
};

/** Guesses which column holds which value, never assigning one column to two roles. */
export const detectColumns = (headers: string[]): ColumnMapping => {
  const claimed = new Set<number>();

  /** Every remaining column that matches, in CSV order so the join reads naturally. */
  const pickAll = (keywords: readonly string[]): number[] => {
    const matches = headers.reduce<number[]>((acc, header, index) => {
      if (!claimed.has(index) && 0 < scoreHeader(header, keywords)) {
        acc.push(index);
      }
      return acc;
    }, []);

    matches.forEach((index) => claimed.add(index));
    return matches;
  };

  const pick = (keywords: readonly string[]): number | null => {
    const best = headers.reduce<{ index: number; score: number }>(
      (acc, header, index) => {
        if (claimed.has(index)) {
          return acc;
        }
        const score = scoreHeader(header, keywords);
        return score > acc.score ? { index, score } : acc;
      },
      { index: -1, score: 0 },
    );

    if (0 === best.score) {
      return null;
    }

    claimed.add(best.index);
    return best.index;
  };

  return {
    date: pick(COLUMN_KEYWORDS.date),
    amount: pick(COLUMN_KEYWORDS.amount),
    category: pick(COLUMN_KEYWORDS.category),
    description: pickAll(COLUMN_KEYWORDS.description),
  };
};

const readCell = (row: string[], index: number | null): string =>
  null === index ? '' : (row[index] ?? '').trim();

/** Joins the mapped description columns, dropping any that are blank on this row. */
const readDescription = (row: string[], indices: number[]): string =>
  indices
    .map((index) => readCell(row, index))
    .filter((part) => '' !== part)
    .join(DESCRIPTION_SEPARATOR);

const rowError = ({
  raw,
  date,
  amount,
}: Omit<ParsedRow, 'lineNumber' | 'error'>): CsvRowError | undefined => {
  if (!date) {
    return 'invalid_date';
  }
  if (!/\d/.test(raw.amount)) {
    return 'invalid_amount';
  }
  if (0n === amount) {
    return 'zero_amount';
  }
  if ('' === raw.description) {
    return 'missing_name';
  }
  return undefined;
};

export interface ParseRowsOptions {
  rows: string[][];
  mapping: ColumnMapping;
  dateFormat: DateFormat;
  amountSign: AmountSign;
  currency: string;
  locale?: string;
}

/**
 * Turns raw CSV records into rows ready for preview, normalising amounts so that a
 * positive value always means an expense regardless of the file's own convention.
 */
export const parseRows = ({
  rows,
  mapping,
  dateFormat,
  amountSign,
  currency,
  locale,
}: ParseRowsOptions): ParsedRow[] => {
  const { toSafeBigInt } = getCurrencyHelpers({ currency, locale });
  const expenseSign = 'expenses_negative' === amountSign ? -1n : 1n;

  return rows.map((row, index) => {
    const raw: Record<CsvColumn, string> = {
      date: readCell(row, mapping.date),
      description: readDescription(row, mapping.description),
      amount: readCell(row, mapping.amount),
      category: readCell(row, mapping.category),
    };

    const date = parseDate(raw.date, dateFormat);
    const amount = toSafeBigInt(raw.amount, true) * expenseSign;

    return {
      // Offset by the header row and by the zero-based index.
      lineNumber: index + 2,
      date,
      name: raw.description,
      amount,
      category: matchCategory(raw.category),
      raw,
      error: rowError({ raw, date, name: raw.description, amount, category: '' }),
    };
  });
};

export interface ImportableExpense {
  name: string;
  amount: bigint;
  expenseDate: Date;
}

const duplicateKey = (name: string, amount: bigint, date: Date) =>
  `${name.trim().toLowerCase()}|${amount}|${startOfDay(date).getTime()}`;

/**
 * Line numbers of rows that look like a repeat of an expense already in the group --
 * same day, same signed amount and same name. Advisory only; the user decides.
 */
export const findDuplicateLines = (
  rows: ParsedRow[],
  existingExpenses: ImportableExpense[],
): Set<number> => {
  const existingKeys = new Set(
    existingExpenses.map(({ name, amount, expenseDate }) =>
      duplicateKey(name, amount, expenseDate),
    ),
  );

  const isDuplicate = ({ error, date, name, amount }: ParsedRow) =>
    !error && date && existingKeys.has(duplicateKey(name, amount, date));

  return new Set(rows.filter(isDuplicate).map((row) => row.lineNumber));
};
