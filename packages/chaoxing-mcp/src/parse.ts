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
};

export type ParsedInboxNotice = {
  id: string;
  title: string;
  due_at: string | null;
  courseId: string | null;
  classId: string | null;
  assignmentLike: boolean;
};

const CLOSED_STATUS = /已提交|已完成|已结束|不可作答/;
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
  const itemPattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  for (const match of body.matchAll(itemPattern)) {
    const attrs = parseAttributes(match[1]);
    const classNames = (attrs.class ?? "").split(/\s+/).filter(Boolean);
    if (!classNames.includes("course")) {
      continue;
    }
    const courseId = attrs.courseid?.trim() ?? "";
    const classId = attrs.clazzid?.trim() ?? "";
    const cpi = attrs.personid?.trim() ?? "";
    if (courseId.length === 0 || classId.length === 0) {
      continue;
    }
    const titleMatch = match[2].match(
      /class=["']course-name["'][^>]*>([^<]*)/i,
    );
    courses.push({
      courseId,
      classId,
      cpi,
      title: decodeEntities((titleMatch?.[1] ?? "").trim()),
    });
  }
  return courses;
}

export function parseCourseSpaceTodos(
  html: string,
  course: EnrolledCourse,
): ParsedCourseTodo[] {
  const todos: ParsedCourseTodo[] = [];
  const itemPattern = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  for (const match of html.matchAll(itemPattern)) {
    const attrs = parseAttributes(match[1]);
    const inner = match[2];
    if (attrs.data === undefined && attrs.href === undefined) {
      continue;
    }
    const text = stripTags(inner);
    const title =
      decodeEntities(
        inner.match(/<p\b[^>]*>([^<]*)/i)?.[1]?.trim() ?? "",
      ) || course.title;
    const dueMatch = text.match(
      /截止时间[:：]\s*(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})/,
    );
    const rawUrl = decodeEntities(attrs.data ?? attrs.href ?? "");
    todos.push({
      id:
        readQueryParam(rawUrl, "taskrefId") ??
        readQueryParam(rawUrl, "workId") ??
        title,
      title,
      due_at: toDueAt(dueMatch?.[1] ?? null),
      closed: CLOSED_STATUS.test(text),
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
  const pad = (part: string): string => part.padStart(2, "0");
  return `${match[1]}-${pad(match[2])}-${pad(match[3])}T${pad(match[4])}:${pad(match[5])}:00+08:00`;
}
