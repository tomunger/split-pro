import { parseCsv } from '~/lib/csv';
import {
  type AmountSign,
  type ColumnMapping,
  DESCRIPTION_SEPARATOR,
  detectColumns,
  detectDateFormat,
  findDuplicateLines,
  parseDate,
  parseRows,
} from '~/lib/csvImport';

const HEADERS = ['Date', 'Chk #', 'Transaction Payee', 'Note', 'Account', 'Category', 'Amount'];

const MAPPING: ColumnMapping = { date: 0, description: [2], amount: 6, category: 5 };

const parseAmounts = (rows: string[][], amountSign: AmountSign) =>
  parseRows({
    rows,
    mapping: MAPPING,
    dateFormat: 'M/d/yy',
    amountSign,
    currency: 'USD',
    locale: 'en-US',
  });

describe('detectColumns', () => {
  it('should map the columns of a typical finance export', () => {
    // Both `Transaction Payee` and `Note` are description-ish, so both are picked up.
    expect(detectColumns(HEADERS)).toEqual({
      date: 0,
      description: [2, 3],
      amount: 6,
      category: 5,
    });
  });

  it('should prefer a payee column over a note column', () => {
    expect(detectColumns(['Date', 'Note', 'Payee', 'Amount']).description).toEqual([1, 2]);
  });

  it('should recognise alternative header names', () => {
    expect(detectColumns(['Posted', 'Description', 'Value'])).toEqual({
      date: 0,
      description: [1],
      amount: 2,
      category: null,
    });
  });

  it('should never assign one column to two roles', () => {
    const mapping = detectColumns(['Amount', 'Amount', 'Amount']);

    expect(mapping.amount).toBe(0);
    expect(mapping.date).toBeNull();
  });

  it('should return nulls when nothing matches', () => {
    expect(detectColumns(['foo', 'bar'])).toEqual({
      date: null,
      description: [],
      amount: null,
      category: null,
    });
  });
});

describe('description columns', () => {
  const parseWith = (description: number[], row: string[]) =>
    parseRows({
      rows: [row],
      mapping: { date: 0, description, amount: 6, category: null },
      dateFormat: 'M/d/yy',
      amountSign: 'expenses_negative',
      currency: 'USD',
      locale: 'en-US',
    })[0];

  const row = ['7/27/26', '0', 'Whole Foods Market', 'weekly shop', 'Apple Card', 'Food', '-$1.00'];

  it('should use a single column on its own', () => {
    expect(parseWith([2], row)?.name).toBe('Whole Foods Market');
  });

  it('should join several columns in the order given', () => {
    expect(parseWith([2, 3], row)?.name).toBe(
      `Whole Foods Market${DESCRIPTION_SEPARATOR}weekly shop`,
    );
  });

  it('should respect the caller order rather than sorting', () => {
    expect(parseWith([3, 2], row)?.name).toBe(
      `weekly shop${DESCRIPTION_SEPARATOR}Whole Foods Market`,
    );
  });

  it('should skip columns that are blank on this row', () => {
    const sparse = ['7/27/26', '0', 'Haggen', '', 'Apple Card', 'Food', '-$1.00'];

    expect(parseWith([2, 3], sparse)?.name).toBe('Haggen');
  });

  it('should join three columns', () => {
    expect(parseWith([2, 3, 4], row)?.name).toBe(
      ['Whole Foods Market', 'weekly shop', 'Apple Card'].join(DESCRIPTION_SEPARATOR),
    );
  });

  it('should flag a row where every mapped column is blank', () => {
    const blank = ['7/27/26', '0', '', '', 'Apple Card', 'Food', '-$1.00'];

    expect(parseWith([2, 3], blank)?.error).toBe('missing_name');
  });

  it('should flag a row when no column is mapped at all', () => {
    expect(parseWith([], row)?.error).toBe('missing_name');
  });
});

describe('parseDate', () => {
  it('should read a US short date', () => {
    expect(parseDate('7/27/26', 'M/d/yy')).toEqual(new Date(2026, 6, 27));
  });

  it('should reject a value the format does not describe exactly', () => {
    // `date-fns` would otherwise read `26` as the year 26 AD.
    expect(parseDate('7/27/26', 'M/d/yyyy')).toBeNull();
    expect(parseDate('07/27/26', 'M/d/yy')).toBeNull();
  });

  it('should reject an impossible day-month pairing', () => {
    expect(parseDate('7/27/26', 'd/M/yy')).toBeNull();
  });

  it('should reject junk and blanks', () => {
    expect(parseDate('not a date', 'M/d/yy')).toBeNull();
    expect(parseDate('   ', 'M/d/yy')).toBeNull();
  });
});

describe('detectDateFormat', () => {
  it('should pick month-first when a day exceeds twelve', () => {
    expect(detectDateFormat(['7/27/26', '7/4/26'])).toBe('M/d/yy');
  });

  it('should pick day-first when the first component exceeds twelve', () => {
    expect(detectDateFormat(['27/7/26', '4/7/26'])).toBe('d/M/yy');
  });

  it('should recognise ISO dates', () => {
    expect(detectDateFormat(['2026-07-27'])).toBe('yyyy-MM-dd');
  });

  it('should recognise zero-padded dates', () => {
    expect(detectDateFormat(['07/27/2026'])).toBe('MM/dd/yyyy');
  });

  it('should prefer the layout that fits the most samples', () => {
    // The second value rules out month-first, so day-first reads both.
    expect(detectDateFormat(['7/4/26', '27/7/26'])).toBe('d/M/yy');
  });

  it('should tolerate a single unreadable sample', () => {
    expect(detectDateFormat(['7/27/26', 'n/a', '7/28/26'])).toBe('M/d/yy');
  });

  it('should fall back to the most common format when nothing fits', () => {
    expect(detectDateFormat(['whenever'])).toBe('M/d/yy');
  });
});

describe('parseRows', () => {
  const row = (date: string, payee: string, amount: string) => [
    date,
    '0',
    payee,
    '',
    '',
    '',
    amount,
  ];

  it('should read a negative-is-spending file as expenses', () => {
    const [parsed] = parseAmounts(
      [row('7/27/26', 'Whole Foods Market', '-$118.24')],
      'expenses_negative',
    );

    expect(parsed).toMatchObject({
      lineNumber: 2,
      name: 'Whole Foods Market',
      amount: 11824n,
      error: undefined,
    });
    expect(parsed?.date).toEqual(new Date(2026, 6, 27));
  });

  it('should read the opposite sign in the same file as money received', () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Refund', '$40.00')], 'expenses_negative');

    expect(parsed?.amount).toBe(-4000n);
  });

  it('should read a positive-is-spending file as expenses', () => {
    const [parsed] = parseAmounts(
      [row('7/27/26', 'Whole Foods Market', '118.24')],
      'expenses_positive',
    );

    expect(parsed?.amount).toBe(11824n);
  });

  it('should read the opposite sign in a positive-is-spending file as money received', () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Refund', '-40.00')], 'expenses_positive');

    expect(parsed?.amount).toBe(-4000n);
  });

  it('should strip currency symbols and thousands separators', () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Rent', '-$1,234.56')], 'expenses_negative');

    expect(parsed?.amount).toBe(123456n);
  });

  it('should number lines from the source file, header included', () => {
    const parsed = parseAmounts(
      [row('7/1/26', 'One', '-1.00'), row('7/2/26', 'Two', '-2.00')],
      'expenses_negative',
    );

    expect(parsed.map((p) => p.lineNumber)).toEqual([2, 3]);
  });

  it('should flag an unreadable date', () => {
    const [parsed] = parseAmounts([row('nope', 'Shop', '-1.00')], 'expenses_negative');

    expect(parsed?.error).toBe('invalid_date');
  });

  it('should flag a missing amount', () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Shop', '')], 'expenses_negative');

    expect(parsed?.error).toBe('invalid_amount');
  });

  it('should flag an amount with a letter in it instead of dropping the letter', () => {
    // `O` typed for `0`: sanitising alone would read this as 1.00.
    const [parsed] = parseAmounts([row('7/27/26', 'Shop', '-1O.00')], 'expenses_negative');

    expect(parsed?.error).toBe('invalid_amount');
  });

  it('should flag an amount with stray characters in it', () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Shop', '-12abc34.56')], 'expenses_negative');

    expect(parsed?.error).toBe('invalid_amount');
  });

  it("should accept the selected currency's code", () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Shop', 'USD -12.00')], 'expenses_negative');

    expect(parsed).toMatchObject({ amount: 1200n, error: undefined });
  });

  it('should accept a currency symbol after the number', () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Shop', '-118.24 €')], 'expenses_negative');

    expect(parsed).toMatchObject({ amount: 11824n, error: undefined });
  });

  it('should flag a zero amount', () => {
    const [parsed] = parseAmounts([row('7/27/26', 'Shop', '$0.00')], 'expenses_negative');

    expect(parsed?.error).toBe('zero_amount');
  });

  it('should flag a missing description', () => {
    const [parsed] = parseAmounts([row('7/27/26', '   ', '-1.00')], 'expenses_negative');

    expect(parsed?.error).toBe('missing_name');
  });

  it('should tolerate an unmapped column', () => {
    const [parsed] = parseRows({
      rows: [['7/27/26', '0', 'Shop', '', '', '', '-1.00']],
      mapping: { date: 0, description: [], amount: 6, category: null },
      dateFormat: 'M/d/yy',
      amountSign: 'expenses_negative',
      currency: 'USD',
      locale: 'en-US',
    });

    expect(parsed?.error).toBe('missing_name');
  });

  it('should parse the sample export end to end', () => {
    const csv = [
      'Date,Chk #,Transaction Payee,Note,Account,Category,Amount',
      '7/27/26,0,Whole Foods Market,,Apple Card,Food:Groceries,-$118.24',
      '7/28/26,0,Haggen,,Apple Card,Food:Groceries,-$30.04',
      '7/13/26,0,Payment to xfinity,,Checking (0967),Utilities,-$55.00',
    ].join('\n');

    const { headers, rows } = parseCsv(csv);
    const parsed = parseRows({
      rows,
      mapping: detectColumns(headers),
      dateFormat: detectDateFormat(rows.map((r) => r[0] ?? '')),
      amountSign: 'expenses_negative',
      currency: 'USD',
      locale: 'en-US',
    });

    expect(parsed.every((p) => !p.error)).toBe(true);
    expect(parsed.reduce((sum, p) => sum + p.amount, 0n)).toBe(20328n);
  });
});

describe('category column', () => {
  const categoryOf = (category: string) =>
    parseRows({
      rows: [['7/27/26', '0', 'Shop', '', '', category, '-$1.00']],
      mapping: MAPPING,
      dateFormat: 'M/d/yy',
      amountSign: 'expenses_negative',
      currency: 'USD',
      locale: 'en-US',
    })[0]?.category;

  it('should resolve the categories in the sample export', () => {
    expect(categoryOf('Food:Groceries')).toBe('groceries');
    expect(categoryOf('Pets:Pet Supplies')).toBe('pets');
    expect(categoryOf('Utilities')).toBe('utilities');
    expect(categoryOf('Utilities:Telephone/Cellular')).toBe('utilities');
    expect(categoryOf('Utilities:Web Services')).toBe('utilities');
  });

  it('should fall back to the default for an unknown category', () => {
    expect(categoryOf('Widgets')).toBe('general');
  });

  it('should fall back to the default when the column is blank', () => {
    expect(categoryOf('')).toBe('general');
  });

  it('should fall back to the default when no category column is mapped', () => {
    const [parsed] = parseRows({
      rows: [['7/27/26', '0', 'Shop', '', '', 'Food:Groceries', '-$1.00']],
      mapping: { ...MAPPING, category: null },
      dateFormat: 'M/d/yy',
      amountSign: 'expenses_negative',
      currency: 'USD',
      locale: 'en-US',
    });

    expect(parsed?.category).toBe('general');
  });
});

describe('findDuplicateLines', () => {
  const existing = [
    { name: 'Whole Foods Market', amount: 11824n, expenseDate: new Date(2026, 6, 27, 13, 30) },
  ];

  it('should flag a row already present in the group', () => {
    const rows = parseAmounts(
      [['7/27/26', '0', 'Whole Foods Market', '', '', '', '-$118.24']],
      'expenses_negative',
    );

    expect([...findDuplicateLines(rows, existing)]).toEqual([2]);
  });

  it('should ignore case and surrounding whitespace in the name', () => {
    const rows = parseAmounts(
      [['7/27/26', '0', '  whole foods market ', '', '', '', '-$118.24']],
      'expenses_negative',
    );

    expect([...findDuplicateLines(rows, existing)]).toEqual([2]);
  });

  it('should not flag a different amount, day or name', () => {
    const rows = parseAmounts(
      [
        ['7/27/26', '0', 'Whole Foods Market', '', '', '', '-$118.25'],
        ['7/28/26', '0', 'Whole Foods Market', '', '', '', '-$118.24'],
        ['7/27/26', '0', 'Haggen', '', '', '', '-$118.24'],
      ],
      'expenses_negative',
    );

    expect(findDuplicateLines(rows, existing).size).toBe(0);
  });

  it('should ignore rows that already have an error', () => {
    const rows = parseAmounts(
      [['nope', '0', 'Whole Foods Market', '', '', '', '-$118.24']],
      'expenses_negative',
    );

    expect(findDuplicateLines(rows, existing).size).toBe(0);
  });
});
