import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment } from "react";
import { renderSafeMarkdown } from "./markdown";

const render = (source: string): string => {
  const nodes = renderSafeMarkdown(source);
  return renderToStaticMarkup(<Fragment>{nodes}</Fragment>);
};

describe("renderSafeMarkdown", () => {
  it("renders headings, paragraphs, and lists", () => {
    const html = render("# Title\nBody\n- one\n- two");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<p>Body</p>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });

  it("renders fenced code blocks", () => {
    const html = render("```\nconst value = 1;\n```\n");
    expect(html).toContain("<pre><code>const value = 1;</code></pre>");
  });

  it("only linkifies http/https urls", () => {
    const html = render("safe [docs](https://example.com) and unsafe [bad](javascript:alert(1))");
    expect(html).toContain("<a href=\"https://example.com\"");
    expect(html).toContain("[bad](javascript:alert(1))");
  });
});
