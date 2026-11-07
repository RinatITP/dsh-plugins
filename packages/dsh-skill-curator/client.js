/**
 * dsh-skill-curator — Client (browser) half, redesigned.
 *
 * One settings page (id `skill-curator`, order 23) with a single primary
 * surface — the skill library — and in-page views for the secondary flows:
 * skill detail, import wizard, create (AI or manual), live sources and trash.
 * No tabs for unrelated sections, no nested modal over the settings modal.
 *
 * AI creation follows the official DSH creator entry: it starts a real chat
 * through `ctx.get('uiWorkspace').startSession(undefined, { prompt, ... })`,
 * where the prompt invokes the plugin's embedded `skill-curator-creator` skill
 * and asks the agent to persist the skill through `skill_curator_create`.
 *
 * Plain ESM through `window.__ModuleLoader__`, React from the host, one injected
 * `<style data-plugin>`, theme tokens only, RU-first with EN parity.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-curator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const PLUGIN_ID = 'dsh-skill-curator';
    const LOCALE_NS = 'settings.skillCurator';
    const API_HEADER = 'x-dsh-skill-curator';
    const API_PATH = '/api/dsh-skill-curator';
    const SECTION_ORDER = 23;

    /* ------------------------------------------------------------------ */
    /* Dictionaries                                                        */
    /* ------------------------------------------------------------------ */

    const DICT_EN = {
      'nav.label': 'Skills',
      'tabs.sources': 'Sources',
      'tabs.trash': 'Trash',
      'page.title': 'Skill studio',
      'page.subtitle': 'Skills from DSH, projects and other agents — browse, edit, import and use live sources.',
      'page.help': 'This page manages Agent Skills: SKILL.md files with optional references/ and scripts/. Writable skills can be edited with backup; external agents stay read-only and can be imported or shown live.',
      'page.refresh': 'Refresh',
      'page.filters.all': 'All',
      'page.filters.on': 'Enabled',
      'page.filters.off': 'Disabled',
      'page.filters.errors': 'With issues',
      'page.filters.mine': 'Mine',
      'page.empty.title': 'No skills yet',
      'page.empty.body': 'Import skills from another agent or create the first one.',
      'page.noResults.title': 'Nothing matches',
      'page.noResults.body': 'Clear the search or the filter to see the rest.',
      'page.error.title': 'Could not load skills',
      'page.error.code': 'Error code',
      'page.error.retry': 'Try again',
      'page.legend': 'Toggles are available on writable skills; read-only sources and symlinks are labelled and explained by the ? hint.',
      'page.error.unauthorized': 'Reopen the page from an authenticated DSH window.',
      'page.error.network': 'The DSH host is not reachable.',
      'group.readOnly': 'read-only',
      'group.empty': 'No skills in this source',
      'badge.symlink': 'symlink',
      'badge.system': 'system',
      'badge.duplicate': 'duplicate',
      'badge.shadowed': 'shadowed',
      'badge.modelOff': 'hidden from model',
      'badge.userOff': 'hidden from /',
      'badge.errors': 'errors',
      'badge.warnings': 'warnings',
      'badge.readOnly': 'read-only',
      'badge.writable': 'writable',
      'badge.truncated': 'truncated',
      'actions.refresh': 'Refresh',
      'actions.create': 'Create',
      'actions.import': 'Import',
      'actions.importPrimary': 'Import selected',
      'actions.back': 'Back',
      'actions.cancel': 'Cancel',
      'actions.close': 'Close',
      'actions.save': 'Save',
      'actions.validate': 'Check',
      'actions.edit': 'Edit',
      'actions.delete': 'Move to trash',
      'actions.confirmDelete': 'Confirm delete',
      'actions.restore': 'Restore',
      'actions.confirmRestore': 'Confirm restore',
      'actions.copyPath': 'Copy path',
      'actions.copied': 'Copied',
      'actions.open': 'Open',
      'actions.more': 'More',
      'actions.retry': 'Try again',
      'actions.rescan': 'Rescan',
      'actions.done': 'Done',
      'actions.openInLibrary': 'Open library',
      'actions.importMore': 'Import more',
      'actions.selectAll': 'Select all',
      'actions.clearAll': 'Clear',
      'actions.copyPrompt': 'Copy prompt',
      'actions.openChat': 'Open chat with the skill creator',
      'actions.openAIChat': 'Open chat',
      'actions.createManual': 'Build manually',
      'actions.createWithAi': 'Create with AI',
      'search.placeholder': 'Search skills…',
      'detail.tabs.overview': 'Overview',
      'detail.tabs.raw': 'SKILL.md',
      'detail.tabs.files': 'Files',
      'detail.tabs.diagnostics': 'Diagnostics',
      'detail.facts.source': 'Source',
      'detail.facts.scope': 'Scope',
      'detail.facts.status': 'Status',
      'detail.facts.size': 'Size',
      'detail.facts.lines': 'Body lines',
      'detail.facts.modified': 'Modified',
      'detail.facts.path': 'Path',
      'detail.model.title': 'How the model sees it',
      'detail.model.hint': 'This name and description are what the model uses to decide whether to load the skill. The body stays out of context until the skill is invoked.',
      'detail.status.enabled': 'enabled',
      'detail.status.disabled': 'hidden',
      'detail.status.readOnly': 'read-only',
      'detail.files.empty': 'No resource files.',
      'detail.diagnostics.empty': 'No issues — the skill looks valid.',
      'detail.diagnostics.hint': 'Each code below has a short explanation of what to fix.',
      'detail.diagnostics.readOnly': 'This skill belongs to another agent and is read-only here. Fix it at the source or import a copy.',
      'detail.deleteHint': 'The skill is moved to the studio trash and can be restored.',
      'detail.editHint': 'Validation runs before writing; the previous file is backed up. Keep SKILL.md compact and move details to references/.',
      'detail.unsaved': 'Unsaved changes',
      'detail.editFile': 'Edit file',
      'detail.fileTooLarge': 'File is larger than the preview limit.',
      'detail.binary': 'Binary file — no preview.',
      'detail.copyName': 'Copy name',
      'editor.hint': 'Keep SKILL.md short (under 500 lines); put reference material in references/ and scripts/ as separate files.',
      'editor.validateHint': 'Checks frontmatter, name/folder match, description limits and the body size.',
      'editor.busy': 'Working…',
      'editor.errors': 'Fix these before saving',
      'editor.ok': 'Looks good',
      'editor.saved': 'Saved',
      'create.title': 'New skill',
      'create.intro': 'Describe the skill once. The AI path opens a DSH chat with the built-in creator; the manual path gives you a guided form.',
      'create.mode.ai': 'With AI',
      'create.mode.manual': 'Manually',
      'create.ai.hint': 'A new chat opens with the built-in “skill-creator” instructions and your description. Tell the agent a bit more if it asks; it will create the skill through the studio tool and the skill appears here after a refresh.',
      'create.ai.description': 'What should the skill do, and when should it be used?',
      'create.ai.descriptionHint': 'Describe the task, trigger phrases, result and anything the agent must not do. Plain language is enough.',
      'create.ai.examples': 'Examples:',
      'create.ai.extra': 'Anything else? (format, tools, constraints)',
      'create.ai.promptPreview': 'Prompt for the agent',
      'create.ai.openChatHint': 'The settings will close and a new chat opens with the prompt already in the composer. Review it and press Send.',
      'create.ai.fallback': 'The chat could not be opened automatically. The prompt is copied — start a new chat, paste it and send.',
      'create.ai.failed': 'Could not open a chat. Copy the prompt and use a new chat.',
      'create.manual.name': 'Name',
      'create.manual.nameHint': 'Latin lowercase, digits and hyphens; becomes the folder name (1–64 chars).',
      'create.manual.description': 'Description',
      'create.manual.descriptionHint': 'What it does + when to use it. Recommended up to 200 characters, maximum 1024.',
      'create.manual.body': 'Instructions',
      'create.manual.bodyHint': 'Short procedure; put reference material and scripts into separate files.',
      'create.manual.template': 'Insert template',
      'create.manual.destination': 'Where to save',
      'create.manual.workspace': 'Workspace',
      'create.field.required': 'This field is required',
      'create.field.nameInvalid': 'Use kebab-case: lowercase latin letters, digits and single hyphens',
      'create.field.descriptionLong': 'Description is longer than 1024 characters',
      'create.field.bodyEmpty': 'Instructions cannot be empty',
      'create.counter.chars': 'characters',
      'create.counter.lines': 'lines',
      'create.created': 'Skill created',
      'import.title': 'Import skills',
      'import.intro': 'Copy or link skills from other agents into DSH. Nothing is overwritten: existing names and invalid skills are skipped before import.',
      'import.destination': 'Destination',
      'import.workspace': 'Workspace',
      'import.mode': 'Mode',
      'import.mode.copy': 'Copy',
      'import.mode.symlink': 'Symlink',
      'import.mode.copyHint': 'An independent snapshot: later edits at the source do not reach DSH.',
      'import.mode.symlinkHint': 'A live link: edits at the source appear here, but moving or deleting the source breaks the link.',
      'import.rescan': 'Rescan',
      'import.search': 'Search candidates…',
      'import.selectAll': 'Select all',
      'import.clearAll': 'Clear',
      'import.empty': 'No importable skills for this destination.',
      'import.footerSelected': 'selected',
      'import.confirm': 'Confirm import',
      'import.imported': 'imported',
      'import.skipped': 'skipped',
      'import.failed': 'failed',
      'import.results': 'Import result',
      'import.resultHint': 'The library was refreshed. Open it to see the new skills — or import a few more.',
      'import.noSelection': 'Select at least one skill',
      'import.reason.TARGET_EXISTS': 'already exists in the destination',
      'import.reason.ALREADY_IN_TARGET': 'already in the destination root',
      'import.reason.INVALID_NAME': 'invalid skill name',
      'import.reason.NAME_TAKEN': 'duplicate name in this selection',
      'import.reason.SOURCE_MISSING': 'source disappeared',
      'import.reason.IMPORT_FAILED': 'import failed',
      'import.reason.NOT_FOUND': 'not found',
      'sources.title': 'Sources',
      'sources.intro': 'Read-only agent libraries can be shown live in the DSH model catalog without copying files. The source agent keeps ownership; the model sees the skill on every load.',
      'sources.live': 'Show live in DSH',
      'sources.hint': 'Live skills are visible to the model only (not in the / menu). Turn this off to remove them from the DSH catalog.',
      'sources.modelOnly': 'model only, not in /',
      'sources.empty': 'No readable read-only sources found on this computer.',
      'sources.writableTitle': 'Your writable roots',
      'trash.title': 'Trash',
      'trash.intro': 'Deleted skills are kept here with their original path and metadata. Restore returns them to the same writable root.',
      'trash.empty': 'Trash is empty.',
      'trash.restore': 'Restore',
      'trash.confirmRestore': 'Confirm restore',
      'trash.originalPath': 'Original path',
      'trash.deletedAt': 'Deleted',
      'help.name': '1–64 characters: lowercase latin letters, digits, single hyphens; it becomes the folder name and must match the frontmatter name.',
      'help.description': 'The routing text: what the skill does and when to use it. The model reads it before choosing the skill. Recommended up to 200 characters, maximum 1024.',
      'help.body': 'Step-by-step instructions. Keep it short and move long material to references/ and scripts/; the body loads into context only when the skill is used.',
      'help.destination': 'Where the skill is stored. “Mine” is ~/.dsh/skills, “Shared” is ~/.agents/skills, “Project” is <workspace>/.dsh/skills.',
      'help.importMode': 'Copy creates an independent snapshot. Symlink keeps a live link to the source: editing the source updates DSH, but moving it breaks the link.',
      'help.importTarget': 'The destination must be a writable DSH root. Imported skills are never overwritten.',
      'help.live': 'Live exposure puts read-only external skills into the DSH model catalog without importing them. Nothing is copied; the model reads the external file.',
      'help.modelToggle': 'Controls whether the model sees this skill in its catalog.',
      'help.userToggle': 'Controls whether the skill appears in the / menu in chat.',
      'help.delete': 'The skill moves to the studio trash; no file is deleted permanently and you can restore it.',
      'help.ai': 'The chat opens with the built-in creator instructions. The agent asks brief questions and saves the skill through the studio tool, with a backup and validation.',
      'toast.saved': 'Skill saved',
      'toast.created': 'Skill created',
      'toast.trashed': 'Skill moved to trash',
      'toast.restored': 'Skill restored',
      'toast.updated': 'Skill updated',
      'toast.stale': 'The catalog changed. Reloaded — try again.',
      'toast.copied': 'Copied to clipboard',
      'toast.copyFailed': 'Could not copy to clipboard',
      'error.CONFIRM_REQUIRED': 'Confirmation is required for this action',
      'error.STALE_REVISION': 'The catalog has changed. Reload the view and try again',
      'error.VALIDATION_FAILED': 'The skill has validation errors',
      'error.READ_ONLY_SKILL': 'This skill is read-only',
      'error.SYMLINK_READ_ONLY': 'Symlinked skills cannot be edited here',
      'error.TARGET_EXISTS': 'A skill with this name already exists',
      'error.NAME_CHANGE_UNSUPPORTED': 'The skill name cannot be changed in this view',
      'error.PATH_NOT_ALLOWED': 'Only files under references/, scripts/ and assets/ may be written',
      'error.SKILL_UNREADABLE': 'The skill file cannot be read',
      'error.PROJECT_NOT_CONFIGURED': 'This project is not configured in the plugin',
      'error.CONTENT_TOO_LARGE': 'The content is too large',
      'error.SELECTION_EMPTY': 'Select at least one skill',
      'error.SELECTION_TOO_LARGE': 'Too many skills selected',
      'error.NOT_FOUND': 'Not found',
      'source.dshUser': 'My skills (DSH)',
      'source.dshAgents': 'Shared agents',
      'source.project': 'Project',
      'source.bundled': 'Bundled (DSH)',
      'source.claude': 'Claude Code',
      'source.codex': 'Codex',
      'source.hermes': 'Hermes',
      'source.zcode': 'ZCode',
      'source.cursor': 'Cursor',
      'source.gemini': 'Gemini / Antigravity',
      'source.kimi': 'Kimi',
      'source.opencode': 'OpenCode',
      'create.scope.user': 'My skills (DSH)',
      'create.scope.agents': 'Shared agents',
      'create.scope.project': 'Project',
      'create.aiHint': 'Describe the skill once — a new chat with the built-in creator opens and the skill appears here after it is saved.',
      'scope.user': 'user',
      'scope.project': 'project',
      'actions.expand': 'Expand',
      'actions.collapse': 'Collapse',
      'detail.facts.files': 'Files',
      'help.symlinkToggle': 'This skill is a symlink to the source. Enable or disable it at the source, or import a copy first.',
      'help.readonlyToggle': 'This source belongs to another agent and is read-only here. Import a copy or turn on live exposure in Sources to use it in DSH.',
      'help.files': 'A skill can contain extra files under references/, scripts/ or assets/. They load only when needed, so SKILL.md stays short.',
      'diag.generic': 'Fix the skill file and save; open the editor to change it.',
      'diag.name-missing': 'Add a kebab-case name to the frontmatter — the folder name is used as a hint.',
      'diag.name-invalid': 'Use lowercase latin letters, digits and single hyphens in the name.',
      'diag.name-folder-mismatch': 'Rename the skill folder or change the frontmatter name so they match.',
      'diag.name-too-long': 'Shorten the name to 64 characters or fewer.',
      'diag.description-missing': 'Add a description: what the skill does and when to use it.',
      'diag.description-too-long': 'Shorten the description to 1024 characters or fewer.',
      'diag.description-long': 'Consider shortening the description to about 200 characters and moving details into the body.',
      'diag.description-short': 'Add trigger phrases so the model knows when to pick this skill.',
      'diag.body-empty': 'Add instructions to the body of SKILL.md.',
      'diag.body-too-large': 'Move long material into references/ or scripts/ and keep SKILL.md compact.',
      'diag.invocation-invalid': 'Use true/false (or yes/no) for invocation fields.',
      'diag.file-too-large': 'The file exceeds the preview limit; check the file on disk if it is unexpectedly large.',
      'diag.symlink': 'This skill is linked to the source; edit the source agent or import a copy.',
      'diag.symlink-broken': 'The symlink target is missing. Re-import the skill or remove the broken link.',
      'diag.frontmatter-missing': 'Add YAML frontmatter delimited by --- at the top of SKILL.md.',
      'diag.frontmatter-invalid': 'Fix the YAML frontmatter syntax (key: value lines).',
      'error.OPERATION_FAILED': 'The operation failed',
    };

    const DICT_RU = {
      'nav.label': 'Навыки',
      'tabs.sources': 'Источники',
      'tabs.trash': 'Корзина',
      'page.title': 'Студия навыков',
      'page.subtitle': 'Навыки DSH, проектов и других агентов: просмотр, редактирование, импорт и live-источники.',
      'page.help': 'Здесь управляются навыки (Agent Skills): файлы SKILL.md с необязательными references/ и scripts/. Свои навыки можно безопасно редактировать с бэкапом; чужие агенты — только чтение, их можно импортировать или включить live.',
      'page.refresh': 'Обновить',
      'page.filters.all': 'Все',
      'page.filters.on': 'Включены',
      'page.filters.off': 'Выключены',
      'page.filters.errors': 'С проблемами',
      'page.filters.mine': 'Мои',
      'page.empty.title': 'Пока нет навыков',
      'page.empty.body': 'Импортируйте навыки из другого агента или создайте первый.',
      'page.noResults.title': 'Ничего не найдено',
      'page.noResults.body': 'Очистите поиск или фильтр, чтобы увидеть остальное.',
      'page.error.title': 'Не удалось загрузить навыки',
      'page.error.code': 'Код ошибки',
      'page.error.retry': 'Повторить',
      'page.legend': 'Переключатели есть у своих (записываемых) навыков; read-only источники и симлинки подписаны, пояснение — по значку ?.',
      'page.error.unauthorized': 'Откройте страницу заново из авторизованного окна DSH.',
      'page.error.network': 'Хост DSH недоступен.',
      'group.readOnly': 'только чтение',
      'group.empty': 'В этом источнике навыков нет',
      'badge.symlink': 'ссылка',
      'badge.system': 'системный',
      'badge.duplicate': 'дубль',
      'badge.shadowed': 'перекрыт',
      'badge.modelOff': 'скрыт от модели',
      'badge.userOff': 'скрыт из /',
      'badge.errors': 'ошибок',
      'badge.warnings': 'предупреждений',
      'badge.readOnly': 'только чтение',
      'badge.writable': 'для записи',
      'badge.truncated': 'обрезан',
      'actions.refresh': 'Обновить',
      'actions.create': 'Создать',
      'actions.import': 'Импорт',
      'actions.importPrimary': 'Импортировать',
      'actions.back': 'Назад',
      'actions.cancel': 'Отмена',
      'actions.close': 'Закрыть',
      'actions.save': 'Сохранить',
      'actions.validate': 'Проверить',
      'actions.edit': 'Редактировать',
      'actions.delete': 'В корзину',
      'actions.confirmDelete': 'Подтвердить удаление',
      'actions.restore': 'Восстановить',
      'actions.confirmRestore': 'Подтвердить восстановление',
      'actions.copyPath': 'Копировать путь',
      'actions.copied': 'Скопировано',
      'actions.open': 'Открыть',
      'actions.more': 'Ещё',
      'actions.retry': 'Повторить',
      'actions.rescan': 'Пересканировать',
      'actions.done': 'Готово',
      'actions.openInLibrary': 'Открыть библиотеку',
      'actions.importMore': 'Импортировать ещё',
      'actions.selectAll': 'Выбрать все',
      'actions.clearAll': 'Снять',
      'actions.copyPrompt': 'Скопировать промпт',
      'actions.openChat': 'Открыть чат с создателем навыков',
      'actions.openAIChat': 'Открыть чат',
      'actions.createManual': 'Собрать вручную',
      'actions.createWithAi': 'Создать с ИИ',
      'search.placeholder': 'Поиск навыков…',
      'detail.tabs.overview': 'Обзор',
      'detail.tabs.raw': 'SKILL.md',
      'detail.tabs.files': 'Файлы',
      'detail.tabs.diagnostics': 'Диагностика',
      'detail.facts.source': 'Источник',
      'detail.facts.scope': 'Область',
      'detail.facts.status': 'Статус',
      'detail.facts.size': 'Размер',
      'detail.facts.lines': 'Строк в теле',
      'detail.facts.modified': 'Изменён',
      'detail.facts.path': 'Путь',
      'detail.model.title': 'Как видит модель',
      'detail.model.hint': 'Имя и описание — то, по чему модель решает, загружать ли навык. Тело попадает в контекст только при вызове навыка.',
      'detail.status.enabled': 'включён',
      'detail.status.disabled': 'скрыт',
      'detail.status.readOnly': 'только чтение',
      'detail.files.empty': 'Вложенных файлов нет.',
      'detail.diagnostics.empty': 'Ошибок нет — навык выглядит корректным.',
      'detail.diagnostics.hint': 'Под каждым кодом — короткое объяснение, что исправить.',
      'detail.diagnostics.readOnly': 'Навык принадлежит другому агенту и здесь только для чтения. Исправляйте в источнике или импортируйте копию.',
      'detail.deleteHint': 'Навык переместится в корзину студии, его можно восстановить.',
      'detail.editHint': 'Перед записью выполняется проверка, предыдущий файл сохраняется в бэкап. Держите SKILL.md компактным, детали — в references/.',
      'detail.unsaved': 'Есть несохранённые изменения',
      'detail.editFile': 'Редактировать файл',
      'detail.fileTooLarge': 'Файл больше лимита предпросмотра.',
      'detail.binary': 'Бинарный файл — предпросмотр недоступен.',
      'detail.copyName': 'Копировать имя',
      'editor.hint': 'Держите SKILL.md коротким (до 500 строк); справочники и скрипты выносите отдельными файлами в references/ и scripts/.',
      'editor.validateHint': 'Проверяет frontmatter, совпадение имени и папки, лимиты описания и размер тела.',
      'editor.busy': 'Выполняю…',
      'editor.errors': 'Исправьте перед сохранением',
      'editor.ok': 'Всё в порядке',
      'editor.saved': 'Сохранено',
      'create.title': 'Новый навык',
      'create.intro': 'Опишите навык один раз. Путь с ИИ откроет чат DSH со встроенным создателем; ручной путь — пошаговая форма.',
      'create.mode.ai': 'С помощью ИИ',
      'create.mode.manual': 'Вручную',
      'create.ai.hint': 'Откроется новый чат со встроенными инструкциями «создателя навыков» и вашим описанием. Ответьте на 1–2 вопроса, если агент спросит; он создаст навык инструментом студии, и после обновления навык появится здесь.',
      'create.ai.description': 'Что должен делать навык и когда его использовать?',
      'create.ai.descriptionHint': 'Опишите задачу, фразы-триггеры, результат и чего делать нельзя. Простых слов достаточно.',
      'create.ai.examples': 'Примеры:',
      'create.ai.extra': 'Что-то ещё? (формат, инструменты, ограничения)',
      'create.ai.promptPreview': 'Промпт для агента',
      'create.ai.openChatHint': 'Настройки закроются, откроется новый чат с готовым промптом в композере. Проверьте его и нажмите «Отправить».',
      'create.ai.fallback': 'Не удалось открыть чат автоматически. Промпт скопирован — откройте новый чат, вставьте и отправьте.',
      'create.ai.failed': 'Не удалось открыть чат. Скопируйте промпт и используйте новый чат.',
      'create.manual.name': 'Имя',
      'create.manual.nameHint': 'Латиница в нижнем регистре, цифры и дефисы; станет именем папки (1–64 символа).',
      'create.manual.description': 'Описание',
      'create.manual.descriptionHint': 'Что делает + когда использовать. Рекомендуем до 200 символов, максимум 1024.',
      'create.manual.body': 'Инструкции',
      'create.manual.bodyHint': 'Короткий порядок действий; справочники и скрипты — отдельными файлами.',
      'create.manual.template': 'Вставить каркас',
      'create.manual.destination': 'Куда сохранить',
      'create.manual.workspace': 'Рабочий каталог',
      'create.field.required': 'Поле обязательно',
      'create.field.nameInvalid': 'Нужен kebab-case: строчная латиница, цифры и одиночные дефисы',
      'create.field.descriptionLong': 'Описание длиннее 1024 символов',
      'create.field.bodyEmpty': 'Инструкции не могут быть пустыми',
      'create.counter.chars': 'символов',
      'create.counter.lines': 'строк',
      'create.created': 'Навык создан',
      'import.title': 'Импорт навыков',
      'import.intro': 'Скопируйте или свяжите навыки других агентов в DSH. Ничего не перезаписывается: существующие имена и некорректные навыки отсеиваются до импорта.',
      'import.destination': 'Куда импортировать',
      'import.workspace': 'Рабочий каталог',
      'import.mode': 'Режим',
      'import.mode.copy': 'Копия',
      'import.mode.symlink': 'Симлинк',
      'import.mode.copyHint': 'Независимый снимок: дальнейшие правки источника не попадут в DSH.',
      'import.mode.symlinkHint': 'Живая ссылка: правки источника видны здесь, но перенос или удаление источника ломает ссылку.',
      'import.rescan': 'Пересканировать',
      'import.search': 'Поиск кандидатов…',
      'import.selectAll': 'Выбрать все',
      'import.clearAll': 'Снять',
      'import.empty': 'Нет навыков для импорта в это место.',
      'import.footerSelected': 'выбрано',
      'import.confirm': 'Подтвердить импорт',
      'import.imported': 'импортировано',
      'import.skipped': 'пропущено',
      'import.failed': 'ошибки',
      'import.results': 'Результат импорта',
      'import.resultHint': 'Библиотека обновлена. Откройте её, чтобы увидеть навыки, или импортируйте ещё.',
      'import.noSelection': 'Выберите хотя бы один навык',
      'import.reason.TARGET_EXISTS': 'уже есть в месте назначения',
      'import.reason.ALREADY_IN_TARGET': 'уже в целевом корне',
      'import.reason.INVALID_NAME': 'недопустимое имя',
      'import.reason.NAME_TAKEN': 'дубль имени в выборке',
      'import.reason.SOURCE_MISSING': 'источник исчез',
      'import.reason.IMPORT_FAILED': 'импорт не удался',
      'import.reason.NOT_FOUND': 'не найден',
      'sources.title': 'Источники',
      'sources.intro': 'Read-only библиотеки других агентов можно показывать в каталоге модели DSH без копирования файлов. Файлами владеет исходный агент, модель читает навык при каждой загрузке.',
      'sources.live': 'Показывать в DSH',
      'sources.hint': 'Live-навыки видны только модели (не в меню /). Выключите переключатель, чтобы убрать их из каталога DSH.',
      'sources.modelOnly': 'только модель, не в /',
      'sources.empty': 'Читаемых read-only источников на этом компьютере не найдено.',
      'sources.writableTitle': 'Ваши корни для записи',
      'trash.title': 'Корзина',
      'trash.intro': 'Удалённые навыки хранятся здесь с исходным путём и метаданными. Восстановление вернёт навык в тот же корень.',
      'trash.empty': 'Корзина пуста.',
      'trash.restore': 'Восстановить',
      'trash.confirmRestore': 'Подтвердить восстановление',
      'trash.originalPath': 'Исходный путь',
      'trash.deletedAt': 'Удалён',
      'help.name': '1–64 символа: строчная латиница, цифры и одиночные дефисы; станет именем папки и должно совпадать с именем во frontmatter.',
      'help.description': 'Маршрутный текст: что делает навык и когда его использовать. Модель читает его до выбора навыка. Рекомендуем до 200 символов, максимум 1024.',
      'help.body': 'Пошаговые инструкции. Держите их короткими, длинные материалы — в references/ и scripts/; тело попадает в контекст только при использовании навыка.',
      'help.destination': 'Где хранится навык. «Мои» — ~/.dsh/skills, «Общие» — ~/.agents/skills, «Проект» — <workspace>/.dsh/skills.',
      'help.importMode': 'Копия — независимый снимок. Симлинк — живая ссылка: правки источника обновляют DSH, но перенос источника ломает ссылку.',
      'help.importTarget': 'Место назначения должно быть записываемым корнем DSH. Импорт никогда не перезаписывает существующие навыки.',
      'help.live': 'Live-режим показывает read-only навыки другого агента в каталоге модели DSH без копирования. Ничего не копируется — модель читает внешний файл.',
      'help.modelToggle': 'Управляет тем, видит ли модель навык в своём каталоге.',
      'help.userToggle': 'Управляет тем, появляется ли навык в меню / в чате.',
      'help.delete': 'Навык перемещается в корзину студии; файл не удаляется безвозвратно, его можно восстановить.',
      'help.ai': 'Чат открывается со встроенными инструкциями создателя. Агент задаёт короткие вопросы и сохраняет навык инструментом студии — с проверкой и бэкапом.',
      'toast.saved': 'Навык сохранён',
      'toast.created': 'Навык создан',
      'toast.trashed': 'Навык перемещён в корзину',
      'toast.restored': 'Навык восстановлен',
      'toast.updated': 'Навык обновлён',
      'toast.stale': 'Каталог изменился. Перезагрузил — повторите.',
      'toast.copied': 'Скопировано в буфер обмена',
      'toast.copyFailed': 'Не удалось скопировать в буфер обмена',
      'error.CONFIRM_REQUIRED': 'Для действия нужно подтверждение',
      'error.STALE_REVISION': 'Каталог изменился. Обновите страницу и повторите',
      'error.VALIDATION_FAILED': 'В навыке есть ошибки проверки',
      'error.READ_ONLY_SKILL': 'Этот навык доступен только для чтения',
      'error.SYMLINK_READ_ONLY': 'Навыки-симлинки здесь не редактируются',
      'error.TARGET_EXISTS': 'Навык с таким именем уже существует',
      'error.NAME_CHANGE_UNSUPPORTED': 'Имя навыка нельзя изменить в этом окне',
      'error.PATH_NOT_ALLOWED': 'Записывать можно только файлы в references/, scripts/ и assets/',
      'error.SKILL_UNREADABLE': 'Файл навыка не читается',
      'error.PROJECT_NOT_CONFIGURED': 'Этот проект не настроен в плагине',
      'error.CONTENT_TOO_LARGE': 'Содержимое слишком большое',
      'error.SELECTION_EMPTY': 'Выберите хотя бы один навык',
      'error.SELECTION_TOO_LARGE': 'Слишком много навыков выбрано',
      'error.NOT_FOUND': 'Не найдено',
      'source.dshUser': 'Мои навыки (DSH)',
      'source.dshAgents': 'Общие агентские',
      'source.project': 'Проект',
      'source.bundled': 'Встроенные (DSH)',
      'source.claude': 'Claude Code',
      'source.codex': 'Codex',
      'source.hermes': 'Hermes',
      'source.zcode': 'ZCode',
      'source.cursor': 'Cursor',
      'source.gemini': 'Gemini / Antigravity',
      'source.kimi': 'Kimi',
      'source.opencode': 'OpenCode',
      'create.scope.user': 'Мои навыки (DSH)',
      'create.scope.agents': 'Общие агентские',
      'create.scope.project': 'Проект',
      'create.aiHint': 'Опишите навык один раз — откроется чат со встроенным создателем, а навык появится здесь после сохранения.',
      'scope.user': 'пользователь',
      'scope.project': 'проект',
      'actions.expand': 'На весь экран',
      'actions.collapse': 'Свернуть',
      'detail.facts.files': 'Файлы',
      'help.symlinkToggle': 'Навык — симлинк на источник. Включайте/выключайте его в исходном агенте или сначала импортируйте копию.',
      'help.readonlyToggle': 'Источник принадлежит другому агенту и здесь только для чтения. Импортируйте копию или включите live-показ в «Источниках», чтобы использовать навык в DSH.',
      'help.files': 'Навык может содержать дополнительные файлы в references/, scripts/ или assets/. Они подгружаются только по необходимости, поэтому SKILL.md остаётся коротким.',
      'diag.generic': 'Исправьте файл навыка и сохраните; откройте редактор, чтобы изменить его.',
      'diag.name-missing': 'Добавьте имя в kebab-case во frontmatter — имя папки используется как подсказка.',
      'diag.name-invalid': 'В имени допустимы строчная латиница, цифры и одиночные дефисы.',
      'diag.name-folder-mismatch': 'Переименуйте папку навыка или измените имя во frontmatter, чтобы они совпадали.',
      'diag.name-too-long': 'Сократите имя до 64 символов.',
      'diag.description-missing': 'Добавьте описание: что делает навык и когда его использовать.',
      'diag.description-too-long': 'Сократите описание до 1024 символов.',
      'diag.description-long': 'Сократите описание примерно до 200 символов, детали перенесите в тело.',
      'diag.description-short': 'Добавьте фразы-триггеры, чтобы модель понимала, когда выбирать навык.',
      'diag.body-empty': 'Добавьте инструкции в тело SKILL.md.',
      'diag.body-too-large': 'Перенесите длинные материалы в references/ или scripts/ и сократите SKILL.md.',
      'diag.invocation-invalid': 'Для полей invocation используйте true/false (или yes/no).',
      'diag.file-too-large': 'Файл больше лимита предпросмотра; проверьте его на диске, если размер неожиданный.',
      'diag.symlink': 'Навык связан с источником: редактируйте в исходном агенте или импортируйте копию.',
      'diag.symlink-broken': 'Цель симлинка не найдена. Импортируйте навык заново или удалите битую ссылку.',
      'diag.frontmatter-missing': 'Добавьте YAML-frontmatter между строками --- в начале SKILL.md.',
      'diag.frontmatter-invalid': 'Исправьте синтаксис YAML-frontmatter (строки key: value).',
      'error.OPERATION_FAILED': 'Операция не выполнена',
    };

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    const STYLES = `
      [data-plugin="dsh-skill-curator"] * { box-sizing: border-box; }
      [data-plugin="dsh-skill-curator"] { font-size: 14px; line-height: 22px; }
      .sc-topbar {
        position: sticky; top: 0; z-index: 30;
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 6px 0 8px; margin: -2px 0 0;
        background: var(--dsw-alias-bg-layer-1);
        border-bottom: .5px solid var(--dsw-alias-border-l2);
      }
      .sc-topbar .sc-breadcrumb { flex: 1 1 auto; min-width: 0; }
      .sc-topbar-actions { display: flex; align-items: center; gap: 6px; flex: none; }
      .sc-fullscreen {
        position: fixed; inset: 0; z-index: 105; overflow: auto;
        background: var(--dsw-alias-bg-layer-1);
        padding: 22px 24px 40px;
      }
      .sc-fullscreen-inner { width: 100%; max-width: 1060px; margin: 0 auto; }
      .sc-fullscreen-bar {
        display: flex; align-items: center; justify-content: space-between; gap: 10px;
        max-width: 1060px; margin: 0 auto 12px;
      }
      .sc-row-status { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
      .sc-diag-help { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .sc-editor-top {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 8px 10px; border-radius: 10px;
        background: var(--dsw-alias-bg-module-platform);
      }
      .sc-page {
        display: flex; flex-direction: column; gap: 14px;
        width: 100%; max-width: 960px; margin: 0 auto; padding: 2px 2px 24px;
        color: var(--dsw-alias-label-primary);
        font-size: 13px; line-height: 20px;
      }
      .sc-head { display: flex; flex-direction: column; gap: 6px; }
      .sc-head-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      .sc-head-titles { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 280px; }
      .sc-title { margin: 0; font-size: 22px; font-weight: 600; line-height: 29px; letter-spacing: -0.01em; }
      .sc-subtitle { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 19px; }
      .sc-head-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sc-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 6px;
        height: 34px; padding: 0 14px; border: 0; border-radius: 8px;
        background: transparent; color: var(--dsw-alias-label-primary);
        font: inherit; font-size: 13px; line-height: 20px; white-space: nowrap;
        cursor: pointer; text-decoration: none;
      }
      .sc-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .sc-btn:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
      .sc-btn:disabled { opacity: .45; cursor: not-allowed; }
      .sc-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .sc-btn-outline { box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l3); }
      .sc-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
      .sc-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
      .sc-btn-ghost { color: var(--dsw-alias-label-secondary); }
      .sc-btn-ghost:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
      .sc-btn-danger { color: var(--dsw-alias-state-error-primary); box-shadow: inset 0 0 0 .5px var(--dsw-alias-border-l3); }
      .sc-btn-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
      .sc-btn-sm { height: 30px; padding: 0 10px; font-size: 12px; border-radius: 7px; }
      .sc-icon-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 34px; height: 34px; padding: 0; flex: none;
        border: .5px solid var(--dsw-alias-border-l3); border-radius: 999px;
        background: transparent; color: var(--dsw-alias-label-secondary);
        cursor: pointer;
      }
      .sc-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .sc-icon-btn:disabled { opacity: .4; cursor: not-allowed; }
      .sc-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .sc-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
      .sc-search { position: relative; flex: 1 1 220px; min-width: 180px; }
      .sc-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--dsw-alias-label-tertiary); display: flex; pointer-events: none; }
      .sc-input, .sc-select, .sc-textarea {
        width: 100%; padding: 8px 10px; border: .5px solid var(--dsw-alias-border-l3);
        border-radius: 8px; background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px;
      }
      .sc-search .sc-input { height: 36px; padding-left: 34px; }
      .sc-input:focus-visible, .sc-select:focus-visible, .sc-textarea:focus-visible {
        outline: none; border-color: var(--dsw-alias-state-business-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);
      }
      .sc-textarea { min-height: 96px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; line-height: 20px; }
      .sc-textarea.sc-body { min-height: 190px; }
      .sc-select { height: 36px; }
      .sc-summary { display: flex; align-items: center; gap: 6px 14px; flex-wrap: wrap; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
      .sc-summary b { color: var(--dsw-alias-label-primary); font-weight: 600; }
      .sc-filters { display: flex; gap: 6px; flex-wrap: wrap; }
      .sc-filter {
        height: 30px; padding: 0 12px; border-radius: 999px; border: .5px solid var(--dsw-alias-border-l3);
        background: transparent; color: var(--dsw-alias-label-secondary);
        font: inherit; font-size: 12.5px; line-height: 18px; cursor: pointer; white-space: nowrap;
      }
      .sc-filter:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .sc-filter[aria-pressed="true"] {
        background: var(--dsw-alias-state-business-tertiary, color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent));
        border-color: transparent; color: var(--dsw-alias-state-business-primary); font-weight: 500;
      }
      .sc-filter:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .sc-group { display: flex; flex-direction: column; gap: 8px; }
      .sc-group-head {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        width: 100%; padding: 0 2px; border: 0; background: transparent;
        color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer;
        min-height: 26px;
      }
      .sc-group-head:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; border-radius: 6px; }
      .sc-group-chevron { flex: none; color: var(--dsw-alias-label-tertiary); display: inline-flex; }
      .sc-group-title { font-size: 13.5px; font-weight: 600; line-height: 19px; }
      .sc-group-count { color: var(--dsw-alias-label-tertiary); font-size: 13px; font-weight: 500; }
      .sc-group-spacer { flex: 1 1 auto; }
      .sc-group-path {
        color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 16px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
      }
      .sc-card {
        border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4));
        border-radius: 12px;
        background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1));
        overflow: hidden;
      }
      .sc-row {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 10px 12px; min-height: 64px;
      }
      .sc-row + .sc-row { border-top: .5px solid var(--dsw-alias-border-l2); }
      .sc-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .sc-row-main {
        display: flex; align-items: flex-start; gap: 12px; flex: 1 1 auto;
        min-width: 0; padding: 0; border: 0; background: transparent;
        color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 8px;
      }
      .sc-row-main:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 4px; }
      .sc-row-icon {
        flex: none; display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; margin-top: 2px; border-radius: 50%;
        border: .5px solid var(--dsw-alias-border-l3);
        background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
      }
      .sc-row-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
      .sc-row-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
      .sc-row-name-text { font-size: 13.5px; font-weight: 600; line-height: 19px; overflow-wrap: anywhere; }
      .sc-row-desc {
        color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 18px;
        overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .sc-row-meta {
        color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 16px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;
      }
      .sc-row-end { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex: none; }
      .sc-row-end-row { display: flex; align-items: center; gap: 6px; }
      .sc-switch {
        position: relative; flex: none; width: 44px; height: 26px; padding: 2px;
        border: 0; border-radius: 999px; background: var(--dsw-alias-border-l3); cursor: pointer;
      }
      .sc-switch[aria-checked="true"] { background: var(--dsw-alias-button-primary-fill); }
      .sc-switch:disabled { opacity: .5; cursor: default; }
      .sc-switch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .sc-switch-thumb {
        display: block; width: 22px; height: 22px; border-radius: 50%;
        background: var(--dsw-alias-switch-thumb, #fff); transition: transform .14s ease;
      }
      .sc-switch[aria-checked="true"] .sc-switch-thumb { transform: translateX(18px); }
      .sc-tag {
        display: inline-flex; align-items: center; gap: 4px; flex: none;
        padding: 0 7px; border-radius: 999px; font-size: 11px; line-height: 17px; font-weight: 500;
        color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-module-platform);
      }
      .sc-tag[data-tone="info"] { color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); }
      .sc-tag[data-tone="error"] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }
      .sc-tag[data-tone="warn"] { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent); }
      .sc-tag[data-tone="success"] { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); }
      .sc-help-wrap { position: relative; display: inline-flex; flex: none; }
      .sc-help {
        display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; padding: 0; border-radius: 50%;
        border: .5px solid var(--dsw-alias-border-l3); background: transparent;
        color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; line-height: 1;
        cursor: pointer;
      }
      .sc-help:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .sc-help:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .sc-help-pop {
        position: fixed; z-index: 125; width: 290px; max-width: calc(100vw - 24px);
        padding: 10px 12px; border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
        border: .5px solid var(--dsw-alias-border-l3);
        box-shadow: 0 12px 36px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent);
        font-size: 12px; line-height: 18px; font-weight: 400; text-align: left;
      }
      .sc-menu-wrap { position: relative; display: inline-flex; }
      .sc-menu {
        position: fixed; z-index: 120; min-width: 210px; max-height: min(70vh, 380px); overflow: auto;
        display: flex; flex-direction: column; gap: 2px; padding: 6px;
        border: .5px solid var(--dsw-alias-border-l3); border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2);
        box-shadow: 0 10px 30px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
      }
      .sc-menu-item {
        display: flex; align-items: center; gap: 8px; width: 100%;
        padding: 8px 10px; border: 0; border-radius: 7px; background: transparent;
        color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px;
        text-align: left; cursor: pointer;
      }
      .sc-menu-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .sc-menu-item:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
      .sc-menu-item[data-danger="true"] { color: var(--dsw-alias-state-error-primary); }
      .sc-menu-item:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
      .sc-menu-note { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .sc-menu-sep { height: 1px; margin: 4px 2px; background: var(--dsw-alias-border-l2); }
      .sc-banner {
        display: flex; align-items: flex-start; gap: 10px; flex-wrap: wrap;
        padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 20px;
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
        color: var(--dsw-alias-state-error-primary);
      }
      .sc-banner[data-tone="info"] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
      .sc-banner[data-tone="success"] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent); color: var(--dsw-alias-state-success-primary); }
      .sc-banner-text { flex: 1 1 220px; min-width: 0; }
      .sc-banner-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .sc-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
      .sc-empty {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 28px 16px; border: .5px dashed var(--dsw-alias-border-l3); border-radius: 12px;
        text-align: center; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px;
      }
      .sc-empty-title { color: var(--dsw-alias-label-primary); font-size: 15px; font-weight: 600; line-height: 22px; }
      .sc-tabs { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); flex-wrap: wrap; }
      .sc-tab {
        height: 30px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent;
        color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer;
      }
      .sc-tab[aria-selected="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 500; box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
      .sc-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .sc-facts { display: flex; flex-direction: column; gap: 0; border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4)); border-radius: 12px; background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1)); }
      .sc-fact { display: flex; align-items: baseline; gap: 12px; padding: 7px 12px; font-size: 12.5px; line-height: 19px; }
      .sc-fact + .sc-fact { border-top: .5px solid var(--dsw-alias-border-l2); }
      .sc-fact-label { flex: 0 0 108px; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
      .sc-fact-value { min-width: 0; flex: 1 1 auto; overflow-wrap: anywhere; }
      .sc-fact-value[data-mono="true"] { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .sc-model { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4)); border-radius: 12px; background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1)); }
      .sc-model-title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; line-height: 19px; }
      .sc-model-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
      .sc-model-desc { color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 19px; }
      .sc-toggles { display: flex; gap: 18px; flex-wrap: wrap; }
      .sc-toggle-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .sc-pre {
        margin: 0; padding: 12px; border-radius: 10px;
        border: .5px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-module-platform);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere;
        max-height: 52vh; overflow: auto;
      }
      .sc-pre.sc-prompt { max-height: 220px; }
      .sc-md { font-size: 14px; line-height: 22px; overflow-wrap: anywhere; }
      .sc-md h1, .sc-md h2, .sc-md h3 { margin: 14px 0 6px; font-size: 16px; line-height: 24px; font-weight: 600; }
      .sc-md h1:first-child, .sc-md h2:first-child { margin-top: 0; }
      .sc-md p { margin: 0 0 8px; }
      .sc-md ul { margin: 0 0 8px; padding-left: 20px; }
      .sc-md li { margin: 2px 0; }
      .sc-file-list { display: flex; flex-direction: column; gap: 2px; }
      .sc-file {
        display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px;
        border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit;
        text-align: left; cursor: pointer;
      }
      .sc-file:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .sc-file-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-file-size { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; flex: none; }
      .sc-diag { display: flex; flex-direction: column; gap: 8px; }
      .sc-diag-item { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4)); border-radius: 10px; background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1)); }
      .sc-diag-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
      .sc-diag-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .sc-diag-params { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 16px; overflow-wrap: anywhere; }
      .sc-field { display: flex; flex-direction: column; gap: 6px; }
      .sc-field-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .sc-field-label { font-size: 13px; font-weight: 500; line-height: 20px; }
      .sc-field-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .sc-field-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
      .sc-counter { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 16px; font-variant-numeric: tabular-nums; }
      .sc-form { display: flex; flex-direction: column; gap: 14px; }
      .sc-form-row { display: flex; gap: 12px; flex-wrap: wrap; }
      .sc-form-row > .sc-field { flex: 1 1 200px; }
      .sc-seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); flex-wrap: wrap; }
      .sc-seg-btn {
        height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent;
        color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12.5px; line-height: 18px; cursor: pointer;
      }
      .sc-seg-btn[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 500; box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
      .sc-seg-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .sc-sticky-foot {
        position: sticky; bottom: 0; z-index: 20;
        display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
        margin: 4px -2px 0; padding: 12px 16px;
        border-top: .5px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-1);
        box-shadow: 0 -8px 24px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent);
      }
      .sc-sticky-foot .sc-note { margin-left: auto; }
      .sc-note { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .sc-note-muted { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; line-height: 16px; }
      .sc-import-bar { display: flex; flex-direction: column; gap: 10px; padding: 14px; }
      .sc-import-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; }
      .sc-import-row > .sc-field { flex: 1 1 190px; }
      .sc-cand-list { display: flex; flex-direction: column; }
      .sc-cand {
        display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px;
      }
      .sc-cand + .sc-cand { border-top: .5px solid var(--dsw-alias-border-l2); }
      .sc-cand[data-skipped="true"] { opacity: .62; }
      .sc-cand-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
      .sc-cand-name { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13.5px; font-weight: 600; line-height: 20px; }
      .sc-cand-desc { color: var(--dsw-alias-label-secondary); font-size: 12.5px; line-height: 18px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
      .sc-cand-path { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-cand-reason { color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 16px; }
      .sc-check { flex: none; width: 16px; height: 16px; margin-top: 3px; accent-color: var(--dsw-alias-state-business-primary); cursor: pointer; }
      .sc-check:disabled { cursor: default; }
      .sc-actions-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sc-breadcrumb { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 20px; }
      .sc-breadcrumb button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; padding: 0; cursor: pointer; }
      .sc-breadcrumb button:hover { color: var(--dsw-alias-label-primary); }
      .sc-breadcrumb button:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; border-radius: 4px; }
      .sc-breadcrumb-sep { color: var(--dsw-alias-label-tertiary); }
      .sc-breadcrumb-current { color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
      .sc-list { display: flex; flex-direction: column; }
      .sc-toast {
        position: fixed; z-index: 130; left: 50%; bottom: 28px; transform: translateX(-50%);
        max-width: min(560px, calc(100vw - 32px)); padding: 9px 14px; border-radius: 10px;
        background: var(--dsw-alias-toast-bg, var(--dsw-alias-bg-layer-2));
        color: var(--dsw-alias-toast-label, var(--dsw-alias-label-primary));
        border: .5px solid var(--dsw-alias-border-l3);
        box-shadow: 0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);
        font-size: 13px; line-height: 20px;
      }
      .sc-mt-0 { margin-top: 0; }
      .sc-mb-0 { margin-bottom: 0; }
      @media (max-width: 720px) {
        .sc-title { font-size: 24px; line-height: 32px; }
        .sc-row { flex-wrap: wrap; }
        .sc-row-end { flex-direction: row; width: 100%; justify-content: flex-end; }
        .sc-fact { flex-wrap: wrap; }
        .sc-fact-label { flex-basis: 100%; }
        .sc-sticky-foot { padding: 10px 12px; }
      }
    `;

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    const PLURAL = {
      ru: {
        skills: ['навык', 'навыка', 'навыков'],
        sources: ['источник', 'источника', 'источников'],
        errors: ['ошибка', 'ошибки', 'ошибок'],
        warnings: ['предупреждение', 'предупреждения', 'предупреждений'],
        chars: ['символ', 'символа', 'символов'],
        lines: ['строка', 'строки', 'строк'],
        selected: ['навык', 'навыка', 'навыков'],
        files: ['файл', 'файла', 'файлов'],
      },
      en: {
        skills: ['skill', 'skills', 'skills'],
        sources: ['source', 'sources', 'sources'],
        errors: ['error', 'errors', 'errors'],
        warnings: ['warning', 'warnings', 'warnings'],
        chars: ['character', 'characters', 'characters'],
        lines: ['line', 'lines', 'lines'],
        selected: ['skill', 'skills', 'skills'],
        files: ['file', 'files', 'files'],
      },
    };

    function plural(runtime, count, kind) {
      const forms = (PLURAL[runtime.language] ?? PLURAL.ru)[kind] ?? ['', '', ''];
      const value = Math.abs(Number(count) || 0) % 100;
      const last = value % 10;
      if (value > 10 && value < 20) return forms[2];
      if (last > 1 && last < 5) return forms[1];
      if (last === 1) return forms[0];
      return forms[2];
    }

    function installStyles() {
      if (typeof document === 'undefined' || !document.head) return () => {};
      const selector = 'style[data-plugin="' + PLUGIN_ID + '"]';
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.textContent = STYLES;
      document.head.appendChild(tag);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        if (tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    function resolveApiPath() {
      try {
        if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI !== '') {
          const url = new URL(API_PATH.replace(/^\//, ''), document.baseURI);
          return url.pathname + url.search;
        }
      } catch {
        // Fall through to the root-relative path.
      }
      return API_PATH;
    }

    function clientError(code, status, details) {
      return { code, status, details };
    }

    async function requestApi(action, payload) {
      const headers = {};
      headers[API_HEADER] = '1';
      const init = { method: 'GET', credentials: 'same-origin', headers, cache: 'no-store' };
      if (typeof action === 'string' && action !== '') {
        init.method = 'POST';
        headers['content-type'] = 'application/json';
        init.body = JSON.stringify({ action, ...(payload || {}) });
      }
      let response;
      try {
        response = await fetch(resolveApiPath(), init);
      } catch {
        throw clientError('NETWORK', 0);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw clientError('INVALID_RESPONSE', response.status);
      }
      if (!response.ok || !body || body.ok !== true) {
        const error = body && body.error && typeof body.error === 'object' ? body.error : {};
        const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'INVALID_RESPONSE';
        throw clientError(code, response.status, error.details);
      }
      return body.value;
    }

    function formatBytes(value) {
      const bytes = typeof value === 'number' && Number.isFinite(value) ? value : 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function formatDate(value, language) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '';
      try {
        return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
          year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(new Date(value));
      } catch {
        return new Date(value).toISOString();
      }
    }

    function countSeverity(diagnostics, severity) {
      return (diagnostics || []).filter((item) => item && item.severity === severity).length;
    }

    function formatParams(params) {
      if (!params || typeof params !== 'object') return '';
      const parts = [];
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
        if (text === '') continue;
        parts.push(key + '=' + text.slice(0, 120));
      }
      return parts.join(' · ');
    }

    function errorText(runtime, error) {
      const code = error && typeof error.code === 'string' && error.code !== '' ? error.code : 'OPERATION_FAILED';
      const key = 'error.' + code;
      const text = runtime.t(key);
      return text === key ? code : text;
    }

    function hasErrors(skill) {
      return countSeverity(skill && skill.diagnostics, 'error') > 0;
    }

    function skillEnabled(skill) {
      return !skill || !skill.invocation || (skill.invocation.modelInvocable !== false && skill.invocation.userInvocable !== false);
    }

    function sourceLabel(runtime, source) {
      if (source && typeof source.label === 'string' && source.label !== '') return source.label;
      const key = source && typeof source.labelKey === 'string' ? source.labelKey : '';
      return key !== '' ? runtime.t(key) : (source && (source.agent || source.key)) || '';
    }


    function agentSourceKey(skill) {
      if (!skill) return null;
      if (skill.scope === 'project') return 'source.project';
      const map = {
        dsh: 'source.dshUser',
        claude: 'source.claude',
        codex: 'source.codex',
        hermes: 'source.hermes',
        zcode: 'source.zcode',
        cursor: 'source.cursor',
        gemini: 'source.gemini',
        kimi: 'source.kimi',
        opencode: 'source.opencode',
      };
      if (skill.sourceKind === 'bundled') return 'source.bundled';
      return map[skill.agent] ?? null;
    }

    function scopeLabel(runtime, scope) {
      return runtime.t(scope === 'project' ? 'scope.project' : 'scope.user');
    }

    function statusLabel(runtime, skill) {
      if (!skill) return '';
      if (skill.readOnly) return runtime.t('detail.status.readOnly');
      return skillEnabled(skill) ? runtime.t('detail.status.enabled') : runtime.t('detail.status.disabled');
    }

    function maskArrow(text) {
      return String(text ?? '').replace(/\s+/g, ' ').trim();
    }

    /* ------------------------------------------------------------------ */
    /* Runtime                                                             */
    /* ------------------------------------------------------------------ */

    function createRuntime(ctx) {
      const locale = ctx && ctx.locale;
      const readLanguage = () => {
        try {
          if (locale && typeof locale.getLocale === 'function') {
            const snapshot = locale.getLocale();
            const code = snapshot && (snapshot.language || snapshot.locale || snapshot.lang);
            if (typeof code === 'string' && code.toLowerCase().startsWith('en')) return 'en';
            if (typeof code === 'string' && code.toLowerCase().startsWith('ru')) return 'ru';
          }
        } catch {
          // Fall through to the default.
        }
        return 'ru';
      };
      const runtime = {
        language: 'ru',
        t(key) {
          const dictionary = runtime.language === 'en' ? DICT_EN : DICT_RU;
          return Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : (DICT_EN[key] ?? key);
        },
        refreshLanguage() {
          runtime.language = readLanguage();
        },
        subscribe(listener) {
          if (locale && typeof locale.subscribe === 'function') {
            try {
              return locale.subscribe(() => {
                runtime.refreshLanguage();
                listener();
              });
            } catch {
              return () => {};
            }
          }
          return () => {};
        },
        /**
         * Start a real DSH chat with a prefilled draft. Synchronous by contract:
         * navigation unmounts the settings page, so it must run before any await.
         */
        startSkillChat(prompt) {
          try {
            const nav = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
            if (!nav || typeof nav.startSession !== 'function') return false;
            nav.startSession(undefined, { prompt, whenDraftExists: 'replace' });
            return true;
          } catch {
            return false;
          }
        },
        async copyText(text) {
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
              await navigator.clipboard.writeText(String(text));
              return true;
            }
          } catch {
            // Fall through.
          }
          return false;
        },
      };
      runtime.refreshLanguage();
      return runtime;
    }

    function useRuntime(runtime) {
      const [, setRevision] = useState(0);
      useEffect(() => {
        const dispose = runtime.subscribe(() => setRevision((value) => value + 1));
        return typeof dispose === 'function' ? dispose : undefined;
      }, [runtime]);
      return runtime;
    }

    /* ------------------------------------------------------------------ */
    /* Primitives                                                          */
    /* ------------------------------------------------------------------ */

    const ICON_PATHS = {
      search: ['M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z', 'm15.5 15.5 4 4'],
      plus: ['M12 5v14', 'M5 12h14'],
      import: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 19h14'],
      refresh: ['M20 11a8 8 0 1 0-2.3 6.7', 'M20 5v6h-6'],
      more: ['M6 12h.01M12 12h.01M18 12h.01'],
      help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.6 9a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 1-1 1.7v.4', 'M12 17h.01'],
      back: ['M15 5l-7 7 7 7'],
      down: ['m6 9 6 6 6-6'],
      right: ['m9 6 6 6-6 6'],
      file: ['M7 3h7l4 4v14H7V3Z', 'M13 3v5h5'],
      folder: ['M3 7h7l2 2h9v10H3V7Z'],
      trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
      edit: ['M4 20h4l11-11-4-4L4 16v4Z', 'm13 5 4 4'],
      copy: ['M9 9h11v11H9V9Z', 'M5 15V4h11'],
      check: ['m5 12 5 5 9-10'],
      close: ['M6 6l12 12', 'M18 6 6 18'],
      skill: ['M6 4h9a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z', 'M6 17a2 2 0 0 1 2-2h9', 'm17 2 .5 1.5L19 4l-1.5.5L17 6l-.5-1.5L15 4l1.5-.5L17 2Z'],
      spark: ['m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z'],
      terminal: ['M4 5h16v14H4V5Z', 'm7 9 3 3-3 3', 'M13 15h4'],
      link: ['M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'],
      source: ['M12 3v18', 'M5 8h14', 'M5 16h14'],
      expand: ['M9 4H4v5', 'M15 4h5v5', 'M9 20H4v-5', 'M15 20h5v-5'],
      collapse: ['M4 9h5V4', 'M20 9h-5V4', 'M4 15h5v5', 'M20 15h-5v5'],
      lock: ['M6 11h12v9H6v-9Z', 'M8.5 11V7a3.5 3.5 0 0 1 7 0v4'],
    };

    function Icon({ name, size = 16 }) {
      const paths = ICON_PATHS[name] ?? ICON_PATHS.skill;
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
        paths.map((d, index) => h('path', {
          key: index,
          d,
          stroke: 'currentColor',
          strokeWidth: name === 'more' ? 2.4 : 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        })),
      );
    }

    function ExpandButton({ runtime, expanded, onExpand }) {
      if (typeof onExpand !== 'function') return null;
      const label = runtime.t(expanded ? 'actions.collapse' : 'actions.expand');
      return h('button', {
        type: 'button',
        className: 'sc-btn sc-btn-sm sc-btn-ghost',
        title: label,
        'aria-label': label,
        onClick: onExpand,
      }, h(Icon, { name: expanded ? 'collapse' : 'expand', size: 14 }), label);
    }

    function Tag({ tone, children }) {
      return h('span', { className: 'sc-tag', 'data-tone': tone ?? undefined }, children);
    }

    function HelpTip({ label, children }) {
      const [open, setOpen] = useState(false);
      const [pos, setPos] = useState(null);
      const wrapRef = useRef(null);
      const popRef = useRef(null);
      const toggle = () => {
        if (!open && wrapRef.current) {
          const rect = wrapRef.current.getBoundingClientRect();
          const width = 290;
          const left = Math.min(Math.max(8, rect.left - width + 18), (window.innerWidth || 1200) - width - 8);
          const top = Math.min(rect.bottom + 6, (window.innerHeight || 800) - 140);
          setPos({ left: Math.max(8, left), top });
        }
        setOpen((value) => !value);
      };
      useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          const wrap = wrapRef.current;
          const pop = popRef.current;
          if (wrap && wrap.contains(event.target)) return;
          if (pop && pop.contains(event.target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);
      return h(
        'span',
        { className: 'sc-help-wrap', ref: wrapRef },
        h('button', {
          type: 'button',
          className: 'sc-help',
          'aria-label': label ?? 'Help',
          'aria-expanded': open ? 'true' : 'false',
          onClick: toggle,
        }, '?'),
        open && pos !== null
          ? h('span', { className: 'sc-help-pop', role: 'tooltip', ref: popRef, style: pos }, children)
          : null,
      );
    }

    function Switch({ checked, disabled, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          title: label,
          className: 'sc-switch',
          disabled: disabled === true,
          onClick: (event) => {
            event.stopPropagation();
            if (disabled !== true) onChange(!checked);
          },
        },
        h('span', { className: 'sc-switch-thumb' }),
      );
    }

    function MenuButton({ label, items, align = 'right', triggerLabel }) {
      const [open, setOpen] = useState(false);
      const [pos, setPos] = useState(null);
      const wrapRef = useRef(null);
      const menuRef = useRef(null);
      const toggle = () => {
        if (!open && wrapRef.current) {
          const rect = wrapRef.current.getBoundingClientRect();
          const width = 220;
          const right = align === 'right' ? rect.right : rect.left + width;
          const left = Math.min(Math.max(8, right - width), (window.innerWidth || 1200) - width - 8);
          setPos({ left, top: Math.min(rect.bottom + 6, (window.innerHeight || 800) - 220) });
        }
        setOpen((value) => !value);
      };
      useEffect(() => {
        if (!open) return undefined;
        const onDown = (event) => {
          const wrap = wrapRef.current;
          const menu = menuRef.current;
          if (wrap && wrap.contains(event.target)) return;
          if (menu && menu.contains(event.target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
          document.removeEventListener('mousedown', onDown);
          document.removeEventListener('keydown', onKey);
        };
      }, [open]);
      return h(
        'span',
        { className: 'sc-menu-wrap', ref: wrapRef },
        h('button', {
          type: 'button',
          className: 'sc-icon-btn',
          'aria-label': triggerLabel ?? label ?? 'Menu',
          'aria-haspopup': 'menu',
          'aria-expanded': open ? 'true' : 'false',
          onClick: toggle,
        }, h(Icon, { name: 'more', size: 16 })),
        open && pos !== null
          ? h(
            'span',
            { className: 'sc-menu', role: 'menu', ref: menuRef, style: pos },
            items.map((item, index) => (item.separator
              ? h('span', { key: 'sep-' + index, className: 'sc-menu-sep' })
              : h('button', {
                key: item.key ?? index,
                type: 'button',
                role: 'menuitem',
                className: 'sc-menu-item',
                'data-danger': item.danger ? 'true' : undefined,
                disabled: item.disabled === true,
                onClick: () => {
                  setOpen(false);
                  if (typeof item.onSelect === 'function') item.onSelect();
                },
              }, item.icon ? h(Icon, { name: item.icon, size: 14 }) : null, item.label, item.note ? h('span', { className: 'sc-menu-note' }, item.note) : null))),
          )
          : null,
      );
    }

    function Banner({ tone, children, actions }) {
      return h('div', { className: 'sc-banner', 'data-tone': tone ?? undefined, role: 'status' },
        h('span', { className: 'sc-banner-text' }, children),
        actions ? h('span', { className: 'sc-banner-actions' }, actions) : null);
    }

    function EmptyState({ title, body, actions }) {
      return h('div', { className: 'sc-empty' },
        h('div', { className: 'sc-empty-title' }, title),
        body ? h('div', null, body) : null,
        actions ? h('div', { className: 'sc-actions-row' }, actions) : null);
    }

    function PillTabs({ items, value, onChange }) {
      return h('div', { className: 'sc-tabs', role: 'tablist' },
        items.map((item) => h('button', {
          key: item.value,
          type: 'button',
          role: 'tab',
          className: 'sc-tab',
          'aria-selected': value === item.value ? 'true' : 'false',
          onClick: () => onChange(item.value),
        }, item.label)));
    }

    function renderInline(text) {
      const parts = [];
      const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
      let last = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index));
        const token = match[0];
        if (token.startsWith('`')) parts.push(h('code', { key: parts.length }, token.slice(1, -1)));
        else parts.push(h('strong', { key: parts.length }, token.slice(2, -2)));
        last = match.index + token.length;
      }
      if (last < text.length) parts.push(text.slice(last));
      return parts;
    }

    function Markdown({ text }) {
      const blocks = useMemo(() => {
        const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
        const out = [];
        let index = 0;
        let key = 0;
        while (index < lines.length) {
          const line = lines[index];
          if (/^```/.test(line.trim())) {
            index += 1;
            const code = [];
            while (index < lines.length && !/^```/.test(lines[index].trim())) {
              code.push(lines[index]);
              index += 1;
            }
            index += 1;
            out.push(h('pre', { key: key++, className: 'sc-pre' }, code.join('\n')));
            continue;
          }
          const heading = /^(#{1,3})\s+(.*)$/.exec(line);
          if (heading) {
            const level = heading[1].length;
            out.push(h('h' + level, { key: key++ }, renderInline(heading[2])));
            index += 1;
            continue;
          }
          if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
              items.push(h('li', { key: key++ }, renderInline(lines[index].replace(/^\s*[-*]\s+/, ''))));
              index += 1;
            }
            out.push(h('ul', { key: key++ }, items));
            continue;
          }
          if (/^\s*\d+\.\s+/.test(line)) {
            const items = [];
            while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
              items.push(h('li', { key: key++ }, renderInline(lines[index].replace(/^\s*\d+\.\s+/, ''))));
              index += 1;
            }
            out.push(h('ol', { key: key++ }, items));
            continue;
          }
          if (line.trim() === '') {
            index += 1;
            continue;
          }
          const paragraph = [];
          while (index < lines.length && lines[index].trim() !== ''
            && !/^(#{1,3})\s+/.test(lines[index])
            && !/^\s*[-*]\s+/.test(lines[index])
            && !/^\s*\d+\.\s+/.test(lines[index])
            && !/^```/.test(lines[index].trim())) {
            paragraph.push(lines[index]);
            index += 1;
          }
          out.push(h('p', { key: key++ }, renderInline(paragraph.join(' '))));
        }
        return out;
      }, [text]);
      return h('div', { className: 'sc-md' }, blocks);
    }

    function Toast({ text }) {
      return h('div', { className: 'sc-toast', role: 'status' }, text);
    }

    function ConfirmOverlay({ runtime, title, body, confirmLabel, tone, busy, onConfirm, onCancel }) {
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onCancel();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
      }, [onCancel]);
      return h(
        'div',
        { className: 'sc-overlay', role: 'dialog', 'aria-modal': 'true', style: { position: 'fixed', inset: 0, zIndex: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--dsw-alias-bg-mask-1, rgba(15,23,42,.45))' } },
        h(
          'div',
          { className: 'sc-card', style: { width: 'min(440px, 100%)', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '12px' } },
          h('div', { style: { fontSize: '16px', fontWeight: '600', lineHeight: '24px' } }, title),
          body ? h('div', { className: 'sc-note' }, body) : null,
          h(
            'div',
            { className: 'sc-actions-row', style: { justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'sc-btn', onClick: onCancel }, runtime.t('actions.cancel')),
            h('button', {
              type: 'button',
              className: 'sc-btn ' + (tone === 'danger' ? 'sc-btn-danger' : 'sc-btn-primary'),
              disabled: busy === true,
              onClick: onConfirm,
            }, confirmLabel),
          ),
        ),
      );
    }

    function sourceGlyph(skill) {
      const key = skill.sourceKey || '';
      if (key.startsWith('claude')) return 'spark';
      if (key.startsWith('codex')) return 'terminal';
      if (key.startsWith('hermes')) return 'link';
      if (key.startsWith('zcode')) return 'skill';
      if (key.startsWith('custom')) return 'folder';
      if (skill.sourceKind === 'bundled') return 'folder';
      if (skill.sourceKind === 'project') return 'folder';
      if (skill.sourceKind === 'external') return 'link';
      return 'skill';
    }

    function SkillRow({ runtime, skill, source, onOpen, onToggle, onDelete, busy }) {
      const errors = countSeverity(skill.diagnostics, 'error');
      const warnings = countSeverity(skill.diagnostics, 'warn');
      const enabled = skillEnabled(skill);
      const tags = [];
      if (skill.isSymlink) tags.push(h(Tag, { key: 'link' }, runtime.t('badge.symlink')));
      if (skill.system) tags.push(h(Tag, { key: 'system' }, runtime.t('badge.system')));
      if (skill.shadowed) tags.push(h(Tag, { key: 'shadow', tone: 'info' }, runtime.t('badge.shadowed')));
      else if (skill.duplicateName) tags.push(h(Tag, { key: 'dup', tone: 'info' }, runtime.t('badge.duplicate')));
      if (skill.invocation && skill.invocation.modelInvocable === false) tags.push(h(Tag, { key: 'modelOff', tone: 'info' }, runtime.t('badge.modelOff')));
      if (errors > 0) tags.push(h(Tag, { key: 'errors', tone: 'error' }, errors + ' ' + runtime.t('badge.errors')));
      else if (warnings > 0) tags.push(h(Tag, { key: 'warnings', tone: 'warn' }, warnings + ' ' + runtime.t('badge.warnings')));
      if (skill.truncated) tags.push(h(Tag, { key: 'trunc', tone: 'warn' }, runtime.t('badge.truncated')));
      if (Number(skill.fileCount) > 1) tags.push(h(Tag, { key: 'files' }, skill.fileCount + ' ' + plural(runtime, skill.fileCount, 'files')));

      const menuItems = [
        { key: 'open', label: runtime.t('actions.open'), icon: 'file', onSelect: () => onOpen(skill) },
        {
          key: 'edit',
          label: runtime.t('actions.edit'),
          icon: 'edit',
          disabled: skill.writable !== true,
          onSelect: () => onOpen(skill, { edit: true }),
        },
        { key: 'copy', label: runtime.t('actions.copyPath'), icon: 'copy', onSelect: () => onOpen(skill, { copyPath: true }) },
        { separator: true },
        {
          key: 'delete',
          label: runtime.t('actions.delete'),
          icon: 'trash',
          danger: true,
          disabled: skill.writable !== true,
          onSelect: () => onDelete(skill),
        },
      ];

      return h(
        'div',
        { className: 'sc-row' },
        h(
          'button',
          { type: 'button', className: 'sc-row-main', onClick: () => onOpen(skill) },
          h('span', { className: 'sc-row-icon' }, h(Icon, { name: sourceGlyph(skill), size: 18 })),
          h(
            'span',
            { className: 'sc-row-text' },
            h('span', { className: 'sc-row-name' }, h('span', { className: 'sc-row-name-text' }, skill.name), tags),
            skill.description ? h('span', { className: 'sc-row-desc' }, skill.description) : null,
            h('span', { className: 'sc-row-meta' }, [scopeLabel(runtime, skill.scope), skill.relativePath || skill.path].filter(Boolean).join(' · ')),
          ),
        ),
        h(
          'span',
          { className: 'sc-row-end' },
          h(
            'span',
            { className: 'sc-row-end-row' },
            skill.writable && !skill.isSymlink
              ? h(Switch, {
                checked: enabled,
                disabled: busy === true,
                label: enabled ? runtime.t('detail.status.enabled') : runtime.t('detail.status.disabled'),
                onChange: (next) => onToggle(skill, next),
              })
              : h('span', { className: 'sc-row-status' },
                skill.readOnly ? h(Icon, { name: 'lock', size: 13 }) : null,
                runtime.t(skill.readOnly ? 'badge.readOnly' : 'badge.symlink'),
                h(HelpTip, { label: runtime.t(skill.readOnly ? 'help.readonlyToggle' : 'help.symlinkToggle') },
                  runtime.t(skill.readOnly ? 'help.readonlyToggle' : 'help.symlinkToggle'))),
            h(MenuButton, {
              label: runtime.t('actions.more'),
              triggerLabel: runtime.t('actions.more') + ': ' + skill.name,
              items: menuItems,
            }),
          ),
        ),
      );
    }

    function LibraryView({ runtime, snapshot, onRefresh, onCreate, onImport, onOpenSkill, onToggle, onDelete, onOpenSources, onOpenTrash, notify, expanded, onExpand }) {
      const [query, setQuery] = useState('');
      const [filter, setFilter] = useState('all');
      const [collapsed, setCollapsed] = useState({});
      const [busyId, setBusyId] = useState(null);
      const skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills : [];
      const sources = snapshot && Array.isArray(snapshot.sources) ? snapshot.sources : [];
      const trashCount = 0;
      const liveCount = sources.filter((source) => source.live === true).length;

      const counts = useMemo(() => ({
        all: skills.length,
        on: skills.filter(skillEnabled).length,
        off: skills.filter((skill) => !skillEnabled(skill)).length,
        errors: skills.filter(hasErrors).length,
        mine: skills.filter((skill) => skill.writable === true).length,
      }), [skills]);

      const filtered = useMemo(() => {
        const text = query.trim().toLowerCase();
        return skills.filter((skill) => {
          if (filter === 'on' && !skillEnabled(skill)) return false;
          if (filter === 'off' && skillEnabled(skill)) return false;
          if (filter === 'errors' && !hasErrors(skill)) return false;
          if (filter === 'mine' && skill.writable !== true) return false;
          if (text === '') return true;
          return String(skill.name || '').toLowerCase().includes(text)
            || String(skill.description || '').toLowerCase().includes(text)
            || String(skill.path || '').toLowerCase().includes(text);
        });
      }, [skills, filter, query]);

      const groups = useMemo(() => {
        const bySource = new Map();
        for (const source of sources) bySource.set(source.key, []);
        for (const skill of filtered) {
          if (!bySource.has(skill.sourceKey)) bySource.set(skill.sourceKey, []);
          bySource.get(skill.sourceKey).push(skill);
        }
        return sources
          .filter((source) => (bySource.get(source.key) || []).length > 0)
          .map((source) => ({ source, skills: bySource.get(source.key) }));
      }, [sources, filtered]);

      const sourceByKey = useMemo(() => {
        const map = new Map();
        for (const source of sources) map.set(source.key, source);
        return map;
      }, [sources]);

      const summary = snapshot && snapshot.summary ? snapshot.summary : { skills: 0, sources: 0, errors: 0, warnings: 0 };
      const filters = [
        { key: 'all', label: runtime.t('page.filters.all'), count: counts.all },
        { key: 'on', label: runtime.t('page.filters.on'), count: counts.on },
        { key: 'off', label: runtime.t('page.filters.off'), count: counts.off },
        { key: 'errors', label: runtime.t('page.filters.errors'), count: counts.errors },
        { key: 'mine', label: runtime.t('page.filters.mine'), count: counts.mine },
      ];

      const handleToggle = async (skill, enabled) => {
        setBusyId(skill.id);
        try {
          await onToggle(skill, enabled);
        } finally {
          setBusyId(null);
        }
      };

      const groupCollapsed = (source) => {
        if (Object.prototype.hasOwnProperty.call(collapsed, source.key)) return collapsed[source.key];
        if (source.readOnly === true || source.kind === 'bundled') return true;
        return false;
      };

      return h(
        'div',
        { className: 'sc-page' },
        h(
          'header',
          { className: 'sc-head' },
          h(
            'div',
            { className: 'sc-head-row' },
            h(
              'div',
              { className: 'sc-head-titles' },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                h('h1', { className: 'sc-title' }, runtime.t('page.title')),
                h(HelpTip, { label: runtime.t('page.help') }, runtime.t('page.help'))),
              h('p', { className: 'sc-subtitle' }, runtime.t('page.subtitle')),
            ),
            h(
              'div',
              { className: 'sc-head-actions' },
              h(ExpandButton, { runtime, expanded, onExpand }),
              h('button', {
                type: 'button',
                className: 'sc-icon-btn',
                'aria-label': runtime.t('actions.refresh'),
                title: runtime.t('actions.refresh'),
                onClick: onRefresh,
              }, h(Icon, { name: 'refresh', size: 15 })),
              h(MenuButton, {
                label: runtime.t('actions.more'),
                triggerLabel: runtime.t('actions.more'),
                items: [
                  { key: 'sources', label: runtime.t('sources.title'), icon: 'source', note: liveCount > 0 ? String(liveCount) : undefined, onSelect: onOpenSources },
                  { key: 'trash', label: runtime.t('trash.title'), icon: 'trash', onSelect: onOpenTrash },
                ],
              }),
              h('button', { type: 'button', className: 'sc-btn sc-btn-outline', onClick: onImport }, h(Icon, { name: 'import', size: 15 }), runtime.t('actions.import')),
              h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: onCreate }, h(Icon, { name: 'plus', size: 15 }), runtime.t('actions.create')),
            ),
          ),
          h(
            'div',
            { className: 'sc-toolbar' },
            h('div', { className: 'sc-search' },
              h('span', { className: 'sc-search-icon' }, h(Icon, { name: 'search', size: 15 })),
              h('input', {
                className: 'sc-input',
                type: 'search',
                value: query,
                placeholder: runtime.t('search.placeholder'),
                'aria-label': runtime.t('search.placeholder'),
                onChange: (event) => setQuery(event.target.value),
              })),
            h('div', { className: 'sc-filters' },
              filters.map((item) => h('button', {
                key: item.key,
                type: 'button',
                className: 'sc-filter',
                'aria-pressed': filter === item.key ? 'true' : 'false',
                onClick: () => setFilter(item.key),
              }, item.label + ' ' + item.count))),
          ),
          h('div', { className: 'sc-summary' },
            h('span', null, h('b', null, String(summary.skills)), ' ', plural(runtime, summary.skills, 'skills')),
            h('span', null, h('b', null, String(summary.sources)), ' ', plural(runtime, summary.sources, 'sources')),
            summary.errors > 0 ? h('span', null, h('b', null, String(summary.errors)), ' ', plural(runtime, summary.errors, 'errors')) : null,
            summary.warnings > 0 ? h('span', null, h('b', null, String(summary.warnings)), ' ', plural(runtime, summary.warnings, 'warnings')) : null,
            snapshot && snapshot.complete === false ? h('span', null, runtime.t('page.error.title')) : null,
            h('span', { className: 'sc-note-muted' }, runtime.t('page.legend'))),
        ),
        skills.length === 0
          ? h(EmptyState, {
            title: runtime.t('page.empty.title'),
            body: runtime.t('page.empty.body'),
            actions: [
              h('button', { key: 'import', type: 'button', className: 'sc-btn sc-btn-outline', onClick: onImport }, runtime.t('actions.import')),
              h('button', { key: 'create', type: 'button', className: 'sc-btn sc-btn-primary', onClick: onCreate }, runtime.t('actions.create')),
            ],
          })
          : groups.length === 0
            ? h(EmptyState, {
              title: runtime.t('page.noResults.title'),
              body: runtime.t('page.noResults.body'),
              actions: [h('button', { key: 'clear', type: 'button', className: 'sc-btn sc-btn-outline', onClick: () => { setQuery(''); setFilter('all'); } }, runtime.t('actions.clearAll'))],
            })
            : groups.map(({ source, skills: groupSkills }) => {
              const isCollapsed = groupCollapsed(source);
              const errors = groupSkills.reduce((total, skill) => total + countSeverity(skill.diagnostics, 'error'), 0);
              return h(
                'section',
                { key: source.key, className: 'sc-group' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sc-group-head',
                    'aria-expanded': isCollapsed ? 'false' : 'true',
                    onClick: () => setCollapsed((current) => ({ ...current, [source.key]: !isCollapsed })),
                  },
                  h('span', { className: 'sc-group-chevron' }, h(Icon, { name: isCollapsed ? 'right' : 'down', size: 14 })),
                  h('span', { className: 'sc-group-title' }, sourceLabel(runtime, source)),
                  h('span', { className: 'sc-group-count' }, groupSkills.length),
                  source.readOnly ? h(Tag, null, runtime.t('group.readOnly')) : null,
                  source.live ? h(Tag, { tone: 'info' }, runtime.t('sources.modelOnly')) : null,
                  errors > 0 ? h(Tag, { tone: 'error' }, errors + ' ' + runtime.t('badge.errors')) : null,
                  h('span', { className: 'sc-group-spacer' }),
                  h('span', { className: 'sc-group-path', title: source.path }, source.path),
                ),
                isCollapsed
                  ? null
                  : h(
                    'div',
                    { className: 'sc-card' },
                    groupSkills.map((skill) => h(SkillRow, {
                      key: skill.id,
                      runtime,
                      skill,
                      source: sourceByKey.get(skill.sourceKey) ?? source,
                      busy: busyId === skill.id,
                      onOpen: (item, options) => onOpenSkill(item, options),
                      onToggle: handleToggle,
                      onDelete,
                    })),
                  ),
              );
            }),
      );
    }

    function diagnosticHelp(runtime, code) {
      const key = 'diag.' + code;
      const text = runtime.t(key);
      return text === key ? runtime.t('diag.generic') : text;
    }

    function DiagnosticsList({ runtime, diagnostics, onHelp }) {
      if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
        return h(EmptyState, { title: runtime.t('detail.diagnostics.empty') });
      }
      return h(
        'div',
        { className: 'sc-diag' },
        diagnostics.map((item, index) => h(
          'div',
          { key: (item.code ?? 'diag') + ':' + index, className: 'sc-diag-item' },
          h(
            'div',
            { className: 'sc-diag-head' },
            h(Tag, { tone: item.severity === 'error' ? 'error' : item.severity === 'warn' ? 'warn' : 'info' },
              runtime.t(item.severity === 'error' ? 'badge.errors' : item.severity === 'warn' ? 'badge.warnings' : 'detail.tabs.diagnostics')),
            h('span', { className: 'sc-diag-code' }, item.code),
          ),
          item.params && Object.keys(item.params).length > 0
            ? h('div', { className: 'sc-diag-params' }, formatParams(item.params))
            : null,
          h('div', { className: 'sc-diag-help' }, diagnosticHelp(runtime, item.code)),
        )),
      );
    }

    function SkillDetailView({ runtime, skillId, initialEdit, revision, onBack, onChanged, notify, expanded, onExpand }) {
      const [detail, setDetail] = useState(null);
      const [state, setState] = useState({ loading: true, error: null });
      const [tab, setTab] = useState('overview');
      const [localRevision, setLocalRevision] = useState(revision);
      const [editing, setEditing] = useState(initialEdit === true);
      const [editText, setEditText] = useState(null);
      const [check, setCheck] = useState({ busy: false, diagnostics: null, error: null });
      const [saving, setSaving] = useState(false);
      const [confirmDelete, setConfirmDelete] = useState(false);
      const [deleting, setDeleting] = useState(false);
      const [file, setFile] = useState(null);
      const [fileState, setFileState] = useState({ loading: false, error: null });
      const [fileEdit, setFileEdit] = useState(null);
      const [fileBusy, setFileBusy] = useState(false);
      const [toggleBusy, setToggleBusy] = useState(false);

      useEffect(() => {
        if (typeof revision === 'string') setLocalRevision(revision);
      }, [revision]);

      const load = useCallback(async () => {
        setState({ loading: true, error: null });
        try {
          const value = await requestApi('detail', { id: skillId });
          setDetail(value);
          setState({ loading: false, error: null });
        } catch (error) {
          setState({ loading: false, error: error.code || 'OPERATION_FAILED' });
        }
      }, [skillId]);

      useEffect(() => {
        setDetail(null);
        setTab('overview');
        setCheck({ busy: false, diagnostics: null, error: null });
        setFile(null);
        setFileEdit(null);
        const wantsEdit = initialEdit === true;
        setEditing(wantsEdit);
        load().then(() => {
          if (wantsEdit) setTab('raw');
        });
      }, [skillId, initialEdit, load]);

      const skill = detail ? detail.skill : null;
      const writable = Boolean(skill && skill.writable === true);
      const diagnostics = skill ? (skill.diagnostics || []) : [];
      const errors = countSeverity(diagnostics, 'error');
      const warnings = countSeverity(diagnostics, 'warn');
      const bodyText = useMemo(() => {
        if (!detail || typeof detail.content !== 'string') return '';
        const lines = detail.content.split('\n');
        const start = Math.max(0, (detail.bodyStartLine || 1) - 1);
        return lines.slice(start).join('\n').trim();
      }, [detail]);

      const beginEdit = () => {
        if (!detail) return;
        setEditText(detail.content);
        setCheck({ busy: false, diagnostics: null, error: null });
        setEditing(true);
        setTab('raw');
      };

      const cancelEdit = () => {
        setEditing(false);
        setEditText(null);
        setCheck({ busy: false, diagnostics: null, error: null });
        setTab('overview');
      };

      const validateEdit = async () => {
        if (editText === null) return;
        setCheck({ busy: true, diagnostics: null, error: null });
        try {
          const value = await requestApi('validate', { id: skillId, content: editText });
          setCheck({ busy: false, diagnostics: value.diagnostics || [], error: null });
        } catch (error) {
          setCheck({ busy: false, diagnostics: null, error: error.code || 'OPERATION_FAILED' });
        }
      };

      const saveEdit = async () => {
        if (editText === null) return;
        setSaving(true);
        setCheck({ busy: false, diagnostics: null, error: null });
        try {
          const value = await requestApi('save', { id: skillId, content: editText, revision: localRevision, confirm: true });
          if (value && typeof value.revision === 'string') {
            setLocalRevision(value.revision);
            onChanged(value.revision);
          }
          setEditing(false);
          setEditText(null);
          await load();
          setTab('overview');
          notify('toast.saved');
        } catch (error) {
          if (error.code === 'VALIDATION_FAILED' && error.details && Array.isArray(error.details.diagnostics)) {
            setCheck({ busy: false, diagnostics: error.details.diagnostics, error: null });
          } else {
            if (error.code === 'STALE_REVISION') notify('toast.stale');
            setCheck({ busy: false, diagnostics: null, error: error.code || 'OPERATION_FAILED' });
          }
        } finally {
          setSaving(false);
        }
      };

      const toggleInvocation = async (field, next) => {
        if (!skill) return;
        setToggleBusy(true);
        try {
          const payload = {
            id: skillId,
            revision: localRevision,
            confirm: true,
            modelInvocable: skill.invocation.modelInvocable !== false,
            userInvocable: skill.invocation.userInvocable !== false,
          };
          if (field === 'model') payload.modelInvocable = next;
          else payload.userInvocable = next;
          const value = await requestApi('toggle', payload);
          if (value && typeof value.revision === 'string') {
            setLocalRevision(value.revision);
            onChanged(value.revision);
          }
          if (value && value.skill) {
            setDetail((current) => (current ? { ...current, skill: value.skill } : current));
          }
          notify('toast.updated');
        } catch (error) {
          if (error.code === 'STALE_REVISION') notify('toast.stale');
          else notify(errorText(runtime, error));
        } finally {
          setToggleBusy(false);
        }
      };

      const removeSkill = async () => {
        setDeleting(true);
        try {
          const value = await requestApi('remove', { id: skillId, revision: localRevision, confirm: true });
          if (value && typeof value.revision === 'string') onChanged(value.revision);
          notify('toast.trashed');
          setConfirmDelete(false);
          onBack();
        } catch (error) {
          if (error.code === 'STALE_REVISION') notify('toast.stale');
          else notify(errorText(runtime, error));
        } finally {
          setDeleting(false);
        }
      };

      const openFile = useCallback(async (relativePath) => {
        setFileState({ loading: true, error: null });
        setFile(null);
        setFileEdit(null);
        try {
          const value = await requestApi('readFile', { id: skillId, path: relativePath });
          setFile({ path: relativePath, ...value });
          setFileState({ loading: false, error: null });
        } catch (error) {
          setFileState({ loading: false, error: error.code || 'OPERATION_FAILED' });
        }
      }, [skillId]);

      const saveFile = async () => {
        if (!fileEdit) return;
        setFileBusy(true);
        try {
          const value = await requestApi('writeFile', {
            id: skillId,
            path: fileEdit.path,
            content: fileEdit.text,
            revision: localRevision,
            confirm: true,
          });
          if (value && typeof value.revision === 'string') {
            setLocalRevision(value.revision);
            onChanged(value.revision);
          }
          setFileEdit(null);
          await load();
          notify('toast.saved');
        } catch (error) {
          if (error.code === 'STALE_REVISION') notify('toast.stale');
          else notify(errorText(runtime, error));
        } finally {
          setFileBusy(false);
        }
      };

      const copy = async (text, successKey) => {
        const ok = await runtime.copyText(text);
        notify(ok ? (successKey ?? 'toast.copied') : 'toast.copyFailed');
      };

      if (!skill) {
        return h('div', { className: 'sc-page' },
          h('div', { className: 'sc-breadcrumb' }, h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back'))),
          state.error
            ? h(Banner, { actions: [h('button', { key: 'retry', type: 'button', className: 'sc-btn sc-btn-sm sc-btn-outline', onClick: load }, runtime.t('actions.retry'))] }, errorText(runtime, { code: state.error }))
            : h('div', { className: 'sc-note' }, runtime.t('editor.busy')));
      }

      const tabs = [
        { value: 'overview', label: runtime.t('detail.tabs.overview') },
        { value: 'raw', label: runtime.t('detail.tabs.raw') },
        { value: 'files', label: runtime.t('detail.tabs.files') + (Number(skill.fileCount) > 1 ? ' (' + skill.fileCount + ')' : '') },
        { value: 'diagnostics', label: runtime.t('detail.tabs.diagnostics') + (errors > 0 ? ' (' + errors + ')' : '') },
      ];

      const menuItems = [
        { key: 'copyPath', label: runtime.t('actions.copyPath'), icon: 'copy', onSelect: () => copy(skill ? skill.path : '') },
        { key: 'copyName', label: runtime.t('detail.copyName'), icon: 'copy', onSelect: () => copy(skill ? skill.name : '') },
        { separator: true },
        { key: 'delete', label: runtime.t('actions.delete'), icon: 'trash', danger: true, disabled: !writable, onSelect: () => setConfirmDelete(true) },
      ];

      if (state.loading) {
        return h('div', { className: 'sc-page' },
          h('div', { className: 'sc-breadcrumb' }, h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back'))),
          h('div', { className: 'sc-note' }, runtime.t('editor.busy')));
      }
      if (state.error) {
        return h('div', { className: 'sc-page' },
          h('div', { className: 'sc-breadcrumb' }, h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back'))),
          h(Banner, { actions: [h('button', { key: 'retry', type: 'button', className: 'sc-btn sc-btn-sm sc-btn-outline', onClick: load }, runtime.t('actions.retry'))] }, errorText(runtime, { code: state.error })));
      }

      return h(
        'div',
        { className: 'sc-page' },
        h('div', { className: 'sc-topbar' },
          h('div', { className: 'sc-breadcrumb' },
            h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back')),
            h('span', { className: 'sc-breadcrumb-sep' }, '/'),
            h('span', { className: 'sc-breadcrumb-current' }, skill ? skill.name : '')),
          h('div', { className: 'sc-topbar-actions' }, h(ExpandButton, { runtime, expanded, onExpand }))),
        h(
          'header',
          { className: 'sc-head' },
          h(
            'div',
            { className: 'sc-head-row' },
            h(
              'div',
              { className: 'sc-head-titles' },
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                h('h1', { className: 'sc-title', style: { fontSize: '20px', lineHeight: '28px' } }, skill.name),
                skill.readOnly ? h(Tag, null, runtime.t('badge.readOnly')) : null,
                skill.isSymlink ? h(Tag, null, runtime.t('badge.symlink')) : null,
                errors > 0 ? h(Tag, { tone: 'error' }, errors + ' ' + runtime.t('badge.errors')) : null,
                warnings > 0 ? h(Tag, { tone: 'warn' }, warnings + ' ' + runtime.t('badge.warnings')) : null),
              skill.description ? h('p', { className: 'sc-subtitle' }, skill.description) : null,
            ),
            h(
              'div',
              { className: 'sc-head-actions' },
              writable && !editing
                ? h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: beginEdit }, h(Icon, { name: 'edit', size: 15 }), runtime.t('actions.edit'))
                : null,
              h(MenuButton, { label: runtime.t('actions.more'), triggerLabel: runtime.t('actions.more'), items: menuItems }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'sc-facts' },
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.source')), h('span', { className: 'sc-fact-value' }, sourceLabel(runtime, { key: skill.sourceKey, labelKey: agentSourceKey(skill) }))),
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.scope')), h('span', { className: 'sc-fact-value' }, scopeLabel(runtime, skill.scope))),
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.status')), h('span', { className: 'sc-fact-value' }, statusLabel(runtime, skill))),
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.size')), h('span', { className: 'sc-fact-value' }, formatBytes(skill.sizeBytes))),
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.lines')), h('span', { className: 'sc-fact-value' }, String(skill.bodyLines))),
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.modified')), h('span', { className: 'sc-fact-value' }, formatDate(skill.mtimeMs, runtime.language))),
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.files')), h('span', { className: 'sc-fact-value' }, String(skill.fileCount ?? 0) + ' ' + plural(runtime, skill.fileCount ?? 0, 'files'))),
          h('div', { className: 'sc-fact' }, h('span', { className: 'sc-fact-label' }, runtime.t('detail.facts.path')), h('span', { className: 'sc-fact-value', 'data-mono': 'true' }, skill.path)),
        ),
        h(
          'div',
          { className: 'sc-model' },
          h('div', { className: 'sc-model-title' }, runtime.t('detail.model.title'), h(HelpTip, { label: runtime.t('help.description') }, runtime.t('detail.model.hint'))),
          h('div', { className: 'sc-model-name' }, skill.name),
          h('div', { className: 'sc-model-desc' }, skill.description || ''),
          h('div', { className: 'sc-toggles' },
            writable
              ? h('div', { className: 'sc-toggle-row' }, runtime.t('help.modelToggle'), h(Switch, {
                checked: skill.invocation.modelInvocable !== false,
                disabled: toggleBusy,
                label: runtime.t('help.modelToggle'),
                onChange: (next) => toggleInvocation('model', next),
              }))
              : null,
            writable
              ? h('div', { className: 'sc-toggle-row' }, runtime.t('help.userToggle'), h(Switch, {
                checked: skill.invocation.userInvocable !== false,
                disabled: toggleBusy,
                label: runtime.t('help.userToggle'),
                onChange: (next) => toggleInvocation('user', next),
              }))
              : null),
        ),
        errors > 0 || warnings > 0
          ? h(Banner, {
            tone: errors > 0 ? 'error' : 'info',
            actions: [h('button', { key: 'diag', type: 'button', className: 'sc-btn sc-btn-sm sc-btn-outline', onClick: () => setTab('diagnostics') }, runtime.t('detail.tabs.diagnostics'))],
          }, errors > 0
            ? errors + ' ' + plural(runtime, errors, 'errors') + (warnings > 0 ? ' · ' + warnings + ' ' + plural(runtime, warnings, 'warnings') : '')
            : warnings + ' ' + plural(runtime, warnings, 'warnings'))
          : null,
        h('div', { className: 'sc-toolbar' }, h(PillTabs, { items: tabs, value: tab, onChange: (next) => setTab(next) })),
        tab === 'overview'
          ? h('div', null,
            h(Markdown, { text: bodyText }),
            h('div', { className: 'sc-actions-row', style: { marginTop: '12px' } },
              writable ? h('button', { type: 'button', className: 'sc-btn sc-btn-outline', onClick: beginEdit }, h(Icon, { name: 'edit', size: 15 }), runtime.t('actions.edit')) : null))
          : null,
        tab === 'raw'
          ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('p', { className: 'sc-note', style: { margin: 0 } }, runtime.t('editor.hint')),
            editing
              ? h('div', { className: 'sc-editor-top' },
                h('button', { type: 'button', className: 'sc-btn sc-btn-primary', disabled: saving, onClick: saveEdit }, saving ? runtime.t('editor.busy') : runtime.t('actions.save')),
                h('button', { type: 'button', className: 'sc-btn sc-btn-outline', disabled: saving, onClick: validateEdit }, runtime.t('actions.validate')),
                h('button', { type: 'button', className: 'sc-btn', disabled: saving, onClick: cancelEdit }, runtime.t('actions.cancel')),
                h('span', { className: 'sc-note' }, runtime.t('detail.unsaved')))
              : null,
            editing
              ? h('textarea', {
                className: 'sc-textarea',
                style: { minHeight: '360px' },
                value: editText === null && detail ? detail.content : (editText ?? ''),
                onChange: (event) => setEditText(event.target.value),
                spellCheck: false,
              })
              : h('pre', { className: 'sc-pre' }, detail.content),
            editing
              ? h(
                'div',
                { className: 'sc-sticky-foot' },
                h('button', { type: 'button', className: 'sc-btn sc-btn-primary', disabled: saving, onClick: saveEdit }, saving ? runtime.t('editor.busy') : runtime.t('actions.save')),
                h('button', { type: 'button', className: 'sc-btn sc-btn-outline', disabled: saving, onClick: validateEdit }, runtime.t('actions.validate')),
                h('button', { type: 'button', className: 'sc-btn', disabled: saving, onClick: cancelEdit }, runtime.t('actions.cancel')),
                editing ? h('span', { className: 'sc-note' }, runtime.t('detail.unsaved')) : null,
              )
              : (writable ? h('div', { className: 'sc-actions-row' }, h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: beginEdit }, runtime.t('actions.edit'))) : null),
            check.diagnostics !== null
              ? h('div', null,
                h('p', { className: 'sc-note' }, countSeverity(check.diagnostics, 'error') > 0 ? runtime.t('editor.errors') : runtime.t('editor.ok')),
                h(DiagnosticsList, { runtime, diagnostics: check.diagnostics }))
              : null,
            check.error
              ? h(Banner, null, errorText(runtime, { code: check.error }))
              : null,
          )
          : null,
        tab === 'files'
          ? h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', { className: 'sc-note', style: { display: 'flex', alignItems: 'center', gap: '6px', margin: 0 } },
              runtime.t('help.files'),
              h(HelpTip, { label: runtime.t('help.files') }, runtime.t('help.files'))),
            fileState.loading ? h('div', { className: 'sc-note' }, runtime.t('editor.busy')) : null,
            fileState.error ? h(Banner, null, errorText(runtime, { code: fileState.error })) : null,
            file && !file.binary
              ? h('div', null,
                h('div', { className: 'sc-note' }, file.path + ' · ' + formatBytes(file.size)),
                file.truncated ? h('p', { className: 'sc-note' }, runtime.t('detail.fileTooLarge')) : null,
                fileEdit
                  ? h('div', { className: 'sc-form' },
                    h('textarea', {
                      className: 'sc-textarea',
                      style: { minHeight: '260px' },
                      value: fileEdit.text,
                      onChange: (event) => setFileEdit({ path: fileEdit.path, text: event.target.value }),
                      spellCheck: false,
                    }),
                    h('div', { className: 'sc-actions-row' },
                      h('button', { type: 'button', className: 'sc-btn sc-btn-primary', disabled: fileBusy, onClick: saveFile }, fileBusy ? runtime.t('editor.busy') : runtime.t('actions.save')),
                      h('button', { type: 'button', className: 'sc-btn', disabled: fileBusy, onClick: () => setFileEdit(null) }, runtime.t('actions.cancel'))))
                  : h('div', null,
                    h('pre', { className: 'sc-pre' }, file.content),
                    writable && file.path !== 'SKILL.md'
                      ? h('div', { className: 'sc-actions-row' }, h('button', {
                        type: 'button',
                        className: 'sc-btn sc-btn-outline',
                        onClick: () => setFileEdit({ path: file.path, text: file.content }),
                      }, runtime.t('detail.editFile')))
                      : null))
              : null,
            file && file.binary ? h('p', { className: 'sc-note' }, runtime.t('detail.binary')) : null,
            h('div', { className: 'sc-card' },
              (detail.files || []).length === 0
                ? h('div', { style: { padding: '14px' } }, h('p', { className: 'sc-note sc-mb-0' }, runtime.t('detail.files.empty')))
                : h('div', { className: 'sc-file-list' },
                  detail.files.map((entry) => h('button', {
                    key: entry.relativePath,
                    type: 'button',
                    className: 'sc-file',
                    onClick: () => openFile(entry.relativePath),
                    disabled: entry.kind === 'directory',
                  }, h(Icon, { name: entry.kind === 'directory' ? 'folder' : 'file', size: 14 }),
                  h('span', { className: 'sc-file-name' }, entry.relativePath),
                  h('span', { className: 'sc-file-size' }, entry.kind === 'directory' ? '' : formatBytes(entry.size))))),
            ),
          )
          : null,
        tab === 'diagnostics'
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', { className: 'sc-toolbar' },
              writable ? h('button', { type: 'button', className: 'sc-btn sc-btn-outline', onClick: beginEdit }, h(Icon, { name: 'edit', size: 15 }), runtime.t('actions.edit')) : null,
              h('span', { className: 'sc-note' }, runtime.t(skill.readOnly ? 'detail.diagnostics.readOnly' : 'detail.diagnostics.hint'))),
            h(DiagnosticsList, { runtime, diagnostics }))
          : null,
        confirmDelete
          ? h(ConfirmOverlay, {
            runtime,
            title: runtime.t('actions.delete') + ' «' + skill.name + '»?',
            body: runtime.t('detail.deleteHint'),
            confirmLabel: runtime.t('actions.confirmDelete'),
            tone: 'danger',
            busy: deleting,
            onConfirm: removeSkill,
            onCancel: () => setConfirmDelete(false),
          })
          : null,
      );
    }

    const CREATOR_SKILL = 'skill-curator-creator';

    function buildCreatorPrompt(runtime, description, extra) {
      const text = String(description ?? '').trim();
      const more = String(extra ?? '').trim();
      const empty = runtime.language === 'en'
        ? '(the user has not written a description yet — ask 1–2 short questions and propose a structure)'
        : '(пользователь ещё не написал описание — задай 1–2 коротких вопроса и предложи структуру)';
      if (runtime.language === 'en') {
        return [
          '/' + CREATOR_SKILL,
          '',
          'Create a DeepSeek Harness skill from the description below.',
          'Follow the skill instructions: ask 1–2 clarifying questions if needed, keep SKILL.md short,',
          'move long material into references/ and scripts/, and save the result with skill_curator_create',
          '(not by hand and not through bash). Finish with a short report: name, destination, files.',
          '',
          'User description:',
          text === '' ? empty : text,
          more === '' ? '' : '',
          more === '' ? '' : 'Additional details: ' + more,
        ].filter((line) => line !== '').join('\n');
      }
      return [
        '/' + CREATOR_SKILL,
        '',
        'Создай навык DeepSeek Harness по описанию ниже.',
        'Действуй по инструкции навыка: при необходимости задай 1–2 уточняющих вопроса,',
        'держи SKILL.md коротким, длинные материалы вынеси в references/ и scripts/,',
        'сохрани результат инструментом skill_curator_create (не руками и не через bash).',
        'В конце коротко отчитайся: имя, куда сохранено, какие файлы добавлены.',
        '',
        'Описание пользователя:',
        text === '' ? empty : text,
        more === '' ? '' : '',
        more === '' ? '' : 'Дополнительные детали: ' + more,
      ].filter((line) => line !== '').join('\n');
    }

    function manualSkillTemplate(runtime) {
      if (runtime.language === 'en') {
        return ['# When to Use', '', 'Describe triggers and situations.', '', '## Procedure', '', '1. First step.', '2. Second step.', '', '## Pitfalls', '', '- What to avoid.', '', '## Verification', '', '- How to check the result.'].join('\n');
      }
      return ['# Когда использовать', '', 'Опишите триггеры и ситуации.', '', '## Порядок действий', '', '1. Первый шаг.', '2. Второй шаг.', '', '## Типичные ошибки', '', '- Чего избегать.', '', '## Проверка', '', '- Как проверить результат.'].join('\n');
    }

    const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

    function CreateSkillView({ runtime, snapshot, onBack, onDone, notify, closeSettings, expanded, onExpand }) {
      const projectSources = (snapshot && Array.isArray(snapshot.sources) ? snapshot.sources : [])
        .filter((source) => source.kind === 'project');
      const workspacePath = (sourcePath) => {
        const marker = '/.dsh/skills';
        const text = String(sourcePath ?? '');
        const index = text.indexOf(marker);
        return index >= 0 ? text.slice(0, index) : text;
      };

      const [mode, setMode] = useState('ai');
      const [aiDescription, setAiDescription] = useState('');
      const [aiExtra, setAiExtra] = useState('');
      const [aiNotice, setAiNotice] = useState(null);
      const [form, setForm] = useState({
        name: '',
        description: '',
        body: '',
        scope: 'user',
        workspace: projectSources[0] ? projectSources[0].path : '',
      });
      const [touched, setTouched] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const prompt = useMemo(() => buildCreatorPrompt(runtime, aiDescription, aiExtra), [runtime, aiDescription, aiExtra]);

      const nameError = form.name.trim() !== '' && !NAME_RE.test(form.name.trim())
        ? runtime.t('create.field.nameInvalid')
        : (touched && form.name.trim() === '' ? runtime.t('create.field.required') : '');
      const descriptionError = form.description.trim().length > 1024
        ? runtime.t('create.field.descriptionLong')
        : (touched && form.description.trim() === '' ? runtime.t('create.field.required') : '');
      const bodyError = touched && form.body.trim() === '' ? runtime.t('create.field.bodyEmpty') : '';
      const canCreate = form.name.trim() !== '' && NAME_RE.test(form.name.trim())
        && form.description.trim() !== '' && form.description.trim().length <= 1024
        && form.body.trim() !== '';

      const openAiChat = async () => {
        const started = runtime.startSkillChat(prompt);
        if (started) {
          if (typeof closeSettings === 'function') closeSettings();
          return;
        }
        const copied = await runtime.copyText(prompt);
        setAiNotice(copied ? runtime.t('create.ai.fallback') : runtime.t('create.ai.failed'));
      };

      const copyPrompt = async () => {
        const ok = await runtime.copyText(prompt);
        notify(ok ? 'toast.copied' : 'toast.copyFailed');
      };

      const submitManual = async () => {
        setTouched(true);
        if (!canCreate) return;
        setBusy(true);
        setError(null);
        try {
          const payload = {
            confirm: true,
            revision: snapshot ? snapshot.revision : undefined,
            scope: form.scope,
            name: form.name.trim(),
            description: form.description.trim(),
            body: form.body,
          };
          if (form.scope === 'project') payload.workspacePath = workspacePath(form.workspace);
          const value = await requestApi('create', payload);
          notify('toast.created');
          onDone(value && value.revision ? value.revision : undefined);
        } catch (caught) {
          if (caught.code === 'STALE_REVISION') notify('toast.stale');
          setError(caught.code || 'OPERATION_FAILED');
        } finally {
          setBusy(false);
        }
      };

      const examples = runtime.language === 'en'
        ? ['Review pull requests for security risks', 'Prepare a commercial offer from a call transcript', 'Turn a document into a short checklist']
        : ['Проверять пул-реквесты на риски безопасности', 'Готовить коммерческое предложение из транскрипта звонка', 'Превращать документ в короткий чек-лист'];

      return h(
        'div',
        { className: 'sc-page' },
        h('div', { className: 'sc-topbar' },
          h('div', { className: 'sc-breadcrumb' },
            h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back')),
            h('span', { className: 'sc-breadcrumb-sep' }, '/'),
            h('span', { className: 'sc-breadcrumb-current' }, runtime.t('create.title'))),
          h('div', { className: 'sc-topbar-actions' }, h(ExpandButton, { runtime, expanded, onExpand }))),
        h('header', { className: 'sc-head' },
          h('div', { className: 'sc-head-titles' },
            h('h1', { className: 'sc-title' }, runtime.t('create.title')),
            h('p', { className: 'sc-subtitle' }, runtime.t('create.intro'))),
          h('div', { className: 'sc-head-actions' },
            h(PillTabs, {
              items: [
                { value: 'ai', label: runtime.t('create.mode.ai') },
                { value: 'manual', label: runtime.t('create.mode.manual') },
              ],
              value: mode,
              onChange: setMode,
            }),
          )),
        mode === 'ai'
          ? h(
            'div',
            { className: 'sc-form' },
            h(Banner, { tone: 'info' }, runtime.t('create.ai.hint')),
            h(
              'div',
              { className: 'sc-field' },
              h('div', { className: 'sc-field-head' },
                h('span', { className: 'sc-field-label' }, runtime.t('create.ai.description')),
                h(HelpTip, { label: runtime.t('help.ai') }, runtime.t('help.ai'))),
              h('textarea', {
                className: 'sc-textarea',
                value: aiDescription,
                onChange: (event) => setAiDescription(event.target.value),
                placeholder: runtime.t('create.ai.descriptionHint'),
                'aria-label': runtime.t('create.ai.description'),
              }),
              h('span', { className: 'sc-field-hint' }, runtime.t('create.ai.descriptionHint')),
              h('div', { className: 'sc-actions-row', style: { flexWrap: 'wrap' } },
                h('span', { className: 'sc-field-hint' }, runtime.t('create.ai.examples')),
                examples.map((example, index) => h('button', {
                  key: index,
                  type: 'button',
                  className: 'sc-btn sc-btn-sm sc-btn-outline',
                  onClick: () => setAiDescription((current) => (current.trim() === '' ? example : current + ' ' + example)),
                }, example))),
            ),
            h(
              'div',
              { className: 'sc-field' },
              h('span', { className: 'sc-field-label' }, runtime.t('create.ai.extra')),
              h('textarea', {
                className: 'sc-textarea',
                style: { minHeight: '70px' },
                value: aiExtra,
                onChange: (event) => setAiExtra(event.target.value),
                'aria-label': runtime.t('create.ai.extra'),
              }),
            ),
            h('details', null,
              h('summary', { className: 'sc-note', style: { cursor: 'pointer' } }, runtime.t('create.ai.promptPreview')),
              h('pre', { className: 'sc-pre sc-prompt', style: { marginTop: '8px' } }, prompt)),
            h('p', { className: 'sc-note sc-mb-0' }, runtime.t('create.ai.openChatHint')),
            aiNotice ? h(Banner, { tone: 'info' }, aiNotice) : null,
            h(
              'div',
              { className: 'sc-sticky-foot' },
              h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: openAiChat }, h(Icon, { name: 'spark', size: 15 }), runtime.t('actions.openChat')),
              h('button', { type: 'button', className: 'sc-btn sc-btn-outline', onClick: copyPrompt }, h(Icon, { name: 'copy', size: 15 }), runtime.t('actions.copyPrompt')),
              h('span', { className: 'sc-note' }, runtime.t('create.ai.openChatHint')),
            ),
          )
          : h(
            'div',
            { className: 'sc-form' },
            error ? h(Banner, null, errorText(runtime, { code: error })) : null,
            h('div', { className: 'sc-form-row' },
              h('label', { className: 'sc-field' },
                h('div', { className: 'sc-field-head' },
                  h('span', { className: 'sc-field-label' }, runtime.t('create.manual.name')),
                  h(HelpTip, { label: runtime.t('help.name') }, runtime.t('help.name'))),
                h('input', {
                  className: 'sc-input',
                  value: form.name,
                  placeholder: 'my-skill',
                  onChange: (event) => setForm({ ...form, name: event.target.value }),
                  'aria-invalid': nameError ? 'true' : 'false',
                }),
                h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                  h('span', { className: 'sc-field-hint' }, runtime.t('create.manual.nameHint')),
                  h('span', { className: 'sc-counter' }, form.name.length + ' / 64')),
                nameError ? h('span', { className: 'sc-field-error' }, nameError) : null),
              h('label', { className: 'sc-field' },
                h('span', { className: 'sc-field-label' }, runtime.t('create.manual.destination')),
                h('select', {
                  className: 'sc-select',
                  value: form.scope,
                  onChange: (event) => setForm({ ...form, scope: event.target.value }),
                },
                h('option', { value: 'user' }, runtime.t('create.scope.user')),
                h('option', { value: 'agents' }, runtime.t('create.scope.agents')),
                projectSources.length > 0 ? h('option', { value: 'project' }, runtime.t('create.scope.project')) : null)),
            ),
            form.scope === 'project' && projectSources.length > 0
              ? h('label', { className: 'sc-field' },
                h('span', { className: 'sc-field-label' }, runtime.t('create.manual.workspace')),
                h('select', {
                  className: 'sc-select',
                  value: form.workspace,
                  onChange: (event) => setForm({ ...form, workspace: event.target.value }),
                }, projectSources.map((source) => h('option', { key: source.key, value: source.path }, source.label || workspacePath(source.path)))))
              : null,
            h('label', { className: 'sc-field' },
              h('div', { className: 'sc-field-head' },
                h('span', { className: 'sc-field-label' }, runtime.t('create.manual.description')),
                h(HelpTip, { label: runtime.t('help.description') }, runtime.t('help.description'))),
              h('textarea', {
                className: 'sc-textarea',
                style: { minHeight: '80px' },
                value: form.description,
                onChange: (event) => setForm({ ...form, description: event.target.value }),
                'aria-invalid': descriptionError ? 'true' : 'false',
              }),
              h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                h('span', { className: 'sc-field-hint' }, runtime.t('create.manual.descriptionHint')),
                h('span', { className: 'sc-counter' }, form.description.length + ' / 1024')),
              descriptionError ? h('span', { className: 'sc-field-error' }, descriptionError) : null),
            h('label', { className: 'sc-field' },
              h('div', { className: 'sc-field-head' },
                h('span', { className: 'sc-field-label' }, runtime.t('create.manual.body')),
                h(HelpTip, { label: runtime.t('help.body') }, runtime.t('help.body')),
                h('button', {
                  type: 'button',
                  className: 'sc-btn sc-btn-sm sc-btn-ghost',
                  style: { marginLeft: 'auto' },
                  onClick: () => setForm((current) => ({ ...current, body: current.body.trim() === '' ? manualSkillTemplate(runtime) : current.body })),
                }, runtime.t('create.manual.template'))),
              h('textarea', {
                className: 'sc-textarea sc-body',
                value: form.body,
                onChange: (event) => setForm({ ...form, body: event.target.value }),
                'aria-invalid': bodyError ? 'true' : 'false',
              }),
              h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
                h('span', { className: 'sc-field-hint' }, runtime.t('create.manual.bodyHint')),
                h('span', { className: 'sc-counter' }, form.body.split('\n').length + ' ' + runtime.t('create.counter.lines'))),
              bodyError ? h('span', { className: 'sc-field-error' }, bodyError) : null),
            h(
              'div',
              { className: 'sc-sticky-foot' },
              h('button', { type: 'button', className: 'sc-btn sc-btn-primary', disabled: busy || !canCreate, onClick: submitManual }, busy ? runtime.t('editor.busy') : runtime.t('actions.create')),
              h('button', { type: 'button', className: 'sc-btn', onClick: onBack }, runtime.t('actions.cancel')),
              h('span', { className: 'sc-note' }, runtime.t('editor.hint')),
            ),
          ),
      );
    }

    function ImportView({ runtime, snapshot, onBack, onDone, notify, expanded, onExpand }) {
      const projectSources = (snapshot && Array.isArray(snapshot.sources) ? snapshot.sources : [])
        .filter((source) => source.kind === 'project');
      const workspacePath = (sourcePath) => {
        const marker = '/.dsh/skills';
        const text = String(sourcePath ?? '');
        const index = text.indexOf(marker);
        return index >= 0 ? text.slice(0, index) : text;
      };

      const [target, setTarget] = useState('user');
      const [workspace, setWorkspace] = useState(projectSources[0] ? projectSources[0].path : '');
      const [mode, setMode] = useState('copy');
      const [plan, setPlan] = useState({ loading: true, error: null, data: null });
      const [query, setQuery] = useState('');
      const [selected, setSelected] = useState(() => new Set());
      const [applying, setApplying] = useState(false);
      const [results, setResults] = useState(null);
      const [applyError, setApplyError] = useState(null);
      const [confirmOpen, setConfirmOpen] = useState(false);

      const loadPlan = useCallback(async () => {
        setPlan({ loading: true, error: null, data: null });
        setApplyError(null);
        try {
          const body = { target };
          if (target === 'project') body.workspacePath = workspacePath(workspace);
          const data = await requestApi('importScan', body);
          setPlan({ loading: false, error: null, data });
          setSelected(new Set());
        } catch (error) {
          setPlan({ loading: false, error: error.code || 'OPERATION_FAILED', data: null });
        }
      }, [target, workspace]);

      useEffect(() => {
        loadPlan();
      }, [loadPlan]);

      const data = plan.data;
      const groups = data ? data.groups : [];
      const selectedCandidates = useMemo(() => {
        const map = new Map();
        for (const group of groups) {
          for (const candidate of group.candidates) map.set(candidate.id, candidate);
        }
        return map;
      }, [groups]);

      const reasonLabel = (code) => {
        if (!code) return '';
        const key = 'import.reason.' + code;
        const text = runtime.t(key);
        return text === key ? code : text;
      };

      const filteredGroups = useMemo(() => {
        const text = query.trim().toLowerCase();
        if (text === '') return groups;
        return groups
          .map((group) => ({
            ...group,
            candidates: group.candidates.filter((candidate) => (
              String(candidate.name || '').toLowerCase().includes(text)
              || String(candidate.description || '').toLowerCase().includes(text)
              || String(candidate.targetPath || '').toLowerCase().includes(text)
            )),
          }))
          .filter((group) => group.candidates.length > 0);
      }, [groups, query]);

      const toggle = (id, next) => {
        setSelected((current) => {
          const copy = new Set(current);
          if (next) copy.add(id);
          else copy.delete(id);
          return copy;
        });
      };

      const toggleGroup = (group, next) => {
        setSelected((current) => {
          const copy = new Set(current);
          for (const candidate of group.candidates) {
            if (candidate.skipReason !== null) continue;
            if (next) copy.add(candidate.id);
            else copy.delete(candidate.id);
          }
          return copy;
        });
      };

      const allImportable = useMemo(() => groups.flatMap((group) => group.candidates).filter((candidate) => candidate.skipReason === null), [groups]);

      const selectAll = () => setSelected(new Set(allImportable.map((candidate) => candidate.id)));
      const clearAll = () => setSelected(new Set());

      const apply = async () => {
        setConfirmOpen(false);
        setApplying(true);
        setApplyError(null);
        try {
          const body = {
            confirm: true,
            revision: snapshot ? snapshot.revision : undefined,
            target,
            mode,
            ids: [...selected],
          };
          if (target === 'project') body.workspacePath = workspacePath(workspace);
          const value = await requestApi('importApply', body);
          setResults(value);
          notify('toast.imported');
          if (value && typeof value.revision === 'string') onDone(value.revision);
          await loadPlan();
        } catch (error) {
          if (error.code === 'STALE_REVISION') {
            notify('toast.stale');
            await loadPlan();
          } else {
            setApplyError(error.code || 'OPERATION_FAILED');
          }
        } finally {
          setApplying(false);
        }
      };

      const applyDisabled = selected.size === 0 || applying || confirmOpen === false;
      const skippedCount = data ? data.counts.skipped : 0;

      return h(
        'div',
        { className: 'sc-page' },
        h('div', { className: 'sc-topbar' },
          h('div', { className: 'sc-breadcrumb' },
            h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back')),
            h('span', { className: 'sc-breadcrumb-sep' }, '/'),
            h('span', { className: 'sc-breadcrumb-current' }, runtime.t('import.title'))),
          h('div', { className: 'sc-topbar-actions' }, h(ExpandButton, { runtime, expanded, onExpand }))),
        h('header', { className: 'sc-head' },
          h('div', { className: 'sc-head-titles' },
            h('h1', { className: 'sc-title' }, runtime.t('import.title')),
            h('p', { className: 'sc-subtitle' }, runtime.t('import.intro'))),
          h('div', { className: 'sc-head-actions' },
            h('button', { type: 'button', className: 'sc-btn sc-btn-outline', onClick: loadPlan, disabled: plan.loading || applying }, h(Icon, { name: 'refresh', size: 15 }), runtime.t('import.rescan')))),
        results
          ? h(
            'div',
            { className: 'sc-form' },
            h('div', { className: 'sc-card' },
              h('div', { className: 'sc-import-bar' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
                  h('h2', { style: { margin: 0, fontSize: '18px', lineHeight: '26px', fontWeight: 600 } }, runtime.t('import.results')),
                  h(Tag, { tone: results.counts.failed > 0 ? 'warn' : 'success' }, results.counts.imported + ' ' + runtime.t('import.imported'))),
                h('div', { className: 'sc-summary' },
                  h('span', null, results.counts.imported + ' ' + runtime.t('import.imported')),
                  h('span', null, results.counts.skipped + ' ' + runtime.t('import.skipped')),
                  h('span', null, results.counts.failed + ' ' + runtime.t('import.failed'))),
                h('p', { className: 'sc-note sc-mb-0' }, runtime.t('import.resultHint')),
                h('div', { className: 'sc-card' }, h('div', { className: 'sc-list' },
                  results.results.map((item, index) => h('div', { key: (item.id ?? 'item') + ':' + index, className: 'sc-cand' },
                    h('div', { className: 'sc-cand-main' },
                      h('div', { className: 'sc-cand-name' }, item.name || item.id,
                        h(Tag, { tone: item.status === 'imported' ? 'success' : item.status === 'failed' ? 'error' : 'warn' }, item.status)),
                      item.code ? h('div', { className: 'sc-cand-reason' }, reasonLabel(item.code)) : null))))),
              )),
            h('div', { className: 'sc-sticky-foot' },
              h('button', { type: 'button', className: 'sc-btn sc-btn-primary', onClick: () => { setResults(null); onBack(); } }, runtime.t('actions.openInLibrary')),
              h('button', { type: 'button', className: 'sc-btn', onClick: () => { setResults(null); loadPlan(); } }, runtime.t('actions.importMore'))),
          )
          : h(
            'div',
            { className: 'sc-form' },
            h('div', { className: 'sc-card' },
              h('div', { className: 'sc-import-bar' },
                h('div', { className: 'sc-import-row' },
                  h('label', { className: 'sc-field' },
                    h('div', { className: 'sc-field-head' },
                      h('span', { className: 'sc-field-label' }, runtime.t('import.destination')),
                      h(HelpTip, { label: runtime.t('help.importTarget') }, runtime.t('help.destination'))),
                    h('select', {
                      className: 'sc-select',
                      value: target,
                      onChange: (event) => setTarget(event.target.value),
                      disabled: applying,
                    },
                    h('option', { value: 'user' }, runtime.t('create.scope.user')),
                    h('option', { value: 'agents' }, runtime.t('create.scope.agents')),
                    projectSources.length > 0 ? h('option', { value: 'project' }, runtime.t('create.scope.project')) : null)),
                  target === 'project' && projectSources.length > 0
                    ? h('label', { className: 'sc-field' },
                      h('span', { className: 'sc-field-label' }, runtime.t('import.workspace')),
                      h('select', {
                        className: 'sc-select',
                        value: workspace,
                        onChange: (event) => setWorkspace(event.target.value),
                        disabled: applying,
                      }, projectSources.map((source) => h('option', { key: source.key, value: source.path }, source.label || workspacePath(source.path)))))
                    : null,
                  h('div', { className: 'sc-field' },
                    h('div', { className: 'sc-field-head' },
                      h('span', { className: 'sc-field-label' }, runtime.t('import.mode')),
                      h(HelpTip, { label: runtime.t('help.importMode') }, runtime.t('help.importMode'))),
                    h('div', { className: 'sc-seg' },
                      h('button', {
                        type: 'button',
                        className: 'sc-seg-btn',
                        'aria-pressed': mode === 'copy' ? 'true' : 'false',
                        onClick: () => setMode('copy'),
                        disabled: applying,
                      }, runtime.t('import.mode.copy')),
                      h('button', {
                        type: 'button',
                        className: 'sc-seg-btn',
                        'aria-pressed': mode === 'symlink' ? 'true' : 'false',
                        onClick: () => setMode('symlink'),
                        disabled: applying,
                      }, runtime.t('import.mode.symlink'))),
                    h('span', { className: 'sc-field-hint' }, runtime.t(mode === 'copy' ? 'import.mode.copyHint' : 'import.mode.symlinkHint')))),
                data ? h('div', { className: 'sc-summary' },
                  h('span', null, h('b', null, String(data.counts.importable)), ' ', plural(runtime, data.counts.importable, 'skills')),
                  skippedCount > 0 ? h('span', null, skippedCount + ' ' + runtime.t('import.skipped')) : null,
                  h('span', null, data.targetRoot)) : null,
              )),
            applyError ? h(Banner, null, errorText(runtime, { code: applyError })) : null,
            plan.loading ? h('div', { className: 'sc-note' }, runtime.t('editor.busy')) : null,
            plan.error ? h(Banner, null, errorText(runtime, { code: plan.error })) : null,
            h('div', { className: 'sc-toolbar' },
              h('div', { className: 'sc-search' },
                h('span', { className: 'sc-search-icon' }, h(Icon, { name: 'search', size: 15 })),
                h('input', {
                  className: 'sc-input',
                  type: 'search',
                  value: query,
                  placeholder: runtime.t('import.search'),
                  'aria-label': runtime.t('import.search'),
                  onChange: (event) => setQuery(event.target.value),
                })),
              h('button', { type: 'button', className: 'sc-btn sc-btn-sm sc-btn-outline', onClick: selectAll, disabled: allImportable.length === 0 }, runtime.t('import.selectAll')),
              h('button', { type: 'button', className: 'sc-btn sc-btn-sm sc-btn-ghost', onClick: clearAll, disabled: selected.size === 0 }, runtime.t('import.clearAll'))),
            !plan.loading && !plan.error && filteredGroups.length === 0
              ? h(EmptyState, { title: runtime.t('import.empty') })
              : filteredGroups.map((group) => {
                const importable = group.candidates.filter((candidate) => candidate.skipReason === null);
                const allSelected = importable.length > 0 && importable.every((candidate) => selected.has(candidate.id));
                return h(
                  'section',
                  { key: group.key, className: 'sc-group' },
                  h('div', { className: 'sc-group-head', style: { cursor: 'default' } },
                    h('span', { className: 'sc-group-title' }, sourceLabel(runtime, group)),
                    h('span', { className: 'sc-group-count' }, group.candidates.length),
                    h('span', { className: 'sc-group-spacer' }),
                    h('button', {
                      type: 'button',
                      className: 'sc-btn sc-btn-sm sc-btn-ghost',
                      onClick: () => toggleGroup(group, !allSelected),
                      disabled: importable.length === 0,
                    }, allSelected ? runtime.t('import.clearAll') : runtime.t('import.selectAll'))),
                  h('div', { className: 'sc-card' },
                    group.candidates.map((candidate) => {
                      const disabled = candidate.skipReason !== null;
                      return h('div', { key: candidate.id, className: 'sc-cand', 'data-skipped': disabled ? 'true' : undefined },
                        h('input', {
                          type: 'checkbox',
                          className: 'sc-check',
                          checked: selected.has(candidate.id),
                          disabled,
                          onChange: (event) => toggle(candidate.id, event.target.checked),
                          'aria-label': candidate.name,
                        }),
                        h('div', { className: 'sc-cand-main' },
                          h('div', { className: 'sc-cand-name' },
                            candidate.name,
                            candidate.isSymlinkSource ? h(Tag, null, runtime.t('badge.symlink')) : null,
                            candidate.diagnostics && candidate.diagnostics.length > 0 ? h(Tag, { tone: 'warn' }, runtime.t('badge.errors')) : null,
                            disabled ? h(Tag, { tone: 'warn' }, reasonLabel(candidate.skipReason)) : null),
                          candidate.description ? h('div', { className: 'sc-cand-desc' }, candidate.description) : null,
                          h('div', { className: 'sc-cand-path' }, candidate.targetPath || candidate.sourcePath)));
                    })),
                );
              }),
            h('div', { className: 'sc-sticky-foot' },
              h('button', {
                type: 'button',
                className: 'sc-btn sc-btn-primary',
                disabled: selected.size === 0 || applying,
                onClick: () => setConfirmOpen(true),
              }, applying ? runtime.t('editor.busy') : runtime.t('actions.importPrimary') + ' (' + selected.size + ')'),
              h('button', { type: 'button', className: 'sc-btn', onClick: onBack }, runtime.t('actions.cancel')),
              h('span', { className: 'sc-note' }, selected.size + ' ' + runtime.t('import.footerSelected'))),
          ),
        confirmOpen
          ? h(ConfirmOverlay, {
            runtime,
            title: runtime.t('import.confirm'),
            body: runtime.t('import.footerSelected') + ': ' + selected.size,
            confirmLabel: runtime.t('actions.importPrimary') + ' (' + selected.size + ')',
            busy: applying,
            onConfirm: apply,
            onCancel: () => setConfirmOpen(false),
          })
          : null,
      );
    }

    function SourcesView({ runtime, snapshot, onBack, onChanged, notify, expanded, onExpand }) {
      const [busyKey, setBusyKey] = useState(null);
      const [error, setError] = useState(null);
      const sources = (snapshot && Array.isArray(snapshot.sources) ? snapshot.sources : [])
        .filter((source) => source.exists === true);
      const readOnlySources = sources.filter((source) => source.readOnly === true);
      const writableSources = sources.filter((source) => source.writable === true);
      const live = snapshot && snapshot.settings && snapshot.settings.liveSources
        ? snapshot.settings.liveSources
        : {};

      const toggle = async (source, enabled) => {
        setBusyKey(source.key);
        setError(null);
        try {
          await requestApi('liveSetSource', { sourceKey: source.key, enabled, confirm: true });
          notify('toast.updated');
          await onChanged();
        } catch (caught) {
          if (caught.code === 'STALE_REVISION') notify('toast.stale');
          else setError(caught.code || 'OPERATION_FAILED');
        } finally {
          setBusyKey(null);
        }
      };

      const readOnlyRows = readOnlySources.map((source) => h(
        'div',
        { key: source.key, className: 'sc-row' },
        h('span', { className: 'sc-row-icon' }, h(Icon, { name: sourceGlyph({ sourceKey: source.key, sourceKind: source.kind }), size: 18 })),
        h(
          'span',
          { className: 'sc-row-text' },
          h(
            'span',
            { className: 'sc-row-name' },
            h('span', { className: 'sc-row-name-text' }, sourceLabel(runtime, source)),
            source.live ? h(Tag, { tone: 'info' }, runtime.t('sources.modelOnly')) : null,
          ),
          h('span', { className: 'sc-row-meta' }, source.path),
          h('span', { className: 'sc-note' }, runtime.t('sources.hint')),
        ),
        h(
          'span',
          { className: 'sc-row-end' },
          h(
            'span',
            { className: 'sc-row-end-row' },
            h(Switch, {
              checked: live[source.key] === true,
              disabled: busyKey === source.key,
              label: runtime.t('sources.live'),
              onChange: (next) => toggle(source, next),
            }),
          ),
        ),
      ));

      const writableRows = writableSources.map((source) => h(
        'div',
        { key: source.key, className: 'sc-row' },
        h('span', { className: 'sc-row-icon' }, h(Icon, { name: 'folder', size: 18 })),
        h(
          'span',
          { className: 'sc-row-text' },
          h('span', { className: 'sc-row-name' }, h('span', { className: 'sc-row-name-text' }, sourceLabel(runtime, source))),
          h('span', { className: 'sc-row-meta' }, source.path),
        ),
        h('span', { className: 'sc-row-end' }, h(Tag, null, runtime.t('badge.writable'))),
      ));

      return h(
        'div',
        { className: 'sc-page' },
        h('div', { className: 'sc-topbar' },
          h('div', { className: 'sc-breadcrumb' },
            h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back')),
            h('span', { className: 'sc-breadcrumb-sep' }, '/'),
            h('span', { className: 'sc-breadcrumb-current' }, runtime.t('sources.title'))),
          h('div', { className: 'sc-topbar-actions' }, h(ExpandButton, { runtime, expanded, onExpand }))),
        h('header', { className: 'sc-head' },
          h('div', { className: 'sc-head-row' },
            h('div', { className: 'sc-head-titles' },
              h('h1', { className: 'sc-title' }, runtime.t('sources.title')),
              h('p', { className: 'sc-subtitle' }, runtime.t('sources.intro'))),
            h('div', { className: 'sc-head-actions' },
              h(HelpTip, { label: runtime.t('help.live') }, runtime.t('help.live'))))),
        error ? h(Banner, null, errorText(runtime, { code: error })) : null,
        readOnlyRows.length === 0
          ? h(EmptyState, { title: runtime.t('sources.empty') })
          : h('div', { className: 'sc-card' }, readOnlyRows),
        h('section', { className: 'sc-group' },
          h('div', { className: 'sc-group-head', style: { cursor: 'default' } },
            h('span', { className: 'sc-group-title' }, runtime.t('sources.writableTitle')),
            h('span', { className: 'sc-group-count' }, writableSources.length)),
          h('div', { className: 'sc-card' },
            writableRows.length === 0
              ? h('div', { style: { padding: '14px' } }, h('span', { className: 'sc-note' }, runtime.t('sources.empty')))
              : writableRows)),
      );
    }

    function TrashView({ runtime, snapshot, onBack, onChanged, notify, expanded, onExpand }) {
      const [list, setList] = useState({ loading: true, error: null, items: [] });
      const [pending, setPending] = useState(null);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);

      const load = useCallback(async () => {
        setList({ loading: true, error: null, items: [] });
        try {
          const value = await requestApi('trashList');
          setList({ loading: false, error: null, items: Array.isArray(value.items) ? value.items : [] });
        } catch (caught) {
          setList({ loading: false, error: caught.code || 'OPERATION_FAILED', items: [] });
        }
      }, []);

      useEffect(() => {
        load();
      }, [load]);

      const restore = async () => {
        if (!pending) return;
        setBusy(true);
        setError(null);
        try {
          const value = await requestApi('restore', { id: pending.id, confirm: true });
          notify('toast.restored');
          if (value && typeof value.revision === 'string') onChanged(value.revision);
          setPending(null);
          await load();
        } catch (caught) {
          if (caught.code === 'STALE_REVISION') notify('toast.stale');
          else setError(caught.code || 'OPERATION_FAILED');
        } finally {
          setBusy(false);
        }
      };

      const rows = list.items.map((item) => h(
        'div',
        { key: item.id, className: 'sc-row' },
        h('span', { className: 'sc-row-icon' }, h(Icon, { name: 'trash', size: 18 })),
        h(
          'span',
          { className: 'sc-row-text' },
          h('span', { className: 'sc-row-name' }, h('span', { className: 'sc-row-name-text' }, item.name || item.id)),
          h('span', { className: 'sc-row-meta' }, runtime.t('trash.originalPath') + ': ' + (item.originalPath || '')),
          h('span', { className: 'sc-row-meta' }, runtime.t('trash.deletedAt') + ': ' + formatDate(Date.parse(item.at), runtime.language)),
        ),
        h(
          'span',
          { className: 'sc-row-end' },
          h(
            'span',
            { className: 'sc-row-end-row' },
            h('button', { type: 'button', className: 'sc-btn sc-btn-sm sc-btn-outline', onClick: () => setPending(item) }, runtime.t('trash.restore')),
          ),
        ),
      ));

      return h(
        'div',
        { className: 'sc-page' },
        h('div', { className: 'sc-topbar' },
          h('div', { className: 'sc-breadcrumb' },
            h('button', { type: 'button', onClick: onBack }, h(Icon, { name: 'back', size: 14 }), ' ', runtime.t('actions.back')),
            h('span', { className: 'sc-breadcrumb-sep' }, '/'),
            h('span', { className: 'sc-breadcrumb-current' }, runtime.t('trash.title'))),
          h('div', { className: 'sc-topbar-actions' }, h(ExpandButton, { runtime, expanded, onExpand }))),
        h('header', { className: 'sc-head' },
          h('div', { className: 'sc-head-titles' },
            h('h1', { className: 'sc-title' }, runtime.t('trash.title')),
            h('p', { className: 'sc-subtitle' }, runtime.t('trash.intro')))),
        error ? h(Banner, null, errorText(runtime, { code: error })) : null,
        list.loading ? h('div', { className: 'sc-note' }, runtime.t('editor.busy')) : null,
        list.error ? h(Banner, null, errorText(runtime, { code: list.error })) : null,
        !list.loading && !list.error && rows.length === 0 ? h(EmptyState, { title: runtime.t('trash.empty') }) : null,
        rows.length > 0 ? h('div', { className: 'sc-card' }, rows) : null,
        pending
          ? h(ConfirmOverlay, {
            runtime,
            title: runtime.t('trash.confirmRestore'),
            body: (pending.name || pending.id) + ' → ' + (pending.originalPath || ''),
            confirmLabel: runtime.t('trash.restore'),
            busy,
            onConfirm: restore,
            onCancel: () => setPending(null),
          })
          : null,
      );
    }

    function SkillCuratorPage({ runtime, close }) {
      useRuntime(runtime);
      const [snapshot, setSnapshot] = useState(null);
      const [state, setState] = useState({ loading: true, error: null });
      const [route, setRoute] = useState({ view: 'library' });
      const [toast, setToast] = useState(null);
      const [pendingDelete, setPendingDelete] = useState(null);
      const [deleteBusy, setDeleteBusy] = useState(false);
      const [expanded, setExpanded] = useState(false);
      const onExpand = useCallback(() => setExpanded((value) => !value), []);

      const notify = useCallback((value) => {
        const text = typeof value === 'string' && Object.prototype.hasOwnProperty.call(runtime.language === 'en' ? DICT_EN : DICT_RU, value)
          ? runtime.t(value)
          : String(value ?? '');
        setToast({ id: Date.now(), text });
      }, [runtime]);

      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(timer);
      }, [toast]);

      const load = useCallback(async (force) => {
        setState((current) => ({ ...current, loading: current.snapshot === null, error: null }));
        try {
          const value = await requestApi('snapshot', force === true ? { force: true } : undefined);
          setSnapshot(value);
          setState({ loading: false, error: null });
        } catch (error) {
          setState({ loading: false, error: error.code || 'OPERATION_FAILED' });
        }
      }, []);

      useEffect(() => {
        load(true);
      }, [load]);

      const refresh = useCallback(async () => {
        try {
          const value = await requestApi('snapshot', { force: true });
          setSnapshot(value);
          return value;
        } catch (error) {
          if (error.code === 'STALE_REVISION') notify('toast.stale');
          return null;
        }
      }, [notify]);

      const revision = snapshot ? snapshot.revision : '';

      const toggleSkill = useCallback(async (skill, enabled) => {
        try {
          await requestApi('toggle', {
            id: skill.id,
            revision,
            confirm: true,
            modelInvocable: enabled,
            userInvocable: enabled,
          });
          await refresh();
          notify('toast.updated');
        } catch (error) {
          if (error.code === 'STALE_REVISION') {
            await refresh();
            notify('toast.stale');
          } else {
            notify(errorText(runtime, error));
          }
        }
      }, [revision, refresh, notify, runtime]);

      const askDelete = useCallback((skill) => setPendingDelete(skill), []);

      const confirmDelete = async () => {
        if (!pendingDelete) return;
        setDeleteBusy(true);
        try {
          await requestApi('remove', { id: pendingDelete.id, revision, confirm: true });
          notify('toast.trashed');
          setPendingDelete(null);
          await refresh();
        } catch (error) {
          if (error.code === 'STALE_REVISION') notify('toast.stale');
          else notify(errorText(runtime, error));
          setPendingDelete(null);
        } finally {
          setDeleteBusy(false);
        }
      };

      const openSkill = useCallback(async (skill, options) => {
        if (options && options.copyPath) {
          const ok = await runtime.copyText(skill.path);
          notify(ok ? 'toast.copied' : 'toast.copyFailed');
          return;
        }
        setRoute({ view: 'detail', skillId: skill.id, initialEdit: Boolean(options && options.edit) });
      }, [runtime, notify]);

      const renderView = () => {
        if (route.view === 'detail') {
          return h(SkillDetailView, {
            runtime,
            skillId: route.skillId,
            initialEdit: route.initialEdit === true,
            revision,
            onBack: () => setRoute({ view: 'library' }),
            onChanged: async () => {
              await refresh();
            },
            notify,
            expanded,
            onExpand,
          });
        }
        if (route.view === 'create') {
          return h(CreateSkillView, {
            runtime,
            snapshot,
            onBack: () => setRoute({ view: 'library' }),
            onDone: async () => {
              await refresh();
              setRoute({ view: 'library' });
            },
            notify,
            closeSettings: close,
            expanded,
            onExpand,
          });
        }
        if (route.view === 'import') {
          return h(ImportView, {
            runtime,
            snapshot,
            onBack: () => setRoute({ view: 'library' }),
            onDone: async () => {
              await refresh();
            },
            notify,
            expanded,
            onExpand,
          });
        }
        if (route.view === 'sources') {
          return h(SourcesView, {
            runtime,
            snapshot,
            onBack: () => setRoute({ view: 'library' }),
            onChanged: async () => {
              await refresh();
            },
            notify,
            expanded,
            onExpand,
          });
        }
        if (route.view === 'trash') {
          return h(TrashView, {
            runtime,
            snapshot,
            onBack: () => setRoute({ view: 'library' }),
            onChanged: async () => {
              await refresh();
            },
            notify,
            expanded,
            onExpand,
          });
        }
        return null;
      };

      const pageContent = state.loading
          ? h('div', { className: 'sc-page' },
            h('h1', { className: 'sc-title' }, runtime.t('page.title')),
            h('div', { className: 'sc-note' }, runtime.t('editor.busy')))
          : state.error
            ? h('div', { className: 'sc-page' },
              h('h1', { className: 'sc-title' }, runtime.t('page.title')),
              h(Banner, {
                actions: [h('button', { key: 'retry', type: 'button', className: 'sc-btn sc-btn-outline', onClick: () => load(true) }, runtime.t('page.error.retry'))],
              }, runtime.t('page.error.title') + ' — ' + (errorText(runtime, { code: state.error }))))
            : route.view === 'library'
              ? h(LibraryView, {
                runtime,
                snapshot,
                onRefresh: async () => {
                  await refresh();
                },
                onCreate: () => setRoute({ view: 'create' }),
                onImport: () => setRoute({ view: 'import' }),
                onOpenSkill: openSkill,
                onToggle: toggleSkill,
                onDelete: askDelete,
                onOpenSources: () => setRoute({ view: 'sources' }),
                onOpenTrash: () => setRoute({ view: 'trash' }),
                notify,
                expanded,
                onExpand,
              })
              : renderView();
      const viewNode = expanded
        ? h(
          'div',
          { className: 'sc-fullscreen' },
          h(
            'div',
            { className: 'sc-fullscreen-bar' },
            h('span', { style: { fontSize: '18px', lineHeight: '26px', fontWeight: 600 } }, runtime.t('page.title')),
            h('button', { type: 'button', className: 'sc-btn sc-btn-outline', onClick: () => setExpanded(false) },
              h(Icon, { name: 'collapse', size: 15 }), runtime.t('actions.collapse')),
          ),
          h('div', { className: 'sc-fullscreen-inner' }, pageContent),
        )
        : pageContent;

      return h(
        React.Fragment,
        null,
        viewNode,
        toast ? h(Toast, { text: toast.text }) : null,
        pendingDelete
          ? h(ConfirmOverlay, {
            runtime,
            title: runtime.t('actions.delete') + ' «' + pendingDelete.name + '»?',
            body: runtime.t('detail.deleteHint'),
            confirmLabel: runtime.t('actions.confirmDelete'),
            tone: 'danger',
            busy: deleteBusy,
            onConfirm: confirmDelete,
            onCancel: () => setPendingDelete(null),
          })
          : null,
      );
    }

    function SkillCuratorIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M6 4h9a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V4Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M6 17a2 2 0 0 1 2-2h9', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M9 8h5M9 11h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        h('path', { d: 'm17.5 2 .6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z', fill: 'currentColor' }),
      );
    }

    /* ------------------------------------------------------------------ */
    /* Plugin definition                                                   */
    /* ------------------------------------------------------------------ */

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      const runtime = createRuntime(ctx);

      ctx.effect(() => installStyles(), 'dsh-skill-curator: styles');

      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => {
          try {
            return ctx.locale.register(LOCALE_NS, { en: DICT_EN, ru: DICT_RU });
          } catch (error) {
            const message = String((error && error.message) || error || '');
            if (/already has locale/.test(message)) return () => {};
            throw error;
          }
        }, 'dsh-skill-curator: dictionaries');
      }

      ctx.effect(
        () => ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: 'skill-curator',
            order: SECTION_ORDER,
            label: () => runtime.t('nav.label'),
            locale: LOCALE_NS,
            inject: () => ({ runtime }),
          },
          SkillCuratorPage,
        )),
        'dsh-skill-curator: settings section',
      );

      ctx.effect(
        () => ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
          {
            name: 'settings.section.icon',
            id: 'skill-curator',
            locale: LOCALE_NS,
          },
          SkillCuratorIcon,
        )),
        'dsh-skill-curator: settings icon',
      );
    }

    return { inject, apply };
  },
});
