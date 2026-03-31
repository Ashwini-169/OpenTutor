export const enum ShapePathFormulasKeys {
  ROUND_RECT = 'roundRect',
  ROUND_RECT_DIAGONAL = 'roundRectDiagonal',
  ROUND_RECT_SINGLE = 'roundRectSingle',
  ROUND_RECT_SAMESIDE = 'roundRectSameSide',
  CUT_RECT_DIAGONAL = 'cutRectDiagonal',
  CUT_RECT_SINGLE = 'cutRectSingle',
  CUT_RECT_SAMESIDE = 'cutRectSameSide',
  CUT_ROUND_RECT = 'cutRoundRect',
  MESSAGE = 'message',
  ROUND_MESSAGE = 'roundMessage',
  L = 'L',
  RING_RECT = 'ringRect',
  PLUS = 'plus',
  TRIANGLE = 'triangle',
  PARALLELOGRAM_LEFT = 'parallelogramLeft',
  PARALLELOGRAM_RIGHT = 'parallelogramRight',
  TRAPEZOID = 'trapezoid',
  BULLET = 'bullet',
  INDICATOR = 'indicator',
  DONUT = 'donut',
  DIAGSTRIPE = 'diagStripe',
}

export const enum ElementTypes {
  TEXT = 'text',
  IMAGE = 'image',
  SHAPE = 'shape',
  LINE = 'line',
  CHART = 'chart',
  TABLE = 'table',
  LATEX = 'latex',
  VIDEO = 'video',
  AUDIO = 'audio',
}

/**
 * ग्रैडिएंट (Gradient)
 *
 * type: ग्रैडिएंट प्रकार: रेडियल या लीनियर (Gradient type: radial, linear)
 *
 * colors: ग्रैडिएंट रंगों की सूची: प्रतिशत स्थिति और रंग (Gradient colors list: position and color)
 *
 * rotate: ग्रैडिएंट रोटेशन: लीनियर ग्रैडिएंट के लिए (Gradient rotation: for linear gradient)
 */
export type GradientType = 'linear' | 'radial';
export type GradientColor = {
  pos: number;
  color: string;
};
export interface Gradient {
  type: GradientType;
  colors: GradientColor[];
  rotate: number;
}

export type LineStyleType = 'solid' | 'dashed' | 'dotted';

/**
 * एलिमेंट शैडो (Element Shadow)
 *
 * h: क्षैतिज ऑफ़सेट (Horizontal offset)
 *
 * v: लंबवत ऑफ़सेट (Vertical offset)
 *
 * blur: ब्लर डिग्री (Blur degree)
 *
 * color: शैडो कलर (Shadow color)
 */
export interface PPTElementShadow {
  h: number;
  v: number;
  blur: number;
  color: string;
}

/**
 * एलिमेंट आउटलाइन (Element Outline)
 *
 * style?: आउटलाइन स्टाइल: सॉलिड या डैश्ड (Outline style: solid or dashed)
 *
 * width?: आउटलाइन विड्थ (Outline width)
 *
 * color?: आउटलाइन कलर (Outline color)
 */
export interface PPTElementOutline {
  style?: LineStyleType;
  width?: number;
  color?: string;
}

export type ElementLinkType = 'web' | 'slide';

/**
 * एलिमेंट हाइपरलिंक (Element Hyperlink)
 *
 * type: लिंक प्रकार: वेब या स्लाइड (Link type: web or slide)
 *
 * target: लक्ष्य पता: वेब लिंक या स्लाइड आईडी (Target address: web link or slide ID)
 */
export interface PPTElementLink {
  type: ElementLinkType;
  target: string;
}

/**
 * सामान्य एलिमेंट गुण (General Element Properties)
 *
 * id: एलिमेंट आईडी (Element ID)
 *
 * left: क्षैतिज स्थिति: कैनवस के बाईं ओर से (Horizontal position from canvas left)
 *
 * top: लंबवत स्थिति: कैनवस के ऊपर से (Vertical position from canvas top)
 *
 * lock?: एलिमेंट लॉक करें (Lock element)
 *
 * groupId?: ग्रुप आईडी: एक ही ग्रुप के सदस्यों के लिए (Group ID: for elements in the same group)
 *
 * width: एलिमेंट की चौड़ाई (Element width)
 *
 * height: एलिमेंट की ऊंचाई (Element height)
 *
 * rotate: रोटेशन एंगल (Rotation angle)
 *
 * link?: हाइपरलिंक (Hyperlink)
 *
 * name?: एलिमेंट का नाम (Element name)
 */
interface PPTBaseElement {
  id: string;
  left: number;
  top: number;
  lock?: boolean;
  groupId?: string;
  width: number;
  height: number;
  rotate: number;
  link?: PPTElementLink;
  name?: string;
}

export type TextType =
  | 'title'
  | 'subtitle'
  | 'content'
  | 'item'
  | 'itemTitle'
  | 'notes'
  | 'header'
  | 'footer'
  | 'partNumber'
  | 'itemNumber';

/**
 * टेक्स्ट एलिमेंट (Text Element)
 *
 * type: एलिमेंट प्रकार (Element type: text)
 *
 * content: टेक्स्ट कंटेंट: HTML स्ट्रिंग (Text content: HTML string)
 *
 * defaultFontName: डिफ़ॉल्ट फ़ॉन्ट: इनलाइन स्टाइल द्वारा बदला जा सकता है (Default font: can be overridden by inline styles)
 *
 * defaultColor: डिफ़ॉल्ट रंग: इनलाइन स्टाइल द्वारा बदला जा सकता है (Default color: can be overridden by inline styles)
 *
 * outline?: आउटलाइन (Outline)
 *
 * fill?: फिल कलर (Fill color)
 *
 * lineHeight?: लाइन हाइट: डिफ़ॉल्ट 1.5 (Line height: default 1.5)
 *
 * wordSpace?: वर्ड स्पेसिंग: डिफ़ॉल्ट 0 (Word spacing: default 0)
 *
 * opacity?: ओपेसिटी: डिफ़ॉल्ट 1 (Opacity: default 1)
 *
 * shadow?: शैडो (Shadow)
 *
 * paragraphSpace?: पैराग्राफ स्पेसिंग: डिफ़ॉल्ट 5px (Paragraph spacing: default 5px)
 *
 * vertical?: वर्टिकल टेक्स्ट (Vertical text)
 *
 * textType?: टेक्स्ट प्रकार (Text type)
 */
export interface PPTTextElement extends PPTBaseElement {
  type: 'text';
  content: string;
  defaultFontName: string;
  defaultColor: string;
  outline?: PPTElementOutline;
  fill?: string;
  lineHeight?: number;
  wordSpace?: number;
  opacity?: number;
  shadow?: PPTElementShadow;
  paragraphSpace?: number;
  vertical?: boolean;
  textType?: TextType;
}

/**
 * इमेज और शेप फ्लिप (Image and Shape Flip)
 *
 * flipH?: क्षैतिज फ्लिप (Horizontal flip)
 *
 * flipV?: लंबवत फ्लिप (Vertical flip)
 */
export interface ImageOrShapeFlip {
  flipH?: boolean;
  flipV?: boolean;
}

/**
 * इमेज फ़िल्टर (Image Filter)
 *
 * https://developer.mozilla.org/hi-IN/docs/Web/CSS/filter
 *
 * 'blur'?: ब्लर (Blur), डिफ़ॉल्ट (Default) 0 (px)
 *
 * 'brightness'?: ब्राइटनेस (Brightness), डिफ़ॉल्ट (Default) 100 (%)
 *
 * 'contrast'?: कंट्रास्ट (Contrast), डिफ़ॉल्ट (Default) 100 (%)
 *
 * 'grayscale'?: ग्रेस्केल (Grayscale), डिफ़ॉल्ट (Default) 0 (%)
 *
 * 'saturate'?: सैचुरेशन (Saturation), डिफ़ॉल्ट (Default) 100 (%)
 *
 * 'hue-rotate'?: ह्यू रोटेट (Hue Rotate), डिफ़ॉल्ट (Default) 0 (deg)
 *
 * 'opacity'?: ओपेसिटी (Opacity), डिफ़ॉल्ट (Default) 100 (%)
 */
export type ImageElementFilterKeys =
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'grayscale'
  | 'saturate'
  | 'hue-rotate'
  | 'opacity'
  | 'sepia'
  | 'invert';
export interface ImageElementFilters {
  blur?: string;
  brightness?: string;
  contrast?: string;
  grayscale?: string;
  saturate?: string;
  'hue-rotate'?: string;
  sepia?: string;
  invert?: string;
  opacity?: string;
}

export type ImageClipDataRange = [[number, number], [number, number]];

/**
 * इमेज क्रॉपिंग (Image Cropping)
 *
 * range: क्रॉप रेंज: जैसे [[10, 10], [90, 90]] (Crop range: e.g., [[10, 10], [90, 90]])
 *
 * shape: क्रॉप शेप: configs/image-clip.ts देखें (Crop shape: see configs/image-clip.ts)
 */
export interface ImageElementClip {
  range: ImageClipDataRange;
  shape: string;
}

export type ImageType = 'pageFigure' | 'itemFigure' | 'background';

/**
 * इमेज एलिमेंट (Image Element)
 *
 * type: एलिमेंट प्रकार (Element type: image)
 *
 * fixedRatio: आस्पेक्ट रेशियो फिक्स रखें (Fixed aspect ratio)
 *
 * src: इमेज एड्रेस (Image address)
 *
 * outline?: आउटलाइन (Outline)
 *
 * filters?: इमेज फ़िल्टर (Image filters)
 *
 * clip?: क्रॉप जानकारी (Crop info)
 *
 * flipH?: क्षैतिज फ्लिप (Horizontal flip)
 *
 * flipV?: लंबवत फ्लिप (Vertical flip)
 *
 * shadow?: शैडो (Shadow)
 *
 * radius?: कॉर्नर रेडियस (Corner radius)
 *
 * colorMask?: कलर मास्क (Color mask)
 *
 * imageType?: इमेज प्रकार (Image type)
 */
export interface PPTImageElement extends PPTBaseElement {
  type: 'image';
  fixedRatio: boolean;
  src: string;
  outline?: PPTElementOutline;
  filters?: ImageElementFilters;
  clip?: ImageElementClip;
  flipH?: boolean;
  flipV?: boolean;
  shadow?: PPTElementShadow;
  radius?: number;
  colorMask?: string;
  imageType?: ImageType;
}

export type ShapeTextAlign = 'top' | 'middle' | 'bottom';

/**
 * शेप के अंदर टेक्स्ट (Text inside Shape)
 *
 * content: टेक्स्ट कंटेंट: HTML स्ट्रिंग (Text content: HTML string)
 *
 * defaultFontName: डिफ़ॉल्ट फ़ॉन्ट (Default font)
 *
 * defaultColor: डिफ़ॉल्ट रंग (Default color)
 *
 * align: टेक्स्ट अलाइनमेंट: वर्टिकल (Text alignment: vertical)
 *
 * lineHeight?: लाइन हाइट: डिफ़ॉल्ट 1.5 (Line height: default 1.5)
 *
 * wordSpace?: वर्ड स्पेसिंग: डिफ़ॉल्ट 0 (Word spacing: default 0)
 *
 * paragraphSpace?: पैराग्राफ स्पेसिंग: डिफ़ॉल्ट 5px (Paragraph spacing: default 5px)
 *
 * type: टेक्स्ट प्रकार (Text type)
 */
export interface ShapeText {
  content: string;
  defaultFontName: string;
  defaultColor: string;
  align: ShapeTextAlign;
  lineHeight?: number;
  wordSpace?: number;
  paragraphSpace?: number;
  type?: TextType;
}

/**
 * शेप एलिमेंट (Shape Element)
 *
 * type: एलिमेंट प्रकार (Element type: shape)
 *
 * viewBox: SVG viewBox गुण (SVG viewBox property, e.g., [1000, 1000])
 *
 * path: शेप पाथ: SVG d गुण (Shape path: SVG path d property)
 *
 * fixedRatio: आस्पेक्ट रेशियो फिक्स रखें (Fixed aspect ratio)
 *
 * fill: फिल: ग्रैडिएंट न होने पर प्रभावी (Fill: effective when gradient is absent)
 *
 * gradient?: ग्रैडिएंट (Gradient: takes precedence if exists)
 *
 * pattern?: पैटर्न (Pattern: takes precedence if exists)
 *
 * outline?: आउटलाइन (Outline)
 *
 * opacity?: ओपेसिटी (Opacity)
 *
 * flipH?: क्षैतिज फ्लिप (Horizontal flip)
 *
 * flipV?: लंबवत फ्लिप (Vertical flip)
 *
 * shadow?: शैडो (Shadow)
 *
 * special?: विशेष आकार (Special shapes: exported as images if complex)
 *
 * text?: शेप के अंदर टेक्स्ट (Text inside shape)
 *
 * pathFormula?: पाथ फॉर्म्युला (Shape path formula)
 * आमतौर पर, शेप स्केल होने पर पाथ नहीं बदलता, लेकिन कुछ शेप्स के लिए पाथ को फिर से कैलकुलेट करने की ज़रूरत होती है।
 * (In general, paths don't change on scale, but some shapes require path recalculation via formulas.)
 *
 * keypoints?: मुख्य बिंदुओं की स्थिति (Keypoints position percentage)
 */
export interface PPTShapeElement extends PPTBaseElement {
  type: 'shape';
  viewBox: [number, number];
  path: string;
  fixedRatio: boolean;
  fill: string;
  gradient?: Gradient;
  pattern?: string;
  outline?: PPTElementOutline;
  opacity?: number;
  flipH?: boolean;
  flipV?: boolean;
  shadow?: PPTElementShadow;
  special?: boolean;
  text?: ShapeText;
  pathFormula?: ShapePathFormulasKeys;
  keypoints?: number[];
}

export type LinePoint = '' | 'arrow' | 'dot';

/**
 * लाइन एलिमेंट (Line Element)
 *
 * type: एलिमेंट प्रकार (Element type: line)
 *
 * start: स्टार्ट पॉइंट (Start position [x, y])
 *
 * end: एंड पॉइंट (End position [x, y])
 *
 * style: लाइन स्टाइल: सॉलिड, डैश्ड, डॉटेड (Line style: solid, dashed, dotted)
 *
 * color: लाइन कलर (Line color)
 *
 * points: एंडपॉइंट स्टाइल: तीर, बिंदु, आदि (Endpoint style: arrow, dot, etc.)
 *
 * shadow?: शैडो (Shadow)
 *
 * broken?: ब्रोकन लाइन कंट्रोल पॉइंट (Broken line control point [x, y])
 *
 * broken2?: डबल ब्रोकन लाइन कंट्रोल पॉइंट (Double broken line control point [x, y])
 *
 * curve?: कर्व कंट्रोल पॉइंट (Curve control point [x, y])
 *
 * cubic?: क्यूबिक कर्व कंट्रोल पॉइंट (Cubic curve control points)
 */
export interface PPTLineElement extends Omit<PPTBaseElement, 'height' | 'rotate'> {
  type: 'line';
  start: [number, number];
  end: [number, number];
  style: LineStyleType;
  color: string;
  points: [LinePoint, LinePoint];
  shadow?: PPTElementShadow;
  broken?: [number, number];
  broken2?: [number, number];
  curve?: [number, number];
  cubic?: [[number, number], [number, number]];
}

export type ChartType = 'bar' | 'column' | 'line' | 'pie' | 'ring' | 'area' | 'radar' | 'scatter';

export interface ChartOptions {
  lineSmooth?: boolean;
  stack?: boolean;
}

export interface ChartData {
  labels: string[];
  legends: string[];
  series: number[][];
}

/**
 * चार्ट एलिमेंट (Chart Element)
 *
 * type: एलिमेंट प्रकार (Element type: chart)
 *
 * fill?: फिल कलर (Fill color)
 *
 * chartType: चार्ट प्रकार: बार, लाइन, पाई (Chart type: bar, line, pie)
 *
 * data: चार्ट डेटा (Chart data)
 *
 * options: अतिरिक्त विकल्प (Options)
 *
 * outline?: आउट线 (Outline)
 *
 * themeColors: थीम कलर्स (Theme colors)
 *
 * textColor?: टेक्स्ट और एक्सिस कलर (Text and axis color)
 *
 * lineColor?: ग्रिड कलर (Grid color)
 */
export interface PPTChartElement extends PPTBaseElement {
  type: 'chart';
  fill?: string;
  chartType: ChartType;
  data: ChartData;
  options?: ChartOptions;
  outline?: PPTElementOutline;
  themeColors: string[];
  textColor?: string;
  lineColor?: string;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
/**
 * टेबल सेल स्टाइल (Table Cell Style)
 *
 * bold?: बोल्ड (Bold)
 *
 * em?: इटैलिक (Italic)
 *
 * underline?: अंडरलाइन (Underline)
 *
 * strikethrough?: स्ट्राइकथ्रू (Strikethrough)
 *
 * color?: फ़ॉन्ट रंग (Font color)
 *
 * backcolor?: बैकग्राउंड रंग (Background color)
 *
 * fontsize?: फ़ॉन्ट साइज़ (Font size)
 *
 * fontname?: फ़ॉन्ट नाम (Font name)
 *
 * align?: अलाइनमेंट (Alignment)
 */
export interface TableCellStyle {
  bold?: boolean;
  em?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  backcolor?: string;
  fontsize?: string;
  fontname?: string;
  align?: TextAlign;
}

/**
 * टेबल सेल (Table Cell)
 *
 * id: सेल आईडी (Cell ID)
 *
 * colspan: कॉलम स्पैन (Column span)
 *
 * rowspan: रो स्पैन (Row span)
 *
 * text: टेक्स्ट कंटेंट (Text content)
 *
 * style?: सेल स्टाइल (Cell style)
 */
export interface TableCell {
  id: string;
  colspan: number;
  rowspan: number;
  text: string;
  style?: TableCellStyle;
}

/**
 * टेबल थीम (Table Theme)
 *
 * color: थीम कलर (Theme color)
 *
 * rowHeader: रो हेडर (Row header)
 *
 * rowFooter: रो फूटर (Row footer)
 *
 * colHeader: कॉलम हेडर (Column header)
 *
 * colFooter: कॉलम फूटर (Column footer)
 */
export interface TableTheme {
  color: string;
  rowHeader: boolean;
  rowFooter: boolean;
  colHeader: boolean;
  colFooter: boolean;
}

/**
 * टेबल एलिमेंट (Table Element)
 *
 * type: एलिमेंट प्रकार (Element type: table)
 *
 * outline: आउटलाइन (Outline)
 *
 * theme?: थीम (Theme)
 *
 * colWidths: कॉलम विड्थ: प्रतिशत में (Column widths as percentages, e.g., [0.3, 0.5, 0.2])
 *
 * cellMinHeight: सेल की न्यूनतम ऊंचाई (Cell minimum height)
 *
 * data: टेबल डेटा (Table data)
 */
export interface PPTTableElement extends PPTBaseElement {
  type: 'table';
  outline: PPTElementOutline;
  theme?: TableTheme;
  colWidths: number[];
  cellMinHeight: number;
  data: TableCell[][];
}

/**
 * LaTeX एलिमेंट - फॉर्म्युला (LaTeX Element - Formula)
 *
 * type: एलिमेंट प्रकार (Element type: latex)
 *
 * latex: LaTeX कोड (LaTeX code)
 *
 * html: KaTeX HTML (KaTeX rendered HTML)
 *
 * path: SVG पाथ (SVG path: backward compatibility)
 *
 * color: रंग (Color: backward compatibility)
 *
 * strokeWidth: आउटलाइन विड्थ (Stroke width: backward compatibility)
 *
 * viewBox: SVG viewBox (SVG viewBox: backward compatibility)
 *
 * fixedRatio: आस्पेक्ट रेशियो फिक्स रखें (Fixed aspect ratio)
 *
 * align: फॉर्म्युला अलाइनमेंट (Formula horizontal alignment)
 */
export interface PPTLatexElement extends PPTBaseElement {
  type: 'latex';
  latex: string;
  html?: string;
  path?: string;
  color?: string;
  strokeWidth?: number;
  viewBox?: [number, number];
  fixedRatio?: boolean;
  align?: 'left' | 'center' | 'right';
}

/**
 * वीडियो एलिमेंट (Video Element)
 *
 * type: एलिमेंट प्रकार (Element type: video)
 *
 * src: वीडियो एड्रेस (Video address)
 *
 * autoplay: ऑटोप्ले (Autoplay)
 *
 * poster: पोस्टर इमेज (Preview poster)
 *
 * ext: वीडियो एक्सटेंशन (Video extension)
 */
export interface PPTVideoElement extends PPTBaseElement {
  type: 'video';
  src: string;
  autoplay: boolean;
  poster?: string;
  ext?: string;
}

/**
 * ऑडियो एलिमेंट (Audio Element)
 *
 * type: एलिमेंट प्रकार (Element type: audio)
 *
 * fixedRatio: ऑइकन आस्पेक्ट रेशियो (Fixed icon aspect ratio)
 *
 * color: ऑइकन कलर (Icon color)
 *
 * loop: लूप प्लेबैक (Loop playback)
 *
 * autoplay: ऑटोप्ले (Autoplay)
 *
 * src: ऑडियो एड्रेस (Audio address)
 *
 * ext: ऑडियो एक्सटेंशन (Audio extension)
 */
export interface PPTAudioElement extends PPTBaseElement {
  type: 'audio';
  fixedRatio: boolean;
  color: string;
  loop: boolean;
  autoplay: boolean;
  src: string;
  ext?: string;
}

export type PPTElement =
  | PPTTextElement
  | PPTImageElement
  | PPTShapeElement
  | PPTLineElement
  | PPTChartElement
  | PPTTableElement
  | PPTLatexElement
  | PPTVideoElement
  | PPTAudioElement;

export type AnimationType = 'in' | 'out' | 'attention';
export type AnimationTrigger = 'click' | 'meantime' | 'auto';

/**
 * एलिमेंट एनीमेशन (Element Animation)
 *
 * id: एनीमेशन आईडी (Animation ID)
 *
 * elId: एलिमेंट आईडी (Element ID)
 *
 * effect: एनीमेशन प्रभाव (Animation effect)
 *
 * type: एनीमेशन प्रकार: प्रवेश, निकास, जोर (Animation type: in, out, attention)
 *
 * duration: एनीमेशन अवधि (Animation duration)
 *
 * trigger: ट्रिगर: क्लिक, साथ में, बाद में (Trigger: click, meantime, auto)
 */
export interface PPTAnimation {
  id: string;
  elId: string;
  effect: string;
  type: AnimationType;
  duration: number;
  trigger: AnimationTrigger;
}

export type SlideBackgroundType = 'solid' | 'image' | 'gradient';
export type SlideBackgroundImageSize = 'cover' | 'contain' | 'repeat';
export interface SlideBackgroundImage {
  src: string;
  size: SlideBackgroundImageSize;
}

/**
 * स्लाइड बैकग्राउंड (Slide Background)
 *
 * type: बैकग्राउंड प्रकार: ठोस रंग, इमेज, ग्रैडिएंट (Background type: color, image, gradient)
 *
 * color?: बैकग्राउंड रंग (Background color)
 *
 * image?: इमेज बैकग्राउंड (Image background)
 *
 * gradientType?: ग्रैडिएंट बैकग्राउंड (Gradient background)
 */
export interface SlideBackground {
  type: SlideBackgroundType;
  color?: string;
  image?: SlideBackgroundImage;
  gradient?: Gradient;
}

export type TurningMode =
  | 'no'
  | 'fade'
  | 'slideX'
  | 'slideY'
  | 'random'
  | 'slideX3D'
  | 'slideY3D'
  | 'rotate'
  | 'scaleY'
  | 'scaleX'
  | 'scale'
  | 'scaleReverse';

export interface SectionTag {
  id: string;
  title?: string;
}

export type SlideType = 'cover' | 'contents' | 'transition' | 'content' | 'end';

/**
 * स्लाइड पेज (Slide Page)
 *
 * id: पेज आईडी (Page ID)
 *
 * viewportSize: व्यूपोर्ट साइज़ (Viewport size)
 *
 * viewportRatio: व्यूपोर्ट आस्पेक्ट रेशियो (Viewport aspect ratio)
 *
 * theme: स्लाइड थीम (Slide theme)
 *
 * elements: एलिमेंट कलेक्शन (Element collection)
 *
 * background?: पेज बैकग्राउंड (Page background)
 *
 * animations?: एनीमेशन कलेक्शन (Animation collection)
 *
 * turningMode?: ट्रांज़िशन मोड (Page turning mode)
 *
 * sectionTag?: सेक्शन टैग (Section tag)
 *
 * type?: स्लाइड प्रकार (Slide type)
 */
export interface Slide {
  id: string;
  viewportSize: number;
  viewportRatio: number;
  theme: SlideTheme;
  elements: PPTElement[];
  background?: SlideBackground;
  animations?: PPTAnimation[];
  turningMode?: TurningMode;
  sectionTag?: SectionTag;
  type?: SlideType;
}

/**
 * स्लाइड थीम (Slide Theme)
 *
 * backgroundColor: पेज बैकग्राउंड रंग (Page background color)
 *
 * themeColor: थीम कलर्स (Theme colors)
 *
 * fontColor: फ़ॉन्ट रंग (Font color)
 *
 * fontName: फ़ॉन्ट नाम (Font name)
 */
export interface SlideTheme {
  backgroundColor: string;
  themeColors: string[];
  fontColor: string;
  fontName: string;
  outline?: PPTElementOutline;
  shadow?: PPTElementShadow;
}

export interface SlideTemplate {
  name: string;
  id: string;
  cover: string;
  origin?: string;
}

/**
 * @deprecated SlideData is deprecated, use Slide instead
 */
export interface SlideData {
  id: string;
  viewportSize: number;
  viewportRatio: number;
  theme: {
    themeColors: string[];
    fontColor: string;
    fontName: string;
    backgroundColor: string;
  };
  elements: PPTElement[];
  background?: SlideBackground;
  animations?: unknown[];
}
