import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  currentSemesterOf,
  parseEnrolledCourses,
  semesterCodeOf,
} from "../src/parse";

/**
 * Real-shaped courselistdata (courseType=1) fragment: cover toolbar nests
 * `<li class="move-to">` inside the course `<li>`, then `div.course-info` /
 * `span.course-name.overHidden2` with the full name in the `title` attribute.
 */
function studentCourseListWithNestedMoveTo(): string {
  return `
<ul id="courseList">
  <li class="course clearfix" id="course_1001" courseid="1001" clazzid="2001" personid="3001">
    <div class="course-cover">
      <a class="colorBlue" href="#">
        <img src="https://p.cldisk.com/star3/origin/cover.jpg" />
      </a>
      <div class="hanlde-list">
        <ul>
          <li class="move-to">移入课程分类</li>
          <li class="quit-course">退课</li>
        </ul>
      </div>
    </div>
    <div class="course-info">
      <h3 class="clearfix">
        <a href="#">
          <span class="course-name overHidden2" title="261学期 计算机组成原理">261学期 计算机组成原理</span>
        </a>
      </h3>
    </div>
  </li>
  <li class="course clearfix" id="course_1002" courseid="1002" clazzid="2002" personid="3002">
    <div class="course-cover">
      <div class="hanlde-list"><ul><li class="move-to">移入</li></ul></div>
    </div>
    <div class="course-info">
      <span class="course-name overHidden2" title="261学期 线性代数">261学期 线性代数</span>
    </div>
  </li>
  <li class="course clearfix" courseid="9999" clazzid="0" personid="1">
    <div class="course-info"><span class="course-name overHidden2" title=""></span></div>
  </li>
</ul>`;
}

describe("parseEnrolledCourses real courselistdata shape", () => {
  test("does not truncate at nested move-to </li>; reads title attr and semester 261", () => {
    const courses = parseEnrolledCourses(studentCourseListWithNestedMoveTo());

    assert.deepEqual(
      courses.map((c) => ({
        courseId: c.courseId,
        classId: c.classId,
        title: c.title,
        semester: semesterCodeOf(c.title),
      })),
      [
        {
          courseId: "1001",
          classId: "2001",
          title: "261学期 计算机组成原理",
          semester: "261",
        },
        {
          courseId: "1002",
          classId: "2002",
          title: "261学期 线性代数",
          semester: "261",
        },
      ],
    );
    assert.equal(currentSemesterOf(courses), "261");
  });

  test("still parses simple course-name text without nested li (legacy fixture)", () => {
    const courses = parseEnrolledCourses(`
      <ul id="courseList">
        <li class="course" courseid="101" clazzid="201" personid="1">
          <h3 class="course-name">253-旧课</h3>
        </li>
      </ul>`);
    assert.equal(courses.length, 1);
    assert.equal(courses[0]?.title, "253-旧课");
    assert.equal(semesterCodeOf(courses[0]!.title), "253");
  });
});
