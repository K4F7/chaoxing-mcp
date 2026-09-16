import { applyDevVars } from "../src/dev-vars";
import {
  fetchDetailSummary,
  isAssignmentOrExamRelated,
} from "../src/processor";
import { fetchInboxMessages } from "../src/inbox";

await applyDevVars();

const limit = readLimit();
const result = await fetchInboxMessages({
  cookie: process.env.CHAOXING_COOKIE || "",
  homeUrl: process.env.CHAOXING_HOME_URL,
  limit,
});

const relevant = result.messages.filter(isAssignmentOrExamRelated);
const summaries = [];

for (const message of relevant.slice(0, readDetailsLimit())) {
  summaries.push(
    await fetchDetailSummary({
      message,
      cookie: process.env.CHAOXING_COOKIE || "",
    }),
  );
}

console.log(
  JSON.stringify(
    {
      fetched: result.totalFetched,
      relevant: relevant.length,
      inspectedDetails: summaries.length,
      summaries,
    },
    null,
    2,
  ),
);

function readLimit(): number {
  const value = process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1];
  return value ? Number.parseInt(value, 10) : 100;
}

function readDetailsLimit(): number {
  const value = process.argv
    .find((arg) => arg.startsWith("--details="))
    ?.split("=")[1];
  return value ? Number.parseInt(value, 10) : 10;
}
