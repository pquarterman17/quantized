import type { ImportCategoricalProblem } from "../../../lib/types";
import { Button } from "../../primitives";

export default function CategoricalProblems({
  problems,
  allowLarge,
  onAllowLarge,
}: {
  problems: ImportCategoricalProblem[];
  allowLarge: boolean;
  onAllowLarge: () => void;
}) {
  if (problems.length === 0) return null;
  const caps = problems.filter((p) => p.type === "categorical_level_cap");
  const collisions = problems.filter((p) => p.type === "categorical_case_collision");
  const truncated = problems.filter((p) => p.type === "categorical_case_collision_truncated");

  return (
    <section aria-labelledby="categorical-check-heading" style={{ marginTop: 10 }}>
      <h3 id="categorical-check-heading" style={{ marginBottom: 5 }}>Categorical checks</h3>
      {caps.length > 0 && (
        <div role={allowLarge ? "status" : "alert"} className="qzk-ds-meta qzk-msg" style={{ color: allowLarge ? "var(--text-dim)" : "var(--warn)" }}>
          {caps.map((problem) => problem.type === "categorical_level_cap" && (
            <div key={problem.column}>
              {problem.column} has {problem.level_count} distinct values; the normal limit is {problem.cap}.
            </div>
          ))}
          {allowLarge ? (
            <div>Large categorical columns accepted for this import.</div>
          ) : (
            <><div>Import is paused in case this column was assigned the wrong role.</div><Button size="sm" onClick={onAllowLarge}>Import large category anyway</Button></>
          )}
        </div>
      )}
      {collisions.length > 0 && (
        <div className="qzk-ds-meta qzk-msg" style={{ color: "var(--warn)" }}>
          {collisions.map((problem) => problem.type === "categorical_case_collision" && (
            <div key={`${problem.column}-${problem.labels.join("-")}`}>
              {problem.column} contains labels differing only by capitalization: {problem.labels.join(", ")}.
            </div>
          ))}
          {truncated.length > 0 && <div>Additional capitalization conflicts are not shown.</div>}
        </div>
      )}
    </section>
  );
}
