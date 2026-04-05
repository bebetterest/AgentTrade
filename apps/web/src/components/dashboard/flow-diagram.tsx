interface FlowStep {
  title: string;
  body: string;
}

interface FlowDiagramProps {
  sectionId: string;
  title: string;
  eyebrow: string;
  body: string;
  steps: FlowStep[];
}

export const FlowDiagram = ({
  sectionId,
  title,
  eyebrow,
  body,
  steps
}: FlowDiagramProps) => (
  <section id={sectionId} className="card flow-diagram-card" data-testid="flow-diagram">
    <div className="section-head">
      <h2>{title}</h2>
      <span className="badge">{eyebrow}</span>
    </div>
    <p className="sub">{body}</p>
    <ol className="flow-diagram" aria-label={title}>
      {steps.map((step, index) => (
        <li key={step.title} className="flow-diagram__item">
          <article className="flow-node">
            <span className="flow-node__index">{String(index + 1).padStart(2, "0")}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </article>
        </li>
      ))}
    </ol>
  </section>
);
