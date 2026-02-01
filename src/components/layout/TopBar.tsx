import { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Calendar, 
  Download, 
  Upload, 
  Bell,
  Search
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRecon } from '@/context/ReconContext';
import { exportToCSV } from '@/utils/reconciliation';
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
  const { transactions } = useRecon();
  const [importOpen, setImportOpen] = useState(false);

  const handleExport = () => {
    exportToCSV(transactions);
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
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Import Transactions</DialogTitle>
            <DialogDescription>
              Upload a CSV file to import bank transactions
            </DialogDescription>
          </DialogHeader>
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer">
            <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-foreground mb-1">
              Drop your CSV file here, or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Supports CSV files up to 10MB
            </p>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => setImportOpen(false)}>
              Upload
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
