import { motion } from 'framer-motion';
import { Settings, AlertTriangle, Calendar, Info } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Switch } from '@/components/ui/switch';
import { useRecon } from '@/context/ReconContext';
import { cn } from '@/lib/utils';
import { HIGH_VALUE_THRESHOLD } from '@/utils/constants';
import { formatCurrency } from '@/utils/reconciliation';

interface RuleCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: () => void;
  color: 'blue' | 'warn';
  delay?: number;
}

function RuleCard({ title, description, icon, enabled, onToggle, color, delay = 0 }: RuleCardProps) {
  const colorClasses = {
    blue: enabled ? 'border-brand-blue/30 bg-brand-blue/5' : 'border-border',
    warn: enabled ? 'border-status-warn/30 bg-status-warn/5' : 'border-border',
  };
  
  const iconClasses = {
    blue: enabled ? 'bg-brand-blue/10 text-brand-blue' : 'bg-secondary text-muted-foreground',
    warn: enabled ? 'bg-status-warn/10 text-status-warn' : 'bg-secondary text-muted-foreground',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className={cn(
        'bg-card border rounded-xl p-6 shadow-card transition-all duration-300',
        colorClasses[color]
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className={cn(
            'w-12 h-12 rounded-lg flex items-center justify-center transition-colors',
            iconClasses[color]
          )}>
            {icon}
          </div>
          <div>
            <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-md">{description}</p>
          </div>
        </div>
        <Switch 
          checked={enabled} 
          onCheckedChange={onToggle}
          className="data-[state=checked]:bg-primary"
        />
      </div>
      
      <div className="mt-4 pt-4 border-t border-border/50">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5" />
          <span>
            {enabled 
              ? 'Active - Flagging matching transactions'
              : 'Inactive - No flags will be applied'
            }
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export default function Rules() {
  const { rulesState, toggleRule, transactions } = useRecon();

  // Count affected transactions
  const highValueCount = transactions.filter(t => t.amount > HIGH_VALUE_THRESHOLD).length;
  const weekendCount = transactions.filter(t => {
    const day = new Date(t.date).getDay();
    return day === 0 || day === 6;
  }).length;

  return (
    <div className="min-h-screen">
      <TopBar 
        title="Rules Engine" 
        subtitle="Configure Reconciliation Logic" 
      />
      
      <div className="p-6 space-y-6">
        {/* Header Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card border border-border rounded-xl p-6 shadow-card"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Settings className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-foreground">
                Automated Flagging Rules
              </h2>
              <p className="text-sm text-muted-foreground">
                Configure rules to automatically flag transactions based on specific criteria.
                Flags appear in the Matching table and persist across sessions.
              </p>
            </div>
          </div>
        </motion.div>

        {/* Rules */}
        <div className="grid gap-4">
          <RuleCard
            title="High Value Alert"
            description={`Flag transactions exceeding ${formatCurrency(HIGH_VALUE_THRESHOLD)}. Currently ${highValueCount} transactions would be flagged.`}
            icon={<AlertTriangle className="w-6 h-6" />}
            enabled={rulesState.highValue}
            onToggle={() => toggleRule('highValue')}
            color="blue"
            delay={0.1}
          />
          
          <RuleCard
            title="Weekend Transaction Alert"
            description={`Flag transactions dated on Saturday or Sunday. Currently ${weekendCount} transactions would be flagged.`}
            icon={<Calendar className="w-6 h-6" />}
            enabled={rulesState.weekendAlert}
            onToggle={() => toggleRule('weekendAlert')}
            color="warn"
            delay={0.2}
          />
        </div>

        {/* Active Flags Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-card border border-border rounded-xl p-6 shadow-card"
        >
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            Current Flag Summary
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-secondary/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">High Value Flags</span>
                <span className="text-lg font-bold font-mono text-foreground">
                  {rulesState.highValue ? highValueCount : 0}
                </span>
              </div>
            </div>
            <div className="bg-secondary/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Weekend Flags</span>
                <span className="text-lg font-bold font-mono text-foreground">
                  {rulesState.weekendAlert ? weekendCount : 0}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
