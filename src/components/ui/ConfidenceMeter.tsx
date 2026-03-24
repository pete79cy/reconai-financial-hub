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
      <div className="confidence-bar flex-1 min-w-[60px] h-2.5 rounded-full overflow-hidden bg-muted">
        <div
          className={cn('confidence-fill h-full rounded-full', getConfidenceColor(value))}
          style={{ width: `${value}%` }}
        />
      </div>
      {showValue && (
        <span className="text-sm font-mono tabular-nums text-muted-foreground w-10 text-right">
          {value}%
        </span>
      )}
    </div>
  );
}
