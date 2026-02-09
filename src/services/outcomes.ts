export function normalizeOutcome(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchOutcomeExact(outcomes: string[], target: string): string | null {
  const normalizedTarget = normalizeOutcome(target);
  for (const outcome of outcomes) {
    if (normalizeOutcome(outcome) === normalizedTarget) {
      return outcome;
    }
  }
  return null;
}

export function matchOutcomeByName(outcomes: string[], name: string): string | null {
  const normalizedName = normalizeOutcome(name);
  for (const outcome of outcomes) {
    if (normalizeOutcome(outcome) === normalizedName) {
      return outcome;
    }
  }
  for (const outcome of outcomes) {
    const normalizedOutcome = normalizeOutcome(outcome);
    if (
      normalizedOutcome.includes(normalizedName) ||
      normalizedName.includes(normalizedOutcome)
    ) {
      return outcome;
    }
  }
  return null;
}

export function findOddsOutcome<T extends { name: string }>(
  outcomes: T[],
  target: string
): T | null {
  const normalizedTarget = normalizeOutcome(target);
  return (
    outcomes.find(
      (outcome) => normalizeOutcome(outcome.name) === normalizedTarget
    ) ?? null
  );
}
