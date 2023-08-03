import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
import React, { useEffect } from "react";
import { Tooltip } from "react-tooltip";
import { useAppSelector } from "../hooks";
import { Role } from "../types";
import CodeBlockActionsButton from "./CodeBlockActionsButton";

interface CodeBlockProps {
  code: string;
  className?: string;
  conversationId: string;
  vscode: any;
  startCollapsed?: boolean; // This is meant to be a literal that is passed in, and not a state variable
  role?: Role;
}

export default ({
  conversationId: currentConversationId,
  code,
  className = "",
  vscode,
  startCollapsed = false,
  role,
}: CodeBlockProps) => {
  const t = useAppSelector((state: any) => state.app.translations);
  const [codeTextContent, setCodeTextContent] = React.useState("");
  const [language, setLanguage] = React.useState("");
  const codeRef = React.useRef<HTMLPreElement>(null);
  const [expanded, setExpanded] = React.useState(false);

  const decodeHtml = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.documentElement.textContent || "";
  };

  const getCodeInnerHtml = (code: string) => {
    let highlightedCode = code
      .replace(/<pre><code[^>]*>/, "")
      .replace(/<\/code><\/pre>/, "");
    highlightedCode = language
      ? hljs.highlight(decodeHtml(highlightedCode), { language }).value
      : hljs.highlightAuto(decodeHtml(highlightedCode)).value;
    //console.log(code);
    //console.log(highlightedCode);
    return highlightedCode;
  };

  useEffect(() => {
    setExpanded(!startCollapsed);
  }, []);

  useEffect(() => {
    let textContent = codeRef.current?.textContent || "";

    // if it ends with a newline, remove it
    if (textContent.endsWith("\n")) {
      textContent = textContent.slice(0, -1);
    }

    setCodeTextContent(textContent);

    // set language based on hljs class
    const detectedLanguage = code.match(/language-(\w+)/)?.[1] || "";
    if (language !== detectedLanguage) {
      setLanguage(detectedLanguage);
    }
  }, [code]);

  return (
    <pre
      className={`c-codeblock group bg-input my-4 relative rounded border bg-opacity-20
        ${className} ${!expanded ? "cursor-pointer" : ""}
      `}
    >
      {language && (
        <div className="absolute -top-5 right-4 text-[10px] text-tab-inactive-unfocused">
          {language}
        </div>
      )}
      {/* Added hover styles for the collapsed UI */}
      {expanded && (
        <div className="sticky h-0 z-10 top-0 -mt-[1px] pt-2 pr-2 border-t">
          <div className="flex flex-wrap items-center justify-end gap-2 transition-opacity duration-75 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <CodeBlockActionsButton
              vscode={vscode}
              codeTextContent={codeTextContent}
              iconName="clipboard"
              tooltipContent={t?.codeBlock?.copyTooltip ?? "Copy to clipboard"}
              buttonText={t?.codeBlock?.copy ?? "Copy"}
              buttonSuccessText={t?.codeBlock?.copied ?? "Copied"}
              onClick={() => {
                navigator.clipboard.writeText(codeTextContent);
              }}
            />

            <CodeBlockActionsButton
              vscode={vscode}
              codeTextContent={codeTextContent}
              iconName="pencil"
              tooltipContent={
                t?.codeBlock?.insertTooltip ?? "Insert into the current file"
              }
              buttonText={t?.codeBlock?.insert ?? "Insert"}
              buttonSuccessText={t?.codeBlock?.inserted ?? "Inserted"}
              onClick={() => {
                vscode.postMessage({
                  type: "editCode",
                  value: codeTextContent,
                  conversationId: currentConversationId,
                });
              }}
            />
            <CodeBlockActionsButton
              vscode={vscode}
              codeTextContent={codeTextContent}
              iconName="plus"
              tooltipContent={
                t?.codeBlock?.newTooltip ??
                "Create a new file with the below code"
              }
              buttonText={t?.codeBlock?.new ?? "New"}
              buttonSuccessText={t?.codeBlock?.created ?? "Created"}
              onClick={() => {
                vscode.postMessage({
                  type: "openNew",
                  value: codeTextContent,
                  conversationId: currentConversationId,
                  // Handle HLJS language names that are different from VS Code's language IDs
                  language: language
                    .replace("js", "javascript")
                    .replace("py", "python")
                    .replace("sh", "bash")
                    .replace("ts", "typescript"),
                });
              }}
            />
            <Tooltip
              id="code-actions-tooltip"
              place="bottom"
              delayShow={1500}
            />
          </div>
        </div>
      )}
      {/* Render a collapsed UI if the prop is set to true */}
      {!expanded && (
        <div className="opacity-0 group-hover:opacity-100 absolute inset-0 p-2 flex items-end justify-center">
          <div className="bg-input rounded">
            <button
              className="flex gap-x-1 pt-1.5 pb-1 px-2 text-xs rounded bg-button-secondary text-button-secondary hover:bg-button-secondary-hover hover:text-button-secondary-hover whitespace-nowrap"
              onClick={() => setExpanded(!expanded)}
            >
              {t?.codeBlock?.expand ?? "Expand"}
            </button>
          </div>
        </div>
      )}
      {startCollapsed && expanded && (
        <div className="opacity-0 group-hover:opacity-100 absolute inset-0 p-2 flex items-end justify-center">
          <div className="bg-input rounded">
            <button
              className="flex gap-x-1 top-0 right-0 pt-1.5 pb-1 px-2 text-xs rounded bg-button-secondary text-button-secondary hover:bg-button-secondary-hover hover:text-button-secondary-hover whitespace-nowrap"
              onClick={() => setExpanded(!expanded)}
            >
              {t?.codeBlock?.collapse ?? "Collapse"}
            </button>
          </div>
        </div>
      )}
      <code
        className={`block px-4 py-2 overflow-x-auto font-code text-code
          ${expanded ? "" : "h-14 collapsed-code-block"}
          ${role === Role.user ? "bg-sidebar" : ""}
        `}
        ref={codeRef}
        dangerouslySetInnerHTML={{
          __html: getCodeInnerHtml(code),
        }}
      />
    </pre>
  );
};
