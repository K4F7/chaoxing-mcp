export const COURSE_LIST_URL =
  "https://mooc1-1.chaoxing.com/mooc-ans/visit/courselistdata";

export type CourseRef = {
  courseId: string;
  classId: string;
  cpi: string;
};

export function courseWorkListUrl(course: CourseRef): string {
  const url = new URL("https://mooc1-api.chaoxing.com/work/task-list");
  url.searchParams.set("courseId", course.courseId);
  url.searchParams.set("classId", course.classId);
  url.searchParams.set("cpi", course.cpi);
  return url.toString();
}
