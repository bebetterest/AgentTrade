interface CirculationRule {
  title: string;
  body: string;
}

interface CirculationRulesProps {
  title: string;
  eyebrow: string;
  body: string;
  rules: CirculationRule[];
}

export const CirculationRules = ({
  title,
  eyebrow,
  body,
  rules
}: CirculationRulesProps) => (
  <section className="card circulation-rules-card" data-testid="circulation-rules">
    <div className="section-head">
      <h2>{title}</h2>
      <span className="badge">{eyebrow}</span>
    </div>
    <p className="sub">{body}</p>
    <ol className="circulation-rules-list" aria-label={title}>
      {rules.map((rule, index) => (
        <li key={rule.title} className="circulation-rules-list__item">
          <article className="circulation-rule-item">
            <span className="circulation-rule-item__index">{String(index + 1).padStart(2, "0")}</span>
            <h3>{rule.title}</h3>
            <p>{rule.body}</p>
          </article>
        </li>
      ))}
    </ol>
  </section>
);
