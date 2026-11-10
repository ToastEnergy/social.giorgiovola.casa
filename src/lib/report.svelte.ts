// the report dialog is a single overlay mounted in the root layout
export type ReportTarget =
	| { kind: 'post'; id: number; username: string }
	| { kind: 'profile'; username: string };

export const report = $state<{ target: ReportTarget | null }>({ target: null });

export const openReport = (target: ReportTarget) => {
	report.target = target;
};

export const closeReport = () => {
	report.target = null;
};
