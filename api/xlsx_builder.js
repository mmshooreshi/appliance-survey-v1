// api/xlsx_builder.js
// Ultra-lightweight zero-dependency OpenXML Spreadsheet (.xlsx) generator for Node.js / Vercel Serverless.
// Uses Node built-in 'zlib' to generate valid OpenXML ZIP archives.

import zlib from 'zlib';

// Standard CRC32 table
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    crcTable[i] = c;
}

function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Convert column index (0-based) to Excel column letters (0 -> A, 27 -> AB)
function colLetter(colIdx) {
    let letter = '';
    let temp = colIdx;
    while (temp >= 0) {
        letter = String.fromCharCode((temp % 26) + 65) + letter;
        temp = Math.floor(temp / 26) - 1;
    }
    return letter;
}

// Escape XML special characters
function escapeXML(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Low-overhead standard ZIP builder
function buildZip(files) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const f of files) {
        const dataBuf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
        const nameBuf = Buffer.from(f.name, 'utf8');
        const crc = crc32(dataBuf);
        const uncompressedSize = dataBuf.length;
        const deflated = zlib.deflateRawSync(dataBuf);
        const compressedSize = deflated.length;

        // Local header (30 bytes + nameBuf.length)
        const lh = Buffer.alloc(30 + nameBuf.length);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);
        lh.writeUInt16LE(0, 6);
        lh.writeUInt16LE(8, 8); // deflate
        lh.writeUInt16LE(0, 10);
        lh.writeUInt16LE(0, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(compressedSize, 18);
        lh.writeUInt32LE(uncompressedSize, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        lh.writeUInt16LE(0, 28);
        nameBuf.copy(lh, 30);

        localHeaders.push(lh, deflated);

        // Central directory header (46 bytes + nameBuf.length)
        const ch = Buffer.alloc(46 + nameBuf.length);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4);
        ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0, 8);
        ch.writeUInt16LE(8, 10);
        ch.writeUInt16LE(0, 12);
        ch.writeUInt16LE(0, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(compressedSize, 20);
        ch.writeUInt32LE(uncompressedSize, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt16LE(0, 30);
        ch.writeUInt16LE(0, 32);
        ch.writeUInt16LE(0, 34);
        ch.writeUInt16LE(0, 36);
        ch.writeUInt32LE(0, 38);
        ch.writeUInt32LE(offset, 42);
        nameBuf.copy(ch, 46);

        centralHeaders.push(ch);
        offset += lh.length + deflated.length;
    }

    const centralDirOffset = offset;
    let centralDirSize = 0;
    for (const ch of centralHeaders) centralDirSize += ch.length;

    // End of central directory (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDirSize, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

/**
 * Builds an Excel (.xlsx) file Buffer from one or more sheets.
 * @param {Array<{ name: string, headers: string[], rows: any[][] }>} sheets
 * @returns {Buffer} XLSX file buffer
 */
export function buildXLSX(sheets) {
    if (!Array.isArray(sheets) || sheets.length === 0) {
        sheets = [{ name: 'Sheet1', headers: ['No Data'], rows: [] }];
    }

    const files = [];

    // 1. [Content_Types].xml
    let ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
             `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
             `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
             `  <Default Extension="xml" ContentType="application/xml"/>\n` +
             `  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n` +
             `  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n`;

    sheets.forEach((_, idx) => {
        ct += `  <Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n`;
    });
    ct += `</Types>`;
    files.push({ name: '[Content_Types].xml', data: ct });

    // 2. _rels/.rels
    files.push({
        name: '_rels/.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
              `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
              `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n` +
              `</Relationships>`
    });

    // 3. xl/_rels/workbook.xml.rels
    let wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
                 `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
                 `  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n`;
    sheets.forEach((_, idx) => {
        wbRels += `  <Relationship Id="rIdSheet${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>\n`;
    });
    wbRels += `</Relationships>`;
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: wbRels });

    // 4. xl/styles.xml (Simple BMJ Navy Header Style: style index 1)
    files.push({
        name: 'xl/styles.xml',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
              `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n` +
              `  <fonts count="2">\n` +
              `    <font><name val="Calibri"/><sz val="11"/></font>\n` +
              `    <font><b/><name val="Calibri"/><sz val="11"/><color rgb="FFFFFFFF"/></font>\n` +
              `  </fonts>\n` +
              `  <fills count="3">\n` +
              `    <fill><patternFill patternType="none"/></fill>\n` +
              `    <fill><patternFill patternType="gray125"/></fill>\n` +
              `    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/></patternFill></fill>\n` +
              `  </fills>\n` +
              `  <borders count="1"><border><left/><right/><top/><bottom/></border></borders>\n` +
              `  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>\n` +
              `  <cellXfs count="2">\n` +
              `    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\n` +
              `    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>\n` +
              `  </cellXfs>\n` +
              `  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>\n` +
              `</styleSheet>`
    });

    // 5. xl/workbook.xml
    let wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
             `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n` +
             `  <sheets>\n`;
    sheets.forEach((sheet, idx) => {
        const cleanName = escapeXML(sheet.name || `Sheet${idx + 1}`).substring(0, 31);
        wb += `    <sheet name="${cleanName}" sheetId="${idx + 1}" r:id="rIdSheet${idx + 1}"/>\n`;
    });
    wb += `  </sheets>\n</workbook>`;
    files.push({ name: 'xl/workbook.xml', data: wb });

    // 6. xl/worksheets/sheetN.xml
    sheets.forEach((sheet, sIdx) => {
        const headers = sheet.headers || [];
        const rows = sheet.rows || [];

        let ws = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
                 `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n` +
                 `  <sheetData>\n`;

        // Row 1: Headers (with styled Navy background: s="1")
        if (headers.length > 0) {
            ws += `    <row r="1">\n`;
            headers.forEach((h, hIdx) => {
                const cellRef = `${colLetter(hIdx)}1`;
                ws += `      <c r="${cellRef}" t="inlineStr" s="1"><is><t>${escapeXML(h)}</t></is></c>\n`;
            });
            ws += `    </row>\n`;
        }

        // Data rows (Row 2 onwards)
        rows.forEach((row, rIdx) => {
            const rowNum = rIdx + 2;
            ws += `    <row r="${rowNum}">\n`;
            headers.forEach((_, cIdx) => {
                const cellRef = `${colLetter(cIdx)}${rowNum}`;
                const val = row[cIdx];
                if (val !== undefined && val !== null && val !== '') {
                    const numVal = Number(val);
                    if (!isNaN(numVal) && typeof val !== 'boolean' && String(val).trim() !== '' && !String(val).startsWith('+') && !String(val).includes('-') && !String(val).includes('/') && !String(val).includes(':')) {
                        ws += `      <c r="${cellRef}"><v>${numVal}</v></c>\n`;
                    } else {
                        ws += `      <c r="${cellRef}" t="inlineStr"><is><t>${escapeXML(val)}</t></is></c>\n`;
                    }
                }
            });
            ws += `    </row>\n`;
        });

        ws += `  </sheetData>\n</worksheet>`;
        files.push({ name: `xl/worksheets/sheet${sIdx + 1}.xml`, data: ws });
    });

    return buildZip(files);
}

/**
 * Builds an Excel buffer from a list of objects (dictionaries).
 * @param {Array<Object>} objects
 * @param {string} [sheetName='Dataset']
 * @param {string[]} [columnPriority]
 * @returns {Buffer}
 */
export function buildXLSXFromObjects(objects, sheetName = 'Dataset', columnPriority = []) {
    if (!objects || objects.length === 0) {
        return buildXLSX([{ name: sheetName, headers: ['Status'], rows: [['No Data']] }]);
    }

    const keySet = new Set(columnPriority);
    objects.forEach(obj => {
        Object.keys(obj).forEach(k => keySet.add(k));
    });
    const headers = Array.from(keySet);

    const rows = objects.map(obj => headers.map(h => obj[h]));
    return buildXLSX([{ name: sheetName, headers, rows }]);
}
