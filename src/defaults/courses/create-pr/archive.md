# create-pr · archive — record the owner's confirmation in git

This leg runs no agent. Its close checks Baton's applied `confirmed` answer and the delivery
end it refers to, then sets `status:` to `done` and archives the ticket with the same git
transaction as `baton tickets done`.
The commit names the delivered commits. `filed` never queues this leg.
