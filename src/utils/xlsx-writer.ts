import * as zlib from 'zlib';

/**
 * Minimal, dependency-free .xlsx writer for the graph selection export.
 *
 * Produces a single-sheet workbook with inline strings (no shared-string
 * table): bold frozen header with an autofilter, column widths fitted to the
 * content, lane columns colored with their graph color, and an optional column
 * of `YYYY-MM-DD HH:MM` strings stored as real Excel dates.
 */
export interface XlsxTable {
  headers: string[];
  rows: string[][];
  /** Colors (`#rgb`/`#rrggbb`/`#rrggbbaa`) of the first `laneColors.length` columns. */
  laneColors: string[];
  /** Index of a column holding `YYYY-MM-DD HH:MM` values to store as dates. */
  dateColumn?: number;
  /** Columns whose numeric values are stored as numbers. */
  numberColumns?: number[];
  /** Detailed export: true for file lines. Commit lines are then shaded and
   *  bold so each commit stands out above its files. */
  fileRows?: boolean[];
  sheetName?: string;
}

// ── Zip (stored + deflate, no zip64) ──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // Fixed DOS timestamp (1980-01-01 00:00) keeps the output deterministic.
  const dosTime = 0;
  const dosDate = (1 << 5) | 1;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const deflated = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + deflated.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

// ── Spreadsheet XML ──

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function xmlEscape(s: string): string {
  // Drop characters XML 1.0 forbids, then escape markup.
  return s
    .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 0 → A, 25 → Z, 26 → AA … */
export function columnName(index: number): string {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** `#rgb` / `#rrggbb` / `#rrggbbaa` → `FFRRGGBB` (ARGB), or null if not a hex color. */
export function toArgb(color: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  return ('FF' + hex.slice(0, 6)).toUpperCase();
}

/** Black or white text, whichever reads better on the given ARGB fill. */
function contrastFont(argb: string): string {
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'FF000000' : 'FFFFFFFF';
}

/** `YYYY-MM-DD HH:MM` → Excel serial date (1900 system), or null. */
export function excelDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  return ms / 86400000 + 25569; // days since 1899-12-30
}

export function buildXlsx(table: XlsxTable): Buffer {
  const laneCount = table.laneColors.length;
  const colCount = table.headers.length;

  // Styles: per distinct lane color a solid fill (commit cell / lane header)
  // and a colored font (passing-lane cell).
  const colorIndex = new Map<string, number>();
  const laneArgb = table.laneColors.map(c => toArgb(c) ?? 'FF888888');
  for (const argb of laneArgb) if (!colorIndex.has(argb)) colorIndex.set(argb, colorIndex.size);
  const colors = [...colorIndex.keys()];

  // fonts: 0 default, 1 bold, then per color: [bold contrast-on-fill, bold lane color]
  const fonts = [
    '<font><sz val="11"/><name val="Calibri"/></font>',
    '<font><b/><sz val="11"/><name val="Calibri"/></font>',
    ...colors.flatMap(c => [
      `<font><b/><sz val="11"/><color rgb="${contrastFont(c)}"/><name val="Calibri"/></font>`,
      `<font><b/><sz val="11"/><color rgb="${c}"/><name val="Calibri"/></font>`,
    ]),
  ];
  // fills: 0 none, 1 gray125 (both required), 2 header gray, 3 commit-line
  // shade, then one per color
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>',
    ...colors.map(c => `<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`),
  ];
  const center = '<alignment horizontal="center"/>';
  // cellXfs: 0 default, 1 header, 2 date, 3 commit line, 4 commit-line date,
  // then per color: [filled, passing]
  const XF_HEADER = 1;
  const XF_DATE = 2;
  const XF_COMMIT = 3;
  const XF_COMMIT_DATE = 4;
  const XF_LANES = 5;
  const xfs = [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>',
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
    '<xf numFmtId="164" fontId="1" fillId="3" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>',
    ...colors.flatMap((_, i) => [
      `<xf numFmtId="0" fontId="${2 + 2 * i}" fillId="${4 + i}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">${center}</xf>`,
      `<xf numFmtId="0" fontId="${3 + 2 * i}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">${center}</xf>`,
    ]),
  ];
  const xfFilled = (lane: number) => XF_LANES + 2 * colorIndex.get(laneArgb[lane])!;
  const xfPassing = (lane: number) => xfFilled(lane) + 1;

  const styles = XML_HEAD +
    `<styleSheet xmlns="${NS_MAIN}">` +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>' +
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
    `<fills count="${fills.length}">${fills.join('')}</fills>` +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const str = (ref: string, v: string, s: number) =>
    v === ''
      ? (s ? `<c r="${ref}" s="${s}"/>` : '')
      : `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;

  const sheetRows: string[] = [];
  sheetRows.push(
    `<row r="1">${table.headers
      .map((h, c) => str(`${columnName(c)}1`, h, c < laneCount ? xfFilled(c) : XF_HEADER))
      .join('')}</row>`,
  );
  const numberCols = new Set(table.numberColumns ?? []);
  const detailed = (table.fileRows ?? []).some(Boolean);
  table.rows.forEach((row, i) => {
    const r = i + 2;
    // In the detailed export, commit lines are shaded/bold above their files.
    const shaded = detailed && !table.fileRows![i];
    const text = shaded ? XF_COMMIT : 0;
    const cells = row.map((v, c) => {
      const ref = `${columnName(c)}${r}`;
      if (c < laneCount) {
        if (v === '') return '';
        // '●' marks the commit's own lane, anything else a lane passing through.
        return str(ref, v, v === '●' ? xfFilled(c) : xfPassing(c));
      }
      if (c === table.dateColumn) {
        const serial = excelDate(v);
        if (serial !== null) return `<c r="${ref}" s="${shaded ? XF_COMMIT_DATE : XF_DATE}"><v>${serial}</v></c>`;
      }
      if (numberCols.has(c) && /^\d+$/.test(v)) {
        return `<c r="${ref}"${text ? ` s="${text}"` : ''}><v>${v}</v></c>`;
      }
      return str(ref, v, text);
    });
    sheetRows.push(`<row r="${r}">${cells.join('')}</row>`);
  });

  // Width ≈ longest value (in characters) + padding, capped.
  const widths = table.headers.map((h, c) => {
    let w = h.length;
    for (const row of table.rows) w = Math.max(w, (row[c] ?? '').length);
    if (c === table.dateColumn) w = Math.max(w, 16);
    return Math.min(Math.max(w + 2, c < laneCount ? 4 : 8), 80);
  });
  const cols = widths
    .map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`)
    .join('');

  const lastRef = `${columnName(Math.max(colCount - 1, 0))}${table.rows.length + 1}`;
  const sheet = XML_HEAD +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<dimension ref="A1:${lastRef}"/>` +
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
    '</sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<cols>${cols}</cols>` +
    `<sheetData>${sheetRows.join('')}</sheetData>` +
    `<autoFilter ref="A1:${lastRef}"/>` +
    '</worksheet>';

  // Sheet names: max 31 chars, none of []:*?/\
  const sheetName = xmlEscape((table.sheetName ?? 'Commits').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Commits');
  const workbook = XML_HEAD +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>` +
    '<definedNames>' +
    `<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$1:$${columnName(Math.max(colCount - 1, 0))}$${table.rows.length + 1}</definedName>` +
    '</definedNames>' +
    '</workbook>';

  const contentTypes = XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  const rootRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  const workbookRels = XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  const b = (s: string) => Buffer.from(s, 'utf8');
  return zip([
    { name: '[Content_Types].xml', data: b(contentTypes) },
    { name: '_rels/.rels', data: b(rootRels) },
    { name: 'xl/workbook.xml', data: b(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: b(workbookRels) },
    { name: 'xl/styles.xml', data: b(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: b(sheet) },
  ]);
}
