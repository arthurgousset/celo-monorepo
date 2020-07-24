const org = process.env.CIRCLE_PROJECT_USERNAME || 'celo-org'
const repo = process.env.CIRCLE_PROJECT_REPONAME || 'celo-monorepo'
const numJobsBeingTracked = 21 // IMPORTANT: This needs to be updated when we add jobs to circleci or GitHub checks may not complete.

// NOTE: Avoid editing this file unless you are making changes to the flake trackers' functionality.
// This file serves mainly to distill various environment variables into easy to use booleans for the rest of the project.
// Configuration should be done via env variables in config.yaml (or command line if running locally)

// NOTE: Many env variables used in this project are provided automatically by circleci (CIRCLE_PROJECT_NAME, CIRCLECI, etc.)

// CUSTOM ENV VARIABLE OVERVIEW:
//  FLAKEY =>
//    - When running in CI, set to 'false' to disable the flake tracker (enabled by default)
//    - When running locally, set to 'true' to enable the flake tracker (disabled by default)
//  LOG_ALL_RETRY_ERRORS =>
//    - Only relevant when flake tracker is enabled.
//    - Enables error logging after retries even for tests that never pass. Useful for debugging flakey tests that don't respond to
//      retries. That is, tests that fail consistently when the first attempt fails but also sometimes pass on the first attempt.
//  NUM_RETRIES =>
//    - Specifies how many retries should be performed before a test is declared failing. Defaults to 10.
//  SKIP_KNOWN_FLAKES =>
//    - Must be set to 'false' to disable the skipping of known flakes in CI.
//    - Note that skipping individual flakey tests can be disabled via the 'Mandatory Tests' feature (See README).

// shouldTrackFlakes => tests are retried `numRetries` times and flakey results are logged w/ test output
const shouldTrackFlakes =
  (process.env.CIRCLECI && process.env.FLAKEY !== 'false') || process.env.FLAKEY === 'true'

// shouldLogRetryErrorsOnFailure => log raw test error immediately after every retry.
//const shouldLogRetryErrorsOnFailure = shouldTrackFlakes && process.env.LOG_ALL_RETRY_ERRORS
const shouldLogRetryErrorsOnFailure = true

// numRetries === times test is run after the initial failure
const numRetries = process.env.NUM_RETRIES ? Number(process.env.NUM_RETRIES) : 10

// shouldSkipKnownFlakes => flakey test issues are fetched from github and corresponding tests are skipped
const shouldSkipKnownFlakes =
  shouldTrackFlakes && process.env.CIRCLECI && process.env.SKIP_KNOWN_FLAKES !== 'false'

// shouldAddCheckToPR => GitHub Check added to PR
const shouldAddCheckToPR = shouldTrackFlakes && process.env.CIRCLECI

// shouldCreateIssues => GitHub Issues created for new flakey tests
const shouldCreateIssues = true
// const shouldCreateIssues =
//   shouldTrackFlakes && process.env.CIRCLECI && process.env.CIRCLE_BRANCH === 'master'

// For convenience...
const shouldReportFlakes = shouldAddCheckToPR || shouldCreateIssues
const shouldUseGitHub = shouldSkipKnownFlakes || shouldReportFlakes

module.exports = {
  numJobsBeingTracked: numJobsBeingTracked,
  numRetries: numRetries,
  org: org,
  repo: repo,
  shouldAddCheckToPR: shouldAddCheckToPR,
  shouldCreateIssues: shouldCreateIssues,
  shouldLogRetryErrorsOnFailure: shouldLogRetryErrorsOnFailure,
  shouldReportFlakes: shouldReportFlakes,
  shouldSkipKnownFlakes: shouldSkipKnownFlakes,
  shouldTrackFlakes: shouldTrackFlakes,
  shouldUseGitHub: shouldUseGitHub,
}
