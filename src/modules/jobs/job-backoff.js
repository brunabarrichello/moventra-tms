export function calculateJobBackoff({
  attempt,
  baseDelayMs = 1000,
  maxDelayMs = 300000,
  jitterRatio = 0.2,
  random = Math.random,
} = {}) {
  const normalizedAttempt = boundedInteger(attempt, 1, 100, 'attempt');
  const base = boundedInteger(baseDelayMs, 100, 3600000, 'baseDelayMs');
  const maximum = boundedInteger(maxDelayMs, base, 86400000, 'maxDelayMs');
  const jitter = Number(jitterRatio);
  if (!Number.isFinite(jitter) || jitter < 0 || jitter > 0.5) {
    throw new TypeError('jitterRatio must be between 0 and 0.5');
  }
  if (typeof random !== 'function') {
    throw new TypeError('random must be a function');
  }
  const randomValue = Number(random());
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new TypeError('random must return a number between 0 and 1');
  }

  const exponential = Math.min(maximum, base * (2 ** Math.min(normalizedAttempt - 1, 30)));
  const jitterMs = Math.floor(exponential * jitter * randomValue);
  return Math.min(maximum, Math.floor(exponential) + jitterMs);
}

function boundedInteger(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}
