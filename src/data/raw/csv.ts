/**
 * A small RFC-4180 CSV parser.
 *
 * The mock source files contain quoted fields with embedded commas (budget revision reasons, PM forecast
 * comments, reference-file notes), so `line.split(',')` would silently corrupt them. Keeping our own parser
 * avoids a dependency for ~60 lines of well-understood code.
 *
 * Handles: quoted fields, embedded commas, embedded newlines, escaped quotes (`""`), CRLF and LF line
 * endings, a UTF-8 BOM, and a trailing newline.
 *
 * This module is the bottom of the stack. It knows about text, not about invoices.
 */

/** Parse CSV text into rows of raw string cells. Returns `[]` for empty input. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (src.length === 0) return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = (): void => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = (): void => {
    endField();
    // Skip a blank trailing line, but keep genuinely empty quoted rows.
    if (row.length === 1 && row[0] === '' && !fieldWasQuoted) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r') {
      // CRLF: the \n handles the row break. A lone CR also ends a row.
      if (src[i + 1] !== '\n') endRow();
    } else {
      field += ch;
    }
  }

  // Final row without a trailing newline.
  if (field !== '' || fieldWasQuoted || row.length > 0) endRow();

  return rows;
}

/**
 * Parse CSV text into objects keyed by the header row.
 *
 * Short rows yield `''` for missing trailing columns rather than `undefined`, so downstream field access is
 * total. Extra columns beyond the header are dropped.
 */
export function parseCsvRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) return [];

  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      record[header[i]!] = cells[i] ?? '';
    }
    return record;
  });
}
