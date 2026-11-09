import { describe, it, expect } from 'vitest';
import * as zlib from 'zlib';
import { buildXlsx, columnName, crc32, excelDate, toArgb, type XlsxTable } from '../xlsx-writer';

/** Reads every entry of a zip through its central directory, checking CRCs. */
function unzip(buf: Buffer): Map<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocd).toBeGreaterThan(0);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + csize));
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString('utf8'));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const table: XlsxTable = {
  headers: ['main', 'feature', 'Tag', 'Description', 'Author', 'SHA', 'Date'],
  rows: [
    ['●', '', 'v1.0', 'Merge <feature> & "x"', 'Alice', 'a1b2c3d', '2026-11-08 12:34'],
    ['│', '●', '', 'Add parser', 'Bob', 'e4f5a6b', '2026-11-07 09:00'],
  ],
  laneColors: ['#63b0f4', '#ff4d4f'],
  dateColumn: 6,
};

describe('xlsx helpers', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('names columns like Excel', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('converts hex colors to ARGB', () => {
    expect(toArgb('#63b0f4')).toBe('FF63B0F4');
    expect(toArgb('#abc')).toBe('FFAABBCC');
    expect(toArgb('#11223344')).toBe('FF112233');
    expect(toArgb('red')).toBeNull();
  });

  it('converts dates to Excel serials', () => {
    expect(excelDate('1970-01-01 00:00')).toBe(25569);
    expect(excelDate('2026-11-08 12:00')).toBeCloseTo(46334.5, 6);
    expect(excelDate('n/a')).toBeNull();
  });
});

describe('buildXlsx', () => {
  const files = unzip(buildXlsx(table));
  const sheet = files.get('xl/worksheets/sheet1.xml')!;
  const styles = files.get('xl/styles.xml')!;

  it('contains the minimal workbook parts', () => {
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
      'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
    ]);
  });

  it('writes escaped inline strings', () => {
    expect(sheet).toContain('<c r="D4" t="inlineStr"><is><t xml:space="preserve">Merge &lt;feature&gt; &amp; &quot;x&quot;</t></is></c>');
  });

  it('stores the date column as numbers with a date format', () => {
    expect(sheet).toMatch(/<c r="G4" s="2"><v>46334\.52361\d*<\/v><\/c>/);
    expect(styles).toContain('formatCode="yyyy\\-mm\\-dd\\ hh:mm"');
  });

  it('puts branch names on staircase title rows colored to the right', () => {
    // xf 5/6 = main lane cell / name, xf 7/8 = feature lane cell / name
    expect(sheet).toContain('<c r="A1" s="6" t="inlineStr"><is><t xml:space="preserve">main</t>');
    expect(sheet).toContain('<c r="G1" s="6"/>');
    expect(sheet).toContain('<c r="A2" s="5"/>');
    expect(sheet).toContain('<c r="B2" s="8" t="inlineStr"><is><t xml:space="preserve">feature</t>');
    expect(sheet).toContain('<c r="G2" s="8"/>');
    expect(styles).toContain('<alignment horizontal="left"/>');
  });

  it('puts the table header after the title rows, lanes colored and empty', () => {
    expect(sheet).toContain('<row r="3"><c r="A3" s="5"/><c r="B3" s="7"/><c r="C3" s="1" t="inlineStr"><is><t xml:space="preserve">Tag</t>');
  });

  it('colors lane columns all the way down, marked or not', () => {
    expect(styles).toContain('<fgColor rgb="FF63B0F4"/>');
    expect(styles).toContain('<fgColor rgb="FFFF4D4F"/>');
    expect(sheet).toContain('<c r="A4" s="5" t="inlineStr"><is><t xml:space="preserve">●</t>');
    expect(sheet).toContain('<c r="B4" s="7"/>');
    expect(sheet).toContain('<c r="A5" s="5" t="inlineStr"><is><t xml:space="preserve">│</t>');
    expect(sheet).toContain('<c r="B5" s="7" t="inlineStr"><is><t xml:space="preserve">●</t>');
    expect(sheet).toContain('<col min="1" max="1" width="3" customWidth="1"/>');
  });

  it('filters from the header row and freezes titles, header and lanes', () => {
    expect(sheet).toContain('<autoFilter ref="A3:G5"/>');
    expect(sheet).toContain('<pane xSplit="2" ySplit="3" topLeftCell="C4" activePane="bottomRight" state="frozen"/>');
    expect(files.get('xl/workbook.xml')).toContain("'Commits'!$A$3:$G$5");
  });

  it('stores line counts as numbers and shades commit lines in the detailed export', () => {
    const detailed = unzip(buildXlsx({
      headers: ['main', 'Tag', 'Description', 'Author', 'SHA', 'Date', 'File', 'Additions', 'Deletions'],
      rows: [
        ['●', '', 'Add parser', 'Bob', 'e4f5a6b', '2026-11-07 09:00', '', '12', '3'],
        ['│', '', '', '', '', '', 'src/parser.ts', '12', '3'],
        ['│', '', '', '', '', '', 'logo.png', '-', '-'],
      ],
      laneColors: ['#63b0f4'],
      dateColumn: 5,
      numberColumns: [7, 8],
      fileRows: [false, true, true],
    })).get('xl/worksheets/sheet1.xml')!;
    expect(detailed).toContain('<c r="C3" s="3" t="inlineStr">'); // commit line: bold + shade
    expect(detailed).toContain('<c r="F3" s="4"><v>');            // commit-line date
    expect(detailed).toContain('<c r="H3" s="3"><v>12</v></c>');  // total as number
    expect(detailed).toContain('<c r="H4"><v>12</v></c>');        // file count as number
    expect(detailed).toContain('<c r="G4" t="inlineStr"><is><t xml:space="preserve">src/parser.ts</t>');
    expect(detailed).toContain('<c r="H5" t="inlineStr"><is><t xml:space="preserve">-</t>'); // binary
  });
});
