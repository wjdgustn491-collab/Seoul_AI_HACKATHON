import { createLLM } from '../lib/llm/index.js';
import { menuFeatureReference } from '../lib/menu-feature-references.js';
import {
  describeMenuFeature, descriptionLimit, formatDetailedMenuDraft, menuTasteSuggestions, readDetailedMenuInterview,
  formatMenuDescription, formatShortMenuDraft, readMenuDescriptionInput, readMenuInterviewAnswers,
  readMenuQuestionsInput, readMenuTasteInput, readShortMenuInterview,
  ruleMenuQuestions, validateDetailedMenuDraft, validateMenuDraft, validateMenuQuestions,
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

async function prepareShortDraft(menu) {
  const reference = menuFeatureReference(menu);
  let selection;
  let suggestion;
  if (reference) {
    const { source, url, options } = reference;
    const { name, notes, taste } = menu;
    selection = await generate('selectMenuFeature', { name, composition: notes, taste, options },
      output => output.choice >= 0 && output.choice <= options.length ? output : null);
    const text = options[(selection?.value.choice ?? 1) - 1];
    if (text) suggestion = { text, source, url };
  }
  return { ...formatShortMenuDraft(menu, suggestion), provider: selection?.provider ?? 'rules' };
}

async function prepareDetailedDraft(menu) {
  const reference = menuFeatureReference(menu);
  const featureOptions = reference?.options ?? [];
  const reserved = Math.max(0, ...featureOptions.map(text => describeMenuFeature(text).length + 1));
  const { name, portion, composition, tastes, tasteNote, features, taste, servings, notes } = menu;
  const input = { name, portion, composition, tastes, tasteNote, features, featureOptions, maxLength: descriptionLimit - reserved };
  const draft = await generate('describeMenuInterview', input, validateDetailedMenuDraft);
  const text = featureOptions[(draft?.value.choice ?? 1) - 1];
  const suggestion = text && { text, source: reference.source, url: reference.url, sentence: describeMenuFeature(text) };
  const description = [draft?.value.description ?? formatDetailedMenuDraft(input), suggestion?.sentence].filter(Boolean).join(' ');
  return {
    description, details: { portion, taste, servings, notes, features: features || text || '' },
    provider: draft?.provider ?? 'rules',
    ...(suggestion && { suggestion }),
  };
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
    if (body?.action === 'taste-suggestions') {
      const input = readMenuTasteInput(body);
      const plan = await generate('inferMenuTastes', input, output => output.suggestions);
      return res.status(200).json({ suggestions: menuTasteSuggestions(input, plan?.value), provider: plan?.provider ?? 'rules' });
    }
    if (body?.action === 'interview-draft') return res.status(200).json(await prepareDetailedDraft(readDetailedMenuInterview(body)));
    if (body?.action === 'short-draft') return res.status(200).json(await prepareShortDraft(readShortMenuInterview(body)));
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
