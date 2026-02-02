import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Calendar, 
  Download, 
  Upload, 
  Bell,
  Search,
  FileSpreadsheet,
  Sparkles,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRecon } from '@/context/ReconContext';
import { exportToCSV } from '@/utils/reconciliation';
import { toast } from 'sonner';
import { ImportModal } from '@/components/modals/ImportModal';
import { BankTransaction, GLTransaction } from '@/types/transaction';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const { 
    transactions, 
    bankTransactions, 
    glTransactions, 
    importBankTransactions, 
    importGLTransactions, 
    runAutoMatch,
    clearAllData 
  } = useRecon();
  
  const [bankImportOpen, setBankImportOpen] = useState(false);
  const [glImportOpen, setGLImportOpen] = useState(false);

  const handleExport = () => {
    exportToCSV(transactions);
  };

  const handleBankImport = (txs: BankTransaction[] | GLTransaction[]) => {
    importBankTransactions(txs as BankTransaction[]);
  };

  const handleGLImport = (txs: BankTransaction[] | GLTransaction[]) => {
    importGLTransactions(txs as GLTransaction[]);
  };

  const handleAutoMatch = () => {
    if (bankTransactions.length === 0 && glTransactions.length === 0) {
      toast.error('Import Bank and GL transactions first');
      return;
    }
    runAutoMatch();
    toast.success('Auto-matching complete! Check the Matching page.');
  };

  const handleClearData = () => {
    clearAllData();
    toast.success('All data cleared');
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

          {/* Import Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 bg-input border-border">
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Import</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border">
              <DropdownMenuItem onClick={() => setBankImportOpen(true)} className="gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                Bank Statement (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setGLImportOpen(true)} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="w-4 h-4" />
                GL Ledger (Excel)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Auto Match */}
          <Button 
            variant="default" 
            size="sm" 
            className="gap-2"
            onClick={handleAutoMatch}
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Match</span>
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

          {/* Clear Data */}
          <Button 
            variant="ghost" 
            size="icon"
            onClick={handleClearData}
            title="Clear all data"
          >
            <Trash2 className="w-4 h-4 text-muted-foreground" />
          </Button>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="w-5 h-5 text-muted-foreground" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-primary rounded-full" />
          </Button>
        </div>
      </motion.header>

      {/* Bank Import Modal */}
      <ImportModal
        open={bankImportOpen}
        onOpenChange={setBankImportOpen}
        type="bank"
        onImport={handleBankImport}
      />

      {/* GL Import Modal */}
      <ImportModal
        open={glImportOpen}
        onOpenChange={setGLImportOpen}
        type="gl"
        onImport={handleGLImport}
      />
    </>
  );
}
