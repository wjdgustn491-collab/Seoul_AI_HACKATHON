import { createLLM } from '../lib/llm/index.js';
import {
  formatMenuDescription, readMenuDescriptionInput, readMenuInterviewAnswers, readMenuQuestionsInput,
  ruleMenuQuestions, validateMenuDraft, validateMenuQuestions,
} from '../lib/menu-description.js';

async function generate(method, input, validate) {
  if (!process.env.GEMINI_API_KEY?.trim()) return null;
  try {
    const llm = createLLM(process.env, { deadline: Date.now() + 7500 });
    const value = validate(await llm[method](input), input);
    if (value) return { value, provider: llm.provider };
  } catch {
    // Rules can prepare the same step if the model is unavailable.
  }
  return null;
}

export default async function menuDescription(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: '지원하지 않는 요청입니다.' });
  }

  let menu;
  let guided;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (body?.action === 'questions') {
      const input = readMenuQuestionsInput(body);
      const plan = await generate('planMenuQuestions', input, validateMenuQuestions);
      return res.status(200).json({ questions: plan?.value ?? ruleMenuQuestions(input), provider: plan?.provider ?? 'rules' });
    }
    guided = body?.answers !== undefined;
    menu = guided ? readMenuInterviewAnswers(body) : readMenuDescriptionInput(body);
  } catch (error) {
    const message = error instanceof SyntaxError ? '메뉴 요청을 읽을 수 없습니다.' : error.message;
    return res.status(400).json({ error: message });
  }

  const draft = await generate('describeMenu', menu, validateMenuDraft);
  const { name, price, ...details } = menu;
  return res.status(200).json({
    description: draft?.value ?? formatMenuDescription(menu),
    provider: draft?.provider ?? 'rules',
    ...(guided ? { details } : {}),
  });
}
