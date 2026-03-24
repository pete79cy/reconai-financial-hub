import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, FileText, X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { BankTransaction, GLTransaction } from '@/types/transaction';
import { MAX_FILE_SIZE_BYTES } from '@/utils/constants';
import { generateId } from '@/utils/id';
import * as XLSX from 'xlsx';

interface ImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'bank' | 'gl';
  onImport: (transactions: BankTransaction[] | GLTransaction[]) => void;
}

type ParsedPreview = {
  headers: string[];
  previewRows: string[][];
  totalRows: number;
  skippedRows: number;
  transactions: BankTransaction[] | GLTransaction[];
};

export function ImportModal({ open, onOpenChange, type, onImport }: ImportModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; duplicates: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = type === 'gl'
    ? '.xls,.xlsx,.csv'
    : '.csv';

  const resetState = () => {
    setSelectedFile(null);
    setStep(1);
    setPreview(null);
    setImportResult(null);
    setIsProcessing(false);
    setIsDragging(false);
  };

  const handleFileSelect = (file: File) => {
    const isExcel = file.name.endsWith('.xls') || file.name.endsWith('.xlsx');
    const isCSV = file.name.endsWith('.csv');

    if (type === 'gl' && !isExcel && !isCSV) {
      toast.error('Please select an Excel (.xls, .xlsx) or CSV file');
      return;
    }
    if (type === 'bank' && !isCSV) {
      toast.error('Please select a CSV file');
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error('File size must be less than 10MB');
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  // Parse European number format (e.g., "1.234,56" -> 1234.56)
  const parseEuropeanNumber = (value: string): number => {
    if (!value || value.trim() === '') return 0;
    const cleaned = value.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  };

  // Convert D/M/YYYY or DD/MM/YYYY to YYYY-MM-DD
  const parseDate = (dateStr: string): string => {
    if (!dateStr) return new Date().toISOString().split('T')[0];

    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const fullYear = year.length === 2 ? `20${year}` : year;
      return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateStr;
  };

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  };

  const parseGLExcel = async (file: File): Promise<{ transactions: GLTransaction[]; headers: string[]; rawRows: string[][]; skipped: number }> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });

    const transactions: GLTransaction[] = [];
    const rawRows: string[][] = [];
    let skipped = 0;

    // Find header row (contains "Date", "Description", "Debit", "Credit")
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const row = rows[i];
      if (!row) continue;
      const rowStr = row.join('|').toLowerCase();
      if (rowStr.includes('date') && (rowStr.includes('debit') || rowStr.includes('credit'))) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      throw new Error('Could not find header row with Date, Debit, Credit columns');
    }

    const headers = rows[headerRowIndex].map((h: string) => (h || '').toString().toLowerCase().trim());
    const displayHeaders = rows[headerRowIndex].map((h: string) => (h || '').toString().trim());
    const dateIdx = headers.findIndex(h => h === 'date');
    const descIdx = headers.findIndex(h => h === 'description');
    const sourceIdx = headers.findIndex(h => h === 'source');
    const debitIdx = headers.findIndex(h => h === 'debit');
    const creditIdx = headers.findIndex(h => h === 'credit');
    const refIdx = headers.findIndex(h => h === 'reference' || h === 'sequence');

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      // Skip opening balance row
      const rowStr = row.join('|').toLowerCase();
      if (rowStr.includes('opening balance')) continue;

      const debit = parseEuropeanNumber(String(row[debitIdx] || ''));
      const credit = parseEuropeanNumber(String(row[creditIdx] || ''));

      if (debit === 0 && credit === 0) {
        skipped++;
        continue;
      }

      const amount = credit > 0 ? credit : debit;
      const txType = credit > 0 ? 'credit' : 'debit';

      rawRows.push(row.map(cell => String(cell || '')));

      transactions.push({
        id: generateId('GL'),
        date: parseDate(String(row[dateIdx] || '')),
        description: String(row[descIdx] || '').trim(),
        amount,
        currency: 'EUR',
        type: txType,
        reference: refIdx >= 0 ? String(row[refIdx] || '').trim() : undefined,
        source: sourceIdx >= 0 ? String(row[sourceIdx] || '').trim() : 'Unknown',
      });
    }

    return { transactions, headers: displayHeaders, rawRows, skipped };
  };

  const parseBankCSV = async (file: File): Promise<{ transactions: BankTransaction[]; headers: string[]; rawRows: string[][]; skipped: number }> => {
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());
    const transactions: BankTransaction[] = [];
    const rawRows: string[][] = [];
    let skipped = 0;

    // Find header row
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('date') && (line.includes('debit') || line.includes('credit'))) {
        headerRowIndex = i;
        break;
      }
    }

    const headerFields = parseCSVLine(lines[headerRowIndex]);
    const displayHeaders = headerFields.map(h => h.trim());
    const headers = headerFields.map(h => h.trim().toLowerCase());
    const dateIdx = headers.findIndex(h => h === 'date');
    const descIdx = headers.findIndex(h => h === 'description');
    const debitIdx = headers.findIndex(h => h === 'debit');
    const creditIdx = headers.findIndex(h => h === 'credit');
    const refIdx = headers.findIndex(h => h.includes('reference'));

    for (let i = headerRowIndex + 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 2) continue;

      const debit = parseEuropeanNumber(values[debitIdx] || '');
      const credit = parseEuropeanNumber(values[creditIdx] || '');

      if (debit === 0 && credit === 0) {
        skipped++;
        continue;
      }

      const amount = credit > 0 ? credit : debit;
      const txType = credit > 0 ? 'credit' : 'debit';

      rawRows.push(values.map(v => v.trim()));

      transactions.push({
        id: generateId('BANK'),
        date: parseDate(values[dateIdx] || ''),
        description: (values[descIdx] || '').trim(),
        amount,
        currency: 'EUR',
        type: txType,
        reference: refIdx >= 0 ? (values[refIdx] || '').trim() : undefined,
        bank_name: 'BOC',
      });
    }

    return { transactions, headers: displayHeaders, rawRows, skipped };
  };

  const handleNext = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    try {
      let result: { transactions: BankTransaction[] | GLTransaction[]; headers: string[]; rawRows: string[][]; skipped: number };

      if (type === 'gl') {
        result = await parseGLExcel(selectedFile);
      } else {
        result = await parseBankCSV(selectedFile);
      }

      if (result.transactions.length === 0) {
        toast.error('No valid transactions found in the file');
        return;
      }

      setPreview({
        headers: result.headers,
        previewRows: result.rawRows.slice(0, 5),
        totalRows: result.transactions.length,
        skippedRows: result.skipped,
        transactions: result.transactions,
      });
      setStep(2);
    } catch (error) {
      toast.error(`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImport = () => {
    if (!preview) return;

    setIsProcessing(true);
    try {
      onImport(preview.transactions);

      const duplicates = 0; // Duplicate detection happens in the parent; show 0 here as baseline
      setImportResult({ imported: preview.totalRows, duplicates });

      toast.success(`Imported ${preview.totalRows} ${type === 'gl' ? 'GL' : 'bank'} transactions`);
      onOpenChange(false);
      resetState();
    } catch (error) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBack = () => {
    setStep(1);
    setPreview(null);
  };

  const title = type === 'gl' ? 'Import GL Transactions' : 'Import Bank Statement';
  const description = type === 'gl'
    ? 'Upload an Excel file from your accounting software with Date, Description, Debit, Credit columns'
    : 'Upload a CSV file from your bank with Date, Description, Debit, Credit columns';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      onOpenChange(isOpen);
      if (!isOpen) resetState();
    }}>
      <DialogContent className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === 'gl' ? <FileSpreadsheet className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-3 py-2">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
              step === 1 ? 'bg-primary text-primary-foreground' : 'bg-primary/20 text-primary'
            }`}>
              {step > 1 ? <Check className="w-4 h-4" /> : '1'}
            </div>
            <span className={`text-sm ${step === 1 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              Select File
            </span>
          </div>
          <div className="w-8 h-px bg-border" />
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
              step === 2 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}>
              2
            </div>
            <span className={`text-sm ${step === 2 ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              Preview & Import
            </span>
          </div>
        </div>

        {/* Step 1: File Selection */}
        {step === 1 && (
          <>
            <input
              type="file"
              ref={fileInputRef}
              accept={acceptedTypes}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
              }}
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-primary bg-primary/5'
                  : selectedFile
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border hover:border-primary/50'
              }`}
            >
              {selectedFile ? (
                <>
                  {type === 'gl' ? (
                    <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-primary" />
                  ) : (
                    <FileText className="w-10 h-10 mx-auto mb-3 text-primary" />
                  )}
                  <p className="text-sm text-foreground mb-1 font-medium">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </>
              ) : (
                <>
                  <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm text-foreground mb-1">
                    Drop your {type === 'gl' ? 'Excel/CSV' : 'CSV'} file here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Supports {type === 'gl' ? '.xls, .xlsx, .csv' : '.csv'} files up to 10MB
                  </p>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => {
                onOpenChange(false);
                resetState();
              }}>
                Cancel
              </Button>
              <Button
                onClick={handleNext}
                disabled={!selectedFile || isProcessing}
              >
                {isProcessing ? (
                  'Parsing...'
                ) : (
                  <>
                    Next
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* Step 2: Preview & Confirm */}
        {step === 2 && preview && (
          <>
            {/* Summary stats */}
            <div className="flex flex-wrap gap-3">
              <div className="flex-1 min-w-[140px] rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Transactions found</p>
                <p className="text-lg font-semibold text-foreground">{preview.totalRows}</p>
              </div>
              {preview.skippedRows > 0 && (
                <div className="flex-1 min-w-[140px] rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">Rows skipped (no amount)</p>
                  <p className="text-lg font-semibold text-yellow-600 dark:text-yellow-400">{preview.skippedRows}</p>
                </div>
              )}
              <div className="flex-1 min-w-[140px] rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Columns detected</p>
                <p className="text-sm font-medium text-foreground mt-1">{preview.headers.filter(h => h).join(', ')}</p>
              </div>
            </div>

            {/* Preview table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50">
                      {preview.headers.map((header, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.previewRows.map((row, rowIdx) => (
                      <tr
                        key={rowIdx}
                        className={rowIdx % 2 === 0 ? 'bg-background' : 'bg-muted/20'}
                      >
                        {row.map((cell, cellIdx) => (
                          <td
                            key={cellIdx}
                            className="px-3 py-1.5 text-muted-foreground whitespace-nowrap max-w-[200px] truncate"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.totalRows > 5 && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 border-t border-border">
                  Showing 5 of {preview.totalRows} rows
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-between gap-2 mt-4">
              <Button variant="outline" onClick={handleBack}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => {
                  onOpenChange(false);
                  resetState();
                }}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    'Importing...'
                  ) : (
                    <>
                      <Check className="w-4 h-4 mr-1" />
                      Import {preview.totalRows} transactions
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
