
const PREFERRED_OLLAMA_MODELS = [
  'qwen2.5:3b',
  'qwen2.5-coder:1.5b-base',
  'kavai/qwen3.5-Gemini-Design:2b',
  'qwen3.5:2b',
  'hf.co/Jackrong/Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-v2-GGUF:Q4_K_M',
  'kavai/qwen3.5-GPT5:2b',
];

const OLLAMA_MODELS_ENV = 'qwen2.5:3b,qwen3.5:2b,qwen2.5-coder:1.5b-base,kavai/qwen3.5-GPT5:2b,kavai/qwen3.5-Gemini-Design:2b,aliafshar/gemma3-it-qat-tools:4b';

const detected = new Set([
    'qwen2.5:3b',
    'aliafshar/gemma3-it-qat-tools:4b',
    'other-model:latest'
]);

function test() {
    const envPreferred = (OLLAMA_MODELS_ENV || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const combinedPreferred = [...new Set([...envPreferred, ...PREFERRED_OLLAMA_MODELS])];

    const detectedSet = new Set(detected);
    const orderedPreferred = combinedPreferred.filter((name) => detectedSet.has(name));
    const others = Array.from(detected).filter((name) => !combinedPreferred.includes(name));

    const orderedNames = [...orderedPreferred, ...others];
    
    console.log('Resulting ordered names:', orderedNames);
    
    const includesGemma = orderedNames.includes('aliafshar/gemma3-it-qat-tools:4b');
    const includesOther = orderedNames.includes('other-model:latest');
    
    if (includesGemma && includesOther) {
        console.log('TEST PASSED: Both Gemma and other models are included.');
    } else {
        console.log('TEST FAILED: Some models are missing.');
    }
}

test();
