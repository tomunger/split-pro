import { PaperClipIcon } from '@heroicons/react/24/solid';
import { type User } from '@prisma/client';
import { useRouter } from 'next/router';
import React, { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { parseCsv } from '~/lib/csv';
import {
  AMOUNT_SIGNS,
  type AmountSign,
  type ColumnMapping,
  type CsvColumn,
  DATE_FORMATS,
  type DateFormat,
  type ParsedRow,
  detectColumns,
  detectDateFormat,
  findDuplicateLines,
  isAmountSign,
  isDateFormat,
  parseRows,
} from '~/lib/csvImport';
import { type CurrencyCode, parseCurrencyCode } from '~/lib/currency';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { CurrencyPicker } from '../AddExpense/CurrencyPicker';
import { CategoryIcon } from '../ui/categoryIcons';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Input } from '../ui/input';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Separator } from '../ui/separator';
import { LoadingSpinner } from '../ui/spinner';
import { buildImportedExpense } from './importExpense';

/** Roles filled by exactly one column. Description is chosen separately, and takes several. */
const SINGLE_COLUMNS = ['date', 'amount', 'category'] as const satisfies readonly CsvColumn[];

/** Sentinel for the "not mapped" option, since a select cannot hold null. */
const UNMAPPED = '';

/** Expenses are sent in batches so that a long file is not one oversized request. */
const IMPORT_BATCH_SIZE = 25;

const chunk = <T,>(items: T[], size: number): T[][] =>
  items.reduce<T[][]>((acc, item, index) => {
    if (0 === index % size) {
      acc.push([]);
    }
    acc[acc.length - 1]!.push(item);
    return acc;
  }, []);

export const ImportExpensesFromCsv: React.FC<{
  groupId: number;
  user: { id: number; currency?: string | null; defaultCurrency?: string | null };
}> = ({ groupId, user }) => {
  const { t, i18n, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const router = useRouter();

  const groupDetailQuery = api.group.getGroupDetails.useQuery({ groupId });
  const expensesQuery = api.expense.getGroupExpenses.useQuery({ groupId });
  const addExpenseMutation = api.expense.addOrEditExpense.useMutation();

  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    date: null,
    amount: null,
    category: null,
    description: [],
  });
  const [dateFormat, setDateFormat] = useState<DateFormat>(DATE_FORMATS[0]);
  const [amountSign, setAmountSign] = useState<AmountSign>('expenses_negative');
  const [currency, setCurrency] = useState<CurrencyCode>(
    parseCurrencyCode(user.currency ?? user.defaultCurrency ?? 'USD'),
  );
  const [paidById, setPaidById] = useState(user.id);
  // Only rows the user has explicitly toggled; everything else follows the default.
  const [overrides, setOverrides] = useState<Record<number, boolean>>({});
  // Rows an interrupted import already saved; never offered again, so a retry cannot duplicate them.
  const [submittedLines, setSubmittedLines] = useState<ReadonlySet<number>>(new Set());
  const [importedCount, setImportedCount] = useState(0);
  /* Tracked separately from the mutation: this stays true across the whole batch run,
     where `isPending` would flicker between batches. */
  const [isImporting, setIsImporting] = useState(false);

  // Precomputed so the option keys do not have to be derived from the array index.
  const headerOptions = useMemo(
    () => headers.map((header, index) => ({ id: `${index}:${header}`, header, index })),
    [headers],
  );

  const members = useMemo(
    () => groupDetailQuery.data?.groupUsers.map((groupUser) => groupUser.user) ?? [],
    [groupDetailQuery.data],
  );

  const rows = useMemo(
    () =>
      parseRows({
        rows: records,
        mapping,
        dateFormat,
        amountSign,
        currency,
        locale: i18n.language,
      }),
    [records, mapping, dateFormat, amountSign, currency, i18n.language],
  );

  const duplicateLines = useMemo(
    () =>
      findDuplicateLines(
        rows,
        (expensesQuery.data ?? []).filter((expense) => expense.currency === currency),
      ),
    [rows, expensesQuery.data, currency],
  );

  /* Until the group's expenses load, a duplicate looks like a new row, so importing waits. */
  const duplicatesChecked = expensesQuery.isSuccess;

  const isIncluded = useCallback(
    (row: ParsedRow) =>
      !row.error &&
      !submittedLines.has(row.lineNumber) &&
      (overrides[row.lineNumber] ?? !duplicateLines.has(row.lineNumber)),
    [overrides, duplicateLines, submittedLines],
  );

  const selectedRows = useMemo(() => rows.filter(isIncluded), [rows, isIncluded]);

  const { toUIString } = getCurrencyHelpersCached(currency);

  const onFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const parsed = parseCsv(await file.text());

        if (0 === parsed.rows.length) {
          toast.error(t('group_details.import_csv.messages.no_rows_found'));
          return;
        }

        const detected = detectColumns(parsed.headers);
        const dateColumn = detected.date;

        setFileName(file.name);
        setHeaders(parsed.headers);
        setRecords(parsed.rows);
        setMapping(detected);
        setOverrides({});
        setSubmittedLines(new Set());
        setImportedCount(0);
        setDateFormat(
          detectDateFormat(
            null === dateColumn ? [] : parsed.rows.map((row) => row[dateColumn] ?? ''),
          ),
        );
      } catch (error) {
        console.error(error);
        toast.error(t('errors.import_failed'));
      }
    },
    [t],
  );

  const onColumnPick = useCallback(
    (column: CsvColumn, value: string) =>
      setMapping((current) => ({
        ...current,
        [column]: UNMAPPED === value ? null : Number(value),
      })),
    [],
  );

  const onDescriptionToggle = useCallback(
    (index: number, checked: boolean) =>
      setMapping((current) => ({
        ...current,
        // Kept in CSV order so the joined description reads the way the file is laid out.
        description: checked
          ? [...current.description, index].sort((a, b) => a - b)
          : current.description.filter((i) => i !== index),
      })),
    [],
  );

  const onCurrencyPick = useCallback((picked: CurrencyCode | null) => {
    if (picked) {
      setCurrency(picked);
    }
  }, []);

  const onAmountSignChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    if (isAmountSign(event.target.value)) {
      setAmountSign(event.target.value);
    }
  }, []);

  const onDateFormatChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    if (isDateFormat(event.target.value)) {
      setDateFormat(event.target.value);
    }
  }, []);

  const onPaidByChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => setPaidById(Number(event.target.value)),
    [],
  );

  const onRowToggle = useCallback(
    (lineNumber: number, included: boolean) =>
      setOverrides((current) => ({ ...current, [lineNumber]: included })),
    [],
  );

  const toExpense = useCallback(
    (row: ParsedRow, expenseDate: Date, paidBy: User) =>
      buildImportedExpense({ row, expenseDate, paidBy, members, currency, groupId }),
    [members, currency, groupId],
  );

  const onImport = useCallback(async () => {
    const paidBy = members.find((member) => member.id === paidById);

    if (!paidBy) {
      return;
    }

    const pending = selectedRows.flatMap((row) =>
      row.date ? [{ lineNumber: row.lineNumber, expense: toExpense(row, row.date, paidBy) }] : [],
    );

    if (0 === pending.length) {
      return;
    }

    let imported = 0;
    const submitted: number[] = [];
    setIsImporting(true);

    try {
      for (const batch of chunk(pending, IMPORT_BATCH_SIZE)) {
        await addExpenseMutation.mutateAsync(batch.map((item) => item.expense));
        imported += batch.length;
        submitted.push(...batch.map((item) => item.lineNumber));
        setImportedCount(imported);
      }

      toast.success(t('group_details.import_csv.messages.import_success', { count: imported }));
      router.push(`/groups/${groupId}`).catch(console.error);
    } catch (error) {
      console.error(error);
      setImportedCount(0);
      /* Saved batches stay saved. Deselected only now, not per batch, so the progress total
         holds steady while the import runs. */
      setSubmittedLines((current) => new Set([...current, ...submitted]));
      toast.error(
        0 === imported
          ? t('errors.import_failed')
          : t('group_details.import_csv.messages.import_partial', { count: imported }),
      );
    } finally {
      setIsImporting(false);
    }
  }, [members, paidById, selectedRows, toExpense, addExpenseMutation, router, groupId, t]);

  const filePicker = <FilePicker fileName={fileName} onFileChange={onFileChange} />;

  if (!fileName) {
    return (
      <>
        {filePicker}
        <p className="mt-4 text-sm text-gray-400">{t('group_details.import_csv.note')}</p>
      </>
    );
  }

  return (
    <>
      {filePicker}

      <p className="mt-8 font-semibold">{t('group_details.import_csv.columns')}</p>
      <div className="mt-2 flex flex-col gap-3">
        {SINGLE_COLUMNS.map((column) => (
          <ColumnSelect
            key={column}
            column={column}
            options={headerOptions}
            value={mapping[column]}
            onPick={onColumnPick}
          />
        ))}

        <div>
          <p className="text-sm">{t('group_details.import_csv.column_description')}</p>
          <p className="mt-1 text-xs text-gray-400">
            {t('group_details.import_csv.column_description_hint')}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {headerOptions.map((option) => (
              <DescriptionColumn
                key={option.id}
                option={option}
                checked={mapping.description.includes(option.index)}
                onToggle={onDescriptionToggle}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-8 font-semibold">{t('group_details.import_csv.options')}</p>
      <div className="mt-2 flex flex-col gap-3">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">{t('group_details.import_csv.amount_sign')}</span>
          <NativeSelect className="w-48" value={amountSign} onChange={onAmountSignChange}>
            {AMOUNT_SIGNS.map((sign) => (
              <NativeSelectOption key={sign} value={sign}>
                {t(`group_details.import_csv.amount_sign_options.${sign}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">{t('group_details.import_csv.date_format')}</span>
          <NativeSelect className="w-48" value={dateFormat} onChange={onDateFormatChange}>
            {DATE_FORMATS.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {option}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">{t('group_details.import_csv.paid_by')}</span>
          <NativeSelect className="w-48" value={paidById} onChange={onPaidByChange}>
            {members.map((member) => (
              <NativeSelectOption key={member.id} value={member.id}>
                {displayName(member, user.id)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>

        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">{t('group_details.import_csv.currency')}</span>
          <div className="w-48">
            <CurrencyPicker currentCurrency={currency} onCurrencyPick={onCurrencyPick} />
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <p className="font-semibold">{t('group_details.import_csv.preview')}</p>
        <p className="text-sm text-gray-400">
          {t('group_details.import_csv.selected', {
            selected: selectedRows.length,
            total: rows.length,
          })}
        </p>
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {rows.map((row) => (
          <PreviewRow
            key={row.lineNumber}
            row={row}
            included={isIncluded(row)}
            isDuplicate={duplicateLines.has(row.lineNumber) || submittedLines.has(row.lineNumber)}
            selectable={duplicatesChecked && !submittedLines.has(row.lineNumber)}
            amount={row.error ? row.raw.amount : toUIString(row.amount, true)}
            onToggle={onRowToggle}
          />
        ))}
      </div>

      {expensesQuery.isError ? (
        <p className="mt-6 text-center text-sm text-red-500">
          {t('group_details.import_csv.messages.duplicates_unavailable')}
        </p>
      ) : null}

      <div className="bg-background sticky bottom-0 mt-6 flex justify-center py-4">
        <Button
          className="w-full max-w-sm"
          disabled={isImporting || !duplicatesChecked || 0 === selectedRows.length}
          onClick={onImport}
        >
          {isImporting ? (
            <>
              <LoadingSpinner className="mr-2 size-4" />
              {t('group_details.import_csv.importing', {
                done: importedCount,
                total: selectedRows.length,
              })}
            </>
          ) : (
            t('actions.import')
          )}
        </Button>
      </div>
    </>
  );
};

interface HeaderOption {
  id: string;
  header: string;
  index: number;
}

const DescriptionColumn: React.FC<{
  option: HeaderOption;
  checked: boolean;
  onToggle: (index: number, checked: boolean) => void;
}> = ({ option, checked, onToggle }) => {
  const onCheckedChange = useCallback(
    (state: boolean | 'indeterminate') => onToggle(option.index, true === state),
    [option.index, onToggle],
  );

  return (
    <label className="flex cursor-pointer items-center gap-2">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      <span className="text-sm">{option.header}</span>
    </label>
  );
};

const ColumnSelect: React.FC<{
  column: CsvColumn;
  options: HeaderOption[];
  value: number | null;
  onPick: (column: CsvColumn, value: string) => void;
}> = ({ column, options, value, onPick }) => {
  const { t } = useTranslationWithUtils();

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => onPick(column, event.target.value),
    [column, onPick],
  );

  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-sm">{t(`group_details.import_csv.column_${column}`)}</span>
      <NativeSelect className="w-48" value={value ?? UNMAPPED} onChange={onChange}>
        <NativeSelectOption value={UNMAPPED}>
          {t('group_details.import_csv.column_unmapped')}
        </NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option.id} value={option.index}>
            {option.header}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
};

const PreviewRow: React.FC<{
  row: ParsedRow;
  included: boolean;
  isDuplicate: boolean;
  /** False until duplicates can be checked, so a row cannot be picked on incomplete information. */
  selectable: boolean;
  amount: string;
  onToggle: (lineNumber: number, included: boolean) => void;
}> = ({ row, included, isDuplicate, selectable, amount, onToggle }) => {
  const { t, toUIDate } = useTranslationWithUtils();

  const onCheckedChange = useCallback(
    (checked: boolean | 'indeterminate') => onToggle(row.lineNumber, true === checked),
    [row.lineNumber, onToggle],
  );

  const label = row.name || t('group_details.import_csv.no_name');

  const note = [
    row.date ? toUIDate(row.date, { year: true }) : row.raw.date,
    row.error && t(`group_details.import_csv.row_errors.${row.error}`),
    !row.error && 0n > row.amount && t('group_details.import_csv.received'),
    !row.error && isDuplicate && t('group_details.import_csv.already_in_group'),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox
            aria-label={t('group_details.import_csv.select_row', {
              line: row.lineNumber,
              name: label,
            })}
            checked={included}
            disabled={!selectable || Boolean(row.error)}
            onCheckedChange={onCheckedChange}
          />
          <CategoryIcon category={row.category} size={16} className="shrink-0 text-gray-400" />
          <div className="min-w-0">
            <p className="truncate">{label}</p>
            <p className="text-xs text-gray-400">{note}</p>
          </div>
        </div>
        <p
          className={cn(
            'shrink-0 text-sm',
            row.error ? 'text-gray-400' : 0n > row.amount ? 'text-green-500' : '',
          )}
        >
          {amount}
        </p>
      </div>
      <Separator className="last:hidden" />
    </>
  );
};

const FilePicker: React.FC<{
  fileName: string | null;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}> = ({ fileName, onFileChange }) => {
  const { t } = useTranslationWithUtils();

  return (
    <label htmlFor="expenses-csv" className="mt-4 flex w-full cursor-pointer rounded border">
      <div className="flex cursor-pointer px-3 py-[6px]">
        <div className="flex items-center border-r pr-4">
          <PaperClipIcon className="mr-2 h-4 w-4" />
          <span className="hidden text-sm md:block">
            {t('group_details.import_csv.choose_file')}
          </span>
        </div>
        <div className="truncate pl-4 text-gray-400">
          {fileName ?? t('group_details.import_csv.no_file_chosen')}
        </div>
      </div>
      <Input
        onChange={onFileChange}
        id="expenses-csv"
        type="file"
        accept=".csv,text/csv"
        className="hidden"
      />
    </label>
  );
};
