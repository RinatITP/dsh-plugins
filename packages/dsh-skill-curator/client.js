/**
 * dsh-skill-curator — Client (browser) half.
 *
 * Registers one `settings.section` page (id `skill-curator`, order 23) into the
 * DeepSeek Harness Web settings UI: a read-only studio over every known skill
 * root. Stage 1 shows the catalog, per-skill diagnostics, the SKILL.md body and
 * the bounded resource tree; editing, import and toggles arrive in later stages
 * behind explicit confirmations.
 *
 * Presentation rules match `dsh-mcp-guard`: plain ESM loaded through
 * `window.__ModuleLoader__`, React from the host, one injected `<style>` with
 * `data-plugin`, theme tokens only, all copy through a local RU/EN dictionary.
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-curator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useState } = React;

    /* ------------------------------------------------------------------ */
    /* Constants                                                           */
    /* ------------------------------------------------------------------ */

    const PLUGIN_ID = 'dsh-skill-curator';
    const LOCALE_NS = 'settings.skillCurator';
    const API_HEADER = 'x-dsh-skill-curator';
    const API_PATH = '/api/dsh-skill-curator';
    const SECTION_ORDER = 23;

    const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

    const DICT_EN = {
      'nav.label': 'Skills',
      'page.title': 'Skill Curator',
      'page.subtitle': 'Read-only studio over DSH, project and external agent skills.',
      'page.search': 'Search skills…',
      'page.refresh': 'Refresh',
      'page.loading': 'Reading skill roots…',
      'page.empty.title': 'No skills found',
      'page.empty.body': 'No SKILL.md files were found in the known roots on this computer.',
      'page.error.title': 'Could not load skills',
      'page.error.code': 'Error code',
      'page.error.unauthorized': 'Reopen this page from an authenticated DSH window.',
      'page.error.network': 'The DSH host is not reachable.',
      'summary.skills': 'skills',
      'summary.sources': 'sources',
      'summary.errors': 'errors',
      'summary.warnings': 'warnings',
      'summary.incomplete': 'some roots could not be read',
      'group.readOnly': 'read-only',
      'group.system': 'system',
      'group.empty': 'No skills in this root',
      'badge.symlink': 'symlink',
      'badge.duplicate': 'duplicate name',
      'badge.shadowed': 'shadowed',
      'badge.truncated': 'truncated',
      'badge.modelOff': 'hidden from model',
      'badge.userOff': 'hidden from slash menu',
      'badge.errors': 'errors',
      'badge.warnings': 'warnings',
      'detail.content': 'SKILL.md',
      'detail.edit': 'Edit',
      'detail.files': 'Files',
      'detail.diagnostics': 'Diagnostics',
      'detail.close': 'Close',
      'detail.loading': 'Reading…',
      'detail.path': 'Path',
      'detail.source': 'Source',
      'detail.scope': 'Scope',
      'detail.size': 'Size',
      'detail.lines': 'Body lines',
      'detail.status': 'Status',
      'detail.mtime': 'Modified',
      'detail.files.empty': 'No resource files.',
      'detail.files.readonly': 'Read-only preview',
      'detail.files.binary': 'Binary file preview is not available.',
      'detail.files.tooLarge': 'File is too large to preview.',
      'detail.diagnostics.none': 'No diagnostics — the skill looks valid.',
      'detail.diagnostics.severity.error': 'error',
      'detail.diagnostics.severity.warn': 'warning',
      'detail.diagnostics.severity.info': 'info',
      'detail.rawTruncated': 'The file is larger than the preview limit; content is truncated.',
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
      'scope.user': 'user',
      'scope.project': 'project',
      'status.writable': 'writable',
      'status.readOnly': 'read-only',
      'status.external': 'external, read-only',
      'status.bundled': 'bundled, read-only',
      'status.projectLocked': 'project, read-only in this stage',
      'tabs.library': 'Library',
      'tabs.trash': 'Trash',
      'tabs.import': 'Import',
      'import.hint': 'Copy or link skills from other agents into a DSH root. Nothing is overwritten: existing targets and invalid names are skipped before import.',
      'import.target': 'Destination',
      'import.target.user': 'My skills (DSH)',
      'import.target.agents': 'Shared agents',
      'import.target.project': 'Project',
      'import.workspace': 'Workspace',
      'import.mode': 'Mode',
      'import.mode.copy': 'Copy',
      'import.mode.copyHint': 'Independent snapshot. The imported skill no longer follows the source.',
      'import.mode.symlink': 'Symlink',
      'import.mode.symlinkHint': 'Live link to the source. Edits there appear here; moving the source breaks the link.',
      'import.selectAll': 'Select all',
      'import.clear': 'Clear',
      'import.selected': 'selected',
      'import.apply': 'Import selected',
      'import.confirmApply': 'Confirm import',
      'import.loading': 'Scanning sources…',
      'import.empty': 'No skills to import into this destination.',
      'import.rescan': 'Rescan',
      'import.results': 'Import result',
      'import.importable': 'importable',
      'import.imported': 'imported',
      'import.skipped': 'skipped',
      'import.failed': 'failed',
      'import.diagnostics': 'has validation errors',
      'import.noTargets': 'No writable destination is configured.',
      'import.reason.TARGET_EXISTS': 'already exists in the destination',
      'import.reason.ALREADY_IN_TARGET': 'already in the destination root',
      'import.reason.INVALID_NAME': 'invalid skill name',
      'import.reason.NAME_TAKEN': 'duplicate name in this selection',
      'import.reason.SOURCE_MISSING': 'source disappeared',
      'import.reason.IMPORT_FAILED': 'import failed',
      'import.reason.NOT_FOUND': 'not found',
      'toast.imported': 'Import finished',
      'actions.create': 'Create',
      'actions.delete': 'Move to trash',
      'actions.confirmDelete': 'Confirm delete',
      'actions.restore': 'Restore',
      'actions.save': 'Save',
      'actions.cancel': 'Cancel',
      'actions.validate': 'Check',
      'actions.editFile': 'Edit file',
      'actions.newFile': 'New file',
      'actions.enable': 'Enable',
      'actions.disable': 'Disable',
      'row.enabled': 'Visible to the model and in the slash menu',
      'row.disabled': 'Hidden from the model and the slash menu',
      'toggle.model': 'Model',
      'toggle.user': 'Slash menu',
      'editor.title': 'Edit SKILL.md',
      'editor.hint': 'Changes are validated before writing. The previous file is backed up; the catalog refreshes after save.',
      'editor.busy': 'Saving…',
      'editor.errors': 'Fix these errors before saving',
      'editor.noErrors': 'No errors',
      'editor.unsaved': 'Unsaved changes',
      'editor.fileTitle': 'Edit resource file',
      'create.title': 'Create skill',
      'create.name': 'Name (kebab-case)',
      'create.description': 'Description (what and when to use)',
      'create.body': 'Instructions',
      'create.scope': 'Location',
      'create.scope.user': 'My skills (DSH)',
      'create.scope.agents': 'Shared agents',
      'create.scope.project': 'Project',
      'create.workspace': 'Workspace',
      'create.submit': 'Create',
      'create.cancel': 'Cancel',
      'create.hint': 'The name becomes the directory name and must match the frontmatter. Additional material belongs in references/ and scripts/ — keep SKILL.md short.',
      'trash.title': 'Trash',
      'trash.empty': 'Trash is empty.',
      'trash.item': 'Deleted skill',
      'trash.originalPath': 'Original path',
      'trash.deletedAt': 'Deleted',
      'trash.confirmRestore': 'Confirm restore',
      'toast.saved': 'Skill saved',
      'toast.created': 'Skill created',
      'toast.trashed': 'Skill moved to trash',
      'toast.restored': 'Skill restored',
      'toast.updated': 'Skill updated',
      'toast.stale': 'The catalog changed. Reloaded — try again.',
      'error.CONFIRM_REQUIRED': 'Confirmation is required for this action',
      'error.STALE_REVISION': 'The catalog has changed. Reopen the skill and try again',
      'error.VALIDATION_FAILED': 'The skill has validation errors',
      'error.READ_ONLY_SKILL': 'This skill is read-only',
      'error.SYMLINK_READ_ONLY': 'Symlinked skills cannot be edited here',
      'error.TARGET_EXISTS': 'A skill with this name already exists',
      'error.NAME_CHANGE_UNSUPPORTED': 'The skill name cannot be changed in this view',
      'error.PATH_NOT_ALLOWED': 'Only references/, scripts/ and assets/ files may be written',
      'error.SKILL_UNREADABLE': 'The skill file cannot be read',
      'error.PROJECT_NOT_CONFIGURED': 'This project is not configured in the plugin',
      'error.CONTENT_TOO_LARGE': 'The content is too large',
      'error.OPERATION_FAILED': 'The operation failed',
    };

    const DICT_RU = {
      'nav.label': 'Навыки',
      'page.title': 'Студия навыков',
      'page.subtitle': 'Просмотр навыков DSH, проекта и других агентов без изменения файлов.',
      'page.search': 'Поиск навыков…',
      'page.refresh': 'Обновить',
      'page.loading': 'Читаю каталоги навыков…',
      'page.empty.title': 'Навыки не найдены',
      'page.empty.body': 'В известных корнях на этом компьютере нет файлов SKILL.md.',
      'page.error.title': 'Не удалось загрузить навыки',
      'page.error.code': 'Код ошибки',
      'page.error.unauthorized': 'Откройте страницу заново из авторизованного окна DSH.',
      'page.error.network': 'Хост DSH недоступен.',
      'summary.skills': 'навыков',
      'summary.sources': 'источников',
      'summary.errors': 'ошибок',
      'summary.warnings': 'предупреждений',
      'summary.incomplete': 'часть корней не прочитана',
      'group.readOnly': 'только чтение',
      'group.system': 'системные',
      'group.empty': 'В этом корне навыков нет',
      'badge.symlink': 'ссылка',
      'badge.duplicate': 'дубль имени',
      'badge.shadowed': 'перекрыт',
      'badge.truncated': 'обрезано',
      'badge.modelOff': 'скрыт от модели',
      'badge.userOff': 'скрыт из меню /',
      'badge.errors': 'ошибок',
      'badge.warnings': 'предупреждений',
      'detail.content': 'SKILL.md',
      'detail.edit': 'Редактировать',
      'detail.files': 'Файлы',
      'detail.diagnostics': 'Диагностика',
      'detail.close': 'Закрыть',
      'detail.loading': 'Читаю…',
      'detail.path': 'Путь',
      'detail.source': 'Источник',
      'detail.scope': 'Область',
      'detail.size': 'Размер',
      'detail.lines': 'Строк в теле',
      'detail.status': 'Статус',
      'detail.mtime': 'Изменён',
      'detail.files.empty': 'Вложенных файлов нет.',
      'detail.files.readonly': 'Просмотр без изменений',
      'detail.files.binary': 'Бинарный файл — предпросмотр недоступен.',
      'detail.files.tooLarge': 'Файл слишком большой для предпросмотра.',
      'detail.diagnostics.none': 'Ошибок нет — навык выглядит корректным.',
      'detail.diagnostics.severity.error': 'ошибка',
      'detail.diagnostics.severity.warn': 'предупреждение',
      'detail.diagnostics.severity.info': 'информация',
      'detail.rawTruncated': 'Файл больше лимита предпросмотра; содержимое обрезано.',
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
      'scope.user': 'пользователь',
      'scope.project': 'проект',
      'status.writable': 'доступен для записи',
      'status.readOnly': 'только чтение',
      'status.external': 'внешний, только чтение',
      'status.bundled': 'встроенный, только чтение',
      'status.projectLocked': 'проектный, на этом этапе только чтение',
      'tabs.library': 'Библиотека',
      'tabs.trash': 'Корзина',
      'tabs.import': 'Импорт',
      'import.hint': 'Скопируйте или свяжите навыки других агентов в корень DSH. Ничего не перезаписывается: существующие цели и недопустимые имена отсеиваются до импорта.',
      'import.target': 'Куда импортировать',
      'import.target.user': 'Мои навыки (DSH)',
      'import.target.agents': 'Общие агентские',
      'import.target.project': 'Проект',
      'import.workspace': 'Рабочий каталог',
      'import.mode': 'Режим',
      'import.mode.copy': 'Копия',
      'import.mode.copyHint': 'Независимый снимок. Импортированный навык больше не связан с источником.',
      'import.mode.symlink': 'Симлинк',
      'import.mode.symlinkHint': 'Живая ссылка на источник. Правки там видны здесь; перенос источника ломает ссылку.',
      'import.selectAll': 'Выбрать все',
      'import.clear': 'Снять',
      'import.selected': 'выбрано',
      'import.apply': 'Импортировать выбранные',
      'import.confirmApply': 'Подтвердить импорт',
      'import.loading': 'Сканирую источники…',
      'import.empty': 'Нет навыков для импорта в это место.',
      'import.rescan': 'Пересканировать',
      'import.results': 'Результат импорта',
      'import.importable': 'можно импортировать',
      'import.imported': 'импортировано',
      'import.skipped': 'пропущено',
      'import.failed': 'ошибки',
      'import.diagnostics': 'есть ошибки проверки',
      'import.noTargets': 'Нет доступного места для записи.',
      'import.reason.TARGET_EXISTS': 'уже есть в месте назначения',
      'import.reason.ALREADY_IN_TARGET': 'уже в целевом корне',
      'import.reason.INVALID_NAME': 'недопустимое имя навыка',
      'import.reason.NAME_TAKEN': 'дубль имени в этой выборке',
      'import.reason.SOURCE_MISSING': 'источник исчез',
      'import.reason.IMPORT_FAILED': 'импорт не удался',
      'import.reason.NOT_FOUND': 'не найден',
      'toast.imported': 'Импорт завершён',
      'actions.create': 'Создать',
      'actions.delete': 'В корзину',
      'actions.confirmDelete': 'Подтвердить удаление',
      'actions.restore': 'Восстановить',
      'actions.save': 'Сохранить',
      'actions.cancel': 'Отмена',
      'actions.validate': 'Проверить',
      'actions.editFile': 'Редактировать файл',
      'actions.newFile': 'Новый файл',
      'actions.enable': 'Включить',
      'actions.disable': 'Выключить',
      'row.enabled': 'Виден модели и в меню /',
      'row.disabled': 'Скрыт от модели и из меню /',
      'toggle.model': 'Модель',
      'toggle.user': 'Меню /',
      'editor.title': 'Редактирование SKILL.md',
      'editor.hint': 'Перед записью изменения проверяются. Предыдущий файл сохраняется в бэкап; после сохранения каталог обновляется.',
      'editor.busy': 'Сохраняю…',
      'editor.errors': 'Исправьте ошибки перед сохранением',
      'editor.noErrors': 'Ошибок нет',
      'editor.unsaved': 'Есть несохранённые изменения',
      'editor.fileTitle': 'Редактирование файла навыка',
      'create.title': 'Новый навык',
      'create.name': 'Имя (kebab-case)',
      'create.description': 'Описание (что и когда использовать)',
      'create.body': 'Инструкции',
      'create.scope': 'Куда сохранить',
      'create.scope.user': 'Мои навыки (DSH)',
      'create.scope.agents': 'Общие агентские',
      'create.scope.project': 'Проект',
      'create.workspace': 'Рабочий каталог',
      'create.submit': 'Создать',
      'create.cancel': 'Отмена',
      'create.hint': 'Имя станет именем папки и должно совпадать с frontmatter. Дополнительные материалы — в references/ и scripts/, а SKILL.md держите коротким.',
      'trash.title': 'Корзина',
      'trash.empty': 'Корзина пуста.',
      'trash.item': 'Удалённый навык',
      'trash.originalPath': 'Исходный путь',
      'trash.deletedAt': 'Удалён',
      'trash.confirmRestore': 'Подтвердить восстановление',
      'toast.saved': 'Навык сохранён',
      'toast.created': 'Навык создан',
      'toast.trashed': 'Навык перемещён в корзину',
      'toast.restored': 'Навык восстановлен',
      'toast.updated': 'Навык обновлён',
      'toast.stale': 'Каталог изменился. Перезагрузил — повторите действие.',
      'error.CONFIRM_REQUIRED': 'Для действия нужно подтверждение',
      'error.STALE_REVISION': 'Каталог изменился. Откройте навык заново и повторите',
      'error.VALIDATION_FAILED': 'В навыке есть ошибки проверки',
      'error.READ_ONLY_SKILL': 'Этот навык доступен только для чтения',
      'error.SYMLINK_READ_ONLY': 'Навыки-симлинки здесь не редактируются',
      'error.TARGET_EXISTS': 'Навык с таким именем уже существует',
      'error.NAME_CHANGE_UNSUPPORTED': 'Имя навыка нельзя изменить в этом окне',
      'error.PATH_NOT_ALLOWED': 'Записывать можно только файлы в references/, scripts/ и assets/',
      'error.SKILL_UNREADABLE': 'Файл навыка не читается',
      'error.PROJECT_NOT_CONFIGURED': 'Этот проект не настроен в плагине',
      'error.CONTENT_TOO_LARGE': 'Содержимое слишком большое',
      'error.OPERATION_FAILED': 'Операция не выполнена',
    };

    /* ------------------------------------------------------------------ */
    /* Styles                                                              */
    /* ------------------------------------------------------------------ */

    const STYLES = `
      [data-plugin="dsh-skill-curator"] * { box-sizing: border-box; }
      .sc-page {
        display: flex; flex-direction: column; gap: 16px;
        max-width: 960px; margin: 0 auto; padding: 8px 4px 40px;
        color: var(--dsw-alias-label-primary, #1c1c1e);
        font-size: 13px; line-height: 1.45;
      }
      .sc-header { display: flex; flex-direction: column; gap: 12px; }
      .sc-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .sc-title { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
      .sc-subtitle { margin: 4px 0 0; color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-header-actions { display: flex; gap: 8px; flex: none; }
      .sc-button {
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db);
        background: var(--dsw-alias-bg-layer-1, #fff);
        color: var(--dsw-alias-label-primary, #1c1c1e);
        border-radius: 8px; padding: 6px 12px; font: inherit; cursor: pointer;
      }
      .sc-button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }
      .sc-button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: 1px; }
      .sc-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
      .sc-search {
        flex: 1 1 260px; min-width: 220px; padding: 7px 10px; font: inherit;
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1, #fff); color: inherit;
      }
      .sc-search:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: 1px; }
      .sc-summary { display: flex; flex-wrap: wrap; gap: 10px; color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-summary strong { color: var(--dsw-alias-label-primary, #1c1c1e); font-weight: 600; }
      .sc-summary .sc-bad { color: var(--dsw-alias-state-error-primary, #dc2626); }
      .sc-summary .sc-warn { color: var(--dsw-alias-state-warn-primary, #b45309); }
      .sc-banner {
        border: 1px solid var(--dsw-alias-state-error-primary, #dc2626);
        border-radius: 10px; padding: 10px 12px;
        background: var(--dsw-alias-bg-layer-2, #f9fafb);
      }
      .sc-banner-title { font-weight: 600; margin-bottom: 2px; }
      .sc-banner-code { color: var(--dsw-alias-label-tertiary, #9ca3af); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .sc-loading, .sc-empty {
        border: 1px dashed var(--dsw-alias-border-l3, #d1d5db); border-radius: 12px;
        padding: 28px 16px; text-align: center; color: var(--dsw-alias-label-secondary, #6b7280);
      }
      .sc-empty-title { font-weight: 600; color: var(--dsw-alias-label-primary, #1c1c1e); margin-bottom: 4px; }
      .sc-group {
        border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 12px;
        background: var(--dsw-alias-bg-layer-1, #fff); overflow: hidden;
      }
      .sc-group-head {
        display: flex; align-items: center; gap: 10px; width: 100%;
        padding: 10px 14px; background: transparent; border: 0; cursor: pointer;
        font: inherit; color: inherit; text-align: left;
      }
      .sc-group-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.03)); }
      .sc-group-chevron { width: 14px; color: var(--dsw-alias-label-tertiary, #9ca3af); flex: none; }
      .sc-group-name { font-weight: 600; }
      .sc-group-path {
        color: var(--dsw-alias-label-tertiary, #9ca3af);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
      }
      .sc-group-spacer { flex: 1 1 auto; }
      .sc-group-count {
        flex: none; color: var(--dsw-alias-label-secondary, #6b7280);
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 999px;
        padding: 0 8px; font-size: 11px; line-height: 18px;
      }
      .sc-rows { display: flex; flex-direction: column; }
      .sc-row {
        display: flex; flex-direction: column; gap: 3px; width: 100%;
        padding: 10px 14px; border: 0; border-top: 1px solid var(--dsw-alias-border-l2, #f0f0f0);
        background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .sc-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.03)); }
      .sc-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: -2px; }
      .sc-row-top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .sc-row-name { font-weight: 600; }
      .sc-row-desc { color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-row-path {
        color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sc-chip {
        flex: none; display: inline-flex; align-items: center; gap: 4px;
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 999px;
        padding: 0 7px; font-size: 11px; line-height: 18px;
        color: var(--dsw-alias-label-secondary, #6b7280); background: var(--dsw-alias-bg-layer-2, #f9fafb);
      }
      .sc-chip.is-error { color: var(--dsw-alias-state-error-primary, #dc2626); border-color: var(--dsw-alias-state-error-primary, #dc2626); }
      .sc-chip.is-warn { color: var(--dsw-alias-state-warn-primary, #b45309); border-color: var(--dsw-alias-state-warn-primary, #b45309); }
      .sc-chip.is-info { color: var(--dsw-alias-label-tertiary, #9ca3af); }
      .sc-overlay {
        position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-1, rgba(15, 23, 42, 0.45)); padding: 24px;
      }
      .sc-modal {
        display: flex; flex-direction: column; width: min(860px, 100%); max-height: min(860px, 92vh);
        background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1c1c1e);
        border-radius: 14px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); overflow: hidden;
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
      }
      .sc-modal-head { display: flex; flex-direction: column; gap: 8px; padding: 16px 18px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
      .sc-modal-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
      .sc-modal-title { margin: 0; font-size: 18px; font-weight: 650; word-break: break-word; }
      .sc-modal-desc { margin: 0; color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-modal-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px 18px; font-size: 12px; }
      .sc-meta { display: flex; flex-direction: column; min-width: 0; }
      .sc-meta-label { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; }
      .sc-meta-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-meta-value.sc-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .sc-tabs { display: flex; gap: 4px; padding: 10px 18px 0; border-bottom: 1px solid var(--dsw-alias-border-l2, #e5e7eb); }
      .sc-tab {
        border: 0; background: transparent; font: inherit; color: var(--dsw-alias-label-secondary, #6b7280);
        padding: 7px 10px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px;
      }
      .sc-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary, #1c1c1e); border-bottom-color: var(--dsw-alias-brand-primary, #4f46e5); }
      .sc-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: -2px; }
      .sc-modal-body { padding: 12px 18px 18px; overflow: auto; }
      .sc-pre {
        margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 10px;
        background: var(--dsw-alias-bg-layer-2, #f9fafb); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow: auto; max-height: 52vh;
      }
      .sc-files { display: flex; flex-direction: column; gap: 2px; }
      .sc-file {
        display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0;
        background: transparent; border-radius: 8px; font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .sc-file:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04)); }
      .sc-file-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .sc-file-size { margin-left: auto; color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; flex: none; }
      .sc-diag { display: flex; flex-direction: column; gap: 8px; }
      .sc-diag-item { border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 10px; padding: 8px 10px; }
      .sc-diag-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
      .sc-diag-params { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px; margin-top: 2px; word-break: break-word; }
      .sc-muted { color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-note { color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 12px; }
      .sc-row-wrap {
        display: flex; align-items: stretch; gap: 8px;
        border-top: 1px solid var(--dsw-alias-border-l2, #f0f0f0);
      }
      .sc-row-wrap:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.03)); }
      .sc-row {
        display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0;
        padding: 10px 0 10px 14px; border: 0; background: transparent;
        font: inherit; color: inherit; text-align: left; cursor: pointer;
      }
      .sc-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: -2px; }
      .sc-row-switch { display: flex; align-items: center; padding: 0 14px 0 6px; }
      .sc-switch {
        position: relative; width: 34px; height: 20px; padding: 0; flex: none;
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 999px;
        background: var(--dsw-alias-bg-layer-3, #e5e7eb); cursor: pointer;
        transition: background 120ms ease;
      }
      .sc-switch.is-on { background: var(--dsw-alias-brand-primary, #4f46e5); border-color: var(--dsw-alias-brand-primary, #4f46e5); }
      .sc-switch:disabled { opacity: 0.55; cursor: default; }
      .sc-switch-knob {
        position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
        border-radius: 50%; background: var(--dsw-alias-switch-thumb, #fff); transition: transform 120ms ease;
      }
      .sc-switch.is-on .sc-switch-knob { transform: translateX(14px); }
      .sc-toolbar-tabs { display: flex; gap: 4px; }
      .sc-toolbar-tabs .sc-tab { padding: 6px 10px; border-bottom: 2px solid transparent; }
      .sc-toolbar-tabs .sc-tab[aria-selected="true"] { border-bottom-color: var(--dsw-alias-brand-primary, #4f46e5); }
      .sc-button.is-danger { border-color: var(--dsw-alias-state-error-primary, #dc2626); color: var(--dsw-alias-state-error-primary, #dc2626); }
      .sc-button-primary {
        border: 1px solid var(--dsw-alias-button-primary-fill, #1f2937);
        background: var(--dsw-alias-button-primary-fill, #1f2937);
        color: var(--dsw-alias-label-primary-foreground, #fff);
      }
      .sc-button-primary:hover { background: var(--dsw-alias-button-primary-hover, #111827); }
      .sc-button:disabled { opacity: 0.55; cursor: default; }
      .sc-input, .sc-textarea, .sc-select {
        width: 100%; padding: 7px 9px; font: inherit; color: inherit;
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db); border-radius: 8px;
        background: var(--dsw-alias-bg-layer-1, #fff);
      }
      .sc-input:focus-visible, .sc-textarea:focus-visible, .sc-select:focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary, #4f46e5); outline-offset: 1px;
      }
      .sc-textarea {
        min-height: 220px; resize: vertical;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.55;
      }
      .sc-form { display: flex; flex-direction: column; gap: 10px; }
      .sc-field { display: flex; flex-direction: column; gap: 4px; }
      .sc-field-label { font-size: 12px; font-weight: 600; }
      .sc-form-row { display: flex; gap: 10px; flex-wrap: wrap; }
      .sc-form-row > .sc-field { flex: 1 1 200px; }
      .sc-editor-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
      .sc-editor-actions .sc-note { margin-left: auto; }
      .sc-toast {
        position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
        z-index: 80; padding: 9px 14px; border-radius: 10px; max-width: 560px;
        background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #1c1c1e);
        border: 1px solid var(--dsw-alias-border-l3, #d1d5db);
        box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22); font-size: 13px;
      }
      .sc-toggle-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
      .sc-trash-list { display: flex; flex-direction: column; gap: 8px; }
      .sc-trash-item {
        display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
        border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 10px; padding: 10px 12px;
      }
      .sc-trash-main { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
      .sc-trash-name { font-weight: 600; }
      .sc-trash-path {
        color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sc-import-controls { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: flex-end; }
      .sc-import-field { display: flex; flex-direction: column; gap: 4px; min-width: 180px; }
      .sc-import-field-label { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9ca3af); }
      .sc-segment { display: flex; gap: 4px; }
      .sc-segment .sc-button[aria-pressed="true"] {
        border-color: var(--dsw-alias-brand-primary, #4f46e5);
        color: var(--dsw-alias-brand-primary, #4f46e5);
        background: var(--dsw-alias-bg-layer-2, #f9fafb);
      }
      .sc-import-group { border: 1px solid var(--dsw-alias-border-l2, #e5e7eb); border-radius: 12px; overflow: hidden; }
      .sc-import-group-head {
        display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
        padding: 10px 14px; background: var(--dsw-alias-bg-layer-2, #f9fafb);
      }
      .sc-import-group-name { font-weight: 600; }
      .sc-import-group-path {
        color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
      }
      .sc-import-group-spacer { flex: 1 1 auto; }
      .sc-candidate {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 9px 14px; border-top: 1px solid var(--dsw-alias-border-l2, #f0f0f0);
      }
      .sc-candidate.is-skipped { opacity: 0.62; }
      .sc-candidate-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .sc-candidate-name { font-weight: 600; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .sc-candidate-desc { color: var(--dsw-alias-label-secondary, #6b7280); font-size: 12px; }
      .sc-candidate-path {
        color: var(--dsw-alias-label-tertiary, #9ca3af); font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .sc-check { margin-top: 2px; width: 15px; height: 15px; flex: none; accent-color: var(--dsw-alias-brand-primary, #4f46e5); }
      .sc-import-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .sc-import-footer .sc-note { margin-left: auto; }
      .sc-results { display: flex; flex-direction: column; gap: 6px; }
      .sc-result-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
      .sc-result-count { color: var(--dsw-alias-label-secondary, #6b7280); }
      .sc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    `;

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

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
      if (typeof value !== 'number' || !Number.isFinite(value)) return '';
      try {
        return new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'ru-RU', {
          year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }).format(new Date(value));
      } catch {
        return new Date(value).toISOString();
      }
    }

    function severityRank(diagnostics) {
      let rank = 99;
      for (const item of diagnostics || []) {
        const value = SEVERITY_ORDER[item?.severity];
        if (typeof value === 'number' && value < rank) rank = value;
      }
      return rank;
    }

    function countSeverity(diagnostics, severity) {
      return (diagnostics || []).filter((item) => item?.severity === severity).length;
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

    function sourceLabel(runtime, source) {
      if (source && typeof source.label === 'string' && source.label !== '') return source.label;
      const key = source && typeof source.labelKey === 'string' ? source.labelKey : '';
      return key !== '' ? runtime.t(key) : (source?.agent ?? source?.key ?? '');
    }

    function scopeLabel(runtime, scope) {
      return runtime.t('scope.' + (scope === 'project' ? 'project' : 'user'));
    }

    function statusLabel(runtime, skill) {
      if (skill.readOnlyReason === 'BUNDLED') return runtime.t('status.bundled');
      if (skill.readOnlyReason === 'EXTERNAL') return runtime.t('status.external');
      if (skill.readOnlyReason === 'PROJECT') return runtime.t('status.projectLocked');
      return skill.readOnly ? runtime.t('status.readOnly') : runtime.t('status.writable');
    }

    /* ------------------------------------------------------------------ */
    /* Components                                                          */
    /* ------------------------------------------------------------------ */

    function Chip({ text, tone }) {
      const className = 'sc-chip' + (tone ? ' is-' + tone : '');
      return h('span', { className }, text);
    }

    function errorText(runtime, error) {
      const code = error && typeof error.code === 'string' && error.code !== '' ? error.code : 'OPERATION_FAILED';
      const key = 'error.' + code;
      const translated = runtime.t(key);
      return translated === key ? code : translated;
    }

    function SkillRow({ runtime, skill, onOpen, capabilities, onToggle, busy }) {
      const errors = countSeverity(skill.diagnostics, 'error');
      const warnings = countSeverity(skill.diagnostics, 'warn');
      const chips = [];
      if (skill.isSymlink) chips.push(h(Chip, { key: 'symlink', text: runtime.t('badge.symlink') }));
      if (skill.system) chips.push(h(Chip, { key: 'system', text: runtime.t('group.system') }));
      if (skill.shadowed) chips.push(h(Chip, { key: 'shadowed', text: runtime.t('badge.shadowed'), tone: 'info' }));
      else if (skill.duplicateName) chips.push(h(Chip, { key: 'duplicate', text: runtime.t('badge.duplicate'), tone: 'info' }));
      if (skill.invocation && skill.invocation.modelInvocable === false) {
        chips.push(h(Chip, { key: 'modelOff', text: runtime.t('badge.modelOff'), tone: 'info' }));
      }
      if (skill.invocation && skill.invocation.userInvocable === false) {
        chips.push(h(Chip, { key: 'userOff', text: runtime.t('badge.userOff'), tone: 'info' }));
      }
      if (skill.truncated) chips.push(h(Chip, { key: 'truncated', text: runtime.t('badge.truncated'), tone: 'warn' }));
      if (errors > 0) chips.push(h(Chip, { key: 'errors', text: errors + ' ' + runtime.t('badge.errors'), tone: 'error' }));
      else if (warnings > 0) chips.push(h(Chip, { key: 'warnings', text: warnings + ' ' + runtime.t('badge.warnings'), tone: 'warn' }));

      const enabled = !skill.invocation || (skill.invocation.modelInvocable !== false && skill.invocation.userInvocable !== false);
      const canToggle = capabilities && capabilities.write === true && skill.writable === true;
      const switchEl = canToggle
        ? h(ToggleSwitch, {
          checked: enabled,
          disabled: busy === true,
          label: enabled ? runtime.t('row.enabled') : runtime.t('row.disabled'),
          onChange: (next) => onToggle(skill, next),
        })
        : null;

      return h(
        'div',
        { className: 'sc-row-wrap' },
        h(
          'button',
          { type: 'button', className: 'sc-row', onClick: () => onOpen(skill), 'aria-label': skill.name },
          h('span', { className: 'sc-row-top' }, h('span', { className: 'sc-row-name' }, skill.name), chips),
          skill.description ? h('span', { className: 'sc-row-desc' }, skill.description) : null,
          h('span', { className: 'sc-row-path' }, skill.relativePath || skill.path),
        ),
        switchEl ? h('div', { className: 'sc-row-switch' }, switchEl) : null,
      );
    }

    function SourceGroup({ runtime, source, skills, collapsed, onToggleGroup, onOpen, capabilities, onToggleSkill, busyId }) {
      const errors = skills.reduce((total, skill) => total + countSeverity(skill.diagnostics, 'error'), 0);
      const warnings = skills.reduce((total, skill) => total + countSeverity(skill.diagnostics, 'warn'), 0);
      const summary = [h(Chip, { key: 'count', text: String(skills.length) })];
      if (source.readOnly) summary.push(h(Chip, { key: 'readonly', text: runtime.t('group.readOnly'), tone: 'info' }));
      if (source.systemCount > 0) summary.push(h(Chip, { key: 'system', text: runtime.t('group.system') }));
      if (errors > 0) summary.push(h(Chip, { key: 'errors', text: errors + ' ' + runtime.t('badge.errors'), tone: 'error' }));
      else if (warnings > 0) summary.push(h(Chip, { key: 'warnings', text: warnings + ' ' + runtime.t('badge.warnings'), tone: 'warn' }));

      return h(
        'section',
        { className: 'sc-group' },
        h(
          'button',
          {
            type: 'button',
            className: 'sc-group-head',
            onClick: onToggleGroup,
            'aria-expanded': collapsed ? 'false' : 'true',
          },
          h('span', { className: 'sc-group-chevron' }, collapsed ? '▸' : '▾'),
          h('span', { className: 'sc-group-name' }, sourceLabel(runtime, source)),
          source.path ? h('span', { className: 'sc-group-path' }, source.path) : null,
          h('span', { className: 'sc-group-spacer' }),
          summary,
        ),
        collapsed ? null : h(
          'div',
          { className: 'sc-rows' },
          skills.length === 0
            ? h('div', { className: 'sc-note', style: { padding: '10px 14px' } }, runtime.t('group.empty'))
            : skills.map((skill) => h(SkillRow, {
              key: skill.id,
              runtime,
              skill,
              onOpen,
              capabilities,
              onToggle: onToggleSkill,
              busy: busyId === skill.id,
            })),
        ),
      );
    }

    function MetaItem({ label, value, mono }) {
      return h(
        'div',
        { className: 'sc-meta' },
        h('span', { className: 'sc-meta-label' }, label),
        h('span', { className: 'sc-meta-value' + (mono ? ' sc-mono' : ''), title: value }, value),
      );
    }

    function ToggleSwitch({ checked, disabled, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          title: label,
          className: 'sc-switch' + (checked ? ' is-on' : ''),
          disabled: disabled === true,
          onClick: (event) => {
            event.stopPropagation();
            if (disabled !== true) onChange(!checked);
          },
        },
        h('span', { className: 'sc-switch-knob' }),
      );
    }

    function ConfirmButton({ label, confirmLabel, disabled, tone, onConfirm }) {
      const [armed, setArmed] = useState(false);
      useEffect(() => {
        if (!armed) return undefined;
        const timer = setTimeout(() => setArmed(false), 5000);
        return () => clearTimeout(timer);
      }, [armed]);
      const className = 'sc-button' + (tone === 'primary' ? ' sc-button-primary' : '') + (armed ? ' is-danger' : '');
      return h(
        'button',
        {
          type: 'button',
          className,
          disabled: disabled === true,
          onClick: () => {
            if (armed) {
              setArmed(false);
              onConfirm();
            } else {
              setArmed(true);
            }
          },
        },
        armed ? confirmLabel : label,
      );
    }

    function DiagnosticsList({ runtime, diagnostics }) {
      if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
        return h('p', { className: 'sc-note' }, runtime.t('detail.diagnostics.none'));
      }
      return h(
        'div',
        { className: 'sc-diag' },
        diagnostics.map((item, index) => h(
          'div',
          { key: item.code + ':' + index, className: 'sc-diag-item' },
          h(
            'div',
            { className: 'sc-diag-code' },
            h(
              'span',
              {
                className: 'sc-chip' + (item.severity === 'error' ? ' is-error' : item.severity === 'warn' ? ' is-warn' : ' is-info'),
                style: { marginRight: '8px' },
              },
              runtime.t('detail.diagnostics.severity.' + (item.severity || 'info')),
            ),
            item.code,
          ),
          item.params && Object.keys(item.params).length > 0
            ? h('div', { className: 'sc-diag-params' }, formatParams(item.params))
            : null,
        )),
      );
    }

    function SkillDetail({ runtime, skillId, source, revision, capabilities, onClose, onChanged, onMessage }) {
      const [detail, setDetail] = useState(null);
      const [state, setState] = useState({ loading: true, error: null });
      const [tab, setTab] = useState('content');
      const [currentRevision, setCurrentRevision] = useState(revision);
      const [editText, setEditText] = useState(null);
      const [editState, setEditState] = useState({ busy: false, diagnostics: null, error: null });
      const [file, setFile] = useState(null);
      const [fileState, setFileState] = useState({ loading: false, error: null });
      const [fileEdit, setFileEdit] = useState(null);
      const [fileEditState, setFileEditState] = useState({ busy: false, error: null });
      const [mutationBusy, setMutationBusy] = useState(false);
      const [mutationError, setMutationError] = useState(null);

      useEffect(() => {
        if (typeof revision === 'string') setCurrentRevision(revision);
      }, [revision]);

      const loadDetail = useCallback(async () => {
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
        setTab('content');
        setEditText(null);
        setFile(null);
        setFileEdit(null);
        setMutationError(null);
        loadDetail();
      }, [skillId, loadDetail]);

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose();
        };
        if (typeof document !== 'undefined') {
          document.addEventListener('keydown', onKey);
          return () => document.removeEventListener('keydown', onKey);
        }
        return undefined;
      }, [onClose]);

      useEffect(() => {
        if (tab === 'edit' && editText === null && detail !== null) setEditText(detail.content);
      }, [tab, detail, editText]);

      const writable = capabilities?.write === true && detail?.skill?.writable === true;
      const skill = detail?.skill ?? null;
      const diagnostics = skill ? (skill.diagnostics || []) : [];
      const errors = countSeverity(diagnostics, 'error');
      const warnings = countSeverity(diagnostics, 'warn');

      const applyRevision = (value) => {
        if (value && typeof value.revision === 'string') {
          setCurrentRevision(value.revision);
          if (typeof onChanged === 'function') onChanged(value.revision);
        }
      };

      const reportError = (error) => {
        setMutationError(errorText(runtime, error));
        if (error && error.code === 'STALE_REVISION') {
          if (typeof onMessage === 'function') onMessage('toast.stale');
          if (typeof onChanged === 'function') onChanged();
        }
      };

      const saveContent = async () => {
        if (editText === null) return;
        setEditState({ busy: true, diagnostics: null, error: null });
        setMutationError(null);
        try {
          const value = await requestApi('save', {
            id: skillId,
            content: editText,
            revision: currentRevision,
            confirm: true,
          });
          applyRevision(value);
          setEditText(null);
          setTab('content');
          await loadDetail();
          if (typeof onMessage === 'function') onMessage('toast.saved');
        } catch (error) {
          if (error.code === 'VALIDATION_FAILED' && error.details && Array.isArray(error.details.diagnostics)) {
            setEditState({ busy: false, diagnostics: error.details.diagnostics, error: null });
          } else {
            setEditState({ busy: false, diagnostics: null, error: error.code || 'OPERATION_FAILED' });
            reportError(error);
          }
        }
      };

      const validateContent = async () => {
        if (editText === null) return;
        setEditState({ busy: true, diagnostics: null, error: null });
        try {
          const value = await requestApi('validate', { id: skillId, content: editText });
          setEditState({ busy: false, diagnostics: value.diagnostics, error: null });
        } catch (error) {
          setEditState({ busy: false, diagnostics: null, error: error.code || 'OPERATION_FAILED' });
        }
      };

      const toggleInvocation = async (field, next) => {
        if (!skill) return;
        setMutationBusy(true);
        setMutationError(null);
        const payload = {
          id: skillId,
          revision: currentRevision,
          confirm: true,
          modelInvocable: skill.invocation.modelInvocable !== false,
          userInvocable: skill.invocation.userInvocable !== false,
        };
        if (field === 'model') payload.modelInvocable = next;
        else payload.userInvocable = next;
        try {
          const value = await requestApi('toggle', payload);
          applyRevision(value);
          setDetail((current) => (current !== null ? { ...current, skill: value.skill } : current));
          if (typeof onMessage === 'function') onMessage('toast.updated');
        } catch (error) {
          reportError(error);
        } finally {
          setMutationBusy(false);
        }
      };

      const removeSkill = async () => {
        setMutationBusy(true);
        setMutationError(null);
        try {
          const value = await requestApi('remove', { id: skillId, revision: currentRevision, confirm: true });
          applyRevision(value);
          if (typeof onMessage === 'function') onMessage('toast.trashed');
          onClose();
        } catch (error) {
          reportError(error);
          setMutationBusy(false);
        }
      };

      const openFile = useCallback(async (relativePath) => {
        setTab('files');
        setFileState({ loading: true, error: null });
        setFile(null);
        setFileEdit(null);
        try {
          const value = await requestApi('readFile', { id: skillId, path: relativePath });
          setFile({ relativePath, ...value });
          setFileState({ loading: false, error: null });
        } catch (error) {
          setFileState({ loading: false, error: error.code || 'OPERATION_FAILED' });
        }
      }, [skillId]);

      const saveFile = async () => {
        if (fileEdit === null) return;
        setFileEditState({ busy: true, error: null });
        try {
          const value = await requestApi('writeFile', {
            id: skillId,
            path: fileEdit.path,
            content: fileEdit.text,
            revision: currentRevision,
            confirm: true,
          });
          applyRevision(value);
          setFileEdit(null);
          await loadDetail();
          if (typeof onMessage === 'function') onMessage('toast.saved');
        } catch (error) {
          setFileEditState({ busy: false, error: error.code || 'OPERATION_FAILED' });
        }
      };

      const tabs = writable ? ['content', 'edit', 'files', 'diagnostics'] : ['content', 'files', 'diagnostics'];

      return h(
        'div',
        {
          className: 'sc-overlay',
          role: 'dialog',
          'aria-modal': 'true',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose();
          },
        },
        h(
          'div',
          { className: 'sc-modal' },
          h(
            'div',
            { className: 'sc-modal-head' },
            h(
              'div',
              { className: 'sc-modal-title-row' },
              h('h2', { className: 'sc-modal-title' }, skill ? skill.name : runtime.t('detail.loading')),
              h(
                'div',
                { style: { display: 'flex', gap: '8px', flex: 'none' } },
                writable
                  ? h(ConfirmButton, {
                    label: runtime.t('actions.delete'),
                    confirmLabel: runtime.t('actions.confirmDelete'),
                    disabled: mutationBusy,
                    onConfirm: removeSkill,
                  })
                  : null,
                h('button', { type: 'button', className: 'sc-button', onClick: onClose }, runtime.t('detail.close')),
              ),
            ),
            skill && skill.description ? h('p', { className: 'sc-modal-desc' }, skill.description) : null,
            skill
              ? h(
                'div',
                { className: 'sc-modal-meta' },
                h(MetaItem, { label: runtime.t('detail.source'), value: sourceLabel(runtime, source ?? { key: skill.sourceKey }) }),
                h(MetaItem, { label: runtime.t('detail.scope'), value: scopeLabel(runtime, skill.scope) }),
                h(MetaItem, { label: runtime.t('detail.path'), value: skill.path, mono: true }),
                h(MetaItem, { label: runtime.t('detail.size'), value: formatBytes(skill.sizeBytes) }),
                h(MetaItem, { label: runtime.t('detail.lines'), value: String(skill.bodyLines) }),
                h(MetaItem, { label: runtime.t('detail.status'), value: statusLabel(runtime, skill) }),
                h(MetaItem, { label: runtime.t('detail.mtime'), value: formatDate(skill.mtimeMs, runtime.language) }),
              )
              : null,
            writable && skill
              ? h(
                'div',
                { style: { display: 'flex', gap: '18px', flexWrap: 'wrap' } },
                h(
                  'div',
                  { className: 'sc-toggle-row' },
                  h('span', null, runtime.t('toggle.model')),
                  h(ToggleSwitch, {
                    checked: skill.invocation.modelInvocable !== false,
                    disabled: mutationBusy,
                    label: runtime.t('toggle.model'),
                    onChange: (next) => toggleInvocation('model', next),
                  }),
                ),
                h(
                  'div',
                  { className: 'sc-toggle-row' },
                  h('span', null, runtime.t('toggle.user')),
                  h(ToggleSwitch, {
                    checked: skill.invocation.userInvocable !== false,
                    disabled: mutationBusy,
                    label: runtime.t('toggle.user'),
                    onChange: (next) => toggleInvocation('user', next),
                  }),
                ),
              )
              : null,
            mutationError
              ? h('div', { className: 'sc-banner', role: 'alert', style: { margin: '8px 0 0' } },
                h('div', { className: 'sc-banner-code' }, mutationError))
              : null,
            h(
              'div',
              { className: 'sc-tabs', role: 'tablist' },
              tabs.map((item) => h(
                'button',
                {
                  key: item,
                  type: 'button',
                  role: 'tab',
                  className: 'sc-tab',
                  'aria-selected': tab === item ? 'true' : 'false',
                  onClick: () => setTab(item),
                },
                runtime.t('detail.' + item),
              )),
            ),
          ),
          h(
            'div',
            { className: 'sc-modal-body' },
            state.loading ? h('div', { className: 'sc-note' }, runtime.t('detail.loading')) : null,
            state.error
              ? h(
                'div',
                { className: 'sc-banner' },
                h('div', { className: 'sc-banner-title' }, runtime.t('page.error.title')),
                h('div', { className: 'sc-banner-code' }, runtime.t('page.error.code') + ': ' + state.error),
              )
              : null,
            !state.loading && !state.error && detail
              ? [
                tab === 'content'
                  ? h(
                    'div',
                    null,
                    detail.truncated ? h('p', { className: 'sc-note' }, runtime.t('detail.rawTruncated')) : null,
                    h('pre', { className: 'sc-pre' }, detail.content),
                  )
                  : null,
                tab === 'edit'
                  ? h(
                    'div',
                    { className: 'sc-form' },
                    h('p', { className: 'sc-note' }, runtime.t('editor.hint')),
                    h('textarea', {
                      className: 'sc-textarea',
                      value: editText === null ? detail.content : editText,
                      onChange: (event) => setEditText(event.target.value),
                      spellCheck: false,
                    }),
                    h(
                      'div',
                      { className: 'sc-editor-actions' },
                      h('button', {
                        type: 'button',
                        className: 'sc-button',
                        disabled: editState.busy,
                        onClick: validateContent,
                      }, runtime.t('actions.validate')),
                      h('button', {
                        type: 'button',
                        className: 'sc-button sc-button-primary',
                        disabled: editState.busy || editText === null,
                        onClick: saveContent,
                      }, editState.busy ? runtime.t('editor.busy') : runtime.t('actions.save')),
                      h('button', {
                        type: 'button',
                        className: 'sc-button',
                        disabled: editState.busy,
                        onClick: () => {
                          setEditText(null);
                          setTab('content');
                        },
                      }, runtime.t('actions.cancel')),
                      editText !== null ? h('span', { className: 'sc-note' }, runtime.t('editor.unsaved')) : null,
                    ),
                    editState.diagnostics !== null
                      ? h(
                        'div',
                        null,
                        h(
                          'div',
                          { className: 'sc-note', style: { marginBottom: '6px' } },
                          countSeverity(editState.diagnostics, 'error') > 0
                            ? runtime.t('editor.errors')
                            : runtime.t('editor.noErrors'),
                        ),
                        h(DiagnosticsList, { runtime, diagnostics: editState.diagnostics }),
                      )
                      : null,
                    editState.error
                      ? h('div', { className: 'sc-banner' }, h('div', { className: 'sc-banner-code' }, errorText(runtime, { code: editState.error })))
                      : null,
                  )
                  : null,
                tab === 'files'
                  ? h(
                    'div',
                    null,
                    fileState.loading ? h('div', { className: 'sc-note' }, runtime.t('detail.loading')) : null,
                    fileState.error
                      ? h('div', { className: 'sc-banner' }, h('div', { className: 'sc-banner-code' }, fileState.error))
                      : null,
                    file
                      ? h(
                        'div',
                        null,
                        h('div', { className: 'sc-note', style: { marginBottom: '8px' } }, file.relativePath + ' · ' + formatBytes(file.size)),
                        file.binary ? h('p', { className: 'sc-note' }, runtime.t('detail.files.binary')) : null,
                        !file.binary && fileEdit === null
                          ? h(
                            'div',
                            null,
                            file.truncated ? h('p', { className: 'sc-note' }, runtime.t('detail.files.tooLarge')) : null,
                            h('pre', { className: 'sc-pre' }, file.content),
                            writable && file.relativePath !== 'SKILL.md'
                              ? h(
                                'div',
                                { className: 'sc-editor-actions' },
                                h('button', {
                                  type: 'button',
                                  className: 'sc-button',
                                  onClick: () => setFileEdit({ path: file.relativePath, text: file.content }),
                                }, runtime.t('actions.editFile')),
                              )
                              : null,
                          )
                          : null,
                        fileEdit !== null
                          ? h(
                            'div',
                            { className: 'sc-form' },
                            h('p', { className: 'sc-note' }, runtime.t('editor.fileTitle') + ': ' + fileEdit.path),
                            h('textarea', {
                              className: 'sc-textarea',
                              value: fileEdit.text,
                              onChange: (event) => setFileEdit({ path: fileEdit.path, text: event.target.value }),
                              spellCheck: false,
                            }),
                            h(
                              'div',
                              { className: 'sc-editor-actions' },
                              h('button', {
                                type: 'button',
                                className: 'sc-button sc-button-primary',
                                disabled: fileEditState.busy,
                                onClick: saveFile,
                              }, fileEditState.busy ? runtime.t('editor.busy') : runtime.t('actions.save')),
                              h('button', {
                                type: 'button',
                                className: 'sc-button',
                                disabled: fileEditState.busy,
                                onClick: () => setFileEdit(null),
                              }, runtime.t('actions.cancel')),
                            ),
                          )
                          : null,
                      )
                      : null,
                    h(
                      'div',
                      { className: 'sc-files', style: { marginTop: file ? '12px' : 0 } },
                      (detail.files || []).length === 0
                        ? h('p', { className: 'sc-note' }, runtime.t('detail.files.empty'))
                        : detail.files.map((entry) => h(
                          'button',
                          {
                            key: entry.relativePath,
                            type: 'button',
                            className: 'sc-file',
                            onClick: () => openFile(entry.relativePath),
                            disabled: entry.kind === 'directory',
                          },
                          h('span', { className: 'sc-file-name' }, (entry.kind === 'directory' ? '📁 ' : '') + entry.relativePath),
                          h('span', { className: 'sc-file-size' }, entry.kind === 'directory' ? '' : formatBytes(entry.size)),
                        )),
                    ),
                  )
                  : null,
                tab === 'diagnostics'
                  ? h(DiagnosticsList, { runtime, diagnostics })
                  : null,
              ]
              : null,
          ),
        ),
      );
    }

    function CreateSkillModal({ runtime, snapshot, onClose, onChanged, onMessage }) {
      const projectSources = (snapshot && Array.isArray(snapshot.sources) ? snapshot.sources : [])
        .filter((source) => source.kind === 'project');
      const [form, setForm] = useState({ name: '', description: '', body: '', scope: 'user', workspace: projectSources[0] ? projectSources[0].path : '' });
      const [state, setState] = useState({ busy: false, error: null });

      const workspacePath = (sourcePath) => {
        const marker = '/.dsh/skills';
        const index = String(sourcePath).indexOf(marker);
        return index >= 0 ? String(sourcePath).slice(0, index) : String(sourcePath);
      };

      const submit = async () => {
        setState({ busy: true, error: null });
        try {
          const payload = {
            confirm: true,
            revision: snapshot.revision,
            scope: form.scope,
            name: form.name,
            description: form.description,
            body: form.body,
          };
          if (form.scope === 'project') payload.workspacePath = workspacePath(form.workspace);
          const value = await requestApi('create', payload);
          if (typeof onChanged === 'function') onChanged(value.revision);
          if (typeof onMessage === 'function') onMessage('toast.created');
          onClose();
        } catch (error) {
          setState({ busy: false, error: error.code || 'OPERATION_FAILED' });
        }
      };

      return h(
        'div',
        {
          className: 'sc-overlay',
          role: 'dialog',
          'aria-modal': 'true',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose();
          },
        },
        h(
          'div',
          { className: 'sc-modal', style: { maxWidth: '720px' } },
          h('div', { className: 'sc-modal-head' }, h('h2', { className: 'sc-modal-title' }, runtime.t('create.title'))),
          h(
            'div',
            { className: 'sc-modal-body' },
            h('p', { className: 'sc-note', style: { marginTop: 0 } }, runtime.t('create.hint')),
            state.error
              ? h('div', { className: 'sc-banner' }, h('div', { className: 'sc-banner-code' }, errorText(runtime, { code: state.error })))
              : null,
            h(
              'div',
              { className: 'sc-form' },
              h('div', { className: 'sc-form-row' },
                h('label', { className: 'sc-field' },
                  h('span', { className: 'sc-field-label' }, runtime.t('create.name')),
                  h('input', {
                    className: 'sc-input',
                    value: form.name,
                    onChange: (event) => setForm({ ...form, name: event.target.value }),
                    placeholder: 'my-skill',
                  })),
                h('label', { className: 'sc-field' },
                  h('span', { className: 'sc-field-label' }, runtime.t('create.scope')),
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
                  h('span', { className: 'sc-field-label' }, runtime.t('create.workspace')),
                  h('select', {
                    className: 'sc-select',
                    value: form.workspace,
                    onChange: (event) => setForm({ ...form, workspace: event.target.value }),
                  },
                  projectSources.map((source) => h('option', { key: source.key, value: source.path }, source.label || workspacePath(source.path)))))
                : null,
              h('label', { className: 'sc-field' },
                h('span', { className: 'sc-field-label' }, runtime.t('create.description')),
                h('textarea', {
                  className: 'sc-textarea',
                  style: { minHeight: '70px' },
                  value: form.description,
                  onChange: (event) => setForm({ ...form, description: event.target.value }),
                })),
              h('label', { className: 'sc-field' },
                h('span', { className: 'sc-field-label' }, runtime.t('create.body')),
                h('textarea', {
                  className: 'sc-textarea',
                  value: form.body,
                  onChange: (event) => setForm({ ...form, body: event.target.value }),
                })),
              h(
                'div',
                { className: 'sc-editor-actions' },
                h('button', {
                  type: 'button',
                  className: 'sc-button sc-button-primary',
                  disabled: state.busy,
                  onClick: submit,
                }, state.busy ? runtime.t('editor.busy') : runtime.t('create.submit')),
                h('button', { type: 'button', className: 'sc-button', onClick: onClose }, runtime.t('create.cancel')),
              ),
            ),
          ),
        ),
      );
    }

    function TrashPanel({ runtime, items, loading, error, busyId, onRestore }) {
      if (loading) return h('div', { className: 'sc-loading' }, runtime.t('page.loading'));
      if (error) {
        return h('div', { className: 'sc-banner' }, h('div', { className: 'sc-banner-code' }, errorText(runtime, { code: error })));
      }
      if (!Array.isArray(items) || items.length === 0) {
        return h('div', { className: 'sc-empty' }, h('div', { className: 'sc-empty-title' }, runtime.t('trash.title')), h('div', null, runtime.t('trash.empty')));
      }
      return h(
        'div',
        { className: 'sc-trash-list' },
        items.map((item) => h(
          'div',
          { key: item.id, className: 'sc-trash-item' },
          h(
            'div',
            { className: 'sc-trash-main' },
            h('span', { className: 'sc-trash-name' }, item.name || runtime.t('trash.item')),
            h('span', { className: 'sc-trash-path' }, runtime.t('trash.originalPath') + ': ' + item.originalPath),
            h('span', { className: 'sc-trash-path' }, runtime.t('trash.deletedAt') + ': ' + formatDate(Date.parse(item.at), runtime.language)),
          ),
          h(ConfirmButton, {
            label: runtime.t('actions.restore'),
            confirmLabel: runtime.t('trash.confirmRestore'),
            disabled: busyId === item.id,
            onConfirm: () => onRestore(item),
          }),
        )),
      );
    }

    function ImportPanel({ runtime, snapshot, capabilities, onChanged, onMessage }) {
      const projectSources = (snapshot && Array.isArray(snapshot.sources) ? snapshot.sources : [])
        .filter((source) => source.kind === 'project');
      const workspacePath = (sourcePath) => {
        const marker = '/.dsh/skills';
        const index = String(sourcePath).indexOf(marker);
        return index >= 0 ? String(sourcePath).slice(0, index) : String(sourcePath);
      };

      const [target, setTarget] = useState('user');
      const [workspace, setWorkspace] = useState(projectSources[0] ? projectSources[0].path : '');
      const [mode, setMode] = useState('copy');
      const [plan, setPlan] = useState({ loading: true, error: null, data: null });
      const [selected, setSelected] = useState(() => new Set());
      const [applying, setApplying] = useState(false);
      const [applyError, setApplyError] = useState(null);
      const [results, setResults] = useState(null);

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

      useEffect(() => {
        setResults(null);
      }, [target, workspace, mode]);

      const data = plan.data;
      const groups = data ? data.groups : [];
      const byId = useMemo(() => {
        const map = new Map();
        for (const group of groups) {
          for (const candidate of group.candidates) map.set(candidate.id, candidate);
        }
        return map;
      }, [groups]);

      const toggleCandidate = (id, next) => {
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

      const reasonLabel = (code) => {
        if (!code) return '';
        const key = 'import.reason.' + code;
        const text = runtime.t(key);
        return text === key ? code : text;
      };

      const apply = async () => {
        setApplying(true);
        setApplyError(null);
        try {
          const body = {
            confirm: true,
            revision: snapshot.revision,
            target,
            mode,
            ids: [...selected],
          };
          if (target === 'project') body.workspacePath = workspacePath(workspace);
          const value = await requestApi('importApply', body);
          setResults(value);
          if (typeof onChanged === 'function') onChanged(value.revision);
          if (typeof onMessage === 'function') onMessage('toast.imported');
          await loadPlan();
        } catch (error) {
          if (error.code === 'STALE_REVISION') {
            if (typeof onMessage === 'function') onMessage('toast.stale');
            await loadPlan();
          } else {
            setApplyError(error.code || 'OPERATION_FAILED');
          }
        } finally {
          setApplying(false);
        }
      };

      const targetOptions = [
        { value: 'user', label: runtime.t('import.target.user') },
        { value: 'agents', label: runtime.t('import.target.agents') },
      ];
      if (projectSources.length > 0) targetOptions.push({ value: 'project', label: runtime.t('import.target.project') });

      return h(
        'section',
        { className: 'sc-form' },
        h('p', { className: 'sc-note', style: { margin: 0 } }, runtime.t('import.hint')),
        h(
          'div',
          { className: 'sc-import-controls' },
          h(
            'label',
            { className: 'sc-import-field' },
            h('span', { className: 'sc-import-field-label' }, runtime.t('import.target')),
            h(
              'select',
              {
                className: 'sc-select',
                value: target,
                onChange: (event) => setTarget(event.target.value),
                disabled: applying,
              },
              targetOptions.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
            ),
          ),
          target === 'project' && projectSources.length > 0
            ? h(
              'label',
              { className: 'sc-import-field' },
              h('span', { className: 'sc-import-field-label' }, runtime.t('import.workspace')),
              h(
                'select',
                {
                  className: 'sc-select',
                  value: workspace,
                  onChange: (event) => setWorkspace(event.target.value),
                  disabled: applying,
                },
                projectSources.map((source) => h('option', { key: source.key, value: source.path }, source.label || workspacePath(source.path))),
              ),
            )
            : null,
          h(
            'div',
            { className: 'sc-import-field' },
            h('span', { className: 'sc-import-field-label' }, runtime.t('import.mode')),
            h(
              'div',
              { className: 'sc-segment' },
              h('button', {
                type: 'button',
                className: 'sc-button',
                'aria-pressed': mode === 'copy' ? 'true' : 'false',
                disabled: applying,
                onClick: () => setMode('copy'),
              }, runtime.t('import.mode.copy')),
              h('button', {
                type: 'button',
                className: 'sc-button',
                'aria-pressed': mode === 'symlink' ? 'true' : 'false',
                disabled: applying,
                onClick: () => setMode('symlink'),
              }, runtime.t('import.mode.symlink')),
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'sc-button', onClick: loadPlan, disabled: plan.loading || applying },
            runtime.t('import.rescan'),
          ),
        ),
        h('p', { className: 'sc-note', style: { margin: 0 } }, runtime.t(mode === 'copy' ? 'import.mode.copyHint' : 'import.mode.symlinkHint')),
        applyError
          ? h('div', { className: 'sc-banner' }, h('div', { className: 'sc-banner-code' }, errorText(runtime, { code: applyError })))
          : null,
        plan.loading ? h('div', { className: 'sc-loading' }, runtime.t('import.loading')) : null,
        plan.error
          ? h('div', { className: 'sc-banner' }, h('div', { className: 'sc-banner-code' }, errorText(runtime, { code: plan.error })))
          : null,
        data && data.counts.importable === 0 && groups.length === 0
          ? h('div', { className: 'sc-empty' }, h('div', null, runtime.t('import.empty')))
          : null,
        groups.map((group) => {
          const importable = group.candidates.filter((candidate) => candidate.skipReason === null);
          const allSelected = importable.length > 0 && importable.every((candidate) => selected.has(candidate.id));
          return h(
            'div',
            { key: group.key, className: 'sc-import-group' },
            h(
              'div',
              { className: 'sc-import-group-head' },
              h('span', { className: 'sc-import-group-name' }, sourceLabel(runtime, group)),
              h('span', { className: 'sc-import-group-path' }, group.path),
              h('span', { className: 'sc-import-group-spacer' }),
              h(Chip, { text: String(group.candidates.length) }),
              h(Chip, { text: importable.length + ' ' + runtime.t('import.importable') }),
              importable.length > 0
                ? h('button', {
                  type: 'button',
                  className: 'sc-button',
                  onClick: () => toggleGroup(group, !allSelected),
                  disabled: applying,
                }, allSelected ? runtime.t('import.clear') : runtime.t('import.selectAll'))
                : null,
            ),
            group.candidates.map((candidate) => {
              const disabled = candidate.skipReason !== null || applying;
              return h(
                'div',
                { key: candidate.id, className: 'sc-candidate' + (candidate.skipReason !== null ? ' is-skipped' : '') },
                h('input', {
                  type: 'checkbox',
                  className: 'sc-check',
                  checked: selected.has(candidate.id),
                  disabled,
                  onChange: (event) => toggleCandidate(candidate.id, event.target.checked),
                  'aria-label': candidate.name,
                }),
                h(
                  'div',
                  { className: 'sc-candidate-main' },
                  h(
                    'span',
                    { className: 'sc-candidate-name' },
                    candidate.name,
                    candidate.isSymlinkSource ? h(Chip, { text: runtime.t('badge.symlink'), tone: 'info' }) : null,
                    candidate.diagnostics && candidate.diagnostics.length > 0
                      ? h(Chip, { text: runtime.t('import.diagnostics'), tone: 'warn' })
                      : null,
                    candidate.skipReason !== null ? h(Chip, { text: reasonLabel(candidate.skipReason), tone: 'warn' }) : null,
                  ),
                  candidate.description ? h('span', { className: 'sc-candidate-desc' }, candidate.description) : null,
                  h('span', { className: 'sc-candidate-path' }, candidate.targetPath || candidate.sourcePath),
                ),
              );
            }),
          );
        }),
        data && groups.length > 0
          ? h(
            'div',
            { className: 'sc-import-footer' },
            h(ConfirmButton, {
              label: runtime.t('import.apply') + ' (' + selected.size + ')',
              confirmLabel: runtime.t('import.confirmApply') + ' (' + selected.size + ')',
              disabled: selected.size === 0 || applying,
              tone: 'primary',
              onConfirm: apply,
            }),
            h('span', { className: 'sc-note' }, selected.size + ' ' + runtime.t('import.selected')),
            applying ? h('span', { className: 'sc-note' }, runtime.t('editor.busy')) : null,
          )
          : null,
        results
          ? h(
            'div',
            { className: 'sc-form' },
            h('div', { className: 'sc-result-count' }, runtime.t('import.results') + ': '
              + results.counts.imported + ' ' + runtime.t('import.imported') + ' · '
              + results.counts.skipped + ' ' + runtime.t('import.skipped') + ' · '
              + results.counts.failed + ' ' + runtime.t('import.failed')),
            h(
              'div',
              { className: 'sc-results' },
              results.results.map((item, index) => h(
                'div',
                { key: item.id + ':' + index, className: 'sc-result-row' },
                h(Chip, {
                  text: item.status,
                  tone: item.status === 'imported' ? 'info' : item.status === 'failed' ? 'error' : 'warn',
                }),
                h('span', null, item.name || item.id),
                item.code ? h('span', { className: 'sc-result-count' }, reasonLabel(item.code)) : null,
              )),
            ),
          )
          : null,
        null,
      );
    }

    function SkillCuratorPage({ runtime }) {
      useRuntime(runtime);
      const [snapshot, setSnapshot] = useState(null);
      const [state, setState] = useState({ loading: true, error: null });
      const [tab, setTab] = useState('library');
      const [query, setQuery] = useState('');
      const [collapsed, setCollapsed] = useState({});
      const [selectedSkill, setSelectedSkill] = useState(null);
      const [createOpen, setCreateOpen] = useState(false);
      const [trash, setTrash] = useState({ loading: false, items: [], error: null });
      const [toast, setToast] = useState(null);
      const [busyId, setBusyId] = useState(null);
      const [trashBusyId, setTrashBusyId] = useState(null);

      useEffect(() => {
        if (!toast) return undefined;
        const timer = setTimeout(() => setToast(null), 5000);
        return () => clearTimeout(timer);
      }, [toast]);

      const notify = useCallback((key) => {
        const message = runtime.t(key);
        setToast({ id: Date.now(), message: message === key ? key : message });
      }, [runtime]);

      const loadSnapshot = useCallback(async (force) => {
        setState((current) => ({ ...current, loading: true, error: null }));
        try {
          const value = await requestApi('snapshot', force === true ? { force: true } : undefined);
          setSnapshot(value);
          setState({ loading: false, error: null });
        } catch (error) {
          setState({ loading: false, error: error.code || 'OPERATION_FAILED' });
        }
      }, []);

      useEffect(() => {
        loadSnapshot(true);
      }, [loadSnapshot]);

      const refresh = useCallback(async () => {
        try {
          const value = await requestApi('snapshot', { force: true });
          setSnapshot(value);
          return value;
        } catch {
          return null;
        }
      }, []);

      const loadTrash = useCallback(async () => {
        setTrash((current) => ({ ...current, loading: true, error: null }));
        try {
          const value = await requestApi('trashList');
          setTrash({ loading: false, items: Array.isArray(value.items) ? value.items : [], error: null });
        } catch (error) {
          setTrash({ loading: false, items: [], error: error.code || 'OPERATION_FAILED' });
        }
      }, []);

      useEffect(() => {
        if (tab === 'trash') loadTrash();
      }, [tab, loadTrash]);

      const capabilities = snapshot ? snapshot.capabilities : null;

      const onToggleSkill = useCallback(async (skill, enabled) => {
        if (!snapshot) return;
        setBusyId(skill.id);
        try {
          await requestApi('toggle', {
            id: skill.id,
            revision: snapshot.revision,
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
            setToast({ id: Date.now(), message: errorText(runtime, error) });
          }
        } finally {
          setBusyId(null);
        }
      }, [snapshot, refresh, notify, runtime]);

      const onRestore = useCallback(async (item) => {
        setTrashBusyId(item.id);
        try {
          await requestApi('restore', { id: item.id, confirm: true });
          await refresh();
          await loadTrash();
          notify('toast.restored');
        } catch (error) {
          setToast({ id: Date.now(), message: errorText(runtime, error) });
        } finally {
          setTrashBusyId(null);
        }
      }, [refresh, loadTrash, notify, runtime]);

      const filtered = useMemo(() => {
        const skills = snapshot && Array.isArray(snapshot.skills) ? snapshot.skills : [];
        const text = query.trim().toLowerCase();
        if (text === '') return skills;
        return skills.filter((skill) => (
          String(skill.name || '').toLowerCase().includes(text)
          || String(skill.description || '').toLowerCase().includes(text)
          || String(skill.path || '').toLowerCase().includes(text)
        ));
      }, [snapshot, query]);

      const groups = useMemo(() => {
        if (!snapshot || !Array.isArray(snapshot.sources)) return [];
        const bySource = new Map();
        for (const source of snapshot.sources) bySource.set(source.key, []);
        for (const skill of filtered) {
          if (!bySource.has(skill.sourceKey)) bySource.set(skill.sourceKey, []);
          bySource.get(skill.sourceKey).push(skill);
        }
        return snapshot.sources
          .filter((source) => (bySource.get(source.key) || []).length > 0)
          .map((source) => ({ source, skills: bySource.get(source.key) || [] }));
      }, [snapshot, filtered]);

      const summary = snapshot && snapshot.summary ? snapshot.summary : null;
      const showEmpty = !state.loading && !state.error && tab === 'library' && groups.length === 0;
      const errorBanner = state.error
        ? h(
          'div',
          { className: 'sc-banner', role: 'alert' },
          h('div', { className: 'sc-banner-title' }, runtime.t('page.error.title')),
          h('div', { className: 'sc-banner-code' }, runtime.t('page.error.code') + ': ' + state.error),
          (state.error === 'UNAUTHENTICATED' || state.error === 'FORBIDDEN')
            ? h('div', { className: 'sc-note', style: { marginTop: '4px' } }, runtime.t('page.error.unauthorized'))
            : state.error === 'NETWORK'
              ? h('div', { className: 'sc-note', style: { marginTop: '4px' } }, runtime.t('page.error.network'))
              : null,
          h('div', { style: { marginTop: '10px' } }, h('button', { type: 'button', className: 'sc-button', onClick: () => loadSnapshot(true) }, runtime.t('page.refresh'))),
        )
        : null;

      const summaryBar = summary
        ? h(
          'div',
          { className: 'sc-summary' },
          h('span', null, h('strong', null, String(summary.skills)), ' ', runtime.t('summary.skills')),
          h('span', null, h('strong', null, String(summary.sources)), ' ', runtime.t('summary.sources')),
          summary.errors > 0
            ? h('span', { className: 'sc-bad' }, h('strong', { className: 'sc-bad' }, String(summary.errors)), ' ', runtime.t('summary.errors'))
            : null,
          summary.warnings > 0
            ? h('span', { className: 'sc-warn' }, h('strong', { className: 'sc-warn' }, String(summary.warnings)), ' ', runtime.t('summary.warnings'))
            : null,
          snapshot && snapshot.complete === false ? h('span', { className: 'sc-warn' }, runtime.t('summary.incomplete')) : null,
        )
        : null;

      return h(
        'div',
        { className: 'sc-page' },
        h(
          'header',
          { className: 'sc-header' },
          h(
            'div',
            { className: 'sc-title-row' },
            h(
              'div',
              null,
              h('h1', { className: 'sc-title' }, runtime.t('page.title')),
              h('p', { className: 'sc-subtitle' }, runtime.t('page.subtitle')),
            ),
            h(
              'div',
              { className: 'sc-header-actions' },
              capabilities && capabilities.create && tab === 'library'
                ? h('button', { type: 'button', className: 'sc-button sc-button-primary', onClick: () => setCreateOpen(true) }, runtime.t('actions.create'))
                : null,
              h('button', { type: 'button', className: 'sc-button', onClick: () => loadSnapshot(true), disabled: state.loading }, runtime.t('page.refresh')),
            ),
          ),
          h(
            'div',
            { className: 'sc-toolbar' },
            h(
              'div',
              { className: 'sc-toolbar-tabs', role: 'tablist' },
              h('button', {
                type: 'button',
                role: 'tab',
                className: 'sc-tab',
                'aria-selected': tab === 'library' ? 'true' : 'false',
                onClick: () => setTab('library'),
              }, runtime.t('tabs.library')),
              capabilities && capabilities.import
                ? h('button', {
                  type: 'button',
                  role: 'tab',
                  className: 'sc-tab',
                  'aria-selected': tab === 'import' ? 'true' : 'false',
                  onClick: () => setTab('import'),
                }, runtime.t('tabs.import'))
                : null,
              capabilities && capabilities.trash
                ? h('button', {
                  type: 'button',
                  role: 'tab',
                  className: 'sc-tab',
                  'aria-selected': tab === 'trash' ? 'true' : 'false',
                  onClick: () => setTab('trash'),
                }, runtime.t('tabs.trash') + (trash.items.length > 0 ? ' (' + trash.items.length + ')' : ''))
                : null,
            ),
            tab === 'library'
              ? h('input', {
                className: 'sc-search',
                type: 'search',
                placeholder: runtime.t('page.search'),
                value: query,
                onChange: (event) => setQuery(event.target.value),
                'aria-label': runtime.t('page.search'),
              })
              : null,
            tab === 'library' ? summaryBar : null,
          ),
        ),
        errorBanner,
        state.loading && tab === 'library' ? h('div', { className: 'sc-loading' }, runtime.t('page.loading')) : null,
        showEmpty
          ? h(
            'div',
            { className: 'sc-empty' },
            h('div', { className: 'sc-empty-title' }, runtime.t('page.empty.title')),
            h('div', null, runtime.t('page.empty.body')),
          )
          : null,
        tab === 'library'
          ? groups.map((group) => h(SourceGroup, {
            key: group.source.key,
            runtime,
            source: group.source,
            skills: group.skills,
            collapsed: collapsed[group.source.key] === true,
            onToggleGroup: () => setCollapsed((current) => ({ ...current, [group.source.key]: !current[group.source.key] })),
            onOpen: (skill) => setSelectedSkill(skill),
            capabilities,
            onToggleSkill,
            busyId,
          }))
          : tab === 'import'
            ? h(ImportPanel, {
              runtime,
              snapshot,
              capabilities,
              onChanged: (revision) => {
                if (typeof revision === 'string') setSnapshot((current) => (current !== null ? { ...current, revision } : current));
                refresh();
              },
              onMessage: notify,
            })
            : h(TrashPanel, {
              runtime,
              items: trash.items,
              loading: trash.loading,
              error: trash.error,
              busyId: trashBusyId,
              onRestore,
            }),
        selectedSkill !== null
          ? h(SkillDetail, {
            runtime,
            skillId: selectedSkill.id,
            source: (snapshot?.sources || []).find((item) => item.key === selectedSkill.sourceKey) ?? null,
            revision: snapshot ? snapshot.revision : '',
            capabilities,
            onClose: () => setSelectedSkill(null),
            onChanged: (revision) => {
              if (typeof revision === 'string') setSnapshot((current) => (current !== null ? { ...current, revision } : current));
              refresh();
            },
            onMessage: notify,
          })
          : null,
        createOpen && snapshot
          ? h(CreateSkillModal, {
            runtime,
            snapshot,
            onClose: () => setCreateOpen(false),
            onChanged: (revision) => {
              if (typeof revision === 'string') setSnapshot((current) => (current !== null ? { ...current, revision } : current));
              refresh();
            },
            onMessage: notify,
          })
          : null,
        toast ? h('div', { className: 'sc-toast', role: 'status' }, toast.message) : null,
      );
    }

    function SkillCuratorIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M5 17a2.5 2.5 0 0 1 2.5-2.5H17', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M8.5 8h5M8.5 11h5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
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
