import { cn } from '@/lib/utils';
import { getConfidenceColor } from '@/utils/reconciliation';

interface ConfidenceMeterProps {
  value: number;
  showValue?: boolean;
  className?: string;
}

export function ConfidenceMeter({ value, showValue = true, className }: ConfidenceMeterProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="confidence-bar flex-1 min-w-[60px]">
        <div 
          className={cn('confidence-fill', getConfidenceColor(value))}
          style={{ width: `${value}%` }}
        />
      </div>
      {showValue && (
        <span className="text-xs font-mono text-muted-foreground w-8 text-right">
          {value}%
        </span>
      )}
    </div>
  );
}
