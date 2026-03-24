import { useState, useRef } from 'react';
import { Upload, FileSpreadsheet, FileText, X } from 'lucide-react';
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

export function ImportModal({ open, onOpenChange, type, onImport }: ImportModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptedTypes = type === 'gl' 
    ? '.xls,.xlsx,.csv' 
    : '.csv';

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

  const parseGLExcel = async (file: File): Promise<GLTransaction[]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    
    const transactions: GLTransaction[] = [];
    
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
      
      if (debit === 0 && credit === 0) continue;

      const amount = credit > 0 ? credit : debit;
      const txType = credit > 0 ? 'credit' : 'debit';

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

    return transactions;
  };

  const parseBankCSV = async (file: File): Promise<BankTransaction[]> => {
    const text = await file.text();
    const lines = text.split('\n').filter(line => line.trim());
    const transactions: BankTransaction[] = [];

    // Find header row
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('date') && (line.includes('debit') || line.includes('credit'))) {
        headerRowIndex = i;
        break;
      }
    }

    const headers = parseCSVLine(lines[headerRowIndex]).map(h => h.trim().toLowerCase());
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
      
      if (debit === 0 && credit === 0) continue;

      const amount = credit > 0 ? credit : debit;
      const txType = credit > 0 ? 'credit' : 'debit';

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

    return transactions;
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    try {
      let transactions: BankTransaction[] | GLTransaction[];
      
      if (type === 'gl') {
        transactions = await parseGLExcel(selectedFile);
      } else {
        transactions = await parseBankCSV(selectedFile);
      }

      if (transactions.length === 0) {
        toast.error('No valid transactions found in the file');
        return;
      }

      onImport(transactions);
      toast.success(`Imported ${transactions.length} ${type === 'gl' ? 'GL' : 'bank'} transactions`);
      onOpenChange(false);
      setSelectedFile(null);
    } catch (error) {
      toast.error(`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
  };

  const title = type === 'gl' ? 'Import GL Transactions' : 'Import Bank Statement';
  const description = type === 'gl' 
    ? 'Upload an Excel file from your accounting software with Date, Description, Debit, Credit columns'
    : 'Upload a CSV file from your bank with Date, Description, Debit, Credit columns';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      onOpenChange(isOpen);
      if (!isOpen) setSelectedFile(null);
    }}>
      <DialogContent className="bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {type === 'gl' ? <FileSpreadsheet className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        
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
            setSelectedFile(null);
          }}>
            Cancel
          </Button>
          <Button 
            onClick={handleUpload} 
            disabled={!selectedFile || isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Upload'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
