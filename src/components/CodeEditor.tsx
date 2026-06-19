import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { ShortcutsDialog } from "@/components/ShortcutsDialog";
import type { Variable } from "@/lib/c-interpreter";

interface Highlight {
  line: number;
  colStart: number;
  colEnd: number;
}

interface Props {
  code: string;
  onChange: (s: string) => void;
  highlightLine: number;
  highlight?: Highlight | null;
  errorLine?: number | null;
  readOnly?: boolean;
  variables?: Variable[];
}

// ── Syntax highlighting ────────────────────────────────────────
const KEYWORDS = new Set([
  "if","else","for","while","do","switch","case","default","break","continue","return",
  "struct","typedef","enum","union","const","static","extern","volatile","register",
  "sizeof","goto","inline","true","false",
  "HIGH","LOW","INPUT","OUTPUT","INPUT_PULLUP","LED_BUILTIN",
  "pinMode","digitalWrite","digitalRead","analogRead","analogWrite",
  "delay","millis","micros","map","constrain","setup","loop","printf","scanf",
]);

const TYPES = new Set([
  "int","float","double","char","void","long","short","unsigned","signed",
  "bool","byte","boolean","String","Serial",
]);

interface Token { text: string; cls: string }

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  const re = /(\/\/.*$)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)|([<>=!]=|&&|\|\||<<|>>|[-+*/%&|^~!<>=,;{}()\[\].])|(\s+)/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index), cls: "" });
    const t = m[0];
    if (m[1] || m[2]) {
      tokens.push({ text: t, cls: "text-[var(--chalk-green)] opacity-70" });
    } else if (m[3]) {
      tokens.push({ text: t, cls: "text-[var(--chalk-green)]" });
    } else if (m[4]) {
      tokens.push({ text: t, cls: "text-[var(--chalk-pink)]" });
    } else if (m[5]) {
      if (TYPES.has(t)) {
        tokens.push({ text: t, cls: "text-[var(--chalk-blue)] font-semibold" });
      } else if (t === "print" || t === "println" || t === "begin") {
        tokens.push({ text: t, cls: "text-[var(--chalk-orange)]" });
      } else if (KEYWORDS.has(t)) {
        tokens.push({ text: t, cls: "text-[var(--chalk-yellow)]" });
      } else {
        tokens.push({ text: t, cls: "" });
      }
    } else if (m[6]) {
      tokens.push({ text: t, cls: "text-[var(--chalk-cyan)] opacity-80" });
    } else if (m[7]) {
      tokens.push({ text: t, cls: "" });
    }
    last = m.index + t.length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), cls: "" });
  return tokens;
}

function formatVarTooltip(v: Variable): string {
  const dims = v.dims && v.dims.length ? `[${v.dims.join("][")}]` : "";
  let valStr: string;
  if (Array.isArray(v.value)) {
    try {
      valStr = JSON.stringify(v.value);
      if (valStr.length > 80) valStr = valStr.slice(0, 77) + "…";
    } catch {
      valStr = "[…]";
    }
  } else {
    valStr = String(v.value);
  }
  const scope = v.scope === "global" ? "global" : v.scope.split("#")[0];
  return `${v.type}${dims} ${v.name} = ${valStr}\nescopo: ${scope}`;
}

function renderHighlighted(text: string, varMap?: Map<string, Variable>): ReactNode {
  const tokens = tokenizeLine(text);
  return tokens.map((tok, i) => {
    const v = varMap?.get(tok.text);
    if (v) {
      return (
        <span
          key={i}
          className={(tok.cls || "") + " cursor-help underline decoration-dotted decoration-1 underline-offset-2"}
          title={formatVarTooltip(v)}
        >
          {tok.text}
        </span>
      );
    }
    return tok.cls ? (
      <span key={i} className={tok.cls}>
        {tok.text}
      </span>
    ) : (
      tok.text
    );
  });
}

// ── Auto-indent helpers ────────────────────────────────────────
function computeInitialDepth(prefix: string): number {
  let depth = 0;
  let i = 0;
  while (i < prefix.length) {
    const c = prefix[i];
    if (c === "/" && prefix[i + 1] === "/") {
      const nl = prefix.indexOf("\n", i);
      i = nl === -1 ? prefix.length : nl;
      continue;
    }
    if (c === "/" && prefix[i + 1] === "*") {
      const end = prefix.indexOf("*/", i + 2);
      i = end === -1 ? prefix.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < prefix.length && prefix[i] !== quote) {
        if (prefix[i] === "\\") i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    i++;
  }
  return depth;
}

function reindent(block: string, startDepth: number): string {
  let depth = Math.max(0, startDepth);
  const out: string[] = [];
  const blockLines = block.split("\n");
  for (const raw of blockLines) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      out.push("");
      continue;
    }
    let leadCloses = 0;
    for (const ch of trimmed) {
      if (ch === "}") leadCloses++;
      else break;
    }
    const effective = Math.max(0, depth - leadCloses);
    out.push("\t".repeat(effective) + trimmed);
    let opens = 0;
    let closes = 0;
    let i = 0;
    while (i < trimmed.length) {
      const c = trimmed[i];
      if (c === "/" && trimmed[i + 1] === "/") break;
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        while (i < trimmed.length && trimmed[i] !== q) {
          if (trimmed[i] === "\\") i += 2;
          else i++;
        }
        i++;
        continue;
      }
      if (c === "{") opens++;
      else if (c === "}") closes++;
      i++;
    }
    depth = Math.max(0, depth + opens - closes);
  }
  return out.join("\n");
}

// Encontra a palavra que envolve `pos` em `text`. Retorna {start,end,word} ou null.
function wordAt(text: string, pos: number): { start: number; end: number; word: string } | null {
  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);
  let s = pos;
  let e = pos;
  while (s > 0 && isWord(text[s - 1])) s--;
  while (e < text.length && isWord(text[e])) e++;
  if (s === e) return null;
  return { start: s, end: e, word: text.slice(s, e) };
}

// ── Component ──────────────────────────────────────────────────
export function CodeEditor({ code, onChange, highlightLine, highlight, errorLine, readOnly, variables }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  // Selection capturada no botão direito (textarea perde foco quando menu abre)
  const savedSelRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const lines = code.split("\n");

  const varMap = (() => {
    if (!variables || variables.length === 0) return undefined;
    const m = new Map<string, Variable>();
    for (const v of variables) {
      const existing = m.get(v.name);
      if (!existing || (existing.scope === "global" && v.scope !== "global")) {
        m.set(v.name, v);
      }
    }
    return m;
  })();

  useEffect(() => {
    const ta = taRef.current; const pre = preRef.current;
    if (!ta || !pre) return;
    const sync = () => { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; };
    ta.addEventListener("scroll", sync);
    sync();
    return () => ta.removeEventListener("scroll", sync);
  }, []);

  useEffect(() => {
    const ta = taRef.current; const pre = preRef.current;
    if (!ta || !pre || !readOnly) return;
    const sync = () => { ta.scrollTop = pre.scrollTop; ta.scrollLeft = pre.scrollLeft; };
    pre.addEventListener("scroll", sync);
    return () => pre.removeEventListener("scroll", sync);
  }, [readOnly]);

  useEffect(() => {
    const scroller: HTMLElement | null = readOnly ? preRef.current : taRef.current;
    if (!scroller || !highlightLine) return;
    const lineHeightPx = 24;
    const paddingTop = 12;
    const targetTop = paddingTop + (highlightLine - 1) * lineHeightPx;
    const visibleH = scroller.clientHeight;
    const margin = 4 * lineHeightPx;
    const minScroll = targetTop + margin + lineHeightPx - visibleH;
    const maxScroll = targetTop - margin;
    let next = scroller.scrollTop;
    if (scroller.scrollTop < minScroll) next = minScroll;
    else if (scroller.scrollTop > maxScroll) next = Math.max(0, maxScroll);
    if (next !== scroller.scrollTop) {
      scroller.scrollTo({ top: next, behavior: "smooth" });
    }
  }, [highlightLine, readOnly]);

  // Aplica uma alteração: troca o valor e restaura a seleção.
  const applyEdit = (newCode: string, selStart: number, selEnd: number) => {
    onChange(newCode);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.selectionStart = selStart;
      ta.selectionEnd = selEnd;
    });
  };

  // Expande seleção para abranger linhas completas.
  const lineBounds = (pos: number): { start: number; end: number } => {
    const start = code.lastIndexOf("\n", pos - 1) + 1;
    let end = code.indexOf("\n", pos);
    if (end === -1) end = code.length;
    return { start, end };
  };

  const renderLine = (text: string, lineNumber: number) => {
    const isCurrent = highlightLine === lineNumber;
    const isError = errorLine === lineNumber;
    const segHighlight =
      highlight && highlight.line === lineNumber ? highlight : null;

    if (isError) {
      return <span className="text-[var(--chalk-pink)] chalk-glow font-semibold">{text}</span>;
    }
    if (segHighlight) {
      const start = Math.max(0, segHighlight.colStart - 1);
      const end = Math.min(text.length, segHighlight.colEnd);
      const before = text.slice(0, start);
      const middle = text.slice(start, end);
      const after = text.slice(end);
      return (
        <>
          <span className={isCurrent ? "text-[var(--chalk-yellow)] chalk-glow" : ""}>{before || ""}</span>
          <span className="text-[var(--chalk-pink)] chalk-glow font-semibold">{middle}</span>
          <span className={isCurrent ? "text-[var(--chalk-yellow)] chalk-glow" : ""}>{after}</span>
        </>
      );
    }
    if (isCurrent) {
      return <span className="text-[var(--chalk-yellow)] chalk-glow">{renderHighlighted(text, varMap)}</span>;
    }
    return <span>{renderHighlighted(text, varMap)}</span>;
  };

  // ── Atalhos avançados ─────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+← / Ctrl+→ : seleciona palavra; novamente → próxima ocorrência
    if (ctrl && !e.shiftKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (start === end) {
        const w = wordAt(code, start);
        if (w) applyEdit(code, w.start, w.end);
        return;
      }
      const sel = code.slice(start, end);
      if (!sel) return;
      const next = code.indexOf(sel, end);
      if (next !== -1) {
        applyEdit(code, next, next + sel.length);
        return;
      }
      const first = code.indexOf(sel);
      if (first !== -1 && first !== start) applyEdit(code, first, first + sel.length);
      return;
    }

    // Ctrl+D : renomeia todas as ocorrências da seleção
    if (ctrl && !e.shiftKey && !e.altKey && (e.key === "d" || e.key === "D")) {
      e.preventDefault();
      let target = code.slice(start, end);
      if (!target) {
        const w = wordAt(code, start);
        if (!w) return;
        target = w.word;
      }
      const replacement = window.prompt(`Renomear todas as ocorrências de "${target}" para:`, target);
      if (replacement == null || replacement === target) return;
      // substitui apenas como palavra inteira se for um identificador
      const isIdent = /^[A-Za-z_]\w*$/.test(target);
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = isIdent ? new RegExp(`\\b${escaped}\\b`, "g") : new RegExp(escaped, "g");
      const newCode = code.replace(re, replacement);
      applyEdit(newCode, start, start + replacement.length);
      return;
    }

    // Ctrl+L : seleciona a linha atual
    if (ctrl && !e.shiftKey && !e.altKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      const { start: ls, end: le } = lineBounds(start);
      const lineEndIncl = le < code.length ? le + 1 : le;
      applyEdit(code, ls, lineEndIncl);
      return;
    }

    // Ctrl+Shift+K : apaga a linha atual (ou as linhas selecionadas)
    if (ctrl && e.shiftKey && (e.key === "K" || e.key === "k")) {
      e.preventDefault();
      const ls = code.lastIndexOf("\n", start - 1) + 1;
      let le = code.indexOf("\n", end);
      if (le === -1) le = code.length;
      else le += 1; // inclui \n
      const newCode = code.slice(0, ls) + code.slice(le);
      applyEdit(newCode, ls, ls);
      return;
    }

    // Ctrl+↓ : duplica linha/seleção
    if (ctrl && !e.shiftKey && !e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      if (start !== end) {
        const sel = code.slice(start, end);
        const newCode = code.slice(0, end) + sel + code.slice(end);
        applyEdit(newCode, end, end + sel.length);
      } else {
        const ls = code.lastIndexOf("\n", start - 1) + 1;
        let le = code.indexOf("\n", start);
        if (le === -1) le = code.length;
        const ln = code.slice(ls, le);
        const newCode = code.slice(0, le) + "\n" + ln + code.slice(le);
        const newPos = start + ln.length + 1;
        applyEdit(newCode, newPos, newPos);
      }
      return;
    }

    // Alt + ↑ / ↓ : mover linha(s)
    if (e.altKey && !ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const blockStart = code.lastIndexOf("\n", start - 1) + 1;
      let blockEnd = code.indexOf("\n", end);
      if (blockEnd === -1) blockEnd = code.length;
      const block = code.slice(blockStart, blockEnd);

      if (e.key === "ArrowUp") {
        if (blockStart === 0) return;
        const prevStart = code.lastIndexOf("\n", blockStart - 2) + 1;
        const prevEnd = blockStart - 1;
        const prev = code.slice(prevStart, prevEnd);
        const newCode =
          code.slice(0, prevStart) + block + "\n" + prev + code.slice(blockEnd);
        const delta = -(prev.length + 1);
        applyEdit(newCode, start + delta, end + delta);
      } else {
        if (blockEnd >= code.length) return;
        const nextStart = blockEnd + 1;
        let nextEnd = code.indexOf("\n", nextStart);
        if (nextEnd === -1) nextEnd = code.length;
        const next = code.slice(nextStart, nextEnd);
        const newCode =
          code.slice(0, blockStart) + next + "\n" + block + code.slice(nextEnd);
        const delta = next.length + 1;
        applyEdit(newCode, start + delta, end + delta);
      }
      return;
    }

    // Ctrl+/ : comenta/descomenta linhas selecionadas
    if (ctrl && !e.shiftKey && !e.altKey && e.key === "/") {
      e.preventDefault();
      const ls = code.lastIndexOf("\n", start - 1) + 1;
      let le = code.indexOf("\n", end);
      if (le === -1) le = code.length;
      const block = code.slice(ls, le);
      const blockLines = block.split("\n");
      const allCommented = blockLines.every(
        (ln) => ln.trim() === "" || /^\s*\/\//.test(ln),
      );
      const newLines = allCommented
        ? blockLines.map((ln) => ln.replace(/^(\s*)\/\/ ?/, "$1"))
        : blockLines.map((ln) => (ln.trim() === "" ? ln : ln.replace(/^(\s*)/, "$1// ")));
      const newBlock = newLines.join("\n");
      const newCode = code.slice(0, ls) + newBlock + code.slice(le);
      const delta = newBlock.length - block.length;
      applyEdit(newCode, start, end + delta);
      return;
    }

    // Ctrl+Enter / Ctrl+Shift+Enter : nova linha abaixo/acima
    if (ctrl && e.key === "Enter") {
      e.preventDefault();
      const { start: ls, end: le } = lineBounds(start);
      const currentLine = code.slice(ls, le);
      const indent = (currentLine.match(/^[\t ]*/) || [""])[0];
      if (e.shiftKey) {
        const newCode = code.slice(0, ls) + indent + "\n" + code.slice(ls);
        const pos = ls + indent.length;
        applyEdit(newCode, pos, pos);
      } else {
        const newCode = code.slice(0, le) + "\n" + indent + code.slice(le);
        const pos = le + 1 + indent.length;
        applyEdit(newCode, pos, pos);
      }
      return;
    }

    // Home : smart home
    if (e.key === "Home" && !e.shiftKey && !ctrl && !e.altKey) {
      const { start: ls } = lineBounds(start);
      const lineText = code.slice(ls, code.indexOf("\n", ls) === -1 ? code.length : code.indexOf("\n", ls));
      const indentLen = (lineText.match(/^[\t ]*/) || [""])[0].length;
      const firstNonWs = ls + indentLen;
      e.preventDefault();
      const target = start === firstNonWs ? ls : firstNonWs;
      ta.selectionStart = ta.selectionEnd = target;
      return;
    }

    // Tab handling (mantido)
    if (e.key === "Tab") {
      e.preventDefault();
      const selText = code.slice(start, end);
      if (selText.includes("\n")) {
        const lineStart = code.lastIndexOf("\n", start - 1) + 1;
        const block = code.slice(lineStart, end);
        const blockLines = block.split("\n");
        let newBlock: string;
        let removedFirst = 0;
        let removedTotal = 0;
        if (e.shiftKey) {
          newBlock = blockLines
            .map((ln, idx) => {
              if (ln.startsWith("\t")) {
                if (idx === 0) removedFirst = 1;
                removedTotal += 1;
                return ln.slice(1);
              }
              const m = ln.match(/^ {1,4}/);
              if (m) {
                if (idx === 0) removedFirst = m[0].length;
                removedTotal += m[0].length;
                return ln.slice(m[0].length);
              }
              return ln;
            })
            .join("\n");
        } else {
          newBlock = blockLines.map((ln) => "\t" + ln).join("\n");
        }
        const newValue = code.slice(0, lineStart) + newBlock + code.slice(end);
        onChange(newValue);
        const newStart = e.shiftKey ? Math.max(lineStart, start - removedFirst) : start + 1;
        const newEnd = e.shiftKey ? end - removedTotal : end + blockLines.length;
        requestAnimationFrame(() => {
          ta.selectionStart = newStart;
          ta.selectionEnd = newEnd;
        });
        return;
      }

      if (e.shiftKey) {
        const lineStart = code.lastIndexOf("\n", start - 1) + 1;
        const before = code.slice(lineStart, start);
        let remove = 0;
        if (before.endsWith("\t")) remove = 1;
        else {
          const m = before.match(/( {1,4})$/);
          if (m) remove = m[1].length;
        }
        if (remove > 0) {
          const newValue = code.slice(0, start - remove) + code.slice(start);
          onChange(newValue);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start - remove;
          });
        }
        return;
      }

      const newValue = code.slice(0, start) + "\t" + code.slice(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 1;
      });
    }
  };


  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border bg-card/40">
      <pre
        ref={preRef}
        aria-hidden={!readOnly}
        className={
          "absolute inset-0 m-0 whitespace-pre py-3 pl-14 pr-3 text-sm leading-6 text-foreground " +
          (readOnly ? "z-20 overflow-auto" : "pointer-events-none overflow-hidden")
        }
        style={{ fontFamily: "var(--font-mono)", fontVariantLigatures: "none" }}
      >
        {lines.map((ln, i) => (
          <div key={i} className="min-h-6">
            {renderLine(ln, i + 1) || <>&nbsp;</>}
          </div>
        ))}
      </pre>

      <NumberGutter lines={lines.length} highlightLine={highlightLine} errorLine={errorLine ?? null} preRef={preRef} />

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <textarea
            ref={taRef}
            value={code}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onContextMenu={(e) => {
              const ta = e.currentTarget;
              savedSelRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
            }}
            readOnly={readOnly}
            spellCheck={false}
            className={
              "absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent py-3 pl-14 pr-3 text-sm leading-6 text-transparent caret-primary outline-none " +
              (readOnly ? "pointer-events-none z-10" : "z-20")
            }
            style={{ fontFamily: "var(--font-mono)", fontVariantLigatures: "none" }}
          />
        </ContextMenuTrigger>
        {!readOnly && (
          <ContextMenuContent className="w-64">
            <ContextMenuItem
              onSelect={() => {
                const ta = taRef.current;
                if (!ta) return;
                const { start: selStart, end: selEnd } = savedSelRef.current;
                const hasSel = selStart !== selEnd;
                if (hasSel) {
                  const lineStart = code.lastIndexOf("\n", selStart - 1) + 1;
                  let lineEnd = code.indexOf("\n", selEnd);
                  if (lineEnd === -1) lineEnd = code.length;
                  const block = code.slice(lineStart, lineEnd);
                  const reindented = reindent(block, computeInitialDepth(code.slice(0, lineStart)));
                  const newValue = code.slice(0, lineStart) + reindented + code.slice(lineEnd);
                  onChange(newValue);
                  requestAnimationFrame(() => {
                    ta.selectionStart = lineStart;
                    ta.selectionEnd = lineStart + reindented.length;
                    ta.focus();
                  });
                } else {
                  const reindented = reindent(code, 0);
                  onChange(reindented);
                  requestAnimationFrame(() => ta.focus());
                }
              }}
            >
              Auto tabular
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setShortcutsOpen(true)}>
              Lista de atalhos
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

function NumberGutter({
  lines,
  highlightLine,
  errorLine,
  preRef,
}: {
  lines: number;
  highlightLine: number;
  errorLine: number | null;
  preRef: React.RefObject<HTMLPreElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pre = preRef.current; const g = ref.current;
    if (!pre || !g) return;
    const sync = () => { g.scrollTop = pre.scrollTop; };
    pre.addEventListener("scroll", sync);
    return () => pre.removeEventListener("scroll", sync);
  }, [preRef]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute left-0 top-0 z-10 h-full w-12 select-none overflow-hidden border-r border-border/60 bg-secondary/60 py-3 text-right text-sm leading-6 text-muted-foreground"
      style={{ fontFamily: "var(--font-mono)", fontVariantLigatures: "none" }}
    >
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={
            "px-2 " +
            (errorLine === i + 1
              ? "chalk-text text-[var(--chalk-pink)] chalk-glow font-semibold"
              : highlightLine === i + 1
              ? "chalk-text text-[var(--chalk-yellow)] chalk-glow"
              : "")
          }
        >
          {i + 1}
        </div>
      ))}
    </div>
  );
}
