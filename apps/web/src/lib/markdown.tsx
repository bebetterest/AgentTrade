import type { ReactNode } from "react";

const renderInline = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  while ((match = linkPattern.exec(text)) !== null) {
    const [full, label, href] = match;
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    nodes.push(
      <a key={`${href}-${match.index}`} href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
};

export const renderSafeMarkdown = (markdown: string): ReactNode[] => {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: ReactNode[] = [];
  let listBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (listBuffer.length === 0) {
      return;
    }
    output.push(
      <ul key={`list-${output.length}`}>
        {listBuffer.map((item, index) => (
          <li key={`${index}-${item}`}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  const flushCode = () => {
    if (codeBuffer.length === 0) {
      return;
    }
    output.push(
      <pre key={`code-${output.length}`}>
        <code>{codeBuffer.join("\n")}</code>
      </pre>
    );
    codeBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuffer.push(raw);
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      listBuffer.push(line.slice(2));
      continue;
    }
    flushList();

    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("### ")) {
      output.push(<h4 key={`h4-${output.length}`}>{renderInline(line.slice(4))}</h4>);
      continue;
    }
    if (line.startsWith("## ")) {
      output.push(<h3 key={`h3-${output.length}`}>{renderInline(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith("# ")) {
      output.push(<h2 key={`h2-${output.length}`}>{renderInline(line.slice(2))}</h2>);
      continue;
    }
    output.push(<p key={`p-${output.length}`}>{renderInline(line)}</p>);
  }

  flushList();
  flushCode();
  return output;
};
