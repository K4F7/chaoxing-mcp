export const TRUSTED_LATEST_RELEASE_API =
  "https://api.github.com/repos/K4F7/chaoxing-mcp/releases/latest";
export const TRUSTED_RELEASES_PAGE =
  "https://github.com/K4F7/chaoxing-mcp/releases";

export type UpdateInfo = {
  buildNumber: number;
  releasePage: string;
};

export function parseLatestBuild(tagName: string): number | null {
  const match = /^app-(\d+)-/.exec(tagName);
  if (match == null) {
    return null;
  }
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? value : null;
}

export function updateIfNewer(input: {
  currentBuild: number;
  tagName: string;
}): UpdateInfo | null {
  const latest = parseLatestBuild(input.tagName);
  if (latest == null || latest <= input.currentBuild) {
    return null;
  }
  return { buildNumber: latest, releasePage: TRUSTED_RELEASES_PAGE };
}
