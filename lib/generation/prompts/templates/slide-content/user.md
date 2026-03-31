# Generation Requirements

## Scene Information

- **Title**: {{title}}
- **Description**: {{description}}
- **Key Points**:
  {{keyPoints}}

{{teacherContext}}

## Available Resources

- **Available Images**: {{assignedImages}}
- **Canvas Size**: {{canvas_width}} × {{canvas_height}} px

## Output Requirements

Based on the scene information above, generate a complete Canvas/PPT component for one page.

**Content Density (CRITICAL)**: The slide must be **highly detailed and information-rich**. A sparse or "clean" slide with minimal text is a failure. You MUST:
1. Provide **at least 5-8 descriptive bullet points** or detailed sub-concepts.
2. Use **multiple levels of information hierarchy** (e.g., main points with secondary explanatory sub-points).
3. Distribute elements across the entire {{canvas_width}} × {{canvas_height}} px canvas to avoid large empty gaps.
4. If the provided "Key Points" are brief, you MUST **intelligently expand** on them using your knowledge to provide depth, examples, or context.
5. Aim for a "professional presentation" look—think information-dense cards, diagrams, or multi-column layouts. A slide with only a title and a few short lines is UNACCEPTABLE.

**Language Requirement**: All generated text content must be in the same language as the title and description above.

**Must Follow**:

1. Output pure JSON directly, without any explanation or description
2. Do not wrap with ```json code blocks
3. Do not add any text before or after the JSON
4. Ensure the JSON format is correct and can be parsed directly
5. Use the provided image_id (e.g., `img_001`) for the `src` field of image elements
6. All TextElement `height` values must be selected from the quick reference table in the system prompt

**Output Structure Example**:
{"background":{"type":"solid","color":"#f8fafc"},"elements":[{"id":"title_001","type":"text","left":60,"top":50,"width":880,"height":76,"content":"<p style=\"font-size:32px; text-align:center;\"><strong>Topic Title</strong></p>","defaultFontName":"","defaultColor":"#1e293b"},{"id":"card_1_bg","type":"shape","left":60,"top":150,"width":430,"height":200,"path":"M 0 0 L 1 0 L 1 1 L 0 1 Z","viewBox":[1,1],"fill":"#ffffff","fixedRatio":false},{"id":"card_1_text","type":"text","left":80,"top":170,"width":390,"height":160,"content":"<p style=\"font-size:20px;\"><strong>Concept A</strong></p><p style=\"font-size:16px;\">• Detail 1: Important fact</p><p style=\"font-size:16px;\">• Detail 2: Another fact</p><p style=\"font-size:16px;\">• Example: Practical use case</p>","defaultFontName":"","defaultColor":"#334155"},{"id":"card_2_bg","type":"shape","left":510,"top":150,"width":430,"height":200,"path":"M 0 0 L 1 0 L 1 1 L 0 1 Z","viewBox":[1,1],"fill":"#ffffff","fixedRatio":false},{"id":"card_2_text","type":"text","left":530,"top":170,"width":390,"height":160,"content":"<p style=\"font-size:20px;\"><strong>Concept B</strong></p><p style=\"font-size:16px;\">• Logic 1: Key rule</p><p style=\"font-size:16px;\">• Logic 2: Secondary rule</p><p style=\"font-size:16px;\">• Note: Critical takeaway</p>","defaultFontName":"","defaultColor":"#334155"},{"id":"footer_sep","type":"shape","left":60,"top":480,"width":880,"height":2,"path":"M 0 0 L 1 0 L 1 1 L 0 1 Z","viewBox":[1,1],"fill":"#e2e8f0","fixedRatio":false}]}

