const caseLaunchPattern = /^case_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;
const demoLaunchPattern = /^demo_(resident|owner|tenant|chair|dispatcher|executor|authority)$/u;

export function pathFromMaxStartParam(startParam: string | undefined): string | undefined {
  const caseId = startParam?.match(caseLaunchPattern)?.[1];
  if (caseId) return `/cases/${caseId}`;
  const role = startParam?.match(demoLaunchPattern)?.[1];
  return role ? `/demo?role=${role}` : undefined;
}
