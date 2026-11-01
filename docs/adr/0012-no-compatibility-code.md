# 0012. No compatibility code

- **Status**: Accepted
- **Date**: 2026-11-01

## Context

The document model changed often while the app was designed: cameras became objects, animation became actions, poses became quaternions. Keeping every old shape readable would mean converters and fallbacks in the readers, and tests for each of them, all of it code that does nothing for what the app is now and gets in the way of the next change.

## Decision

- No converters, fallbacks or compatibility shims for older document shapes, and no tests for them.
- Data enters through validation (`lib/doc.ts`, `parseScene`, `parseExportOptions`…). What does not fit the current shape is dropped or set to its default, never translated from an old one.
- When a shape changes, the code and the built-in data change together: templates, films, the motion library and test fixtures are regenerated, not adapted.
- The database schema is the exception: it changes through Prisma migrations, which are the schema's history, not compatibility code.

## Consequences

- The code describes one model, the current one, and changing it is a single edit.
- A project file saved before a shape change may not open as it was. This is accepted while the app is pre-release; if users come to rely on old files, this record will be revisited.
- Dead code is removed rather than kept "just in case": knip and the lint run in CI keep it out.
