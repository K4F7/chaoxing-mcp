export type EnrolledCourse = {
  courseId: string;
  classId: string;
  cpi: string;
  title: string;
};

export type ParsedCourseTodo = {
  id: string;
  title: string;
  due_at: string | null;
  closed: boolean;
  remaining_text: string | null;
  entry_url: string | null;
};

export type ParsedInboxNotice = {
  id: string;
  title: string;
  due_at: string | null;
  courseId: string | null;
  classId: string | null;
  assignmentLike: boolean;
};

const CLOSED_STATUS = /待批阅|已提交|已完成|已批阅|已过期|已结束|不可作答|查看答案/;
const ASSIGNMENT_LIKE = /作业|考试|测验|测试|截止|答题|试卷|练习/;

export function semesterCodeOf(title: string): string | null {
  const match = title.trim().match(/^(\d{3})/);
  return match?.[1] ?? null;
}

export function currentSemesterOf(
  courses: readonly EnrolledCourse[],
): string | null {
  const codes = courses
    .map((course) => semesterCodeOf(course.title))
    .filter((code): code is string => code !== null);
  if (codes.length === 0) {
    return null;
  }
  return codes.reduce((best, code) => (code > best ? code : best));
}

export function parseEnrolledCourses(body: string): EnrolledCourse[] {
  const courses: EnrolledCourse[] = [];
  const openTag = /<li\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = openTag.exec(body)) !== null) {
    const attrs = parseAttributes(match[1]);
    const classNames = (attrs.class ?? "").split(/\s+/).filter(Boolean);
    if (!classNames.includes("course")) {
      continue;
    }
    const courseId = attrs.courseid?.trim() ?? "";
    const classId = attrs.clazzid?.trim() ?? "";
    const cpi = attrs.personid?.trim() ?? "";
    // 教侧 junk often has clazzid=0 and/or empty course name.
    if (courseId.length === 0 || classId.length === 0 || classId === "0") {
      continue;
    }
    const startInner = match.index + match[0].length;
    const closeIndex = findMatchingClose(body, startInner, "li");
    const innerHtml = body.slice(startInner, closeIndex);
    const title = extractCourseTitle(innerHtml);
    if (title.length === 0) {
      continue;
    }
    courses.push({
      courseId,
      classId,
      cpi,
      title,
    });
  }
  return courses;
}

export function parseCourseSpaceTodos(
  html: string,
  course: EnrolledCourse,
  now: Date = new Date(),
): ParsedCourseTodo[] {
  const todos: ParsedCourseTodo[] = [];
  const openTag = /<li\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = openTag.exec(html)) !== null) {
    const attrs = parseAttributes(match[1]);
    if (attrs.data === undefined && attrs.href === undefined) {
      continue;
    }
    const startInner = match.index + match[0].length;
    const closeIndex = findMatchingClose(html, startInner, "li");
    const inner = html.slice(startInner, closeIndex);
    openTag.lastIndex = closeIndex;
    const text = stripTags(inner);
    const title =
      decodeEntities(
        inner.match(/<p\b[^>]*>([^<]*)/i)?.[1]?.trim() ?? "",
      ) || course.title;
    const rawUrl = decodeEntities(attrs.data ?? attrs.href ?? "");
    const imageMarksExpired = /<img\b[^>]*\bsrc=["'][^"']*ks_02[^"']*["']/i.test(
      inner,
    );
    todos.push({
      id:
        readQueryParam(rawUrl, "taskrefId") ??
        readQueryParam(rawUrl, "workId") ??
        title,
      title,
      due_at: parseAbsoluteDueAt(text, now),
      closed: CLOSED_STATUS.test(text) || imageMarksExpired,
      remaining_text: extractRemainingText(text),
      entry_url: rawUrl.length > 0 ? rawUrl : null,
    });
  }
  return todos;
}

export function parseInboxNotices(html: string): ParsedInboxNotice[] {
  const notices: ParsedInboxNotice[] = [];
  const itemPattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  for (const match of html.matchAll(itemPattern)) {
    const attrs = parseAttributes(match[1]);
    const classNames = (attrs.class ?? "").split(/\s+/).filter(Boolean);
    if (!classNames.includes("notice")) {
      continue;
    }
    const inner = match[2];
    const text = stripTags(inner);
    const title =
      decodeEntities(
        inner.match(/<p\b[^>]*>([^<]*)/i)?.[1]?.trim() ?? "",
      ) || text;
    const dueMatch = text.match(
      /截止时间[:：]\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/,
    );
    const rawUrl = decodeEntities(attrs.data ?? attrs.href ?? "");
    const courseId = readQueryParam(rawUrl, "courseId");
    const classId = readQueryParam(rawUrl, "classId");
    notices.push({
      id:
        readQueryParam(rawUrl, "taskrefId") ??
        readQueryParam(rawUrl, "workId") ??
        readQueryParam(rawUrl, "examId") ??
        title,
      title,
      due_at: toDueAt(dueMatch?.[1] ?? null),
      courseId,
      classId,
      assignmentLike: isAssignmentLike(text),
    });
  }
  return notices;
}

function extractCourseTitle(innerHtml: string): string {
  const titleAttrPatterns = [
    /class=["'][^"']*\bcourse-name\b[^"']*["'][^>]*\btitle=["']([^"']*)["']/i,
    /\btitle=["']([^"']*)["'][^>]*class=["'][^"']*\bcourse-name\b[^"']*["']/i,
  ];
  for (const pattern of titleAttrPatterns) {
    const match = innerHtml.match(pattern);
    const fromAttr = decodeEntities((match?.[1] ?? "").trim());
    if (fromAttr.length > 0) {
      return fromAttr;
    }
  }
  const textMatch = innerHtml.match(
    /class=["'][^"']*\bcourse-name\b[^"']*["'][^>]*>([^<]*)/i,
  );
  return decodeEntities((textMatch?.[1] ?? "").trim());
}

function findMatchingClose(html: string, start: number, tag: string): number {
  const open = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let cursor = start;
  while (depth > 0 && cursor < html.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (nextClose === null) {
      return html.length;
    }
    if (
      nextOpen !== null &&
      nextOpen.index < nextClose.index &&
      !nextOpen[0].trimEnd().endsWith("/>")
    ) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      if (depth === 0) {
        return nextClose.index;
      }
      cursor = nextClose.index + nextClose[0].length;
    }
  }
  return html.length;
}

function isAssignmentLike(text: string): boolean {
  if (text.includes("结束提醒")) {
    return false;
  }
  return ASSIGNMENT_LIKE.test(text);
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern =
    /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of raw.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attrs;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function readQueryParam(rawUrl: string, key: string): string | null {
  try {
    const url = new URL(rawUrl, "https://mooc1-api.chaoxing.com");
    const value = url.searchParams.get(key);
    return value != null && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function toDueAt(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const match = value
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
  if (match == null) {
    return null;
  }
  return formatDueAt(
    match[1],
    match[2],
    match[3],
    match[4],
    match[5],
    "00",
  );
}

export function parseWorkDetailDueAt(html: string, now: Date): string | null {
  const aria = html.match(
    /aria-label=["']截止时间(\d{1,2})月(\d{1,2})日(\d{1,2})时(\d{1,2})分(?:(\d{1,2})秒)?["']/,
  );
  if (aria != null) {
    return dueAtWithoutYear(
      aria[1],
      aria[2],
      aria[3],
      aria[4],
      aria[5] ?? "00",
      now,
    );
  }
  const text = stripTags(html);
  return parseAbsoluteDueAt(text, now);
}

function parseAbsoluteDueAt(text: string, now: Date): string | null {
  const withYear = text.match(
    /截止时间[:：]\s*(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (withYear != null) {
    return formatDueAt(
      withYear[1],
      withYear[2],
      withYear[3],
      withYear[4],
      withYear[5],
      withYear[6] ?? "00",
    );
  }
  const withoutYear = text.match(
    /截止时间[:：]\s*(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (withoutYear == null) {
    return null;
  }
  return dueAtWithoutYear(
    withoutYear[1],
    withoutYear[2],
    withoutYear[3],
    withoutYear[4],
    withoutYear[5] ?? "00",
    now,
  );
}

function dueAtWithoutYear(
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
  now: Date,
): string {
  const year = yearNotBeforeNow(
    Number.parseInt(month, 10),
    Number.parseInt(day, 10),
    Number.parseInt(hour, 10),
    Number.parseInt(minute, 10),
    Number.parseInt(second, 10),
    now,
  );
  return formatDueAt(String(year), month, day, hour, minute, second);
}

function formatDueAt(
  year: string,
  month: string,
  day: string,
  hour: string,
  minute: string,
  second: string,
): string {
  const pad = (part: string): string => part.padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+08:00`;
}

function yearNotBeforeNow(
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  now: Date,
): number {
  const nowInPlus8 = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = nowInPlus8.getUTCFullYear();
  const candidate = Date.parse(
    formatDueAt(
      String(year),
      String(month),
      String(day),
      String(hour),
      String(minute),
      String(second),
    ),
  );
  return candidate >= now.getTime() ? year : year + 1;
}

const REMAINING_PATTERN =
  /剩余(?:(\d+)\s*天)?(?:(\d+)\s*小时)?(?:(\d+)\s*分钟)?/;

export function dueAtFromRemaining(text: string, now: Date): string | null {
  const match = text.match(REMAINING_PATTERN);
  if (match == null) {
    return null;
  }
  const days = match[1] == null ? 0 : Number.parseInt(match[1], 10);
  const hours = match[2] == null ? 0 : Number.parseInt(match[2], 10);
  const minutes = match[3] == null ? 0 : Number.parseInt(match[3], 10);
  if (days === 0 && hours === 0 && minutes === 0) {
    return null;
  }
  const due = new Date(
    now.getTime() +
      days * 24 * 60 * 60 * 1000 +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000,
  );
  return toIsoPlus8(due);
}

function extractRemainingText(text: string): string | null {
  const match = text.match(REMAINING_PATTERN);
  if (match == null || (match[1] == null && match[2] == null && match[3] == null)) {
    return null;
  }
  return match[0];
}

function toIsoPlus8(value: Date): string {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}+08:00`;
}

const MAX_SUMMARY_CHARS = 1500;
const DO_HOMEWORK_URL =
  /(?:https:\/\/[a-z0-9.-]+)?\/(?:mooc-ans\/)?work\/phone\/doHomeWork\?[^\s"'<>]*/gi;

export type HomeworkPrompt = {
  summary: string | null;
  kind: string | null;
};

export function extractDoHomeworkUrls(html: string): string[] {
  const normalized = html.replaceAll("\\/", "/");
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of normalized.matchAll(DO_HOMEWORK_URL)) {
    const raw = decodeEntities(match[0]).replace(/[.,;]+$/, "");
    if (raw.length === 0 || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    found.push(raw);
  }
  return found;
}

export function parseHomeworkPrompt(html: string): HomeworkPrompt {
  return {
    summary: parseWorkWrapSummary(html),
    kind: parseTitType(html),
  };
}

function parseTitType(html: string): string | null {
  const match = html.match(
    /<[^>]*\bclass=["'][^"']*\btitType\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  );
  const text = stripTags(match?.[1] ?? "");
  if (text.length === 0) {
    return null;
  }
  const kind = text.replace(/^\d+\s*[.、．]\s*/, "");
  return kind.length > 0 ? kind : text;
}

function parseWorkWrapSummary(html: string): string | null {
  const open = html.match(
    /<([a-zA-Z][\w:-]*)\b[^>]*\bclass=["'][^"']*\bworkWrap\b[^"']*["'][^>]*>/i,
  );
  if (open == null || open.index === undefined) {
    return null;
  }
  const startInner = open.index + open[0].length;
  const closeIndex = findMatchingClose(html, startInner, open[1]);
  return truncateSummary(stripTags(html.slice(startInner, closeIndex)));
}

function truncateSummary(text: string): string | null {
  if (text.length === 0) {
    return null;
  }
  return text.length > MAX_SUMMARY_CHARS
    ? text.slice(0, MAX_SUMMARY_CHARS)
    : text;
}
