/**
 * Built-in "skill creator" assistant for the studio.
 *
 * The plugin registers its own runtime skill (`skill-curator-creator`) so the AI
 * path does not depend on a `skill-creator` skill being installed in DSH or in
 * another agent. The skill body teaches an agent to interview the user briefly,
 * write a compact modular `SKILL.md`, and persist it through the plugin's own
 * `skill_curator_create` tool instead of editing files by hand.
 */

export const CREATOR_SKILL_NAME = 'skill-curator-creator';
export const CREATOR_SKILL_SOURCE = 'plugin:skill-curator';

export const CREATOR_SKILL_DESCRIPTION = 'Создать или обновить навык DeepSeek Harness по описанию пользователя: короткий SKILL.md, модульные references/scripts, сохранение через skill_curator_create.';

export const CREATOR_SKILL_BODY = `# Создание навыка DSH

Ты помогаешь пользователю собрать навык (Agent Skill) для DeepSeek Harness.
Работай коротко и по делу. Язык — русский, если пользователь не попросил иначе.

## 1. Пойми задачу

Если из сообщения пользователя уже понятно, что должен делать навык и когда
срабатывать, не задавай лишних вопросов. Если непонятно — задай 1–2 коротких
вопроса, например:
- что навык должен делать и какой результат получать;
- по каким фразам пользователя он должен включаться;
- нужны ли справочники, примеры или скрипты.

## 2. Сформируй файлы

- **Имя**: kebab-case, латиница и цифры, 1–64 символа, совпадает с именем папки.
- **description**: что делает + когда использовать (триггерные фразы), до 1024
  символов; старайся уложиться в 200–300.
- **Тело SKILL.md**: не раздувай. Ориентир — до 500 строк и 50 КБ. Достаточно
  разделов: «Когда использовать», «Порядок действий», «Типичные ошибки»,
  «Проверка».
- Всё объёмное — в отдельные файлы: \`references/*.md\`, \`scripts/*\`, \`assets/*\`.
  В SKILL.md оставь ссылки на них, а не весь текст.
- Не выдумывай команды, пути и API. Если чего-то не хватает — спроси.

## 3. Сохрани навык инструментом

Используй \`skill_curator_create\` с полями:
- \`name\`, \`description\`, \`body\`;
- \`scope\`: \`user\` (обычно), \`agents\` или \`project\`;
- \`workspacePath\` — только для project;
- \`files\` — необязательный список \`{ path, content }\` для references/scripts.

Не создавай навык через bash, cat или редактирование файлов напрямую: только
через этот инструмент, чтобы сработали проверка, бэкап и аудит студии.

## 4. После создания

Коротко напиши, что создано: имя, куда сохранено, какие файлы добавлены.
Если пользователь просит «улучши», «сократи» или «добавь примеры» — открой
навык в «Студии навыков», при необходимости используй инструмент повторно
для создания обновлённой версии и предложи проверить диагностику.`;

/** The definition registered on the DSH skill registry (rank 250, runtime provider). */
export function creatorSkillDefinition() {
  return {
    name: CREATOR_SKILL_NAME,
    description: CREATOR_SKILL_DESCRIPTION,
    source: CREATOR_SKILL_SOURCE,
    content: CREATOR_SKILL_BODY,
    invocation: { modelInvocable: true, userInvocable: true },
  };
}

const EMPTY_DESCRIPTION = '(пользователь ещё не написал описание — задай 1–2 уточняющих вопроса и предложи структуру)';

/**
 * Prompt placed into the new DSH chat when the user chooses "Создать с ИИ".
 * The leading slash token loads the embedded creator skill on the Host.
 *
 * @param {string} [description] user's free-form description
 */
export function createSkillPrompt(description = '') {
  const text = String(description ?? '').trim();
  return [
    `/${CREATOR_SKILL_NAME}`,
    '',
    'Задача: создай или обнови навык DeepSeek Harness по описанию ниже.',
    'Действуй по инструкции навыка: при необходимости задай 1–2 уточняющих вопроса,',
    'собери короткий SKILL.md, при необходимости вынеси материалы в references/scripts',
    'и сохрани навык инструментом skill_curator_create (не руками и не через bash).',
    'В конце коротко отчитайся: имя, куда сохранено, какие файлы добавлены.',
    '',
    'Описание пользователя:',
    text === '' ? EMPTY_DESCRIPTION : text,
  ].join('\n');
}
