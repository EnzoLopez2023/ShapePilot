// Vitest global setup. Deliberately minimal: the suites construct their own
// databases and servers so nothing is shared across files.

// Testing Library's `waitFor` gives up after one second by default, which is
// generous on a developer's machine and tight on a shared CI runner: the
// component suites render whole pages into jsdom and wait on several requests
// in sequence. Two of them passed locally and failed in CI for exactly that
// reason, which is the worst kind of failure -- it looks like a real defect and
// is not.
//
// Five seconds is still far below the 30 s per-test budget, so a genuinely
// stuck assertion is reported as a failure rather than hanging the suite.
// `document` is not in this project's lib, since most suites are plain Node.
if ('document' in globalThis) {
  const { configure } = await import('@testing-library/dom')
  configure({ asyncUtilTimeout: 5_000 })
}

export {}
