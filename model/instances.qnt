// Instances of the model. `sim`: R3-1243's bounds — 3 workers, 2 tickets, 2 overlapping sync
// runs — for `quint run` (npm run model). `small`: 2 workers, 1 ticket, 1 sync run — for
// Apalache's bounded proof (npm run model:verify), which explodes on `sim` past a few steps.
module sim {
  import properties(P_TICKETS = Set("t1", "t2"), P_WORKERS = Set("w1", "w2", "w3"),
                    P_SLOTS = Set(1, 2), P_MAX_CLAIMS = 6, P_GIT_BUDGET = 2,
                    P_OWNER_BUDGET = 2,
                    P_DECLARED = Map("w1" -> Set("vpn:corp"), "w2" -> Set("vpn:corp", "db:orders:rw"), "w3" -> Set("db:orders:rw")),
                    P_GRANTED = Map("w1" -> Set("vpn:corp"), "w2" -> Set("vpn:corp"), "w3" -> Set("vpn:corp", "db:orders:rw")),
                    P_REQUIRES = Map("t1" -> Set(), "t2" -> Set("db:orders:rw")),
                    P_RESOURCES = Set("llm"), P_NEEDS = Map("implement" -> Set("llm"), "review" -> Set(), "fix" -> Set(), "adjudicate" -> Set(), "merge" -> Set())).* from "./properties"
}
module small {
  import properties(P_TICKETS = Set("t1"), P_WORKERS = Set("w1", "w2"),
                    P_SLOTS = Set(1), P_MAX_CLAIMS = 3, P_GIT_BUDGET = 1,
                    P_OWNER_BUDGET = 1,
                    P_DECLARED = Map("w1" -> Set(), "w2" -> Set()), P_GRANTED = Map("w1" -> Set(), "w2" -> Set()),
                    P_REQUIRES = Map("t1" -> Set()), P_RESOURCES = Set(), P_NEEDS = Map("implement" -> Set(), "review" -> Set(), "fix" -> Set(), "adjudicate" -> Set(), "merge" -> Set())).* from "./properties"
}
