import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

interface RingChartProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label: string;
  sublabel?: string;
  color?: 'teal' | 'blue' | 'warn' | 'error';
}

const colorMap = {
  teal: 'hsl(165, 100%, 42%)',
  blue: 'hsl(217, 91%, 60%)',
  warn: 'hsl(38, 92%, 50%)',
  error: 'hsl(0, 84%, 60%)',
};

const glowMap = {
  teal: 'drop-shadow(0 0 8px hsl(165 100% 42% / 0.5))',
  blue: 'drop-shadow(0 0 8px hsl(217 91% 60% / 0.5))',
  warn: 'drop-shadow(0 0 8px hsl(38 92% 50% / 0.5))',
  error: 'drop-shadow(0 0 8px hsl(0 84% 60% / 0.5))',
};

export function RingChart({ 
  value, 
  max = 100, 
  size = 140, 
  strokeWidth = 10,
  label,
  sublabel,
  color = 'teal'
}: RingChartProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min((value / max) * 100, 100);
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="transform -rotate-90"
          style={{ filter: glowMap[color] }}
        >
          {/* Background ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="hsl(210, 35%, 18%)"
            strokeWidth={strokeWidth}
          />
          {/* Progress ring */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colorMap[color]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ 
              strokeDashoffset: mounted ? offset : circumference 
            }}
            transition={{ 
              duration: 1.5, 
              ease: 'easeOut',
              delay: 0.2
            }}
          />
        </svg>
        
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span 
            className="text-2xl font-bold font-mono text-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {Math.round(percentage)}%
          </motion.span>
        </div>
      </div>
      
      <div className="mt-3 text-center">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {sublabel && (
          <p className="text-xs text-muted-foreground">{sublabel}</p>
        )}
      </div>
    </div>
  );
}
