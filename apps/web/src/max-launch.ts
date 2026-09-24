const caseLaunchPattern = /^case_([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu;

export function pathFromMaxStartParam(startParam: string | undefined): string | undefined {
  const caseId = startParam?.match(caseLaunchPattern)?.[1];
  return caseId ? `/cases/${caseId}` : undefined;
}
