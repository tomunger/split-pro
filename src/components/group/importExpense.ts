import { SplitType, type User } from '@prisma/client';

import { type ParsedRow } from '~/lib/csvImport';
import { type SplitShares, calculateParticipantSplit, initSplitShares } from '~/store/addStore';
import { type CreateExpense } from '~/types/expense.types';
import { BigMath } from '~/utils/numbers';

export interface BuildImportedExpenseOptions {
  row: ParsedRow;
  expenseDate: Date;
  paidBy: User;
  members: User[];
  currency: string;
  groupId: number;
}

/**
 * Turns one parsed row into an expense split equally across the whole group.
 *
 * Money received is a negative expense: the magnitude is split as usual and then every
 * amount is flipped, which is exactly what AddOrEditExpensePage does for a negative
 * amount. The category comes from the row, already resolved to a SplitPro category.
 */
export const buildImportedExpense = ({
  row,
  expenseDate,
  paidBy,
  members,
  currency,
  groupId,
}: BuildImportedExpenseOptions): CreateExpense => {
  const isNegative = 0n > row.amount;
  const sign = isNegative ? -1n : 1n;

  const splitShares = members.reduce<SplitShares>((acc, member) => {
    acc[member.id] = initSplitShares();
    return acc;
  }, {});

  const { participants } = calculateParticipantSplit({
    amount: BigMath.abs(row.amount),
    participants: members,
    splitType: SplitType.EQUAL,
    splitShares,
    paidBy,
    expenseDate,
    isNegative,
  });

  return {
    name: row.name,
    currency,
    amount: row.amount,
    groupId,
    splitType: SplitType.EQUAL,
    paidBy: paidBy.id,
    participants: participants.map((p) => ({ userId: p.id, amount: (p.amount ?? 0n) * sign })),
    category: row.category,
    expenseDate,
  };
};
