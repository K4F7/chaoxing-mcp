/** Pure HTML parsers and draft-save form builders for phone doHomeWork pages. */

export const HOMEWORK_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: "单选题",
  1: "多选题",
  2: "填空题",
  3: "判断题",
  4: "简答题",
  7: "计算题",
  8: "其它",
  9: "填空题",
  10: "填空题",
  11: "简答题",
  14: "匹配题",
  15: "填空题",
  16: "填空题",
  19: "填空题",
  21: "多选题",
};

/** Question types that need photo/rich-text upload; draft text save is rejected by default. */
export const RICH_TEXT_TYPES = new Set([4, 7]);

/** Types we can draft-save as blanks or choices without rich text. */
export const SAVEABLE_TYPES = new Set([0, 1, 2, 3, 9, 10, 14, 15, 16, 19, 21]);

export type HomeworkBlank = {
  slot: string;
  name: string;
  current: string;
};

export type HomeworkChoiceOption = {
  value: string;
  checked: boolean;
  name: string;
};

export type ParsedHomeworkQuestion = {
  index: number;
  question_id: string;
  type: number;
  type_label: string;
  title: string;
  stem_text: string | null;
  stem_image_urls: string[];
  blanks: HomeworkBlank[];
  choice_options: HomeworkChoiceOption[];
  current_answer: string | null;
  supports_save: boolean;
};

export type AnswerSheetEntry = {
  index: number;
  display_number: string;
  type_label: string;
};

export type DraftAnswerInput = {
  blanks?: string[];
  choice?: string;
  choices?: string[];
  rich_text?: string;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function readNamedValue(html: string, name: string): string | null {
  const patterns = [
    new RegExp(
      `<input\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*\\bvalue=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<input\\b[^>]*\\bvalue=["']([^"']*)["'][^>]*\\bname=["']${escapeRegExp(name)}["']`,
      "i",
    ),
    new RegExp(
      `<textarea\\b[^>]*\\bname=["']${escapeRegExp(name)}["'][^>]*>([\\s\\S]*?)<\\/textarea>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] !== undefined) {
      return decodeEntities(match[1]);
    }
  }
  return null;
}

function readIdValue(html: string, id: string): string | null {
  const patterns = [
    new RegExp(
      `<input\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*\\bvalue=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<input\\b[^>]*\\bvalue=["']([^"']*)["'][^>]*\\bid=["']${escapeRegExp(id)}["']`,
      "i",
    ),
    new RegExp(
      `<textarea\\b[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/textarea>`,
      "i",
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1] !== undefined) {
      return decodeEntities(match[1]);
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function extractSubmitTestInner(html: string): string | null {
  const open = html.match(/<form\b[^>]*\bid=["']submitTest["'][^>]*>/i);
  if (open == null || open.index === undefined) {
    return null;
  }
  const startInner = open.index + open[0].length;
  const closeIndex = findMatchingClose(html, startInner, "form");
  return html.slice(startInner, closeIndex);
}

function applyNamedField(
  fields: Record<string, string>,
  attrs: string,
  body: string | undefined,
): void {
  const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
  if (nameMatch == null) {
    return;
  }
  const name = decodeEntities(nameMatch[1]);
  if (name.length === 0) {
    return;
  }
  const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
  const type = (typeMatch?.[1] ?? "text").toLowerCase();
  if (type === "radio" || type === "checkbox") {
    if (!/\bchecked\b/i.test(attrs)) {
      return;
    }
  }
  const valueAttr = attrs.match(/\bvalue=["']([^"']*)["']/i);
  const value =
    valueAttr != null
      ? decodeEntities(valueAttr[1])
      : decodeEntities(body ?? "");
  if (name in fields && (type === "checkbox" || name.startsWith("answers"))) {
    fields[name] = `${fields[name]},${value}`;
  } else {
    fields[name] = value;
  }
}

export function parseSubmitTestFields(html: string): Record<string, string> {
  const inner = extractSubmitTestInner(html) ?? html;
  const fields: Record<string, string> = {};
  // Parse <input> and <textarea> separately so an early <input> never
  // consumes bytes until a later </textarea> (greedy optional group bug).
  for (const match of inner.matchAll(/<input\b([^>]*)\/?>/gi)) {
    applyNamedField(fields, match[1], undefined);
  }
  for (const match of inner.matchAll(
    /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi,
  )) {
    applyNamedField(fields, match[1], match[2]);
  }
  return fields;
}

function parseTitType(html: string): string {
  const match = html.match(
    /<[^>]*\bclass=["'][^"']*\btitType\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  );
  if (match != null) {
    return stripTags(match[1]);
  }
  const aria = html.match(
    /<(?:span|div)\b[^>]*\baria-label=["']([^"']+)["'][^>]*>/i,
  );
  return aria?.[1] != null ? decodeEntities(aria[1]).trim() : "";
}

function parseStem(html: string): { text: string | null; imageUrls: string[] } {
  const open = html.match(
    /<([a-zA-Z][\w:-]*)\b[^>]*\bclass=["'][^"']*\bworkWrap\b[^"']*["'][^>]*>/i,
  );
  if (open == null || open.index === undefined) {
    return { text: null, imageUrls: [] };
  }
  const startInner = open.index + open[0].length;
  const closeIndex = findMatchingClose(html, startInner, open[1]);
  const inner = html.slice(startInner, closeIndex);
  const imageUrls: string[] = [];
  const seen = new Set<string>();
  for (const img of inner.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const src = decodeEntities(img[1]).trim();
    if (src.length === 0 || seen.has(src)) {
      continue;
    }
    if (/noimg|add\.png|photo\.png|voice\.png|prev_|next_/i.test(src)) {
      continue;
    }
    seen.add(src);
    imageUrls.push(src);
  }
  const text = stripTags(inner);
  return { text: text.length > 0 ? text : null, imageUrls };
}

function parseQuestionType(html: string, questionId: string): number {
  const typed = readNamedValue(html, `type${questionId}`);
  if (typed != null && /^\d+$/.test(typed)) {
    return Number.parseInt(typed, 10);
  }
  const dataType = readIdValue(html, "questionDataType");
  if (dataType != null && /^\d+$/.test(dataType)) {
    return Number.parseInt(dataType, 10);
  }
  return -1;
}

function parseType2Blanks(html: string, questionId: string): HomeworkBlank[] {
  const blankNum =
    readIdValue(html, `blankNum${questionId}`) ??
    readNamedValue(html, `blankNum${questionId}`) ??
    "";
  const slots = blankNum
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (slots.length === 0) {
    // Fall back to any answer{qid}{slot} fields.
    const found: HomeworkBlank[] = [];
    const pattern = new RegExp(
      `\\b(?:name|id)=["']answer${escapeRegExp(questionId)}(\\d+)["']`,
      "gi",
    );
    const seen = new Set<string>();
    for (const match of html.matchAll(pattern)) {
      const slot = match[1];
      if (seen.has(slot)) {
        continue;
      }
      seen.add(slot);
      const name = `answer${questionId}${slot}`;
      found.push({
        slot,
        name,
        current: readNamedValue(html, name) ?? readIdValue(html, name) ?? "",
      });
    }
    return found;
  }
  return slots.map((slot) => {
    const name = `answer${questionId}${slot}`;
    return {
      slot,
      name,
      current: readNamedValue(html, name) ?? readIdValue(html, name) ?? "",
    };
  });
}

function parseType15Blanks(html: string, questionId: string): HomeworkBlank[] {
  const blanks: HomeworkBlank[] = [];
  const blankNamePattern = new RegExp(
    `\\bid=["']blankName${escapeRegExp(questionId)}([^"']+)["'][^>]*\\bvalue=["']([^"']*)["']`,
    "gi",
  );
  for (const match of html.matchAll(blankNamePattern)) {
    const itemId = match[1];
    const slots = match[2]
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    for (const slot of slots) {
      const name = `my-content${itemId}-${slot}`;
      blanks.push({
        slot: `${itemId}-${slot}`,
        name,
        current: readIdValue(html, name) ?? "",
      });
    }
  }
  if (blanks.length > 0) {
    return blanks;
  }
  // Fallback: discover my-content* textareas.
  for (const match of html.matchAll(
    /<(?:textarea|input)\b[^>]*\bid=["'](my-content[^"']+)["'][^>]*>/gi,
  )) {
    const name = match[1];
    blanks.push({
      slot: name.replace(/^my-content/, ""),
      name,
      current: readIdValue(html, name) ?? "",
    });
  }
  return blanks;
}

function parseChoiceOptions(html: string, questionId: string): {
  options: HomeworkChoiceOption[];
  current: string | null;
} {
  const options: HomeworkChoiceOption[] = [];
  const inputPattern =
    /<input\b([^>]*\btype=["'](?:radio|checkbox)["'][^>]*)>/gi;
  for (const match of html.matchAll(inputPattern)) {
    const attrs = match[1];
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    const valueMatch = attrs.match(/\bvalue=["']([^"']*)["']/i);
    if (nameMatch == null || valueMatch == null) {
      continue;
    }
    const name = decodeEntities(nameMatch[1]);
    if (questionId.length > 0) {
      const allowed =
        name === `answer${questionId}` || name === `answers${questionId}`;
      if (!allowed) {
        continue;
      }
    }
    options.push({
      name,
      value: decodeEntities(valueMatch[1]),
      checked: /\bchecked\b/i.test(attrs),
    });
  }
  const checked = options.filter((option) => option.checked).map((o) => o.value);
  return {
    options,
    current: checked.length === 0 ? null : checked.join(","),
  };
}

export function typeLabelOf(type: number, titleHint?: string): string {
  if (titleHint != null && titleHint.length > 0) {
    const cleaned = titleHint.replace(/^\d+\s*[.、．]\s*/, "").trim();
    if (cleaned.length > 0) {
      return cleaned;
    }
  }
  return HOMEWORK_TYPE_LABELS[type] ?? `题型${type}`;
}

export function supportsSaveForType(type: number): boolean {
  if (RICH_TEXT_TYPES.has(type)) {
    return false;
  }
  if (SAVEABLE_TYPES.has(type)) {
    return true;
  }
  // Unknown but not rich-text: allow if blanks/choices exist; callers set after parse.
  return false;
}

export function parseHomeworkQuestionPage(html: string): ParsedHomeworkQuestion {
  const questionId =
    readIdValue(html, "questionId") ?? readNamedValue(html, "questionId") ?? "";
  const indexRaw =
    readIdValue(html, "index") ?? readNamedValue(html, "index") ?? "0";
  const index = Number.parseInt(indexRaw, 10);
  const type = parseQuestionType(html, questionId);
  const title = parseTitType(html);
  const stem = parseStem(html);
  const blanks =
    type === 15 || type === 16 || type === 19
      ? parseType15Blanks(html, questionId)
      : type === 2 || type === 9 || type === 10
        ? parseType2Blanks(html, questionId)
        : parseType2Blanks(html, questionId).length > 0
          ? parseType2Blanks(html, questionId)
          : parseType15Blanks(html, questionId);
  const choice = parseChoiceOptions(html, questionId);
  let currentAnswer = choice.current;
  if (currentAnswer == null && blanks.length > 0) {
    const filled = blanks.map((blank) => blank.current).filter((v) => v.length > 0);
    currentAnswer = filled.length > 0 ? filled.join("\n") : null;
  }
  if (currentAnswer == null) {
    const editor =
      readIdValue(html, "answerEditor") ??
      readNamedValue(html, `answer${questionId}`);
    if (editor != null && editor.trim().length > 0) {
      currentAnswer = editor;
    }
  }
  const supportsSave =
    !RICH_TEXT_TYPES.has(type) &&
    (SAVEABLE_TYPES.has(type) ||
      blanks.length > 0 ||
      choice.options.length > 0);

  return {
    index: Number.isFinite(index) ? index : 0,
    question_id: questionId,
    type,
    type_label: typeLabelOf(type, title),
    title,
    stem_text: stem.text,
    stem_image_urls: stem.imageUrls,
    blanks,
    choice_options: choice.options,
    current_answer: currentAnswer,
    supports_save: supportsSave,
  };
}

export function parseAnswerSheet(html: string): AnswerSheetEntry[] {
  const entries: AnswerSheetEntry[] = [];
  const blocks = html.split(/<p\b[^>]*\bclass=["'][^"']*\btimu\b[^"']*["'][^>]*>/i);
  // First chunk is preamble; subsequent start with label text.
  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i] ?? "";
    const labelEnd = block.indexOf("</p>");
    const typeLabel =
      labelEnd >= 0 ? stripTags(block.slice(0, labelEnd)) : stripTags(block.slice(0, 40));
    const spanPattern =
      /<span\b([^>]*\bclass=["'][^"']*\bcircleItem\b[^"']*["'][^>]*)>([\s\S]*?)<\/span>/gi;
    for (const match of block.matchAll(spanPattern)) {
      const attrs = match[1];
      const dataMatch = attrs.match(/\bdata=["']([^"']+)["']/i);
      const index = Number.parseInt(dataMatch?.[1] ?? "", 10);
      if (!Number.isFinite(index)) {
        continue;
      }
      entries.push({
        index,
        display_number: stripTags(match[2]),
        type_label: typeLabel,
      });
    }
  }
  return entries;
}

function mergeSessionIntoDraftForm(
  fields: Record<string, string>,
  html: string,
): void {
  const session = parseHomeworkSession(html);
  const gaps: Array<[string, string]> = [
    ["enc", session.enc],
    ["encWork", session.encWork],
    ["courseId", session.courseId],
    ["classId", session.classId],
    ["workRelationId", session.workRelationId],
    ["workRelationAnswerId", session.workRelationAnswerId],
    ["answerId", session.answerId],
    ["cpi", session.cpi],
    ["currentCpi", session.cpi],
    ["knowledgeid", session.knowledgeid],
  ];
  for (const [key, value] of gaps) {
    if (value.length === 0) {
      continue;
    }
    const existing = fields[key];
    if (existing == null || existing.length === 0) {
      fields[key] = value;
    }
  }
}

export function buildDraftSaveForm(
  html: string,
  answer: DraftAnswerInput,
): Record<string, string> {
  const fields = parseSubmitTestFields(html);
  // Always draft-only. Refuse any path that would submit.
  fields.tempSave = "true";

  const questionId =
    fields.questionId ??
    readIdValue(html, "questionId") ??
    readNamedValue(html, "questionId") ??
    "";
  if (questionId.length > 0 && fields.questionId == null) {
    fields.questionId = questionId;
  }

  // Belt-and-suspenders: some live pages expose session fields by id only.
  mergeSessionIntoDraftForm(fields, html);

  const parsed = parseHomeworkQuestionPage(html);

  if (answer.blanks != null && answer.blanks.length > 0) {
    if (parsed.blanks.length > 0) {
      for (let i = 0; i < parsed.blanks.length; i += 1) {
        const blank = parsed.blanks[i];
        if (blank == null) {
          continue;
        }
        const value = answer.blanks[i];
        if (value === undefined) {
          continue;
        }
        fields[blank.name] = value;
      }
    } else {
      // Type 2 convention: answer{qid}{slot}
      for (let i = 0; i < answer.blanks.length; i += 1) {
        const slot = String(i + 1);
        fields[`answer${questionId}${slot}`] = answer.blanks[i] ?? "";
      }
    }
  }

  if (answer.choice != null) {
    fields[`answer${questionId}`] = answer.choice;
  }
  if (answer.choices != null && answer.choices.length > 0) {
    fields[`answers${questionId}`] = answer.choices.join(",");
  }
  if (answer.rich_text != null) {
    fields[`answer${questionId}`] = answer.rich_text;
    fields.answerEditor = answer.rich_text;
  }

  fields.tempSave = "true";
  return fields;
}

export type HomeworkSessionFields = {
  courseId: string;
  classId: string;
  workRelationId: string;
  workRelationAnswerId: string;
  answerId: string;
  enc: string;
  encWork: string;
  cpi: string;
  knowledgeid: string;
};

export function parseHomeworkSession(html: string): HomeworkSessionFields {
  const pick = (id: string, name?: string): string =>
    readIdValue(html, id) ??
    (name != null ? readNamedValue(html, name) : null) ??
    "";

  return {
    courseId: pick("courseId", "courseId"),
    classId: pick("classId", "classId"),
    workRelationId: pick("workRelationId", "workRelationId"),
    workRelationAnswerId:
      pick("workRelationAnswerId", "workRelationAnswerId") ||
      pick("answerId"),
    answerId: pick("answerId") || pick("workRelationAnswerId", "workRelationAnswerId"),
    enc: pick("enc", "enc"),
    encWork: pick("encWork", "encWork"),
    cpi: pick("cpi") || pick("currentCpi"),
    knowledgeid: pick("knowledgeid", "knowledgeid") || "0",
  };
}

export function doHomeworkUrl(
  session: HomeworkSessionFields,
  index: number,
  baseOrigin = "https://mooc1-api.chaoxing.com",
): string {
  const url = new URL(`${baseOrigin}/mooc-ans/work/phone/doHomeWork`);
  url.searchParams.set("courseId", session.courseId);
  url.searchParams.set("classId", session.classId);
  url.searchParams.set("workId", session.workRelationId);
  url.searchParams.set("workAnswerId", session.workRelationAnswerId || session.answerId);
  url.searchParams.set("cpi", session.cpi);
  url.searchParams.set("knowledgeid", session.knowledgeid || "0");
  url.searchParams.set("enc", session.enc);
  if (session.encWork.length > 0) {
    url.searchParams.set("encWork", session.encWork);
  }
  url.searchParams.set("mooc", "1");
  url.searchParams.set("source", "0");
  url.searchParams.set("index", String(index));
  return url.toString();
}

export function answerSheetUrl(
  session: HomeworkSessionFields,
  lastIndex: number,
  baseOrigin = "https://mooc1-api.chaoxing.com",
): string {
  const url = new URL(`${baseOrigin}/mooc-ans/work/phone/gotoWorkAnswerSheet`);
  url.searchParams.set("courseId", session.courseId);
  url.searchParams.set("classId", session.classId);
  url.searchParams.set("source", "0");
  url.searchParams.set("workRelationId", session.workRelationId);
  url.searchParams.set(
    "workRelationAnswerId",
    session.workRelationAnswerId || session.answerId,
  );
  url.searchParams.set("knowledgeid", session.knowledgeid || "0");
  url.searchParams.set("enc", session.enc);
  if (session.encWork.length > 0) {
    url.searchParams.set("encWork", session.encWork);
  }
  url.searchParams.set("mooc", "1");
  url.searchParams.set("lastIndex", String(lastIndex));
  return url.toString();
}

export const DRAFT_SAVE_PATH =
  "/mooc-ans/work/phone/doNormalHomeWorkSubmit?tempSave=true";

export function draftSaveUrl(
  baseOrigin = "https://mooc1-api.chaoxing.com",
): string {
  return `${baseOrigin}${DRAFT_SAVE_PATH}`;
}

/** Hard guard: reject any form that would submit for real. */
export function assertDraftOnly(fields: Record<string, string>): void {
  if (fields.tempSave !== "true") {
    throw new Error("refusing_submit: tempSave must be true");
  }
}
