// CUSTOM(factory): the Pipelines tab's words in the three languages the plugin speaks.
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
};

export function pipelineStrings(locale: PageLocale): PipelineStrings {
  return locale === "pt" ? pt : locale === "zh" ? zh : en;
}

export function usePipelineStrings(): PipelineStrings {
  return pipelineStrings(usePaseoLocale());
}
