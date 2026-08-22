# JobFlow — Portfolio Proof Contract

**Track:** Commercial AI front-office / agent product

JobFlow is complete only when its receptionist and business-continuity workflows operate reliably in production and create measurable value for real businesses.

Required proof: executable voice/customer workflows; scheduling and business-state correctness tests; failure tests for dropped calls, tool/API outages, duplicate events, bad transcription, latency spikes, conflicting bookings, and escalation; benchmarks for latency, booking success, automation rate, escalation rate, and recovery; security for customer/tenant data and tool authorization; repeatable deployment with observability and rollback; real-business usage; payment, retention, and measurable customer value.

Every material claim must point to an exact test, benchmark, deployment artifact, or usage/revenue record. Synthetic calls are not customer validation.

**Next proof target:** run a full inbound-call-to-booking scenario under normal and injected-failure conditions, preserve transcripts/events/verification evidence, and measure completion, latency, escalation, and recovery.