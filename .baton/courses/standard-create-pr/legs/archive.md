# create-pr · archive — record the owner's confirmation in git

This leg runs no agent. Its close checks Baton's applied `confirmed` answer and the delivery
end it refers to, runs the pinned `dibber done` (`$BATON_DIBBER`) to set `status:` to `done`,
and `git mv`s the ticket into `archive/` — Dibber writes the file, git moves it — in one commit
the leg pushes itself.
The commit names the recorded delivery commits and flags incomplete legacy evidence.
`filed` never queues this leg.
