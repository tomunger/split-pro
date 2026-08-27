import { parseCsv } from '~/lib/csv';

describe('parseCsv', () => {
  it('should split a plain record into fields', () => {
    const { headers, rows } = parseCsv('a,b,c\n1,2,3\n');

    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([['1', '2', '3']]);
  });

  it('should keep separators inside quoted fields', () => {
    const { rows } = parseCsv('a,b\n"Smith, John",5\n');

    expect(rows).toEqual([['Smith, John', '5']]);
  });

  it('should unescape doubled quotes', () => {
    const { rows } = parseCsv('a\n"He said ""hi"""\n');

    expect(rows).toEqual([['He said "hi"']]);
  });

  it('should keep newlines inside quoted fields', () => {
    const { rows } = parseCsv('a,b\n"line one\nline two",5\n');

    expect(rows).toEqual([['line one\nline two', '5']]);
  });

  it('should handle CRLF endings and a byte order mark', () => {
    const { headers, rows } = parseCsv('\uFEFFa,b\r\n1,2\r\n');

    expect(headers).toEqual(['a', 'b']);
    expect(rows).toEqual([['1', '2']]);
  });

  it('should drop blank lines rather than emit empty records', () => {
    const { rows } = parseCsv('a,b\n1,2\n\n\n');

    expect(rows).toEqual([['1', '2']]);
  });

  it('should preserve empty fields between separators', () => {
    const { rows } = parseCsv('a,b,c\n1,,3\n');

    expect(rows).toEqual([['1', '', '3']]);
  });

  it('should return nothing for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
  });
});
