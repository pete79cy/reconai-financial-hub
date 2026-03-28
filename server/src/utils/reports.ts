import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { Response } from 'express';

// ============================================================
// Shared formatting helpers
// ============================================================

export function formatEUR(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateStr: string | Date): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// ============================================================
// Excel Report Helpers
// ============================================================

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF000000' } },
    };
  });
  row.height = 22;
}

function styleTotalsRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.border = {
      top: { style: 'double', color: { argb: 'FF000000' } },
    };
  });
}

// ============================================================
// Matched Transactions Report — Excel
// ============================================================

export async function generateMatchedExcel(
  res: Response,
  rows: any[],
  period: string
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ReconAI Financial Hub';
  wb.created = new Date();

  const ws = wb.addWorksheet('Matched Transactions');

  // Title
  ws.mergeCells('A1:H1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Matched Transactions — ${formatPeriodLabel(period)}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells('A2:H2');
  ws.getCell('A2').value = `Generated: ${new Date().toLocaleDateString('en-GB')}`;
  ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  ws.getCell('A2').alignment = { horizontal: 'center' };

  // Headers
  const headers = ['Date', 'Bank Description', 'GL Description', 'Amount (€)', 'Reference', 'Match Type', 'Confidence', 'Category'];
  ws.columns = [
    { key: 'date', width: 14 },
    { key: 'bank_desc', width: 35 },
    { key: 'gl_desc', width: 35 },
    { key: 'amount', width: 16 },
    { key: 'reference', width: 15 },
    { key: 'match_type', width: 14 },
    { key: 'confidence', width: 12 },
    { key: 'category', width: 12 },
  ];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);

  // Data rows
  let totalAmount = 0;
  for (const row of rows) {
    const amt = Math.abs(parseFloat(row.amount || 0));
    totalAmount += amt;
    const dataRow = ws.addRow([
      formatDate(row.date),
      row.bank_desc || '',
      row.gl_desc || '',
      amt,
      row.reference || '',
      row.match_type || '',
      row.confidence != null ? `${row.confidence}%` : '',
      row.match_category || '',
    ]);
    // Currency format for amount column
    dataRow.getCell(4).numFmt = '#,##0.00';
  }

  // Totals row
  const totalsRow = ws.addRow(['', '', 'TOTAL', totalAmount, '', '', '', '']);
  totalsRow.getCell(4).numFmt = '#,##0.00';
  styleTotalsRow(totalsRow);

  // Count row
  ws.addRow([]);
  ws.addRow([`Total matched transactions: ${rows.length}`]);

  // Write to response
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=Matched_Transactions_${period}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
}

// ============================================================
// Matched Transactions Report — PDF
// ============================================================

export function generateMatchedPDF(
  res: Response,
  rows: any[],
  period: string
) {
  const doc = new PDFDocument({ layout: 'landscape', size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Matched_Transactions_${period}.pdf`);
  doc.pipe(res);

  // Title
  doc.fontSize(16).font('Helvetica-Bold')
    .text(`Matched Transactions — ${formatPeriodLabel(period)}`, { align: 'center' });
  doc.fontSize(9).font('Helvetica')
    .text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, { align: 'center' });
  doc.moveDown(1);

  // Table
  const colWidths = [70, 200, 200, 80, 80, 70, 60];
  const colHeaders = ['Date', 'Bank Description', 'GL Description', 'Amount (€)', 'Reference', 'Match Type', 'Conf.'];
  const startX = 40;
  let y = doc.y;

  // Header row
  doc.fontSize(8).font('Helvetica-Bold');
  let x = startX;
  // Header background
  doc.rect(startX, y - 2, colWidths.reduce((a, b) => a + b, 0), 16).fill('#1F4E79');
  doc.fillColor('white');
  x = startX;
  for (let i = 0; i < colHeaders.length; i++) {
    doc.text(colHeaders[i], x + 2, y, { width: colWidths[i] - 4, height: 14 });
    x += colWidths[i];
  }
  y += 18;
  doc.fillColor('black');

  // Data rows
  let totalAmount = 0;
  doc.font('Helvetica').fontSize(7);
  for (let r = 0; r < rows.length; r++) {
    // New page if needed
    if (y > 540) {
      doc.addPage({ layout: 'landscape', size: 'A4', margin: 40 });
      y = 40;
    }

    // Zebra stripe
    if (r % 2 === 0) {
      doc.rect(startX, y - 2, colWidths.reduce((a, b) => a + b, 0), 14).fill('#F0F4F8');
      doc.fillColor('black');
    }

    const row = rows[r];
    const amt = Math.abs(parseFloat(row.amount || 0));
    totalAmount += amt;
    x = startX;
    const values = [
      formatDate(row.date),
      (row.bank_desc || '').substring(0, 45),
      (row.gl_desc || '').substring(0, 45),
      formatEUR(amt),
      (row.reference || '').substring(0, 15),
      row.match_type || '',
      row.confidence != null ? `${row.confidence}%` : '',
    ];
    for (let i = 0; i < values.length; i++) {
      const align = i === 3 ? 'right' : 'left';
      doc.text(values[i], x + 2, y, { width: colWidths[i] - 4, height: 12, align });
      x += colWidths[i];
    }
    y += 14;
  }

  // Totals
  y += 4;
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text(`Total: €${formatEUR(totalAmount)}`, startX + colWidths[0] + colWidths[1], y, { width: colWidths[2] + colWidths[3], align: 'right' });
  y += 14;
  doc.text(`Total matched transactions: ${rows.length}`, startX, y);

  // Page numbers
  const pageCount = doc.bufferedPageRange();
  for (let i = 0; i < pageCount.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).font('Helvetica')
      .text(`Page ${i + 1} of ${pageCount.count}`, 40, 560, { align: 'right', width: 720 });
  }

  doc.end();
}

// ============================================================
// Outstanding Items Report — Excel
// ============================================================

export async function generateOutstandingExcel(
  res: Response,
  checks: any[],
  deposits: any[],
  other: any[],
  summary: { bankBalance: number; adjustedBankBalance: number; glBalance: number; adjustedGLBalance: number; proof: number },
  period: string
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ReconAI Financial Hub';
  wb.created = new Date();

  // Helper to create a sheet for each category
  function addItemsSheet(name: string, items: any[]) {
    const ws = wb.addWorksheet(name);
    ws.columns = [
      { key: 'date', width: 14 },
      { key: 'description', width: 40 },
      { key: 'reference', width: 18 },
      { key: 'source', width: 18 },
      { key: 'amount', width: 16 },
    ];

    // Title
    ws.mergeCells('A1:E1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `Outstanding ${name} — ${formatPeriodLabel(period)}`;
    titleCell.font = { bold: true, size: 14 };
    titleCell.alignment = { horizontal: 'center' };

    ws.mergeCells('A2:E2');
    ws.getCell('A2').value = `Generated: ${new Date().toLocaleDateString('en-GB')}`;
    ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF666666' } };
    ws.getCell('A2').alignment = { horizontal: 'center' };

    // Headers
    const headerRow = ws.addRow(['Date', 'Description', 'Reference', 'Source', 'Amount (€)']);
    styleHeaderRow(headerRow);

    // Data
    let total = 0;
    for (const item of items) {
      const amt = Math.abs(parseFloat(item.amount || 0));
      total += amt;
      const dataRow = ws.addRow([
        formatDate(item.date),
        item.description || '',
        item.reference || item.reference_number || '',
        item.source || item.source_period || '',
        amt,
      ]);
      dataRow.getCell(5).numFmt = '#,##0.00';
    }

    // Totals
    const totalsRow = ws.addRow(['', '', '', 'TOTAL', total]);
    totalsRow.getCell(5).numFmt = '#,##0.00';
    styleTotalsRow(totalsRow);
    ws.addRow([]);
    ws.addRow([`Total items: ${items.length}`]);

    return total;
  }

  // Summary sheet first so it appears as the first tab
  const summarySheet = wb.addWorksheet('Reconciliation Summary');

  // Create category sheets
  const checkTotal = addItemsSheet('Cheques', checks);
  const depositTotal = addItemsSheet('Deposits', deposits);
  const otherTotal = addItemsSheet('Other', other);
  summarySheet.columns = [
    { key: 'label', width: 35 },
    { key: 'value', width: 20 },
  ];

  summarySheet.mergeCells('A1:B1');
  const stc = summarySheet.getCell('A1');
  stc.value = `Bank Reconciliation Summary — ${formatPeriodLabel(period)}`;
  stc.font = { bold: true, size: 14 };
  stc.alignment = { horizontal: 'center' };

  summarySheet.addRow([]);
  const addSummaryRow = (label: string, value: number | string, bold = false) => {
    const row = summarySheet.addRow([label, typeof value === 'number' ? value : value]);
    if (typeof value === 'number') row.getCell(2).numFmt = '#,##0.00';
    if (bold) row.eachCell(c => { c.font = { bold: true }; });
    return row;
  };

  addSummaryRow('Balance per Bank Statement', summary.bankBalance, true);
  addSummaryRow('Less: Outstanding Deposits', -depositTotal);
  addSummaryRow('Less: Outstanding Cheques', -checkTotal);
  addSummaryRow('Less: Outstanding Other', -otherTotal);

  const adjBankRow = addSummaryRow('Adjusted Bank Balance', summary.adjustedBankBalance, true);
  adjBankRow.eachCell(c => { c.border = { top: { style: 'thin' } }; });

  summarySheet.addRow([]);
  addSummaryRow('Balance per G/L', summary.glBalance, true);
  addSummaryRow('Adjusted G/L Balance', summary.adjustedGLBalance, true);

  summarySheet.addRow([]);
  const proofRow = addSummaryRow('PROOF (Difference)', summary.proof, true);
  proofRow.eachCell(c => {
    c.border = { top: { style: 'double' }, bottom: { style: 'double' } };
    c.font = { bold: true, size: 12, color: { argb: Math.abs(summary.proof) < 0.01 ? 'FF008000' : 'FFFF0000' } };
  });

  summarySheet.addRow([]);
  summarySheet.addRow([`Outstanding Cheques: ${checks.length} items`]);
  summarySheet.addRow([`Outstanding Deposits: ${deposits.length} items`]);
  summarySheet.addRow([`Outstanding Other: ${other.length} items`]);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=Outstanding_Items_${period}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
}

// ============================================================
// Outstanding Items Report — PDF
// ============================================================

export function generateOutstandingPDF(
  res: Response,
  checks: any[],
  deposits: any[],
  other: any[],
  summary: { bankBalance: number; adjustedBankBalance: number; glBalance: number; adjustedGLBalance: number; proof: number },
  period: string
) {
  const doc = new PDFDocument({ layout: 'portrait', size: 'A4', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Outstanding_Items_${period}.pdf`);
  doc.pipe(res);

  // Title
  doc.fontSize(16).font('Helvetica-Bold')
    .text(`Outstanding Items — ${formatPeriodLabel(period)}`, { align: 'center' });
  doc.fontSize(9).font('Helvetica')
    .text(`Generated: ${new Date().toLocaleDateString('en-GB')}`, { align: 'center' });
  doc.moveDown(1);

  // Reconciliation Summary Box
  const boxX = 40;
  let by = doc.y;
  doc.rect(boxX, by, 515, 130).lineWidth(0.5).stroke('#1F4E79');

  doc.fontSize(10).font('Helvetica-Bold')
    .text('Reconciliation Summary', boxX + 10, by + 8);
  by += 24;
  doc.fontSize(9).font('Helvetica');

  const summaryLines = [
    ['Balance per Bank Statement', formatEUR(summary.bankBalance)],
    ['Less: Outstanding Deposits', `(${formatEUR(Math.abs(summary.adjustedBankBalance - summary.bankBalance + (summary as any).outstandingChecks || 0))})`],
    ['Less: Outstanding Cheques', `(${formatEUR(checks.reduce((s, c) => s + Math.abs(parseFloat(c.amount || 0)), 0))})`],
    ['Less: Outstanding Other', `(${formatEUR(other.reduce((s, c) => s + Math.abs(parseFloat(c.amount || 0)), 0))})`],
  ];
  for (const [label, val] of summaryLines) {
    doc.text(label, boxX + 10, by, { width: 300, continued: false });
    doc.text(val, boxX + 320, by, { width: 180, align: 'right' });
    by += 14;
  }
  by += 2;
  doc.moveTo(boxX + 10, by).lineTo(boxX + 505, by).stroke();
  by += 4;
  doc.font('Helvetica-Bold');
  doc.text('Adjusted Bank Balance', boxX + 10, by, { width: 300 });
  doc.text(formatEUR(summary.adjustedBankBalance), boxX + 320, by, { width: 180, align: 'right' });
  by += 18;
  doc.text('Balance per G/L', boxX + 10, by, { width: 300 });
  doc.text(formatEUR(summary.glBalance), boxX + 320, by, { width: 180, align: 'right' });
  by += 18;
  const proofColor = Math.abs(summary.proof) < 0.01 ? 'green' : 'red';
  doc.fillColor(proofColor).text('PROOF', boxX + 10, by, { width: 300 });
  doc.text(formatEUR(summary.proof), boxX + 320, by, { width: 180, align: 'right' });
  doc.fillColor('black');

  doc.y = by + 30;

  // Helper to render a table section
  function renderSection(title: string, items: any[]) {
    if (doc.y > 700) {
      doc.addPage({ layout: 'portrait', size: 'A4', margin: 40 });
    }

    doc.fontSize(11).font('Helvetica-Bold').text(title);
    doc.moveDown(0.3);

    if (items.length === 0) {
      doc.fontSize(9).font('Helvetica').text('No items.');
      doc.moveDown(1);
      return;
    }

    const colW = [65, 230, 80, 70, 70];
    const colH = ['Date', 'Description', 'Reference', 'Source', 'Amount (€)'];
    let y = doc.y;
    let x = 40;

    // Header
    doc.rect(x, y - 2, colW.reduce((a, b) => a + b, 0), 15).fill('#1F4E79');
    doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
    x = 40;
    for (let i = 0; i < colH.length; i++) {
      doc.text(colH[i], x + 2, y, { width: colW[i] - 4, height: 13 });
      x += colW[i];
    }
    y += 16;
    doc.fillColor('black').font('Helvetica').fontSize(7);

    let total = 0;
    for (let r = 0; r < items.length; r++) {
      if (y > 750) {
        doc.addPage({ layout: 'portrait', size: 'A4', margin: 40 });
        y = 40;
      }
      if (r % 2 === 0) {
        doc.rect(40, y - 2, colW.reduce((a, b) => a + b, 0), 13).fill('#F0F4F8');
        doc.fillColor('black');
      }
      const item = items[r];
      const amt = Math.abs(parseFloat(item.amount || 0));
      total += amt;
      x = 40;
      const vals = [
        formatDate(item.date),
        (item.description || '').substring(0, 50),
        (item.reference || item.reference_number || '').substring(0, 15),
        (item.source || item.source_period || '').substring(0, 12),
        formatEUR(amt),
      ];
      for (let i = 0; i < vals.length; i++) {
        const align = i === 4 ? 'right' : 'left';
        doc.text(vals[i], x + 2, y, { width: colW[i] - 4, height: 12, align });
        x += colW[i];
      }
      y += 13;
    }

    // Total
    y += 3;
    doc.font('Helvetica-Bold').fontSize(8);
    doc.text(`Total: €${formatEUR(total)}  (${items.length} items)`, 40, y);
    y += 18;
    doc.y = y;
  }

  renderSection(`Outstanding Cheques (${checks.length})`, checks);
  renderSection(`Outstanding Deposits (${deposits.length})`, deposits);
  renderSection(`Outstanding Other (${other.length})`, other);

  // Page numbers
  const pageCount = doc.bufferedPageRange();
  for (let i = 0; i < pageCount.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).font('Helvetica')
      .text(`Page ${i + 1} of ${pageCount.count}`, 40, 810, { align: 'right', width: 515 });
  }

  doc.end();
}
