const PREFIX = 'hermes-proxy:';

/** Reads a persisted UI preference; falls back when storage is unavailable or the value is invalid. */
export const loadPreference = <T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T => {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
};

export const savePreference = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
};
