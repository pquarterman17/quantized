import type { ImportCategoricalProblem } from "../../../lib/types";
import { Button } from "../../primitives";

export default function CategoricalProblems({
  problems,
  accepted,
  onAccept,
  onUnaccept,
}: {
  problems: ImportCategoricalProblem[];
  /** Raw file column indices the user has explicitly accepted. */
  accepted: readonly number[];
  onAccept: (index: number) => void;
  onUnaccept: (index: number) => void;
}) {
  if (problems.length === 0) return null;
  const caps = problems.filter((p) => p.type === "categorical_level_cap");
  const collisions = problems.filter((p) => p.type === "categorical_case_collision");
  const truncated = problems.filter((p) => p.type === "categorical_case_collision_truncated");
  const isAccepted = (index: number) => accepted.includes(index);
  // Only the columns still refusing decide the alert's severity: once every
  // flagged column has been accepted the section is a status, not a warning.
  const blocking = caps.filter((p) => !isAccepted(p.index));

  return (
    <section aria-labelledby="categorical-check-heading" style={{ marginTop: 10 }}>
      <h3 id="categorical-check-heading" style={{ marginBottom: 5 }}>Categorical checks</h3>
      {caps.length > 0 && (
        <div
          role={blocking.length > 0 ? "alert" : "status"}
          className="qzk-ds-meta qzk-msg"
          style={{ color: blocking.length > 0 ? "var(--warn)" : "var(--text-dim)" }}
        >
          {/* Keyed on `index`, not `column`: `_resolve_names` never
              de-duplicates column names, so two columns sharing a header
              would reconcile as one row — merged or stale. */}
          {caps.map((problem) => problem.type === "categorical_level_cap" && (
            <div key={problem.index} style={{ marginBottom: 3 }}>
              {problem.column} has {problem.level_count} distinct values; the normal limit
              is {problem.cap}.{" "}
              {isAccepted(problem.index) ? (
                <>
                  Accepted for this import.{" "}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onUnaccept(problem.index)}
                  >
                    Undo
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => onAccept(problem.index)}>
                  Import {problem.column} as a large category anyway
                </Button>
              )}
            </div>
          ))}
          {blocking.length > 0 && (
            <div>Import is paused in case {blocking.length === 1 ? "this column was" : "these columns were"} assigned the wrong role.</div>
          )}
        </div>
      )}
      {collisions.length > 0 && (
        <div className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn)" }}>
          {collisions.map((problem) => problem.type === "categorical_case_collision" && (
            <div key={`${problem.index}-${problem.labels.join("-")}`}>
              {problem.column} contains labels differing only by capitalization: {problem.labels.join(", ")}.
            </div>
          ))}
          {truncated.length > 0 && <div>Additional capitalization conflicts are not shown.</div>}
        </div>
      )}
    </section>
  );
}
