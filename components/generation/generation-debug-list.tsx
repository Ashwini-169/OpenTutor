'use client';

import { GenerationDebugRecord } from '@/lib/types/generation';
import { Zap, Database, Eye } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';

interface GenerationDebugListProps {
  records: GenerationDebugRecord[];
  onViewResponse?: (record: GenerationDebugRecord) => void;
}

export function GenerationDebugList({ records, onViewResponse }: GenerationDebugListProps) {
  if (!records || records.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground italic border rounded-lg bg-muted/30">
        Awaiting AI metrics...
      </div>
    );
  }

  const totalIn = records.reduce((acc, r) => acc + r.tokensIn, 0);
  const totalOut = records.reduce((acc, r) => acc + r.tokensOut, 0);
  const totalTokens = totalIn + totalOut;
  const avgLatency = Math.round(records.reduce((acc, r) => acc + r.latencyMs, 0) / records.length);

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-lg">
          <div className="text-[10px] text-indigo-500 uppercase tracking-tight font-bold mb-1">Total Tokens</div>
          <div className="text-lg font-bold text-indigo-700 dark:text-indigo-400">
            {totalTokens.toLocaleString()}
          </div>
        </div>
        <div className="p-3 bg-sky-50 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900 rounded-lg">
          <div className="text-[10px] text-sky-500 uppercase tracking-tight font-bold mb-1">Avg Latency</div>
          <div className="text-lg font-bold text-sky-700 dark:text-sky-400">
            {avgLatency}ms
          </div>
        </div>
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900 rounded-lg">
          <div className="text-[10px] text-amber-500 uppercase tracking-tight font-bold mb-1">Requests</div>
          <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
            {records.length}
          </div>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white dark:bg-zinc-950">
        <div className="bg-muted px-3 py-2 border-b flex justify-between font-bold text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Step / Model</span>
          <span>Metrics</span>
        </div>
        <div className="max-h-80 overflow-y-auto divide-y">
          {records.map((record, i) => (
            <motion.div 
              key={record.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="space-y-0.5">
                  <div className="font-bold text-slate-900 dark:text-slate-100">{record.step}</div>
                  <div className="text-slate-500 text-[10px]">{record.model}</div>
                </div>
                <div className="flex items-center gap-1.5 text-amber-500 font-bold">
                  <Zap size={12} />
                  {record.latencyMs}ms
                  {record.rawText && onViewResponse && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onViewResponse(record)}
                      className="size-6 ml-2 text-indigo-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
                      title="View AI Response"
                    >
                      <Eye size={12} />
                    </Button>
                  )}
                </div>
              </div>
              
              <div className="flex items-center gap-4 text-slate-500">
                <div className="flex items-center gap-1.5">
                  <Database size={12} className="text-sky-500" />
                  <span>In: {record.tokensIn.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Database size={12} className="text-indigo-500" />
                  <span>Out: {record.tokensOut.toLocaleString()}</span>
                </div>
              </div>

              <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1 mt-2 rounded-full overflow-hidden flex">
                 <div 
                   className="bg-sky-400 h-full" 
                   style={{ width: `${(record.tokensIn / (record.tokensIn + record.tokensOut)) * 100}%` }}
                 />
                 <div 
                   className="bg-indigo-500 h-full" 
                   style={{ width: `${(record.tokensOut / (record.tokensIn + record.tokensOut)) * 100}%` }}
                 />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
