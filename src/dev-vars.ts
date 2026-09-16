import { access, readFile, writeFile } from "node:fs/promises";

export type DevVars = Record<string, string>;

export async function loadDevVars(filePath = ".dev.vars"): Promise<DevVars> {
  if (!(await fileExists(filePath))) {
    return {};
  }

  return parseDevVars(await readFile(filePath, "utf8"));
}

export function parseDevVars(text: string): DevVars {
  const vars: DevVars = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    vars[key] = unquoteValue(line.slice(separatorIndex + 1).trim());
  }

  return vars;
}

export async function applyDevVars(
  filePath = ".dev.vars",
  options: { overwrite?: boolean } = {},
): Promise<DevVars> {
  const vars = await loadDevVars(filePath);
  for (const [key, value] of Object.entries(vars)) {
    if (options.overwrite || !(key in process.env)) {
      process.env[key] = value;
    }
  }

  return vars;
}

export async function upsertDevVar(
  key: string,
  value: string,
  filePath = ".dev.vars",
): Promise<void> {
  const exists = await fileExists(filePath);
  const originalText = exists ? await readFile(filePath, "utf8") : "";
  const lines = originalText ? originalText.split(/\r?\n/) : [];
  const nextLine = `${key}=${quoteValue(value)}`;
  let updated = false;

  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return line;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return line;
    }

    const lineKey = line.slice(0, separatorIndex).trim();
    if (lineKey !== key) {
      return line;
    }

    updated = true;
    return nextLine;
  });

  if (!updated) {
    if (nextLines.length > 0 && nextLines.at(-1) !== "") {
      nextLines.push("");
    }
    nextLines.push(nextLine);
  }

  await writeFile(filePath, `${nextLines.join("\n").replace(/\n+$/g, "")}\n`);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function unquoteValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function quoteValue(value: string): string {
  return JSON.stringify(value);
}
