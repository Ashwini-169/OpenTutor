# Hindi Translation Integration Guide

## 🎯 Overview

The Zero-API Hindi translation system has been implemented with the following components:

### Core Files Created:
1. **`lib/i18n/translate-service.ts`** - Google Translate Web service (no API key needed)
2. **`lib/hooks/use-translation.ts`** - React hooks for component integration
3. **`lib/hooks/use-hindi-speech-translation.ts`** - Speech-specific translation wrapper
4. **`components/settings/hindi-translation-settings.tsx`** - Settings UI component
5. **`lib/store/settings.ts`** - Enhanced with `hindiModeEnabled` setting

---

## 🚀 Quick Start

### 1. **Enable Hindi Mode in Settings**

Add the settings component to your settings page:

```tsx
import { HindiTranslationSettings } from '@/components/settings/hindi-translation-settings';

export function SettingsPage() {
  return (
    <div className="space-y-6">
      {/* ... other settings ... */}
      <HindiTranslationSettings />
    </div>
  );
}
```

Or use the quick toggle in a menu:

```tsx
import { HindiTranslationQuickToggle } from '@/components/settings/hindi-translation-settings';

export function LanguageMenu() {
  return (
    <div className="space-y-2">
      <HindiTranslationQuickToggle />
    </div>
  );
}
```

---

## 💬 Integration Points

### 2. **Translate Chat Messages**

In `components/chat/chat-session.tsx`:

```tsx
import { useTranslation } from '@/lib/hooks/use-translation';

export function ChatSessionComponent({ messages }) {
  const { translate } = useTranslation({ targetLang: 'hi' });
  
  const renderMessage = async (message) => {
    const displayText = await translate(message.text);
    return <div>{displayText}</div>;
  };
  
  return (
    <div>
      {messages.map(msg => renderMessage(msg))}
    </div>
  );
}
```

### 3. **Translate Speech Actions**

In `components/action/engine.ts` or speech handler:

```tsx
import { useHindiSpeechTranslation } from '@/lib/hooks/use-hindi-speech-translation';

export function useSpeechWithTranslation() {
  const { translateSpeechAction } = useHindiSpeechTranslation();
  
  const playSpeech = async (action: SpeechAction) => {
    // Translate the speech action text if Hindi mode is enabled
    const translatedAction = await translateSpeechAction(action);
    
    // Use translated action for TTS generation
    await generateAndPlayTTS(translatedAction.text);
  };
  
  return { playSpeech };
}
```

### 4. **Translate Lecture Content**

In `components/chat/lecture-notes-view.tsx`:

```tsx
import { useTranslation } from '@/lib/hooks/use-translation';

export function LectureNotesView({ notes }) {
  const { translate, isTranslating } = useTranslation({ targetLang: 'hi' });
  
  const renderNote = async (note) => {
    const displayText = await translate(note.text);
    return <div>{displayText}</div>;
  };
  
  return (
    <div>
      {notes.map(note => (
        <div key={note.id}>
          {isTranslating && <Spinner />}
          {renderNote(note)}
        </div>
      ))}
    </div>
  );
}
```

### 5. **Translate Discussion/QA Messages**

In `components/roundtable/discussion-view.tsx`:

```tsx
import { useTranslation } from '@/lib/hooks/use-translation';

export function DiscussionView({ discussion }) {
  const { translateBatch } = useTranslationBatch({ targetLang: 'hi' });
  
  useEffect(() => {
    // Batch translate multiple messages
    const messages = discussion.map(d => d.message);
    translateBatch(messages).then(translated => {
      // Update UI with translated messages
    });
  }, [discussion]);
  
  return <div>{/* render translated discussion */}</div>;
}
```

---

## 🔧 API Reference

### `useTranslation(options?)`

```tsx
const { translate, isTranslating, error, getCurrentLang, clearCache } = useTranslation({
  targetLang: 'hi',      // Optional: target language (auto-detected if not provided)
  enabled: true,         // Optional: disable translation if needed
  cacheTimeout: 3600000  // Optional: cache timeout in ms
});

// Translate a single text
const hindi = await translate('Hello world', 'hi');

// Check if currently translating
if (isTranslating) console.log('Translating...');

// Handle errors
if (error) console.error('Translation error:', error);

// Clear cache if needed
clearCache();
```

### `useTranslationBatch(options?)`

```tsx
const { translateBatch, isTranslating, error } = useTranslationBatch({
  targetLang: 'hi'
});

// Translate multiple texts
const [hindi1, hindi2, hindi3] = await translateBatch([
  'Hello',
  'World',
  'How are you?'
], 'hi');
```

### `translateText(text, targetLang, options?)`

Lower-level function for direct use:

```tsx
import { translateText } from '@/lib/i18n/translate-service';

const hindi = await translateText('Hello', 'hi', {
  useCache: true,
  timeout: 5000
});
```

### `detectLanguage(text)`

Detect the language of a text:

```tsx
import { detectLanguage } from '@/lib/i18n/translate-service';

const lang = detectLanguage('नमस्ते'); // 'hi'
const lang2 = detectLanguage('Hello'); // 'en'
```

---

## ⚙️ Settings Store Integration

The Hindi mode is stored in the settings store and persisted to localStorage:

```tsx
import { useSettingsStore } from '@/lib/store/settings';

// Check if Hindi mode is enabled
const hindiModeEnabled = useSettingsStore(s => s.hindiModeEnabled);

// Toggle Hindi mode
useSettingsStore.getState().setHindiModeEnabled(true);
```

---

## 🎨 Features

### ✅ Zero API Cost
- Uses Google Translate Web endpoint (no API key required)
- Completely free

### ✅ Smart Caching
- Caches translations to minimize requests
- Cache expires after 1 hour
- Batch with rate limiting to avoid API throttling

### ✅ Language Detection
- Automatically detects if text is already in target language
- Skips redundant translations

### ✅ Fallback Support
- Falls back to original text if translation fails
- Never breaks functionality

### ✅ Performance
- Client-side execution
- Async/await patterns for non-blocking UI
- Configurable timeouts (default: 5 seconds)

---

## 📝 Usage Examples

### Example 1: Simple Chat Message Translation

```tsx
export function ChatBubble({ message }) {
  const { translate } = useTranslation();
  const [displayText, setDisplayText] = useState(message.text);
  
  useEffect(() => {
    translate(message.text).then(setDisplayText);
  }, [message.text, translate]);
  
  return <div className="p-4 bg-blue-100 rounded">{displayText}</div>;
}
```

### Example 2: Real-time Speech Translation

```tsx
export function SpeechHandler() {
  const { translateSpeechAction } = useHindiSpeechTranslation();
  const { execute } = useActionEngine();
  
  const handleSpeechAction = async (action: SpeechAction) => {
    const translated = await translateSpeechAction(action);
    execute(translated);
  };
  
  return <button onClick={() => handleSpeechAction(speechAction)}>Play</button>;
}
```

### Example 3: Batch Translation with UI

```tsx
export function LectureNotes({ notes }) {
  const { translateBatch, isTranslating } = useTranslationBatch();
  const [translatedNotes, setTranslatedNotes] = useState<typeof notes>([]);
  
  useEffect(() => {
    const texts = notes.map(n => n.content);
    translateBatch(texts, 'hi').then(translated => {
      setTranslatedNotes(
        notes.map((n, i) => ({ ...n, content: translated[i] }))
      );
    });
  }, [notes, translateBatch]);
  
  if (isTranslating) return <Skeleton />;
  
  return (
    <div>
      {translatedNotes.map(note => (
        <div key={note.id}>{note.content}</div>
      ))}
    </div>
  );
}
```

---

## 🐛 Troubleshooting

### Translation Not Working?

1. **Check if Hindi mode is enabled:**
   ```tsx
   const enabled = useSettingsStore(s => s.hindiModeEnabled);
   console.log('Hindi mode:', enabled);
   ```

2. **Check cache stats:**
   ```tsx
   import { getTranslationCacheStats } from '@/lib/i18n/translate-service';
   console.log('Cache:', getTranslationCacheStats());
   ```

3. **Clear cache if translations are stale:**
   ```tsx
   import { clearTranslationCache } from '@/lib/i18n/translate-service';
   clearTranslationCache();
   ```

### Performance Issues?

- The default timeout is 5 seconds, increase for slower connections:
  ```tsx
  const { translate } = useTranslation();
  await translate('text', { timeout: 10000 });
  ```

- Use batch translation for multiple texts instead of individual calls

---

## 🌐 Supported Languages

Currently optimized for Hindi, but supports all Google Translate languages:
- `'hi'` - Hindi
- `'en'` - English
- `'es'` - Spanish
- `'fr'` - French
- `'de'` - German
- `'zh'` - Chinese
- `'ja'` - Japanese
- `'ar'` - Arabic

---

## 📚 Next Steps

1. Add the `HindiTranslationSettings` component to your settings page
2. Update chat components to use `useTranslation` hook
3. Integrate speech translation via `useHindiSpeechTranslation`
4. Test with Hindi mode enabled/disabled
5. Monitor performance and adjust cache settings as needed

---

## 💡 Tips

- **For UI Components:** Use the custom hooks (`useTranslation`, `useTranslationBatch`)
- **For One-Off Translations:** Use the service directly (`translateText`, `translateBatch`)
- **For Performance:** Use batch translation when possible
- **For Debugging:** Check cache stats and clear cache if needed
- **For Fallback:** Always provide the original text as fallback in UI

---

## Notes

- Translations are cached per-session (clear on app reload unless cached)
- Google Translate Web endpoint is unofficial but widely used and stable
- No rate limiting issues expected for normal classroom use
- Text detection works for mixed-language content (hybrid English-Hindi)
