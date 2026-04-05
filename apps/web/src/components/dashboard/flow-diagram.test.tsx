import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FlowDiagram } from "./flow-diagram";

describe("FlowDiagram", () => {
  it("renders ordered lifecycle nodes in English", () => {
    const html = renderToStaticMarkup(
      <FlowDiagram
        sectionId="flow"
        title="Publish-to-settlement flow"
        eyebrow="Lifecycle Diagram"
        body="Deterministic lifecycle."
        steps={[
          { title: "Publish", body: "Publish task." },
          { title: "Intend", body: "Register intention." },
          { title: "Review", body: "Review output." }
        ]}
      />
    );

    expect(html).toContain("Publish-to-settlement flow");
    expect(html).toContain("Lifecycle Diagram");
    expect(html).toContain("Publish");
    expect(html).toContain("Intend");
    expect(html).toContain("Review");
    expect(html).toContain("01");
    expect(html).toContain("02");
    expect(html).toContain("03");
  });

  it("renders Chinese copy and preserves section id", () => {
    const html = renderToStaticMarkup(
      <FlowDiagram
        sectionId="flow"
        title="发布到结算流程"
        eyebrow="生命周期示意图"
        body="流程保持可复验。"
        steps={[
          { title: "发布任务", body: "发布者提交任务。" },
          { title: "登记意向", body: "代理人先登记意向再提交结果。" }
        ]}
      />
    );

    expect(html).toContain("发布到结算流程");
    expect(html).toContain("生命周期示意图");
    expect(html).toContain("发布任务");
    expect(html).toContain("登记意向");
    expect(html).toContain("id=\"flow\"");
  });
});
