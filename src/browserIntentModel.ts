import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Multilingual sentence embeddings let the browser compare colloquial Korean
// messages with examples for each supported response intent.
const MODEL_ID = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

export type BrowserIntent = {
  intent: string;
  content: string;
  examples: string[];
};

export const browserIntents: BrowserIntent[] = [
  { intent: 'AFFIRMATIVE', content: '웅', examples: ['응', '웅', '네 알겠어', '그래 좋아', '맞아', 'ㅇㅇ', '응응'] },
  { intent: 'COMFORT', content: '아현 걱정하지마', examples: ['걱정하지 마', '괜찮을 거야', '너무 걱정하지 않아도 돼', '다 잘될 거야'] },
  { intent: 'REASSURE', content: 'ㄱㅊ아', examples: ['괜찮아', '불안하고 무서워', '요즘 너무 힘들어', '속상해서 마음이 안 좋아', '걱정돼', '좆됐어 큰일났어', '망했어 어떡해', '조졌어 이제 끝났어'] },
  { intent: 'ENCOURAGE', content: '아현 잘할수있어', examples: ['나 시험 잘 볼 수 있을까', '잘할 수 있을 거야', '도전하기 무서워', '실패할까 봐 걱정돼', '포기하고 싶어'] },
  { intent: 'ASK_WHAT_HAPPENED', content: '아현 무슨일이야', examples: ['무슨 일이야', '왜 그래', '오늘 힘든 일 있었어?', '무슨 일 있었는지 말해줘'] },
  { intent: 'DENY', content: '그런거 아니야', examples: ['그런 거 아니야', '아닌데', '오해야', '그렇게 생각하지 마'] },
  { intent: 'NO', content: '안돼', examples: ['안 돼', '하지 마', '싫어 그만해', '그건 안 돼'] },
  { intent: 'SURPRISE', content: 'ㅇㄹㅅㄱ', examples: ['이럴 수가', '정말 놀랐어', '헐 믿을 수가 없어', '설마 진짜야?'] },
  { intent: 'CUTE', content: 'ㄱㅇㅇ', examples: ['너무 귀여워', '진짜 예쁘다', '사랑스러워', '깜찍해'] },
  { intent: 'SIGH', content: 'ㅇㅎ', examples: ['에휴', '하아 한숨 나온다', '피곤하고 지쳤어', '아이고 힘들다'] },
  { intent: 'AFFECTION', content: '오구', examples: ['졸려', '잠이 와', '자고 싶어', '아이고 울지 마', '오구오구'] },
  { intent: 'REACTION', content: '이애가 진짜', examples: ['안녕', '고마워', '도움이 필요해', '잘 가', '진짜 대단하다'] },
];

async function getExtractor() {
  extractorPromise ??= pipeline('feature-extraction', MODEL_ID, {
    dtype: 'q4',
    progress_callback: (progress: { status?: string; progress?: number }) => {
      if (progress.status === 'progress' && typeof progress.progress === 'number') {
        window.dispatchEvent(new CustomEvent('browser-model-progress', { detail: progress.progress }));
      }
    },
  });
  return extractorPromise;
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }
  return dot / (Math.sqrt(leftNorm * rightNorm) || 1);
}

let examplesPromise: Promise<Array<{ intent: BrowserIntent; embedding: number[] }>> | undefined;

async function getExamples() {
  examplesPromise ??= (async () => {
    const model = await getExtractor();
    const examples = browserIntents.flatMap((intent) => intent.examples.map((example) => ({ intent, example })));
    const embeddings = await model(examples.map(({ example }) => example), { pooling: 'mean', normalize: true });
    const rows = embeddings.tolist() as number[][][] | number[][];
    return examples.map(({ intent }, index) => ({
      intent,
      embedding: Array.isArray(rows[index][0]) ? (rows[index] as number[][])[0] : rows[index] as number[],
    }));
  })();
  return examplesPromise;
}

export async function warmBrowserIntentModel() {
  await getExtractor();
  await getExamples();
}

export async function classifyInBrowser(text: string) {
  // Strong Korean distress/slang signals should not be left to nearest-example
  // similarity; short colloquial phrases can otherwise resemble unrelated intents.
  const normalized = text.toLowerCase().replace(/\s+/gu, '');
  const distressPhrases = [
    '좆됐어', '좆됐다', '좆되었어', '좆되버렸어', '조졌어', '조졌다',
    '망했어', '망했다', '개망했어', '큰일났어', '큰일났다', '끝났어',
    '다끝났어', '다망했어', '어떡해', '어쩌지',
  ];
  if (distressPhrases.some((phrase) => normalized.includes(phrase))) {
    return browserIntents.find((item) => item.intent === 'ASK_WHAT_HAPPENED')!;
  }

  const [model, examples] = await Promise.all([getExtractor(), getExamples()]);
  const output = await model(text, { pooling: 'mean', normalize: true });
  const rows = output.tolist() as number[][][] | number[][];
  const raw = rows[0];
  const embedding = Array.isArray(raw[0]) ? (raw as number[][])[0] : raw as number[];
  const best = examples.reduce((winner, candidate) => {
    const score = cosineSimilarity(embedding, candidate.embedding);
    return score > winner.score ? { intent: candidate.intent, score } : winner;
  }, { intent: browserIntents[browserIntents.length - 1], score: -1 });
  // Avoid confident sounding canned replies when a message is unrelated.
  if (best.score < 0.35) return browserIntents.find((item) => item.intent === 'REACTION')!;
  return best.intent;
}
