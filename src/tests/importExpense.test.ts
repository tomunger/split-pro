import { SplitType, type User } from '@prisma/client';

import { buildImportedExpense } from '~/components/group/importExpense';
import { parseCsv } from '~/lib/csv';
import { type ParsedRow, detectColumns, detectDateFormat, parseRows } from '~/lib/csvImport';

// No shuffling, so the participant that absorbs the odd cent is predictable.
jest.mock('~/utils/array', () => ({
  shuffleArray: jest.fn(<T>(arr: T[]): T[] => arr),
}));

const createMockUser = (id: number, name: string): User => ({
  id,
  name,
  email: `${name.toLowerCase()}@example.com`,
  currency: 'USD',
  defaultCurrency: null,
  emailVerified: null,
  image: null,
  preferredLanguage: 'en',
  obapiProviderId: null,
  bankingId: null,
  hiddenFriendIds: [],
});

const alice = createMockUser(1, 'Alice');
const bob = createMockUser(2, 'Bob');
const carol = createMockUser(3, 'Carol');
const members = [alice, bob, carol];

const EXPENSE_DATE = new Date(2026, 6, 27);

const createRow = (amount: bigint): ParsedRow => ({
  lineNumber: 2,
  date: EXPENSE_DATE,
  name: 'Whole Foods Market',
  amount,
  category: 'general',
  raw: {
    date: '7/27/26',
    description: 'Whole Foods Market',
    amount: '-$118.24',
    category: '',
  },
});

const build = (amount: bigint) =>
  buildImportedExpense({
    row: createRow(amount),
    expenseDate: EXPENSE_DATE,
    paidBy: alice,
    members,
    currency: 'USD',
    groupId: 7,
  });

const sumParticipants = (expense: { participants: { amount: bigint }[] }) =>
  expense.participants.reduce((sum, p) => sum + p.amount, 0n);

describe('buildImportedExpense', () => {
  describe('Expenses', () => {
    it('should split the amount equally and credit the payer', () => {
      const expense = build(11824n);

      expect(expense.amount).toBe(11824n);
      expect(expense.participants).toEqual([
        // 118.24 over three people leaves an odd cent with the payer.
        { userId: alice.id, amount: 7882n },
        { userId: bob.id, amount: -3941n },
        { userId: carol.id, amount: -3941n },
      ]);
    });

    it('should always balance to zero', () => {
      [1n, 2n, 3n, 100n, 11824n, 999999n].forEach((amount) => {
        expect(sumParticipants(build(amount))).toBe(0n);
      });
    });

    it('should file the expense for later categorisation', () => {
      const expense = build(11824n);

      expect(expense).toMatchObject({
        name: 'Whole Foods Market',
        category: 'general',
        splitType: SplitType.EQUAL,
        currency: 'USD',
        groupId: 7,
        paidBy: alice.id,
        expenseDate: EXPENSE_DATE,
      });
    });
  });

  describe('MoneyReceived', () => {
    it('should reverse every amount for a negative row', () => {
      const expense = build(-4000n);

      expect(expense.amount).toBe(-4000n);
      expect(expense.participants).toEqual([
        { userId: alice.id, amount: -2666n },
        { userId: bob.id, amount: 1333n },
        { userId: carol.id, amount: 1333n },
      ]);
    });

    it('should be the exact mirror of the same amount spent', () => {
      const spent = build(11824n);
      const received = build(-11824n);

      expect(received.amount).toBe(-spent.amount);
      received.participants.forEach((participant, index) => {
        expect(participant.amount).toBe(-spent.participants[index]!.amount);
      });
    });

    it('should always balance to zero', () => {
      [-1n, -2n, -3n, -100n, -4000n, -999999n].forEach((amount) => {
        expect(sumParticipants(build(amount))).toBe(0n);
      });
    });
  });

  describe('GroupSizes', () => {
    it('should give a solo member the whole amount', () => {
      const expense = buildImportedExpense({
        row: createRow(11824n),
        expenseDate: EXPENSE_DATE,
        paidBy: alice,
        members: [alice],
        currency: 'USD',
        groupId: 7,
      });

      expect(expense.participants).toEqual([{ userId: alice.id, amount: 0n }]);
    });

    it('should halve the amount between two members', () => {
      const expense = buildImportedExpense({
        row: createRow(1000n),
        expenseDate: EXPENSE_DATE,
        paidBy: alice,
        members: [alice, bob],
        currency: 'USD',
        groupId: 7,
      });

      expect(expense.participants).toEqual([
        { userId: alice.id, amount: 500n },
        { userId: bob.id, amount: -500n },
      ]);
    });
  });
});

describe('CSV import end to end', () => {
  const CSV = [
    'Date,Chk #,Transaction Payee,Note,Account,Category,Amount',
    '7/27/26,0,Whole Foods Market,,Apple Card,Food:Groceries,-$118.24',
    '7/28/26,0,Haggen,,Apple Card,Food:Groceries,-$30.04',
    '7/13/26,0,Payment to xfinity,,Checking (0967),Utilities,-$55.00',
    '7/4/26,0,Utility rebate,,Checking (0967),Utilities,$40.00',
  ].join('\n');

  const importRows = (amountSign: 'expenses_negative' | 'expenses_positive') => {
    const { headers, rows } = parseCsv(CSV);
    const mapping = detectColumns(headers);

    const parsed = parseRows({
      rows,
      mapping,
      dateFormat: detectDateFormat(rows.map((row) => row[mapping.date!] ?? '')),
      amountSign,
      currency: 'USD',
      locale: 'en-US',
    });

    return parsed.map((row) =>
      buildImportedExpense({
        row,
        expenseDate: row.date!,
        paidBy: alice,
        members,
        currency: 'USD',
        groupId: 7,
      }),
    );
  };

  it('should turn a bank export into balanced group expenses', () => {
    const expenses = importRows('expenses_negative');

    expect(expenses).toHaveLength(4);
    expect(expenses.map((e) => e.amount)).toEqual([11824n, 3004n, 5500n, -4000n]);
    expenses.forEach((expense) => expect(sumParticipants(expense)).toBe(0n));
  });

  it('should reverse the direction of every row when the sign convention flips', () => {
    const negative = importRows('expenses_negative');
    const positive = importRows('expenses_positive');

    positive.forEach((expense, index) => {
      expect(expense.amount).toBe(-negative[index]!.amount);
    });
  });

  it('should leave the group net worth unchanged overall', () => {
    const total = importRows('expenses_negative').reduce((sum, e) => sum + e.amount, 0n);

    // 118.24 + 30.04 + 55.00 spent, less a 40.00 rebate.
    expect(total).toBe(16328n);
  });
});
