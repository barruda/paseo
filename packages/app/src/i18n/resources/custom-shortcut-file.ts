// CUSTOM(shortcut-file): strings for Settings > Shortcuts > Export / Import, kept out of the big
// locale files so upstream changes to them don't conflict. Each locale file adds
// `shortcutFile: SHORTCUT_FILE_<LOCALE>` under `settings`.

interface ShortcutFileStrings {
  export: string;
  import: string;
  exported: string;
  imported: string;
  importedSkipped: string;
  invalidJson: string;
  invalidFormat: string;
  newerVersion: string;
  readError: string;
}

export const SHORTCUT_FILE_EN: ShortcutFileStrings = {
  export: "Export",
  import: "Import",
  exported: "Shortcuts exported",
  imported: "Shortcuts imported",
  importedSkipped:
    "Shortcuts imported. {{count}} entries were skipped: this version doesn't know them.",
  invalidJson: "That file isn't valid JSON",
  invalidFormat: "That file isn't a Paseo shortcuts file",
  newerVersion: "That file was saved by a newer Paseo. Update to load it.",
  readError: "Couldn't read that file",
};

export const SHORTCUT_FILE_PT_BR: ShortcutFileStrings = {
  export: "Exportar",
  import: "Importar",
  exported: "Atalhos exportados",
  imported: "Atalhos importados",
  importedSkipped:
    "Atalhos importados. {{count}} entradas foram ignoradas: esta versão não as conhece.",
  invalidJson: "Esse arquivo não é um JSON válido",
  invalidFormat: "Esse arquivo não é um arquivo de atalhos do Paseo",
  newerVersion: "Esse arquivo foi salvo por um Paseo mais novo. Atualize para carregá-lo.",
  readError: "Não foi possível ler esse arquivo",
};

export const SHORTCUT_FILE_ES: ShortcutFileStrings = {
  export: "Exportar",
  import: "Importar",
  exported: "Atajos exportados",
  imported: "Atajos importados",
  importedSkipped:
    "Atajos importados. Se omitieron {{count}} entradas: esta versión no las conoce.",
  invalidJson: "Ese archivo no es un JSON válido",
  invalidFormat: "Ese archivo no es un archivo de atajos de Paseo",
  newerVersion: "Ese archivo lo guardó un Paseo más nuevo. Actualiza para cargarlo.",
  readError: "No se pudo leer ese archivo",
};

export const SHORTCUT_FILE_FR: ShortcutFileStrings = {
  export: "Exporter",
  import: "Importer",
  exported: "Raccourcis exportés",
  imported: "Raccourcis importés",
  importedSkipped:
    "Raccourcis importés. {{count}} entrées ont été ignorées : cette version ne les connaît pas.",
  invalidJson: "Ce fichier n'est pas un JSON valide",
  invalidFormat: "Ce fichier n'est pas un fichier de raccourcis Paseo",
  newerVersion:
    "Ce fichier a été enregistré par une version plus récente de Paseo. Mettez à jour pour le charger.",
  readError: "Impossible de lire ce fichier",
};

export const SHORTCUT_FILE_JA: ShortcutFileStrings = {
  export: "エクスポート",
  import: "インポート",
  exported: "ショートカットをエクスポートしました",
  imported: "ショートカットをインポートしました",
  importedSkipped:
    "ショートカットをインポートしました。{{count}} 件はこのバージョンが認識できないためスキップしました。",
  invalidJson: "このファイルは有効な JSON ではありません",
  invalidFormat: "このファイルは Paseo のショートカットファイルではありません",
  newerVersion: "このファイルはより新しい Paseo で保存されました。更新してから読み込んでください。",
  readError: "ファイルを読み込めませんでした",
};

export const SHORTCUT_FILE_KO: ShortcutFileStrings = {
  export: "내보내기",
  import: "가져오기",
  exported: "단축키를 내보냈습니다",
  imported: "단축키를 가져왔습니다",
  importedSkipped:
    "단축키를 가져왔습니다. 이 버전이 알지 못하는 항목 {{count}}개는 건너뛰었습니다.",
  invalidJson: "올바른 JSON 파일이 아닙니다",
  invalidFormat: "Paseo 단축키 파일이 아닙니다",
  newerVersion: "더 최신 버전의 Paseo에서 저장한 파일입니다. 업데이트한 뒤 불러오세요.",
  readError: "파일을 읽을 수 없습니다",
};

export const SHORTCUT_FILE_RU: ShortcutFileStrings = {
  export: "Экспорт",
  import: "Импорт",
  exported: "Сочетания клавиш экспортированы",
  imported: "Сочетания клавиш импортированы",
  importedSkipped:
    "Сочетания клавиш импортированы. Пропущено записей: {{count}}, эта версия их не знает.",
  invalidJson: "Файл не является корректным JSON",
  invalidFormat: "Это не файл сочетаний клавиш Paseo",
  newerVersion: "Файл сохранён более новой версией Paseo. Обновитесь, чтобы загрузить его.",
  readError: "Не удалось прочитать файл",
};

export const SHORTCUT_FILE_ZH_CN: ShortcutFileStrings = {
  export: "导出",
  import: "导入",
  exported: "快捷键已导出",
  imported: "快捷键已导入",
  importedSkipped: "快捷键已导入。有 {{count}} 项被跳过：当前版本不认识它们。",
  invalidJson: "该文件不是有效的 JSON",
  invalidFormat: "该文件不是 Paseo 快捷键文件",
  newerVersion: "该文件由更新版本的 Paseo 保存。请更新后再加载。",
  readError: "无法读取该文件",
};

export const SHORTCUT_FILE_AR: ShortcutFileStrings = {
  export: "تصدير",
  import: "استيراد",
  exported: "تم تصدير الاختصارات",
  imported: "تم استيراد الاختصارات",
  importedSkipped: "تم استيراد الاختصارات. تم تخطي {{count}} من الإدخالات لأن هذا الإصدار لا يعرفها.",
  invalidJson: "هذا الملف ليس JSON صالحًا",
  invalidFormat: "هذا الملف ليس ملف اختصارات Paseo",
  newerVersion: "حُفظ هذا الملف بواسطة إصدار أحدث من Paseo. حدّث التطبيق لتحميله.",
  readError: "تعذّرت قراءة هذا الملف",
};
