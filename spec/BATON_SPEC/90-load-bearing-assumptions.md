## Load-bearing assumptions

Every claim this spec rests on about code that exists today is about the reference deployment's
code (docs' `claim.sh`, its factory-state library, its skills and harness hooks). The table is in
docs' `BATON_DOCS_DEPLOYMENT` §16, where `check-spec-anchors` re-resolves it. This repository's
`npm run check:spec` checks that every requirement id the code cites is defined here (or retired
in `BATON_SPEC_HISTORY.md`), and that every ticket the spec cites exists in `tickets/`.

