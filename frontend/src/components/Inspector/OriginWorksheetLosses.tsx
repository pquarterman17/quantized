// Origin provenance: what this book's import did NOT bring in from the
// `.opju` worksheet (`metadata.origin_worksheet_losses`, written per book by
// io/origin_project/opju.py). Each kind is one line — its wording, then the
// Origin short names of the columns it affects (bounded server-side, so the
// count can exceed the names listed).

import { UNVERIFIED_KIND, type BookLoss } from "../../lib/originWorksheetFidelity";

function ColumnList({ loss }: { loss: BookLoss }) {
  const more = loss.count - loss.columns.length;
  return (
    <span style={{ fontFamily: "var(--font-mono)" }}>
      {loss.columns.join(", ")}
      {more > 0 ? ` +${more} more` : ""}
    </span>
  );
}

export default function OriginWorksheetLosses({ entries }: { entries: BookLoss[] }) {
  const losses = entries.filter((e) => e.kind !== UNVERIFIED_KIND);
  const unverified = entries.find((e) => e.kind === UNVERIFIED_KIND);
  return (
    <>
      {losses.length > 0 && <LossList losses={losses} />}
      {unverified && (
        <div style={{ marginBottom: 10, fontSize: "var(--font-size-sm)", color: "var(--text-faint)" }}>
          {unverified.label}: <ColumnList loss={unverified} />
        </div>
      )}
    </>
  );
}

function LossList({ losses }: { losses: BookLoss[] }) {
  return (
    <div
      role="group"
      aria-label="Worksheet import losses"
      style={{ marginBottom: 10, fontSize: "var(--font-size-sm)", lineHeight: 1.4 }}
    >
      <div style={{ color: "var(--text-faint)", marginBottom: 2 }}>
        <span style={{ color: "var(--accent)" }}>⚠</span> Not fully imported from this worksheet
      </div>
      {losses.map((loss) => (
        <div key={loss.kind} style={{ color: "var(--text-dim)", paddingLeft: 14 }}>
          {loss.label}: <ColumnList loss={loss} />
        </div>
      ))}
    </div>
  );
}
