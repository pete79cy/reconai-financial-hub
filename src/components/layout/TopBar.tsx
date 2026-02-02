import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  Calendar, 
  Download, 
  Upload, 
  Bell,
  Search,
  FileText,
  CheckCircle,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRecon } from '@/context/ReconContext';
import { exportToCSV } from '@/utils/reconciliation';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const { transactions, importTransactions } = useRecon();
  const [importOpen, setImportOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    exportToCSV(transactions);
  };

  const handleFileSelect = (file: File) => {
    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  // Parse European number format (e.g., "1.234,56" -> 1234.56)
  const parseEuropeanNumber = (value: string): number => {
    if (!value || value.trim() === '') return 0;
    // Remove thousand separators (.) and replace decimal comma with dot
    const cleaned = value.replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
  };

  // Convert DD/MM/YYYY to YYYY-MM-DD
  const parseEuropeanDate = (dateStr: string): string => {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
    return dateStr;
  };

  // Find the header row index (skip metadata rows)
  const findHeaderRowIndex = (lines: string[]): number => {
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].toLowerCase();
      if (line.includes('date') && (line.includes('description') || line.includes('debit') || line.includes('credit'))) {
        return i;
      }
    }
    return 0;
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    
    setIsProcessing(true);
    try {
      const text = await selectedFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        toast.error('CSV file is empty or has no data rows');
        return;
      }

      // Find the actual header row (skip bank metadata)
      const headerRowIndex = findHeaderRowIndex(lines);
      const headers = parseCSVLine(lines[headerRowIndex]).map(h => h.trim().toLowerCase());
      
      // Detect format: bank format has 'debit'/'credit', our format has 'amount'
      const isBankFormat = headers.includes('debit') || headers.includes('credit');
      
      const newTransactions = [];
      for (let i = headerRowIndex + 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < 2) continue;

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => row[h] = values[idx]?.trim() || '');

        let amount: number;
        let description: string;
        let date: string;

        if (isBankFormat) {
          // Bank of Cyprus format
          const debit = parseEuropeanNumber(row.debit || '');
          const credit = parseEuropeanNumber(row.credit || '');
          amount = credit > 0 ? credit : -debit;
          description = row.description || 'Imported Transaction';
          date = parseEuropeanDate(row.date || '');
        } else {
          // Original app format
          amount = parseFloat(row.amount?.replace(/[€,]/g, '') || '0');
          description = row.bank_desc || row.description || 'Imported Transaction';
          date = row.date || new Date().toISOString().split('T')[0];
        }

        if (isNaN(amount) || amount === 0) continue;

        newTransactions.push({
          id: `REC-${Date.now()}-${i}`,
          date,
          bank_desc: description,
          gl_desc: row['transaction type'] || row.gl_desc || '',
          amount: Math.abs(amount),
          currency: 'EUR' as const,
          bank_name: 'Piraeus' as const, // Default bank
          match_type: 'Manual' as const,
          confidence: 0,
          status: 'pending' as const,
          approval_stage: 'none' as const,
        });
      }

      if (newTransactions.length === 0) {
        toast.error('No valid transactions found in the CSV');
        return;
      }

      importTransactions(newTransactions);
      toast.success(`Imported ${newTransactions.length} transactions`);
      setImportOpen(false);
      setSelectedFile(null);
    } catch (error) {
      toast.error('Failed to parse CSV file');
      console.error(error);
    } finally {
      setIsProcessing(false);
    }
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

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="h-16 border-b border-border bg-card/50 backdrop-blur-sm px-6 flex items-center justify-between"
      >
        <div>
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search transactions..."
              className="w-64 pl-9 bg-input border-border"
            />
          </div>

          {/* Date Picker (Visual) */}
          <Button variant="outline" size="sm" className="gap-2 bg-input border-border">
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">Feb 2025</span>
          </Button>

          {/* Import */}
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 bg-input border-border"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Import</span>
          </Button>

          {/* Export */}
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2 bg-input border-border"
            onClick={handleExport}
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-5 h-5 text-muted-foreground" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
          </Button>
        </div>
      </motion.header>

      {/* Import Modal */}
      <Dialog open={importOpen} onOpenChange={(open) => {
        setImportOpen(open);
        if (!open) setSelectedFile(null);
      }}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Import Transactions</DialogTitle>
            <DialogDescription>
              Upload a CSV file with columns: date, bank_desc, amount (required), gl_desc, bank_name (optional)
            </DialogDescription>
          </DialogHeader>
          
          <input
            type="file"
            ref={fileInputRef}
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
          
          <div 
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
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
                <FileText className="w-10 h-10 mx-auto mb-3 text-primary" />
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
                  Drop your CSV file here, or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports CSV files up to 10MB
                </p>
              </>
            )}
          </div>
          
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => {
              setImportOpen(false);
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
    </>
  );
}
