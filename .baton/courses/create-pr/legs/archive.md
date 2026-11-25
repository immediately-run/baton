# create-pr · archive — record the owner's confirmation in git

This leg runs no agent. Its close checks Baton's applied `confirmed` answer and the delivery
end it refers to, runs pinned `dibber done` to set `status:` to `done`, and archives the
resulting ticket in one git commit.
The commit names the recorded delivery commits and flags incomplete legacy evidence.
`filed` never queues this leg.
