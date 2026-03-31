/**
 * Hindi Translation Settings Component
 * Allows users to enable/disable Hindi translation for speech, lecture, and chat
 */

'use client';

import { useState } from 'react';
import { Languages, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useSettingsStore } from '@/lib/store/settings';
import { useI18n } from '@/lib/hooks/use-i18n';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface HindiTranslationSettingsProps {
  className?: string;
}

export function HindiTranslationSettings({ className }: HindiTranslationSettingsProps) {
  const { t } = useI18n();
  const hindiModeEnabled = useSettingsStore((s) => s.hindiModeEnabled ?? false);
  const setHindiModeEnabled = useSettingsStore((s) => s.setHindiModeEnabled);
  const [isLoading, setIsLoading] = useState(false);

  const handleToggle = async (enabled: boolean) => {
    try {
      setIsLoading(true);

      // Toggle the setting
      setHindiModeEnabled(enabled);

      // Show feedback
      if (enabled) {
        toast.success('Hindi translation enabled', {
          icon: <CheckCircle2 className="w-4 h-4" />,
          description:
            'Speech, lecture content, and chat messages will be translated to Hindi. Note: This uses free translation (Google Translate) without API keys.',
        });
      } else {
        toast.info('Hindi translation disabled');
      }

      // Log for analytics
      console.log(`[Hindi Mode] ${enabled ? 'Enabled' : 'Disabled'}`);
    } catch (error) {
      // Reset on error
      setHindiModeEnabled(!enabled);
      toast.error('Failed to update setting');
      console.error('Failed to toggle Hindi mode:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className={cn('border border-blue-200  dark:border-blue-800/30', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-300">
              <Languages className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">
                हिंदी mode | Hindi Translation
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Zero-API Hindi translation for speech, lecture, and chat
              </CardDescription>
            </div>
          </div>
          <Switch
            checked={hindiModeEnabled}
            onCheckedChange={handleToggle}
            disabled={isLoading}
            aria-label="Enable Hindi translation"
          />
        </div>
      </CardHeader>

      {hindiModeEnabled && (
        <CardContent className="space-y-3">
          {/* Feature list */}
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500/60 flex-shrink-0" />
              <span>
                <strong>Speech:</strong> Student speech will be auto-translated to Hindi
              </span>
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500/60 flex-shrink-0" />
              <span>
                <strong>Lecture:</strong> AI lecture content displayed in Hindi
              </span>
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-500/60 flex-shrink-0" />
              <span>
                <strong>Chat:</strong> Discussion and Q&A messages translated to Hindi
              </span>
            </div>
          </div>

          {/* Info badge */}
          <div className="flex items-start gap-2 p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800/30">
            <AlertCircle className="w-4 h-4 mt-0.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <div className="text-xs text-blue-700 dark:text-blue-300">
              <strong>Zero-Cost:</strong> Uses free Google Translate Web endpoint - no API keys required.
              Text is cached to minimize translate requests.
            </div>
          </div>

          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Updating...
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Compact version for quick toggle (without description)
 */
export function HindiTranslationQuickToggle() {
  const hindiModeEnabled = useSettingsStore((s) => s.hindiModeEnabled ?? false);
  const setHindiModeEnabled = useSettingsStore((s) => s.setHindiModeEnabled);

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted transition-colors">
      <Languages className="w-4 h-4 text-muted-foreground" />
      <span className="text-sm font-medium">हिंदी Mode</span>
      <Switch
        checked={hindiModeEnabled}
        onCheckedChange={setHindiModeEnabled}
        className="ml-auto"
      />
    </div>
  );
}
