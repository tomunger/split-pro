# CSV IMPORT

SplitPro can import a group's expenses in bulk from a CSV file, for example a monthly export from
a bank or a personal finance app. No configuration or external service is required.

## How to use it

1. Open a group, then the group info drawer (the ⓘ icon).
2. Under **Actions**, choose **Import expenses from CSV**.
3. Pick the file. SplitPro reads the header row and guesses which columns hold the date,
   the description and the amount.
4. Check the options and the preview, then import.

## What gets created

Every selected row becomes one expense in the group:

- Split **equally** between all group members.
- Paid by whoever is selected in **Paid by** (the importing user by default).
- Categorised from the file's own category column where it can be matched, and **General** otherwise.
- Dated from the file's date column.

Imported expenses are ordinary expenses. Nothing about them is special afterwards, and each one can
be edited or deleted individually.

## Columns

Columns are mapped into SplitPro's Date, Description, and Amount. The import operation attempts
to recognize the appropriate columns.

| Role                      | Recognised header names                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| Date                      | `Transaction Date`, `Date`, `Posted`, `Day`                                                     |
| Description (one or more) | `Payee`, `Description`, `Merchant`, `Narrative`, `Details`, `Note`, `Memo`, `Reference`, `Name` |
| Amount                    | `Amount`, `Value`, `Debit`, `Total`, `Sum`                                                      |

Detection is case-insensitive and matches substrings, so `Transaction Payee` is recognised as the
description. Whatever is detected can be changed, so a file with unrecognised headers still works.

### Combining columns into the description

A SplitPro expense has a single description, but exports often spread it over several fields --
a payee plus a note, or a merchant plus a memo. **Description takes any number of columns**, chosen
with tick boxes rather than a dropdown. Every matching column is ticked automatically, and you can
add or remove any of them.

Ticked columns are joined in CSV order, separated by `-`. Columns that are blank on a given row
are skipped, so a mostly-empty note column costs nothing:

| Payee                | Note          | Imported description               |
| -------------------- | ------------- | ---------------------------------- |
| `Whole Foods Market` | `weekly shop` | `Whole Foods Market - weekly shop` |
| `Haggen`             |               | `Haggen`                           |

A row where every ticked column is blank is flagged as missing a description and cannot be
selected.

## Categories

SplitPro has a fixed category list, so the file's own categories are matched onto it. The value is
tried whole first, then split on `:`, `.` and `-` and each part tried in turn. A specific item beats
a broad section, and anything unrecognised falls back to **General** rather than failing the row.

| In the file              | Imported as                                          |
| ------------------------ | ---------------------------------------------------- |
| `Food:Groceries`         | Groceries                                            |
| `Pets:Pet Supplies`      | Pets                                                 |
| `Utilities`              | Utilities                                            |
| `Utilities:Web Services` | Utilities (the leaf is unknown, the section matches) |
| `Dining-Out`             | Dining Out (matched before splitting)                |
| `Widgets`                | General                                              |

Matching ignores case, spaces and punctuation, so `Dining Out`, `dining-out` and `diningOut` all
resolve to the same category. The preview shows each row's resolved category as an icon, so a file
whose categories do not match is obvious before you import.

Leave the category column unmapped to file everything under General.

## Amount sign and money received

Exports disagree about which side of zero means spending. The **Amount sign** option says which
convention the file uses:

- **Expenses are negative** — `-$118.24` is money spent. This is the common bank convention.
- **Expenses are positive** — `118.24` is money spent.

Rows with the **opposite** sign are money received — a refund, a rebate, a reimbursement — and are
imported as negative expenses, which move balances the other way. They are labelled `Received` in
the preview.

Getting this option backwards is not silent: every row flips between expense and received in the
preview before anything is written.

## Dates

The date layout is detected from the file and can be overridden. `7/27/26` is unambiguously
month-first because 27 cannot be a month; a file where every row is ambiguous (`7/5/26`) defaults to
month-first, so check the preview if your export is day-first.

Month names are matched in English only. For other languages, export dates in a numeric or ISO
format.

## Duplicates

Re-importing a file you have already imported is an easy mistake to make with a monthly workflow.
Rows matching an existing expense in the group on **date, amount, description and currency** are
labelled `Already in group` and start unselected. This is advisory — you can select them anyway.

## Amount format

Currency symbols and thousands separators are stripped, so `-$1,234.56` reads correctly. Numbers are
interpreted using the **separators of your app language**: with English selected, `1.234,56` is not
read as 1234.56. The preview shows the parsed value, so a mismatch is visible before importing.

Any other character makes the amount unreadable, so a typo like `1O.00` is flagged rather than
imported as 1.00. The selected currency's code is allowed, as in `USD 12.00`.

Accounting-style parentheses for negatives (`(118.24)`) are not recognised as a sign; such a value
reads as positive. Export plain signed numbers instead.

One currency applies to the whole import; there is no per-row currency column.

## File format

Standard RFC 4180 CSV:

- Comma separated, first line is the header.
- Fields may be quoted; quoted fields may contain commas, newlines and `""`-escaped quotes.
- LF and CRLF line endings are both accepted, as is a leading byte order mark.
- Blank lines are ignored.

Rows that cannot be used are listed in the preview with a reason (unreadable date, unreadable
amount, zero amount, missing description) and cannot be selected.

## Example

```csv
Date,Chk #,Transaction Payee,Note,Account,Category,Amount
7/27/26,0,Whole Foods Market,,Apple Card,Food:Groceries,-$118.24
7/28/26,0,Haggen,,Apple Card,Food:Groceries,-$30.04
7/13/26,0,Payment to xfinity,,Checking (0967),Utilities,-$55.00
8/2/26,0,Utility rebate,,Checking (0967),Utilities,$40.00
```

With **Expenses are negative**, the first three rows import as expenses and the rebate imports as
money received.
