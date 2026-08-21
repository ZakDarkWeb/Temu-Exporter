(() => {
  'use strict';

  const MAIN_COLUMNS = [
    'Shipping Date',
    'Order Date',
    'Tracking Number',
    'Order No',
    'Customer Name',
    'Product Details',
    'Qty (No)',
    'Est. Revenue',
    'Shipping Cost'
  ];

  const ERROR_COLUMNS = ['Time', 'Order No', 'Package ID', 'Attempts', 'Error'];
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function colLetter(index) {
    let result = '';
    let value = index + 1;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      result = LETTERS[remainder] + result;
      value = Math.floor((value - 1) / 26);
    }
    return result;
  }

  function asNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function dateOnly(value) {
    const text = String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const monthDate = text.match(/^(.+?,\s*\d{4})/);
    if (monthDate) return monthDate[1].trim();
    const isoDate = text.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate) return isoDate[1];
    const beforeTime = text.match(/^(.+?)(?=,?\s+\d{1,2}:\d{2}\s*(?:am|pm)?\b)/i);
    return beforeTime ? beforeTime[1].replace(/,\s*$/, '').trim() : text;
  }

  function cellXml(rowNumber, columnIndex, value, numeric = false, style = 0) {
    const reference = `${colLetter(columnIndex)}${rowNumber}`;
    if (value === null || value === undefined || String(value).trim() === '') return `<c r="${reference}" s="${style}"/>`;
    if (numeric) {
      const number = asNumber(value);
      if (number !== null) return `<c r="${reference}" s="${style}" t="n"><v>${number}</v></c>`;
    }
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }

  function makeSheetXml(records, errors) {
    const rows = [];
    rows.push(`<row r="1">${MAIN_COLUMNS.map((column, index) => cellXml(1, index, column, false, 1)).join('')}</row>`);
    records.forEach((record, recordIndex) => {
      const rowNumber = recordIndex + 2;
      const values = [
        record['Shipping Date'],
        record['Order Date'],
        record['Tracking Number'],
        record['Order No'],
        record['Customer Name'],
        record['Product Details'],
        record['Qty (No)'],
        record['Est. Revenue'],
        record['Shipping Cost']
      ];
      const numericIndexes = new Set([6, 7, 8]);
      rows.push(`<row r="${rowNumber}">${values.map((value, index) => {
        const normalizedValue = index < 2 ? dateOnly(value) : value;
        const style = index === 6 ? 3 : (numericIndexes.has(index) ? 2 : 0);
        return cellXml(rowNumber, index, normalizedValue, numericIndexes.has(index), style);
      }).join('')}</row>`);
    });
    const lastRow = Math.max(records.length + 1, 1);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:I${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>
    <col min="1" max="1" width="22" customWidth="1"/>
    <col min="2" max="2" width="22" customWidth="1"/>
    <col min="3" max="3" width="25" customWidth="1"/>
    <col min="4" max="4" width="25" customWidth="1"/>
    <col min="5" max="5" width="22" customWidth="1"/>
    <col min="6" max="6" width="58" customWidth="1"/>
    <col min="7" max="7" width="12" customWidth="1"/>
    <col min="8" max="8" width="16" customWidth="1"/>
    <col min="9" max="9" width="16" customWidth="1"/>
  </cols>
  <sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A1:I${lastRow}"/>
  <tableParts count="1"><tablePart r:id="rId1"/></tableParts>
</worksheet>`;
  }

  function makeErrorsSheetXml(errors) {
    const rows = [];
    rows.push(`<row r="1">${ERROR_COLUMNS.map((column, index) => cellXml(1, index, column, false, 1)).join('')}</row>`);
    if (!errors.length) {
      rows.push(`<row r="2">${cellXml(2, 0, 'Completed without extraction errors', false, 0)}</row>`);
    } else {
      errors.forEach((error, index) => {
        const rowNumber = index + 2;
        const values = [error.at || new Date().toISOString(), error.orderNo || '', error.packageId || '', error.attempts || '', error.message || ''];
        rows.push(`<row r="${rowNumber}">${values.map((value, column) => cellXml(rowNumber, column, value, column === 3, column === 3 ? 3 : 0)).join('')}</row>`);
      });
    }
    const lastRow = Math.max(errors.length + 1, 2);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:E${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="25" customWidth="1"/><col min="3" max="3" width="28" customWidth="1"/><col min="4" max="4" width="12" customWidth="1"/><col min="5" max="5" width="70" customWidth="1"/></cols>
  <sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A1:E${lastRow}"/>
</worksheet>`;
  }

  function makeTableXml(records) {
    const lastRow = Math.max(records.length + 1, 1);
    const columns = MAIN_COLUMNS.map((column, index) => `<tableColumn id="${index + 1}" name="${xmlEscape(column)}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="TemuOrders" displayName="TemuOrders" ref="A1:I${lastRow}" headerRowCount="1" totalsRowCount="0"><autoFilter ref="A1:I${lastRow}"/><tableColumns count="9">${columns}</tableColumns><tableStyleInfo name="TableStyleMedium4" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
  }

  function makeStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.00"/></numFmts>
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00B050"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1" xfId="0"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" applyNumberFormat="1" xfId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function u16(value) { return [value & 255, (value >>> 8) & 255]; }
  function u32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
  function concat(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { output.set(part, offset); offset += part.length; }
    return output;
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = crc32(data);
      const localHeader = new Uint8Array([
        ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)
      ]);
      localParts.push(localHeader, name, data);
      const centralHeader = new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
      ]);
      centralParts.push(centralHeader, name);
      offset += localHeader.length + name.length + data.length;
    }
    const centralDirectory = concat(centralParts);
    const localDirectory = concat(localParts);
    const end = new Uint8Array([
      ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
      ...u32(centralDirectory.length), ...u32(localDirectory.length), ...u16(0)
    ]);
    return concat([localDirectory, centralDirectory, end]);
  }

  function buildWorkbook(records, errors) {
    const files = [
      { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
      { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
      { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Temu Order Exporter</dc:creator><cp:lastModifiedBy>Temu Order Exporter</cp:lastModifiedBy><dc:title>Temu Order Export</dc:title></cp:coreProperties>` },
      { name: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Temu Order Exporter</Application></Properties>` },
      { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Orders" sheetId="1" r:id="rId1"/><sheet name="Extraction Status" sheetId="2" r:id="rId2"/></sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/worksheets/sheet1.xml', content: makeSheetXml(records, errors) },
      { name: 'xl/worksheets/sheet2.xml', content: makeErrorsSheetXml(errors) },
      { name: 'xl/worksheets/_rels/sheet1.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/></Relationships>` },
      { name: 'xl/tables/table1.xml', content: makeTableXml(records) },
      { name: 'xl/styles.xml', content: makeStylesXml() }
    ];
    return zipStore(files);
  }

  function downloadWorkbook(records, errors) {
    const bytes = buildWorkbook(records || [], errors || []);
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `temu-orders-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  window.TemuXlsx = { MAIN_COLUMNS, ERROR_COLUMNS, buildWorkbook, downloadWorkbook };
})();
