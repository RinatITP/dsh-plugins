/**
 * Host half of dsh-visual-studio.
 *
 * Responsibilities:
 *  - three agent tools: `visual_guidelines`, `visual_ask`, `visual_publish`;
 *  - plugin-owned artifact storage with versions under `<dshHome>/visual-studio`;
 *  - three exact loopback routes used by the right-sidebar panel and the
 *    inline widget (manifest, one stored version, widget answer);
 *  - one system-prompt section that tells the model when to use which mode.
 *
 * No user project file is written, no network is used, and every model-supplied
 * value is normalized by lib/spec.js before it reaches the disk or the UI.
 */
import { randomUUID } from 'node:crypto';
import { createStore, visualStudioHome } from './store.js';
import { createAskRegistry } from './ask.js';
import { normalizeAskSpec, normalizePublish, SpecError } from './spec.js';
import { createRoutes } from './http.js';
import { guidelineFor, MODULES } from './guidelines.js';
import { templateFor, TEMPLATE_MODULES } from './templates.js';

export const name = 'dsh-visual-studio';

/** Required Host services; the plugin stays inactive without them. */
export const inject = ['webServer', 'connection', 'tools'];

const SYSTEM_SECTION = `Визуалы (плагин «Визуальная студия»):
- Если пользователю нужно выбрать или подтвердить варианты (план, блоки программы, приоритеты, компоновка), вызывай visual_ask: это инлайн-виджет в чате. Ответ пользователя придёт результатом инструмента — продолжай с ним в том же ходе и не задавай тот же вопрос текстом.
- Если нужно объяснить тему или показать решение — схему процесса, граф связей, мокап экрана, график — вызывай visual_publish с самодостаточным HTML. Страница откроется в правой панели «Визуализации» и сохранится с версиями.
- Перед любым визуалом вызови visual_guidelines с модулем (overview | diagram | mockup | interactive | chart) и следуй бюджету сложности из ответа.
- Для схемы, мокапа или слайда можно взять готовый каркас: вызови visual_template(module), подставь данные вместо плейсхолдеров в квадратных скобках и опубликуй результат через visual_publish.
- Один визуал — одна мысль. Не рисуй ради простого текстового ответа. Собери данные до публикации.
- В опубликованной странице нет сети: только инлайн CSS/JS; внешние шрифты, картинки по URL и fetch запрещены.
- Виджет не должен содержать длинных абзацев: короткие строки, 2–4 действия на строку, один вопрос на вызов.`;

const EMPTY_ANSWER_NOTE = 'Пользователь не ответил на виджет.';

function readConfig(ctx) {
  const entry = ctx.fiber?.entry;
  const config = entry?.options?.config;
  return config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function loggerOf(ctx) {
  try {
    return typeof ctx.get === 'function' ? ctx.get('logger') : undefined;
  } catch {
    return undefined;
  }
}

function specFailure(error) {
  if (error instanceof SpecError) return new Error(`${error.code}: ${error.message}`);
  return error;
}

function renderAnswerLines(value) {
  if (value.submitted !== true) return [{ type: 'text', text: value.note ?? EMPTY_ANSWER_NOTE }];
  const lines = [`Пользователь отправил выбор (изменено относительно предложения: ${value.changed}).`];
  for (const selection of value.selections) {
    lines.push(`- ${selection.title}: ${selection.label}`);
  }
  if (typeof value.note === 'string' && value.note !== '') lines.push(`Комментарий: ${value.note}`);
  return [{ type: 'text', text: lines.join('\n') }];
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const config = readConfig(ctx);
  const log = loggerOf(ctx);
  const debug = (code) => {
    try {
      log?.debug?.(`[dsh-visual-studio] ${code}`);
    } catch {
      // Diagnostics are best-effort.
    }
  };

  const paths = visualStudioHome({
    env: typeof config.dshHome === 'string' && config.dshHome.trim() !== ''
      ? { ...process.env, DSH_HOME: config.dshHome.trim() }
      : process.env,
  });
  const store = createStore(paths);
  const asks = createAskRegistry({
    timeoutMs: Number.isInteger(config.askTimeoutMs) && config.askTimeoutMs > 0 ? config.askTimeoutMs : undefined,
  });
  void store.ensureReady().catch(() => {
    debug('store-init-failed');
  });
  ctx.effect(() => () => asks.dispose(), 'dsh-visual-studio: dispose pending widgets');

  const tools = ctx.tools;

  ctx.effect(() => tools.register({
    name: 'visual_guidelines',
    description: 'Return design rules and a complexity budget for a visual before drawing it. Call this before visual_publish or visual_ask. Modules: overview (which mode to use), diagram, mockup, interactive, chart.',
    parameters: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          enum: ['overview', 'diagram', 'mockup', 'interactive', 'chart'],
          description: 'The kind of visual you are about to build.',
        },
      },
      required: ['module'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          module: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['module', 'text'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    execute(args) {
      const module = MODULES.includes(args.module) ? args.module : 'overview';
      return { module, text: guidelineFor(module) };
    },
    presentCall(args) {
      return { card: 'generic', title: 'Visual guidelines', kind: 'read', rawInput: args?.module };
    },
  }), 'dsh-visual-studio: visual_guidelines tool');

  ctx.effect(() => tools.register({
    name: 'visual_template',
    description: 'Return a ready-to-adapt, self-contained HTML starter for a visual. Call it when the user wants a process diagram, a screen mockup or a slide and you would otherwise draw from scratch. Replace the bracketed Russian placeholders with the real data, keep the inline CSS, and publish the result with visual_publish. The template has no scripts and no external resources.',
    parameters: {
      type: 'object',
      properties: {
        module: {
          type: 'string',
          enum: TEMPLATE_MODULES,
          description: 'Starter kind: process diagram, screen mockup or 16:9 slide.',
        },
      },
      required: ['module'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          module: { type: 'string' },
          template: { type: 'string' },
        },
        required: ['module', 'template'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Каркас «${value.module}» (${Math.round(value.template.length / 1024)} КБ). Подставь реальные данные вместо плейсхолдеров в квадратных скобках, сохрани инлайн-CSS и опубликуй через visual_publish с тем же module.`,
          '',
          value.template,
        ].join('\n'),
      }],
    },
    execute(args) {
      const module = TEMPLATE_MODULES.includes(args.module) ? args.module : 'diagram';
      return { module, template: templateFor(module) };
    },
    presentCall(args) {
      return { card: 'generic', title: 'Visual template', kind: 'read', rawInput: args?.module };
    },
  }), 'dsh-visual-studio: visual_template tool');

  ctx.effect(() => tools.register({
    name: 'visual_ask',
    description: 'Ask the user to choose or adjust options with an interactive widget rendered inline in the chat. Use it when the user must pick or confirm variants (plan blocks, priorities, layout options) and the answer should return to you in the same turn. Rows carry 2-4 actions each; the widget shows a metric, the rows and a submit button. The result contains one selection per row and how many differ from the proposed default. Call visual_guidelines("interactive") first. Keep 3-7 rows and one decision per call. After the result, continue with the user\'s choice without repeating the question.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'rows'],
      properties: {
        title: { type: 'string', description: 'Widget title, at most 140 characters.' },
        kicker: { type: 'string', description: 'Small line above the title (source, date).' },
        subtitle: { type: 'string', description: 'One explanation line under the title.' },
        metric: {
          type: 'object',
          additionalProperties: false,
          required: ['value'],
          properties: {
            value: { type: 'string', description: 'Big number or short total, at most 16 characters.' },
            label: { type: 'string', description: 'What the number means.' },
          },
          description: 'Optional headline metric (minutes, budget, count).',
        },
        rows: {
          type: 'array',
          description: '3-7 rows recommended, 14 maximum.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'actions'],
            properties: {
              id: { type: 'string', description: 'Stable row id; auto-assigned when omitted.' },
              title: { type: 'string', description: 'Row name, at most 140 characters.' },
              note: { type: 'string', description: 'Short badge text, for example "4 из 5".' },
              detail: { type: 'string', description: 'One explanation line, at most 200 characters.' },
              defaultAction: { type: 'string', description: 'Action id proposed by the agent; the first action by default.' },
              actions: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['label'],
                  properties: {
                    id: { type: 'string', description: 'Stable action id; auto-assigned when omitted.' },
                    label: { type: 'string', description: 'Button text, at most 28 characters.' },
                    tone: { type: 'string', enum: ['default', 'primary', 'muted'] },
                  },
                },
              },
            },
          },
        },
        submitLabel: { type: 'string', description: 'Submit button text.' },
        resetLabel: { type: 'string', description: 'Reset button text.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          submitted: { type: 'boolean' },
          callId: { type: 'string' },
          selections: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rowId: { type: 'string' },
                actionId: { type: 'string' },
                label: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['rowId', 'actionId', 'label', 'title'],
            },
          },
          changed: { type: 'integer' },
          note: { type: 'string' },
        },
        required: ['submitted', 'callId', 'selections', 'changed'],
      },
      render: (_args, value) => renderAnswerLines(value),
    },
    async execute(args, exec) {
      let spec;
      try {
        spec = normalizeAskSpec(args);
      } catch (error) {
        throw specFailure(error);
      }
      const answer = await asks.open({
        callId: exec.callId,
        spec,
        signal: exec.signal,
        timeout: Number.isInteger(config.askTimeoutMs) && config.askTimeoutMs > 0 ? config.askTimeoutMs : undefined,
      });
      return {
        submitted: answer.submitted === true,
        callId: answer.callId,
        selections: Array.isArray(answer.selections) ? answer.selections : [],
        changed: Number.isInteger(answer.changed) ? answer.changed : 0,
        ...(typeof answer.note === 'string' && answer.note !== ''
          ? { note: answer.note }
          : answer.timedOut === true
            ? { note: 'Время ожидания ответа истекло; виджет закрыт.' }
            : answer.aborted === true
              ? { note: 'Вызов отменён до ответа.' }
              : {}),
      };
    },
    presentCall(args) {
      return { card: 'generic', title: 'User choice', kind: 'question', rawInput: args?.title };
    },
  }), 'dsh-visual-studio: visual_ask tool');

  ctx.effect(() => tools.register({
    name: 'visual_publish',
    description: 'Publish one self-contained interactive HTML visual to the Visual Studio sidebar panel, where the user can explore it, switch device width, export and reopen it later. Use it to explain: process diagrams, link graphs, screen mockups, dashboards and charts. Call visual_guidelines(module) first and follow its complexity budget. The HTML must be a complete document with inline CSS and JavaScript only: no external scripts, styles, fonts, images by URL or fetch calls; maximum 512 KB. Every publish is stored as a new version of the same title.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'module', 'html'],
      properties: {
        title: { type: 'string', description: 'Human title shown in the panel and in the chat card.' },
        module: { type: 'string', enum: ['diagram', 'mockup', 'interactive', 'chart'] },
        summary: { type: 'string', description: 'One paragraph for the chat card: what the visual shows.' },
        html: { type: 'string', description: 'Complete self-contained HTML document.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string' },
          rev: { type: 'integer' },
          title: { type: 'string' },
          module: { type: 'string' },
          url: { type: 'string' },
          bytes: { type: 'integer' },
        },
        required: ['artifactId', 'rev', 'title', 'module', 'url', 'bytes'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Опубликовано «${value.title}» (${value.module}, версия ${value.rev}). Панель «Визуализации» открыта на этом визуале — можно смотреть, менять ширину устройства и скачать HTML.`,
      }],
    },
    async execute(args) {
      let normalized;
      try {
        normalized = normalizePublish(args);
      } catch (error) {
        throw specFailure(error);
      }
      const artifact = await store.publish(normalized);
      debug(`published ${artifact.id} v${artifact.rev}`);
      return {
        artifactId: artifact.id,
        rev: artifact.rev,
        title: artifact.title,
        module: artifact.module,
        url: `/plugins/dsh-visual-studio/artifact?id=${artifact.id}&rev=${artifact.rev}`,
        bytes: normalized.bytes,
      };
    },
    presentCall(args) {
      return { card: 'generic', title: 'Publish visual', kind: 'write', rawInput: args?.title };
    },
  }), 'dsh-visual-studio: visual_publish tool');

  // Per-process capability key for artifact reads: the manifest carries it to
  // the authenticated panel, which appends it to every iframe/download URL.
  const previewKey = `${randomUUID().replace(/-/g, '')}${randomUUID().slice(0, 8)}`;
  const routes = createRoutes({
    store,
    asks,
    previewKey,
    admit: (req) => ctx.connection.admit(req),
  });
  for (const [path, handler] of Object.entries(routes)) {
    ctx.effect(
      () => ctx.webServer.register({ kind: 'exact', path, handler }),
      `dsh-visual-studio: route ${path}`,
    );
  }

  const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined;
  if (systemPrompt !== undefined && systemPrompt !== null && typeof systemPrompt.section === 'function') {
    ctx.effect(
      () => systemPrompt.section({ name: 'dsh-visual-studio', order: 250, text: SYSTEM_SECTION }),
      'dsh-visual-studio: prompt section',
    );
  }
}
