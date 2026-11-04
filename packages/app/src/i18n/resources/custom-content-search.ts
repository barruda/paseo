// CUSTOM(workspace-content-search): strings for the command center's Search in files scope, kept out
// of the big locale files so upstream changes to them don't conflict. Each locale file adds
// `contentSearch: CONTENT_SEARCH_<LOCALE>` under `shell.commandCenter`.

interface ContentSearchStrings {
  shortcutLabel: string;
  scope: string;
  placeholder: string;
  prompt: string;
  searching: string;
  results: string;
  truncated: string;
  unsupported: string;
}

export const CONTENT_SEARCH_EN: ContentSearchStrings = {
  shortcutLabel: "Search in files",
  scope: "In files",
  placeholder: "Search in files...",
  prompt: "Type to search the text of this project's files",
  searching: "Searching in files...",
  results: "Results",
  truncated: "First {{count}} results",
  unsupported: "This host's daemon doesn't support this search yet. Restart or update the daemon.",
};

export const CONTENT_SEARCH_PT_BR: ContentSearchStrings = {
  shortcutLabel: "Buscar nos arquivos",
  scope: "Nos arquivos",
  placeholder: "Buscar nos arquivos...",
  prompt: "Digite para buscar no texto dos arquivos deste projeto",
  searching: "Buscando nos arquivos...",
  results: "Resultados",
  truncated: "Primeiros {{count}} resultados",
  unsupported: "O daemon deste host ainda não tem esta busca. Reinicie ou atualize o daemon.",
};

export const CONTENT_SEARCH_ES: ContentSearchStrings = {
  shortcutLabel: "Buscar en archivos",
  scope: "En archivos",
  placeholder: "Buscar en archivos...",
  prompt: "Escribe para buscar en el texto de los archivos de este proyecto",
  searching: "Buscando en archivos...",
  results: "Resultados",
  truncated: "Primeros {{count}} resultados",
  unsupported:
    "El daemon de este host aún no admite esta búsqueda. Reinicia o actualiza el daemon.",
};

export const CONTENT_SEARCH_FR: ContentSearchStrings = {
  shortcutLabel: "Rechercher dans les fichiers",
  scope: "Dans les fichiers",
  placeholder: "Rechercher dans les fichiers...",
  prompt: "Saisissez du texte à chercher dans les fichiers de ce projet",
  searching: "Recherche dans les fichiers...",
  results: "Résultats",
  truncated: "{{count}} premiers résultats",
  unsupported:
    "Le daemon de cet hôte ne prend pas encore en charge cette recherche. Redémarrez ou mettez à jour le daemon.",
};

export const CONTENT_SEARCH_JA: ContentSearchStrings = {
  shortcutLabel: "ファイル内を検索",
  scope: "ファイル内",
  placeholder: "ファイル内を検索...",
  prompt: "このプロジェクトのファイル内のテキストを検索するには入力してください",
  searching: "ファイル内を検索中...",
  results: "結果",
  truncated: "最初の {{count}} 件の結果",
  unsupported:
    "このホストのデーモンはこの検索にまだ対応していません。デーモンを再起動または更新してください。",
};

export const CONTENT_SEARCH_KO: ContentSearchStrings = {
  shortcutLabel: "파일 내용 검색",
  scope: "파일 내용",
  placeholder: "파일 내용 검색...",
  prompt: "이 프로젝트 파일의 텍스트를 검색하려면 입력하세요",
  searching: "파일 내용 검색 중...",
  results: "결과",
  truncated: "처음 {{count}}개 결과",
  unsupported:
    "이 호스트의 데몬은 아직 이 검색을 지원하지 않습니다. 데몬을 다시 시작하거나 업데이트하세요.",
};

export const CONTENT_SEARCH_RU: ContentSearchStrings = {
  shortcutLabel: "Поиск в файлах",
  scope: "В файлах",
  placeholder: "Поиск в файлах...",
  prompt: "Введите текст для поиска в файлах этого проекта",
  searching: "Поиск в файлах...",
  results: "Результаты",
  truncated: "Первые результаты: {{count}}",
  unsupported:
    "Демон этого хоста пока не поддерживает такой поиск. Перезапустите или обновите демон.",
};

export const CONTENT_SEARCH_AR: ContentSearchStrings = {
  shortcutLabel: "البحث في الملفات",
  scope: "في الملفات",
  placeholder: "البحث في الملفات...",
  prompt: "اكتب للبحث في نص ملفات هذا المشروع",
  searching: "جارٍ البحث في الملفات...",
  results: "النتائج",
  truncated: "أول {{count}} من النتائج",
  unsupported: "لا يدعم خادم هذا المضيف هذا البحث بعد. أعد تشغيل الخادم أو حدّثه.",
};

export const CONTENT_SEARCH_ZH_CN: ContentSearchStrings = {
  shortcutLabel: "在文件中搜索",
  scope: "文件内容",
  placeholder: "在文件中搜索...",
  prompt: "输入内容以搜索此项目文件中的文本",
  searching: "正在文件中搜索...",
  results: "结果",
  truncated: "前 {{count}} 条结果",
  unsupported: "此主机的守护进程尚不支持此搜索。请重启或更新守护进程。",
};
