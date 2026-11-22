// CUSTOM(factory): the Pipelines tab's words in the three languages the plugin speaks.
import type { UserOnlyReason } from "../shared/autonomy";
import { usePaseoLocale, type PageLocale } from "./paseo-language";

export interface PipelineStrings {
  tab: string;
  project: string;
  builtinNote: string;
  start: string;
  gate: string;
  fresh: string;
  role: string;
  worker: string;
  session: string;
  sessionContinue: string;
  sessionFresh: string;
  maxVisits: string;
  procedure: string;
  procedurePrompt: string;
  procedureFile: string;
  gateQuestion: string;
  options: string;
  transitions: string;
  noWorker: string;
  projectManager: string;
  implementFallback: string;
  builtinStages: { deliver: string; end: string; cancel: string };
  selectStage: string;
  tasks: string;
  tasksRunning: string;
  tasksWaiting: string;
  waitingBadge: string;
  noTasks: string;
  openTicket: string;
  loading: string;
  loadFailed: string;
  noProjects: string;
  /** Autonomy comboboxes (ticket 14). `{preset}` is the inherited preset's label. */
  pipelineAutonomy: string;
  projectAutonomy: string;
  inherit: string;
  /** `{reasons}`: the preset's userDecides, joined by "; ". */
  autonomyUser: string;
  breakerOn: string;
  breakerOff: string;
  reasons: Record<UserOnlyReason, string>;
  /** The editor (ticket 14). */
  addStage: string;
  save: string;
  discard: string;
  unsaved: string;
  problems: string;
  stageId: string;
  idInvalid: string;
  idBuiltin: string;
  idTaken: string;
  setStart: string;
  workerAuto: string;
  procedureDefault: string;
  gateOn: string;
  optionId: string;
  optionLabel: string;
  optionTo: string;
  addOption: string;
  remove: string;
  transitionsNone: string;
  transitionsOne: string;
  transitionsMany: string;
  nextStage: string;
  when: string;
  addCondition: string;
  connectTo: string;
  targets: string;
  deleteStage: string;
  confirmDelete: string;
  saving: string;
}

const en: PipelineStrings = {
  tab: "Pipelines",
  project: "Project",
  builtinNote: "Built-in pipeline, the factory is off; read only.",
  start: "start",
  gate: "gate",
  fresh: "fresh",
  role: "Role",
  worker: "Worker",
  session: "Session",
  sessionContinue: "continue",
  sessionFresh: "fresh",
  maxVisits: "Max visits",
  procedure: "Procedure",
  procedurePrompt: "prompt",
  procedureFile: "file",
  gateQuestion: "Gate question",
  options: "Options",
  transitions: "Transitions",
  noWorker: "no worker",
  projectManager: "Project Manager",
  implementFallback: "(as implement)",
  builtinStages: {
    deliver: "Runs the project's delivery.",
    end: "Done with no delivery.",
    cancel: "Cancels the task.",
  },
  selectStage: "Select a stage",
  tasks: "Tasks",
  tasksRunning: "In this stage",
  tasksWaiting: "Waiting for a decision",
  waitingBadge: "waiting",
  noTasks: "No tasks in this stage.",
  openTicket: "Opens the ticket beside the board",
  loading: "Loading pipelines...",
  loadFailed: "Could not load the pipelines.",
  noProjects: "No projects on the board.",
  pipelineAutonomy: "Pipeline autonomy",
  projectAutonomy: "Project autonomy",
  inherit: "Inherit ({preset})",
  autonomyUser: "The user decides: {reasons}.",
  breakerOn: "Breaker: {minutes} min.",
  breakerOff: "Breaker: off.",
  reasons: {
    "fresh-agent": "the merge ok of a critical project",
    merge: "the ok for every merge",
    "data-migration": "every migration of live data",
    product: "product decisions",
    irreversible: "actions with no backup and no revert",
  },
  addStage: "Add stage",
  save: "Save",
  discard: "Discard",
  unsaved: "Unsaved changes",
  problems: "{count} problem(s), fix them to save",
  stageId: "Id",
  idInvalid: "Use lowercase letters, digits and dashes.",
  idBuiltin: "That name is a built-in stage.",
  idTaken: "Another stage already uses that id.",
  setStart: "Set as start",
  workerAuto: "auto (by role)",
  procedureDefault: "default",
  gateOn: "Ask the user after this stage",
  optionId: "Option id",
  optionLabel: "Label",
  optionTo: "Leads to",
  addOption: "Add option",
  remove: "Remove",
  transitionsNone: "none",
  transitionsOne: "one next stage",
  transitionsMany: "conditions (the PM chooses)",
  nextStage: "Next stage",
  when: "When",
  addCondition: "Add condition",
  connectTo: "Connect to...",
  targets: "Leads to",
  deleteStage: "Delete stage",
  confirmDelete: "Confirm delete",
  saving: "Saving...",
};

const pt: PipelineStrings = {
  tab: "Pipelines",
  project: "Projeto",
  builtinNote: "Pipeline embutido, a fábrica está desligada; somente leitura.",
  start: "início",
  gate: "gate",
  fresh: "nova",
  role: "Papel",
  worker: "Worker",
  session: "Sessão",
  sessionContinue: "continuar",
  sessionFresh: "nova",
  maxVisits: "Máx. de visitas",
  procedure: "Procedimento",
  procedurePrompt: "prompt",
  procedureFile: "arquivo",
  gateQuestion: "Pergunta do gate",
  options: "Opções",
  transitions: "Transições",
  noWorker: "sem worker",
  projectManager: "Project Manager",
  implementFallback: "(como implement)",
  builtinStages: {
    deliver: "Executa a entrega do projeto.",
    end: "Concluída, sem entrega.",
    cancel: "Cancela a tarefa.",
  },
  selectStage: "Selecione uma etapa",
  tasks: "Tarefas",
  tasksRunning: "Nesta etapa",
  tasksWaiting: "Aguardando decisão",
  waitingBadge: "aguardando",
  noTasks: "Nenhuma tarefa nesta etapa.",
  openTicket: "Abre o ticket ao lado do quadro",
  loading: "Carregando pipelines...",
  loadFailed: "Não foi possível carregar os pipelines.",
  noProjects: "Nenhum projeto no quadro.",
  pipelineAutonomy: "Autonomia do pipeline",
  projectAutonomy: "Autonomia do projeto",
  inherit: "Herdar ({preset})",
  autonomyUser: "O usuário decide: {reasons}.",
  breakerOn: "Disjuntor: {minutes} min.",
  breakerOff: "Disjuntor: desligado.",
  reasons: {
    "fresh-agent": "o ok do merge de projeto crítico",
    merge: "o ok de todo merge",
    "data-migration": "toda migração de dados vivos",
    product: "decisões de produto",
    irreversible: "ações sem backup e sem volta",
  },
  addStage: "Adicionar etapa",
  save: "Salvar",
  discard: "Descartar",
  unsaved: "Alterações não salvas",
  problems: "{count} problema(s), corrija para salvar",
  stageId: "Id",
  idInvalid: "Use letras minúsculas, números e hífens.",
  idBuiltin: "Esse nome é de uma etapa embutida.",
  idTaken: "Outra etapa já usa esse id.",
  setStart: "Definir como início",
  workerAuto: "auto (pelo papel)",
  procedureDefault: "padrão",
  gateOn: "Perguntar ao usuário depois desta etapa",
  optionId: "Id da opção",
  optionLabel: "Rótulo",
  optionTo: "Leva a",
  addOption: "Adicionar opção",
  remove: "Remover",
  transitionsNone: "nenhuma",
  transitionsOne: "uma próxima etapa",
  transitionsMany: "condições (o PM escolhe)",
  nextStage: "Próxima etapa",
  when: "Quando",
  addCondition: "Adicionar condição",
  connectTo: "Conectar a...",
  targets: "Leva a",
  deleteStage: "Excluir etapa",
  confirmDelete: "Confirmar exclusão",
  saving: "Salvando...",
};

const zh: PipelineStrings = {
  tab: "流水线",
  project: "项目",
  builtinNote: "内置流水线,工厂未启用;只读。",
  start: "起点",
  gate: "关卡",
  fresh: "新会话",
  role: "角色",
  worker: "Worker",
  session: "会话",
  sessionContinue: "继续",
  sessionFresh: "新会话",
  maxVisits: "最大访问次数",
  procedure: "流程",
  procedurePrompt: "提示词",
  procedureFile: "文件",
  gateQuestion: "关卡问题",
  options: "选项",
  transitions: "流转",
  noWorker: "无 worker",
  projectManager: "Project Manager",
  implementFallback: "(按 implement)",
  builtinStages: {
    deliver: "执行项目的交付。",
    end: "完成,不交付。",
    cancel: "取消任务。",
  },
  selectStage: "选择一个阶段",
  tasks: "任务",
  tasksRunning: "在此阶段",
  tasksWaiting: "等待决定",
  waitingBadge: "等待",
  noTasks: "此阶段没有任务。",
  openTicket: "在看板旁打开工单",
  loading: "正在加载流水线...",
  loadFailed: "无法加载流水线。",
  noProjects: "看板上没有项目。",
  pipelineAutonomy: "流水线自主度",
  projectAutonomy: "项目自主度",
  inherit: "继承（{preset}）",
  autonomyUser: "由用户决定：{reasons}。",
  breakerOn: "断路器：{minutes} 分钟。",
  breakerOff: "断路器：关闭。",
  reasons: {
    "fresh-agent": "关键项目合并前的确认",
    merge: "每次合并前的确认",
    "data-migration": "每次在线数据迁移",
    product: "产品决策",
    irreversible: "没有备份也无法撤回的操作",
  },
  addStage: "添加阶段",
  save: "保存",
  discard: "放弃",
  unsaved: "有未保存的更改",
  problems: "{count} 个问题,修复后才能保存",
  stageId: "ID",
  idInvalid: "请使用小写字母、数字和连字符。",
  idBuiltin: "该名称是内置阶段。",
  idTaken: "已有其他阶段使用该 ID。",
  setStart: "设为起点",
  workerAuto: "自动(按角色)",
  procedureDefault: "默认",
  gateOn: "此阶段后询问用户",
  optionId: "选项 ID",
  optionLabel: "标签",
  optionTo: "前往",
  addOption: "添加选项",
  remove: "移除",
  transitionsNone: "无",
  transitionsOne: "单个下一阶段",
  transitionsMany: "条件(由 PM 选择)",
  nextStage: "下一阶段",
  when: "条件",
  addCondition: "添加条件",
  connectTo: "连接到...",
  targets: "前往",
  deleteStage: "删除阶段",
  confirmDelete: "确认删除",
  saving: "正在保存...",
};

export function pipelineStrings(locale: PageLocale): PipelineStrings {
  return locale === "pt" ? pt : locale === "zh" ? zh : en;
}

export function usePipelineStrings(): PipelineStrings {
  return pipelineStrings(usePaseoLocale());
}
