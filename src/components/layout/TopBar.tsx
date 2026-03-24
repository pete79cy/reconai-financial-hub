import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Download,
  Upload,
  Bell,
  Search,
  FileSpreadsheet,
  Sparkles,
  Trash2,
  MoreHorizontal,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
    clearAllData,
    searchQuery,
    setSearchQuery,
  } = useRecon();

  const [bankImportOpen, setBankImportOpen] = useState(false);
  const [glImportOpen, setGLImportOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  const hasUnmatchedData =
    bankTransactions.length > 0 &&
    glTransactions.length > 0 &&
    transactions.filter((t) => t.status === 'unmatched' || t.status === 'pending').length > 0;

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
    setClearDialogOpen(false);
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

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search transactions..."
              className="w-56 pl-9 bg-input border-border text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Import Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 bg-input border-border"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Import</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border">
              <DropdownMenuItem
                onClick={() => setBankImportOpen(true)}
                className="gap-2 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                Bank Statement (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setGLImportOpen(true)}
                className="gap-2 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4" />
                GL Ledger (Excel)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Auto Match - prominent */}
          <Button
            variant="default"
            size="sm"
            className="gap-2 relative"
            onClick={handleAutoMatch}
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Match</span>
            {hasUnmatchedData && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-status-warn rounded-full border-2 border-card" />
            )}
          </Button>

          {/* Overflow menu: Export, Clear Data, Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
                {/* Notification dot */}
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-card border-border w-48">
              <DropdownMenuItem onClick={handleExport} className="gap-2 cursor-pointer">
                <Download className="w-4 h-4" />
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 cursor-pointer">
                <Bell className="w-4 h-4" />
                Notifications
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setClearDialogOpen(true)}
                className="gap-2 cursor-pointer text-status-error focus:text-status-error"
              >
                <Trash2 className="w-4 h-4" />
                Clear all data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </motion.header>

      {/* Clear Data Confirmation */}
      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all imported bank and GL transactions, matched
              results, and reset to the default sample data. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearData}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
