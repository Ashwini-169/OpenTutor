'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Terminal, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LiveResponseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
  model: string;
}

export function LiveResponseModal({
  isOpen,
  onClose,
  title,
  content,
  model,
}: LiveResponseModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-[90vw] h-[80vh] flex flex-col p-0 gap-0 overflow-hidden bg-zinc-950 border-zinc-800 text-zinc-100">
        <DialogHeader className="p-4 border-b border-zinc-800 flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-500/20 rounded-md">
              <Terminal className="size-4 text-indigo-400" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold tracking-tight">
                {title}
              </DialogTitle>
              <div className="text-[10px] text-zinc-500 font-mono">
                Model: {model}
              </div>
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-8 px-2 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            {copied ? (
              <Check className="size-4 mr-1.5 text-green-500" />
            ) : (
              <Copy className="size-4 mr-1.5" />
            )}
            <span className="text-xs">{copied ? 'Copied' : 'Copy Raw'}</span>
          </Button>
        </DialogHeader>

        <div className="flex-1 relative overflow-hidden bg-black/50">
          <ScrollArea className="h-full w-full">
            <div className="p-6 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-zinc-300">
              {content || (
                <div className="flex flex-col items-center justify-center h-40 text-zinc-600 gap-2 italic">
                   <div className="size-2 bg-indigo-500 rounded-full animate-ping" />
                   Awaiting stream...
                </div>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="p-2 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
          <div className="text-[10px] text-zinc-600 font-mono flex items-center gap-4">
             <span>Chars: {content.length}</span>
             <span>Est. Tokens: {Math.ceil(content.length / 4)}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
