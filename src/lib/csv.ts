/**
 * Minimal RFC 4180 CSV reader.
 *
 * Supports quoted fields containing separators, newlines and escaped (`""`) quotes,
 * both LF and CRLF line endings, and a leading byte order mark. Fully blank lines
 * are dropped, so trailing newlines do not produce empty records.
 */
export const parseCsv = (text: string): { headers: string[]; rows: string[][] } => {
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text;

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;

  const endField = () => {
    record.push(field);
    field = '';
  };

  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  while (index < input.length) {
    const char = input[index]!;

    if (quoted) {
      if ('"' !== char) {
        field += char;
        index += 1;
      } else if ('"' === input[index + 1]) {
        // An escaped quote inside a quoted field.
        field += '"';
        index += 2;
      } else {
        quoted = false;
        index += 1;
      }
    } else if ('"' === char && '' === field) {
      quoted = true;
      index += 1;
    } else if (',' === char) {
      endField();
      index += 1;
    } else if ('\n' === char || '\r' === char) {
      endRecord();
      index += '\r' === char && '\n' === input[index + 1] ? 2 : 1;
    } else {
      field += char;
      index += 1;
    }
  }

  if ('' !== field || 0 < record.length) {
    endRecord();
  }

  const [headers = [], ...rows] = records.filter((r) => r.some((f) => '' !== f.trim()));

  return { headers: headers.map((h) => h.trim()), rows };
};
