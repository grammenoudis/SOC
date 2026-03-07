export type Status = "healthy" | "warning" | "critical";

export interface Company {
  id: string;
  name: string;
  workspaces: number;
  status: Status;
  alerts: number;
}

export interface Workspace {
  id: string;
  companyId: string;
  name: string;
  status: Status;
  alerts: number;
  logsToday: number;
  autoResponseEnabled: boolean;
}

export const mockCompanies: Company[] = [
  { id: "1", name: "Acme Corp", workspaces: 3, status: "healthy", alerts: 0 },
  { id: "2", name: "TechStart Inc", workspaces: 1, status: "warning", alerts: 2 },
  { id: "3", name: "Global Finance Ltd", workspaces: 4, status: "critical", alerts: 7 },
  { id: "4", name: "MedSecure Health", workspaces: 2, status: "critical", alerts: 12 },
  { id: "5", name: "Retail Solutions", workspaces: 1, status: "healthy", alerts: 0 },
  { id: "6", name: "DataFlow Systems", workspaces: 2, status: "warning", alerts: 1 },
];

export const mockWorkspaces: Workspace[] = [
  { id: "w1", companyId: "1", name: "Production AWS", status: "healthy", alerts: 0, logsToday: 2340, autoResponseEnabled: false },
  { id: "w2", companyId: "1", name: "Office Network", status: "healthy", alerts: 0, logsToday: 890, autoResponseEnabled: false },
  { id: "w3", companyId: "1", name: "Dev Environment", status: "healthy", alerts: 0, logsToday: 412, autoResponseEnabled: false },
  { id: "w4", companyId: "2", name: "Cloud Infrastructure", status: "warning", alerts: 2, logsToday: 1560, autoResponseEnabled: true },
  { id: "w5", companyId: "3", name: "Trading Platform", status: "critical", alerts: 4, logsToday: 5200, autoResponseEnabled: true },
  { id: "w6", companyId: "3", name: "Customer Portal", status: "warning", alerts: 2, logsToday: 3100, autoResponseEnabled: false },
  { id: "w7", companyId: "3", name: "Internal Network", status: "healthy", alerts: 1, logsToday: 1800, autoResponseEnabled: false },
  { id: "w8", companyId: "3", name: "Backup Systems", status: "healthy", alerts: 0, logsToday: 220, autoResponseEnabled: false },
  { id: "w9", companyId: "4", name: "Patient Database", status: "critical", alerts: 8, logsToday: 4100, autoResponseEnabled: true },
  { id: "w10", companyId: "4", name: "Admin Systems", status: "critical", alerts: 4, logsToday: 2900, autoResponseEnabled: false },
  { id: "w11", companyId: "5", name: "E-Commerce Platform", status: "healthy", alerts: 0, logsToday: 1200, autoResponseEnabled: false },
  { id: "w12", companyId: "6", name: "Data Pipeline", status: "warning", alerts: 1, logsToday: 3400, autoResponseEnabled: true },
  { id: "w13", companyId: "6", name: "Analytics Dashboard", status: "healthy", alerts: 0, logsToday: 780, autoResponseEnabled: false },
];

export const statusStyle: Record<Status, string> = {
  healthy: "text-emerald-400 border-emerald-500/30",
  warning: "text-amber-400 border-amber-500/30",
  critical: "text-red-400 border-red-500/30",
};

export const statusPriority: Record<Status, number> = {
  critical: 0,
  warning: 1,
  healthy: 2,
};
