import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
  color?: 'teal' | 'blue' | 'warn' | 'error';
  delay?: number;
}

const colorClasses = {
  teal: 'text-primary bg-primary/10',
  blue: 'text-brand-blue bg-brand-blue/10',
  warn: 'text-status-warn bg-status-warn/10',
  error: 'text-status-error bg-status-error/10',
};

export function KPICard({ 
  title, 
  value, 
  subtitle,
  icon: Icon, 
  trend,
  color = 'teal',
  delay = 0
}: KPICardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
      className="bg-card border border-border rounded-xl p-5 shadow-card"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{title}</p>
          <p className="text-2xl font-bold font-mono text-foreground">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
        <div className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          colorClasses[color]
        )}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      
      {trend && (
        <div className="mt-4 flex items-center gap-2">
          <span className={cn(
            'text-xs font-medium px-2 py-0.5 rounded',
            trend.positive 
              ? 'bg-primary/10 text-primary' 
              : 'bg-status-error/10 text-status-error'
          )}>
            {trend.positive ? '+' : ''}{trend.value}%
          </span>
          <span className="text-xs text-muted-foreground">{trend.label}</span>
        </div>
      )}
    </motion.div>
  );
}
