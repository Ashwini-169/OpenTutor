'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, X, Database, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { useDebugStore } from '@/lib/store/debug-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function TokenDebugPanel() {
  const { isOpen, records, toggleOpen, getTotalTokens, clearRecords } = useDebugStore();
  const [expanded, setExpanded] = useState(false);
  
  const { in: totalIn, out: totalOut } = getTotalTokens();
  const totalTokens = totalIn + totalOut;

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed bottom-4 left-4 z-[100] w-80 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md shadow-2xl rounded-xl border border-indigo-200 dark:border-indigo-900 overflow-hidden flex flex-col font-mono text-xs"
    >
      <div 
        className="flex items-center justify-between p-3 bg-indigo-50 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 font-bold text-indigo-700 dark:text-indigo-400">
          <Activity size={16} className="text-indigo-500" />
          <span>AI Metrics (Beta)</span>
        </div>
        <div className="flex items-center gap-1">
          {expanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          <button 
            onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
            className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded-md"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      
      <div className="p-3 bg-slate-50 dark:bg-zinc-900 flex justify-between items-center text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-1.5">
          <Database size={14} />
          <span>{totalTokens.toLocaleString()} tokens</span>
        </div>
        <button 
          onClick={clearRecords}
          className="text-xs hover:text-red-500 transition-colors"
        >
          Clear
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div 
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="max-h-60 overflow-y-auto p-2 space-y-1.5 hide-scrollbar">
              {records.length === 0 ? (
                <div className="p-4 text-center text-slate-400 italic">
                  Awaiting AI generations...
                </div>
              ) : (
                records.map((r) => (
                  <div key={r.id} className="p-2 bg-white dark:bg-zinc-950 rounded border border-slate-100 dark:border-slate-800 shadow-sm">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300 truncate w-32">{r.step}</span>
                      <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <Zap size={10} className="text-amber-500" />
                        {r.latencyMs}ms
                      </span>
                    </div>
                    {r.agentId && (
                      <div className="text-[10px] text-indigo-500 mb-1.5">Agent: {r.agentId}</div>
                    )}
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>In: {r.tokensIn.toLocaleString()}</span>
                      <span>Out: {r.tokensOut.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-zinc-800 h-1 mt-1.5 rounded-full overflow-hidden flex">
                       <div 
                         className="bg-sky-400 h-full" 
                         style={{ width: `${(r.tokensIn / (r.tokensIn + r.tokensOut)) * 100}%` }}
                       />
                       <div 
                         className="bg-indigo-500 h-full" 
                         style={{ width: `${(r.tokensOut / (r.tokensIn + r.tokensOut)) * 100}%` }}
                       />
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
