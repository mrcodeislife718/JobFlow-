# Reliability & Efficiency Standard

JobFlow must become harder to break and cheaper to operate as it matures.

Reliability invariants: no lost customer state, idempotent consequential actions, bounded retries, safe provider fallback, restart recovery, concurrency protection, delivery confirmation, lifecycle provenance, and verified recovery before customer state advances.

Efficiency invariants: eliminate duplicate customer touches, route work by expected value, avoid unnecessary voice/LLM/provider calls, batch safe work, reuse stable customer context, and automate only when expected value exceeds operating cost plus risk.

Primary economic metric: recovered or created customer revenue per operating dollar.

Every release must answer: what fails first under load; what happens when dependencies disappear; can customer state be corrupted or lost; can the system replay and explain what happened; can it restore known-good state; what work is repeated; what provider/data traffic is avoidable; what expensive intelligence can be replaced by cheaper logic; what is cost per useful revenue outcome; and whether optimization reduces customer experience, correctness or safety.

Release loop: input -> normal operation -> resource accounting -> failure injection -> recovery -> verification -> cost accounting -> adaptive improvement.
