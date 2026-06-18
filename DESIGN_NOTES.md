# Design Notes

## Activity Log Write Strategy

`logActivity` is awaited after the primary write but wrapped in its own try/catch, so a failure in the audit insert surfaces as a server-side error log without rolling back the user's action. The alternative — wrapping both writes in a single Prisma transaction — would mean a slow or locked `activity_logs` table could start rejecting valid task updates, which is the wrong failure mode for an audit system that should be subordinate to the core product. Awaiting (rather than fire-and-forget) ensures failures are observable and actionable rather than silently discarded, which matters because undetected gaps in an audit trail are harder to recover from than known ones.
