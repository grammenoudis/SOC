export const SEVERITY_LEVELS = ['info', 'warning', 'error', 'critical'] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];

export const LOG_CATEGORIES = ['auth', 'network', 'system', 'application', 'firewall', 'ids'] as const;
export type LogCategory = (typeof LOG_CATEGORIES)[number];

export const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const AUTO_RESPONSE_STATUSES = ['proposed', 'approved', 'executed', 'rejected'] as const;
export type AutoResponseStatus = (typeof AUTO_RESPONSE_STATUSES)[number];
