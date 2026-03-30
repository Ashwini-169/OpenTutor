'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle, Circle } from 'lucide-react';
import { useI18n } from '@/lib/hooks/use-i18n';
import { GenerationDebugList } from './generation-debug-list';
import type { GenerationDebugRecord } from '@/lib/types/generation';
import { Button } from '@/components/ui/button';
import { Bot } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface GeneratingProgressProps {
  outlineReady: boolean; // Is outline generation complete?
  firstPageReady: boolean; // Is first page generated?
  statusMessage: string;
  error?: string | null;
  debugRecords?: GenerationDebugRecord[];
}

// Status item component - declared outside main component
function StatusItem({
  completed,
  inProgress,
  hasError,
  label,
}: {
  completed: boolean;
  inProgress: boolean;
  hasError: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-shrink-0">
        {hasError ? (
          <XCircle className="size-6 text-destructive" />
        ) : completed ? (
          <CheckCircle2 className="size-6 text-green-500" />
        ) : inProgress ? (
          <Loader2 className="size-6 text-primary animate-spin" />
        ) : (
          <Circle className="size-6 text-muted-foreground" />
        )}
      </div>
      <span
        className={`text-base ${
          hasError
            ? 'text-destructive'
            : completed
              ? 'text-green-600 font-medium'
              : inProgress
                ? 'text-primary font-medium'
                : 'text-muted-foreground'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

export function GeneratingProgress({
  outlineReady,
  firstPageReady,
  statusMessage,
  error,
  debugRecords = [],
}: GeneratingProgressProps) {
  const { t } = useI18n();
  const [dots, setDots] = useState('');
  const [showDebug, setShowDebug] = useState(false);

  // Animated dots for loading state
  useEffect(() => {
    if (!error && !firstPageReady) {
      const interval = setInterval(() => {
        setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
      }, 500);
      return () => clearInterval(interval);
    }
  }, [error, firstPageReady]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {error ? (
              <>
                <XCircle className="size-5 text-destructive" />
                {t('generation.generationFailed')}
              </>
            ) : firstPageReady ? (
              <>
                <CheckCircle2 className="size-5 text-green-500" />
                {t('generation.openingClassroom')}
              </>
            ) : (
              <>
                <Loader2 className="size-5 animate-spin" />
                {t('generation.generatingCourse')}
                {dots}
              </>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Two milestone status items */}
          <div className="divide-y">
            <StatusItem
              completed={outlineReady}
              inProgress={!outlineReady && !error}
              hasError={!outlineReady && !!error}
              label={
                outlineReady ? t('generation.outlineReady') : t('generation.generatingOutlines')
              }
            />
            <StatusItem
              completed={firstPageReady}
              inProgress={outlineReady && !firstPageReady && !error}
              hasError={outlineReady && !firstPageReady && !!error}
              label={
                firstPageReady
                  ? t('generation.firstPageReady')
                  : t('generation.generatingFirstPage')
              }
            />
          </div>

          {/* Status message */}
          {statusMessage && !error && (
            <div className="pt-2 border-t">
              <p className="text-sm text-muted-foreground">{statusMessage}</p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Debug Toggle & Panel */}
          {debugRecords.length > 0 && (
            <div className="pt-4 mt-4 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                  <Bot className="size-3.5" />
                  {t('debug.generationMetrics')}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDebug(!showDebug)}
                  className="text-[10px] h-6 px-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {showDebug ? t('common.hide') : t('common.show')}
                </Button>
              </div>

              <AnimatePresence>
                {showDebug && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-slate-50/50 dark:bg-slate-900/50 rounded-lg border border-slate-100 dark:border-slate-800 p-0.5">
                      <GenerationDebugList records={debugRecords} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
