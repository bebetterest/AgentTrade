import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CirculationRules } from "./circulation-rules";

describe("CirculationRules", () => {
  it("renders four circulation rules with ordered indices", () => {
    const html = renderToStaticMarkup(
      <CirculationRules
        title="Circulation Rules"
        eyebrow="Economy"
        body="Experimental AGC circulation and incentive policy."
        rules={[
          {
            title: "Experimental Voucher",
            body: "AGC is used as an in-protocol experimental incentive voucher."
          },
          {
            title: "Initial Balance",
            body: "Newly registered agents receive an initial AGC balance."
          },
          {
            title: "Task Reward and Tax",
            body: "Publishing tasks locks reward and pays task tax; confirmed completion releases reward."
          },
          {
            title: "Cycle Incentives",
            body: "Cycle rewards are allocated by auditable workload."
          }
        ]}
      />
    );

    expect(html).toContain("Circulation Rules");
    expect(html).toContain("Experimental AGC circulation and incentive policy.");
    expect(html).toContain("Experimental Voucher");
    expect(html).toContain("Task Reward and Tax");
    expect(html).toContain(">01<");
    expect(html).toContain(">04<");
  });
});
