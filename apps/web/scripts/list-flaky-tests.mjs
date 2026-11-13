// Prints a Markdown list of the tests in a Playwright JSON report that passed only on a retry.
// Usage: node scripts/list-flaky-tests.mjs <report.json>
import {readFileSync} from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const rows = [];
const visit = (suite, titles) => {
  // The top-level suites are files; their titles are the file paths, already in the spec column.
  const path = suite.file && suite.title === suite.file ? titles : [...titles, suite.title];
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      if (test.status !== 'flaky') continue;
      const message = test.results[0]?.error?.message ?? '';
      rows.push({
        spec: `${spec.file}:${spec.line}`,
        title: [...path, spec.title].join(' › '),
        project: test.projectName,
        error: message
          .replace(/\u001b\[[0-9;]*m/g, '')
          .trim()
          .split('\n')[0],
      });
    }
  }
  for (const child of suite.suites ?? []) visit(child, path);
};
for (const suite of report.suites) visit(suite, []);

const cell = (text) => text.replaceAll('|', '\\|');
if (rows.length === 0) {
  console.log('No flaky tests.');
} else {
  console.log(`### ${rows.length} flaky ${rows.length === 1 ? 'test' : 'tests'}\n`);
  console.log('Each failed at first and passed on a retry.\n');
  console.log('| Spec | Test | Project | First error |');
  console.log('| --- | --- | --- | --- |');
  for (const row of rows)
    console.log(`| ${[row.spec, row.title, row.project, row.error].map(cell).join(' | ')} |`);
}
