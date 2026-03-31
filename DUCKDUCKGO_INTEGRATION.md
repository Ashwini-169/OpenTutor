# DuckDuckGo Web Search Integration Guide

## ✅ Overview

Successfully added **DuckDuckGo** as a web search provider option alongside Tavily.

### Key Features:
- **Zero API Cost** - DuckDuckGo's Instant Answer API is completely free
- **No Authentication Required** - No API key needed
- **Instant Answers** - Direct answers to queries
- **Fallback to Tavily** - Use Tavily as backup for more premium results

---

## 📋 Files Modified/Created

1. **`lib/web-search/types.ts`** - Added `'duckduckgo'` to `WebSearchProviderId` type
2. **`lib/web-search/constants.ts`** - Added DuckDuckGo provider config
3. **`lib/web-search/duckduckgo.ts`** - NEW: DuckDuckGo search implementation
4. **`app/api/web-search/route.ts`** - Updated to support both providers with routing logic
5. **`lib/store/settings.ts`** - Set DuckDuckGo as default provider (free!)

---

## 🚀 How It Works

### Default Behavior
- **Default Provider**: DuckDuckGo (free, no setup needed)
- **Alternative**: Tavily (requires API key)

### API Request Format

```json
{
  "query": "What is machine learning?",
  "provider": "duckduckgo",  // or "tavily"
  "apiKey": "optional-for-tavily"
}
```

### API Routing Logic

```
POST /api/web-search
├─ provider = "duckduckgo" → searchWithDuckDuckGo()
├─ provider = "tavily" → searchWithTavily({apiKey})
└─ default → "duckduckgo"
```

---

## 💻 Usage Examples

### 1. Simple Search (Uses Default DuckDuckGo)

```typescript
const response = await fetch('/api/web-search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: 'What is Machine Learning?'
  })
});

const result = await response.json();
console.log(result.answer);
console.log(result.sources);
```

### 2. Explicit Provider Selection

```typescript
// Use DuckDuckGo explicitly
const response = await fetch('/api/web-search', {
  method: 'POST',
  body: JSON.stringify({
    query: 'latest AI breakthroughs',
    provider: 'duckduckgo'
  })
});

// Or fallback to Tavily with API key
const tavilyResponse = await fetch('/api/web-search', {
  method: 'POST',
  body: JSON.stringify({
    query: 'latest AI breakthroughs',
    provider: 'tavily',
    apiKey: process.env.TAVILY_API_KEY
  })
});
```

### 3. In Components (with Provider Selection)

```tsx
export function SearchComponent() {
  const webSearchProviderId = useSettingsStore(s => s.webSearchProviderId);
  const webSearchProvidersConfig = useSettingsStore(s => s.webSearchProvidersConfig);

  const handleSearch = async (query: string) => {
    const config = webSearchProvidersConfig[webSearchProviderId];
    
    const response = await fetch('/api/web-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        provider: webSearchProviderId,
        apiKey: config?.apiKey
      })
    });

    const result = await response.json();
    return result;
  };

  return (
    <div>
      <button onClick={() => handleSearch('hello world')}>
        Search with {webSearchProviderId}
      </button>
    </div>
  );
}
```

---

## ⚙️ Settings UI

1. Go to **Settings → Web Search**
2. Select **DuckDuckGo** (✨ Recommended - Free!)
3. Or select **Tavily** and enter your API key

---

## 📊 Provider Comparison

| Feature | DuckDuckGo | Tavily |
|---------|-----------|--------|
| **Cost** | 🎉 Free | Paid |
| **Auth Required** | ❌ No | ✅ Yes (API Key) |
| **Instant Answers** | ✅ Yes | ✅ Yes |
| **Result Quality** | Good | Excellent |
| **Daily Limits** | None | Depends on plan |
| **Setup Time** | 0 seconds | Configure API key |

---

## 🔧 Technical Details

### DuckDuckGo API
- **Endpoint**: `https://api.duckduckgo.com`
- **Method**: GET with query parameters
- **Response**: JSON with instant answers and related topics

### Request Format
```
GET https://api.duckduckgo.com?q=<query>&format=json&no_html=1&t=openmaic
```

### Response Fields Used
- `Answer` - Direct answer to query
- `AbstractText` - Summary/abstract  
- `RelatedTopics` - Related search results
- `Results` - General search results

---

## 🐛 Troubleshooting

### DuckDuckGo Returns No Results
- This is normal for very specific queries
- Check if query is valid
- Tavily may have better results for specialized searches

### Switching Providers
1. Open Settings → Web Search
2. Click on **DuckDuckGo** or **Tavily**
3. Settings auto-save

### Clearing Cache
DuckDuckGo responses are typically fresh, no cache clearing needed.

---

## 📝 Integration Examples

### In Generation Process

```typescript
export async function generateCourseContent(params: {
  query: string;
  useWebSearch: boolean;
}) {
  if (params.useWebSearch) {
    const searchResult = await fetch('/api/web-search', {
      method: 'POST',
      body: JSON.stringify({ query: params.query })
    });
    
    const { context } = await searchResult.json();
    // Use context in prompt
  }
}
```

### With Error Handling

```typescript
async function searchWithFallback(query: string) {
  try {
    // Try DuckDuckGo first (fast, free)
    const response = await fetch('/api/web-search', {
      method: 'POST',
      body: JSON.stringify({ query, provider: 'duckduckgo' })
    });
    
    if (!response.ok) throw new Error('DuckDuckGo failed');
    return await response.json();
  } catch (error) {
    console.log('DuckDuckGo failed, trying Tavily...');
    
    // Fallback to Tavily if DuckDuckGo fails
    const fallback = await fetch('/api/web-search', {
      method: 'POST',
      body: JSON.stringify({ 
        query, 
        provider: 'tavily',
        apiKey: process.env.TAVILY_API_KEY 
      })
    });
    
    return await fallback.json();
  }
}
```

---

## ✨ Benefits

✅ **Cost-Effective**: Save on search API costs by using DuckDuckGo  
✅ **Zero Setup**: No API keys, no authentication  
✅ **Privacy-Friendly**: DuckDuckGo doesn't track users  
✅ **Instant Answers**: Get direct answers to questions  
✅ **Flexible**: Switch between providers as needed  

---

## 🎯 Next Steps

1. ✅ DuckDuckGo provider added
2. ✅ Set as default provider
3. ✅ API routing implemented
4. ✅ Settings UI ready
5. Future: Add more providers (Google Custom Search, Bing, etc.)

---

## Notes

- DuckDuckGo is completely free and requires no API key
- Tavily is available as a premium alternative for more powerful results
- The web-search route defaults to DuckDuckGo if no provider is specified
- Both providers return results in the same format for easy switching
