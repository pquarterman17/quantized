import type { AnalysisResult } from "../../../lib/analysisResult";
import { statisticalReporting } from "../../../lib/statisticalReporting";

function Section({ title, values }: { title: string; values: string[] }) {
  return <section className="qz-analysis-reporting-section">
    <h4>{title}</h4>
    <ul>{values.map((value, index) => <li key={`${title}-${index}`}>{value}</li>)}</ul>
  </section>;
}

export default function StatisticalReportingCard({ result }: { result: AnalysisResult }) {
  const report = statisticalReporting(result);
  return <div className="qz-analysis-reporting" aria-label="Statistical reporting details">
    <h3>Statistical reporting</h3>
    <p className="qz-analysis-caption">Saved evidence only. “Not recorded” does not mean an assumption passed.</p>
    <div className="qz-analysis-reporting-grid">
      <Section title="Effect size" values={report.effectSizes} />
      <Section title="Intervals" values={report.intervals} />
      <Section title="Assumptions" values={report.assumptions} />
      <Section title="Multiple comparisons" values={report.adjustments} />
      <Section title="Missing data" values={report.missingData} />
    </div>
  </div>;
}
