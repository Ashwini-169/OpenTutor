Title: {{title}}
Description: {{description}}
Test Points: {{keyPoints}}
Question Count: {{questionCount}}, Difficulty: {{difficulty}}, Question Types: {{questionTypes}}

**Language Requirement**: Questions and options must be in the same language as the title and description above.

**CRITICAL REQUIREMENTS FOR EACH QUESTION**:
1. Each question MUST have exactly 4 options for single/multiple choice
2. The "correctAnswer" field MUST be set to ONE of the option texts exactly (not abbreviated, not option letter)
3. For multiple choice questions, "correctAnswer" can be an array: ["Option A", "Option C']
4. DO NOT create questions without a proper correctAnswer
5. VALIDATE that correctAnswer matches one of your options word-for-word

Output JSON array directly (no explanation, no code blocks, no LaTeX):
[{"id":"q1","type":"single","question":"Question text","options":["Option A","Option B","Option C","Option D"],"correctAnswer":"Option A","points":1}]
