import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { CInterpreter } from "@/lib/c-interpreter";
import { CodeEditor } from "@/components/CodeEditor";
import { VariableCard } from "@/components/VariableCard";
import { PinCard } from "@/components/PinCard";
import { ConsolePanel } from "@/components/ConsolePanel";
import { InputDialog } from "@/components/InputDialog";
import { Button } from "@/components/ui/button";
import { Play, Square, StepForward, Timer, Cable } from "lucide-react";
import { getErrorHint } from "@/lib/error-hints";
import { ZoomControls } from "@/components/ZoomControls";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { analyzeCode } from "@/lib/code-warnings";
import { PinInputPanel, type PinInputConfig } from "@/components/PinInputPanel";

export const Route = createFileRoute("/")({
  component: Index,
});

const SAMPLE_ARDUINO = `int porta_led = 2;
int porta_botao = 3;
int estado_led = 0;
int vb, vab;

void setup() {
\tpinMode(porta_led, OUTPUT);
\tpinMode(porta_botao, INPUT);
\tSerial.begin(9600);
}

void loop() {
\tvb = digitalRead(porta_botao);
\tif (vb == HIGH && vab == LOW) {
\t\tSerial.println("Botão pressionado");
\t\testado_led = !estado_led;
\t\tdigitalWrite(porta_led, estado_led);
\t}
\tvab = vb;
}`;

const SAMPLE_C = `#include <stdio.h>

int main() {
\tprintf("Olá, mundo!\\n");
}`;

function Index() {
  const [sampleType, setSampleType] = useState<"arduino" | "c">("c");
  const [code, setCode] = useState(SAMPLE_C);
  const [msPerLoop, setMsPerLoop] = useState(100);
  const [interp, setInterp] = useState<CInterpreter | null>(null);
  const [, setTick] = useState(0);
  const [codeZoom, setCodeZoom] = useState(1);
  const [memZoom, setMemZoom] = useState(1);
  const [outZoom, setOutZoom] = useState(1);
  const refresh = () => setTick((t) => t + 1);

  // Auto-execução
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoDelay, setAutoDelay] = useState<number | null>(null);
  const [showAutoPrompt, setShowAutoPrompt] = useState(false);
  const [autoDelayInput, setAutoDelayInput] = useState("500");
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    const i = new CInterpreter(code, msPerLoop);
    setInterp(i);
    refresh();
  }, [code, msPerLoop]);

  // Permite alterar a velocidade do loop em tempo de execução.
  useEffect(() => {
    if (interp) interp.setMsPerLoop(msPerLoop);
  }, [interp, msPerLoop]);

  const reset = useCallback(() => {
    setInterp(null);
    setAutoRunning(false);
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    refresh();
  }, []);

  const step = useCallback(() => {
    if (!interp) return;
    interp.step();
    refresh();
  }, [interp]);

  const runAll = useCallback(() => {
    if (!interp) return;
    let guard = 0;
    while (!interp.state.finished && !interp.state.awaitingInput && !interp.state.error && guard++ < 5000) {
      interp.step();
    }
    refresh();
  }, [interp]);

  const provideInput = useCallback((v: string) => {
    if (!interp) return;
    interp.provideInput(v);
    refresh();
  }, [interp]);

  // Painel de entradas pré-configuradas para digitalRead/analogRead.
  const [pinInputs, setPinInputs] = useState<Record<number, PinInputConfig>>({});
  const [showPinPanel, setShowPinPanel] = useState(false);

  // Quando o interpretador pedir uma leitura de pino e houver valor configurado,
  // injeta automaticamente — sem abrir o diálogo modal.
  useEffect(() => {
    if (!interp) return;
    const ai = interp.state.awaitingInput;
    if (!ai?.pinRead) return;
    const cfg = pinInputs[ai.pinRead.pin];
    if (!cfg) return;
    const expectedMode = ai.pinRead.fn === "digitalRead" ? "digital" : "analog";
    if (cfg.mode !== expectedMode) return;
    interp.provideInput(String(cfg.value));
    refresh();
  });

  // Auto-execução: avança uma linha a cada autoDelay ms
  useEffect(() => {
    if (!autoRunning || !interp || autoDelay == null) return;
    const s = interp.state;
    if (s.finished || s.error || s.awaitingInput) return;

    autoTimerRef.current = setTimeout(() => {
      interp.step();
      refresh();
    }, autoDelay);

    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  });

  const startAutoRun = useCallback(() => {
    const i = new CInterpreter(code, msPerLoop);
    setInterp(i);
    setAutoRunning(true);
    refresh();
  }, [code, msPerLoop]);

  const stopAutoRun = useCallback(() => {
    setAutoRunning(false);
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
  }, []);

  const state = interp?.state;
  const variables = state?.variables ?? [];
  const returns = state?.returns ?? [];
  const pinStates = state?.pinStates ?? [];

  // Retornos somem após alguns segundos. Mantemos um set de IDs ocultos
  // (preenchido por timers) e filtramos a lista exibida.
  const [hiddenReturnIds, setHiddenReturnIds] = useState<Set<number>>(new Set());
  const scheduledRef = useRef<Set<number>>(new Set());
  const RETURN_VISIBLE_MS = 4000;

  useEffect(() => {
    for (const r of returns) {
      if (scheduledRef.current.has(r.id)) continue;
      scheduledRef.current.add(r.id);
      const id = r.id;
      window.setTimeout(() => {
        setHiddenReturnIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }, RETURN_VISIBLE_MS);
    }
  }, [returns]);

  // Ao reiniciar a execução (interp muda), limpar a lista de ocultos.
  useEffect(() => {
    setHiddenReturnIds(new Set());
    scheduledRef.current = new Set();
  }, [interp]);

  const visibleReturns = returns.filter((r) => !hiddenReturnIds.has(r.id));

  // agrupar variáveis por escopo para visual
  const grouped = useMemo(() => {
    const m = new Map<string, typeof variables>();
    for (const v of variables) {
      const k = v.scope;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(v);
    }
    return Array.from(m.entries());
  }, [variables]);

  // Avisos pedagógicos: análise estática enquanto o aluno digita.
  // Não roda durante a execução (a linha atual já tem feedback próprio).
  const warnings = useMemo(
    () => (interp ? [] : analyzeCode(code, sampleType)),
    [code, interp, sampleType],
  );

  return (
    <main className="flex h-screen w-screen flex-col p-2 md:p-3">
      <header className="mb-2 w-full">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ThemeSwitcher />
          {sampleType === "arduino" && (
            <>
              <Button
                onClick={() => setShowPinPanel((v) => !v)}
                size="sm"
                variant={showPinPanel ? "default" : "outline"}
                className="chalk-text"
                title="Mostrar/ocultar entradas pré-configuradas de pinos"
              >
                <Cable className="mr-2 h-4 w-4" />
                Entradas de pinos
              </Button>
              <label className="chalk-text flex items-center gap-2 text-sm text-muted-foreground">
                ms/loop
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={msPerLoop}
                  onChange={(e) => setMsPerLoop(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 rounded-md border border-border bg-card/40 px-2 py-1 font-mono text-base text-foreground outline-none focus:border-primary"
                  style={{ fontFamily: "var(--font-mono)" }}
                />
              </label>
            </>
          )}
          {!interp ? (
            <>
              <div className="flex gap-1 rounded-md border border-border p-0.5">
                <Button
                  size="sm"
                  variant={sampleType === "arduino" ? "default" : "ghost"}
                  className="chalk-text h-7 px-3 text-xs"
                  onClick={() => { setSampleType("arduino"); setCode(SAMPLE_ARDUINO); }}
                >
                  Arduino
                </Button>
                <Button
                  size="sm"
                  variant={sampleType === "c" ? "default" : "ghost"}
                  className="chalk-text h-7 px-3 text-xs"
                  onClick={() => { setSampleType("c"); setCode(SAMPLE_C); }}
                >
                  Linguagem C
                </Button>
              </div>
              <Button onClick={start} size="lg" className="chalk-text text-base">
                <Play className="mr-2 h-4 w-4" /> Iniciar execução
              </Button>
              <Button onClick={() => setShowAutoPrompt(true)} size="lg" variant="secondary" className="chalk-text text-base">
                <Timer className="mr-2 h-4 w-4" /> Execução automática
              </Button>
            </>
          ) : (
            <>
              {!autoRunning && (
                <Button
                  onClick={step}
                  disabled={state?.finished || !!state?.error || !!state?.awaitingInput}
                  size="lg"
                  className="chalk-text text-base"
                >
                  <StepForward className="mr-2 h-4 w-4" /> Próxima linha
                </Button>
              )}
              {autoRunning && (
                <Button onClick={stopAutoRun} size="lg" className="chalk-text text-base" variant="destructive">
                  <StepForward className="mr-2 h-4 w-4" /> Modo manual
                </Button>
              )}
              <Button onClick={reset} variant="outline" size="lg" className="chalk-text text-base">
                <Square className="mr-2 h-4 w-4" /> Parar
              </Button>
            </>
          )}
          {interp && state && (
            <>
              <span className="chalk-text rounded-md border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">
                ⏱ <strong className="font-mono" style={{ fontFamily: "var(--font-mono)" }}>{Math.trunc(state.simMillis)} ms</strong>
              </span>
              {state.arduinoMode && (
                <span className="chalk-text rounded-md border border-border bg-card/40 px-3 py-1 text-sm text-muted-foreground">
                  🔁 <strong className="text-foreground">{state.loopIterations}</strong>
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {showPinPanel && (
        <div className="mb-2 w-full">
          <PinInputPanel pinInputs={pinInputs} onChange={setPinInputs} />
        </div>
      )}

      <div className="w-full flex-1 min-h-0">
        <ResizablePanelGroup orientation="horizontal" className="gap-0">
          {/* Coluna esquerda: editor */}
          <ResizablePanel defaultSize={55} minSize={20}>
            <section className="chalkboard relative flex h-full flex-col p-4">
              {state?.lastEvent && (
                <div className="chalk-text mb-2 rounded-md border border-primary/30 bg-primary/10 p-2 text-sm text-primary" style={{ zoom: codeZoom }}>
                  Linha {state.lastEvent.line || "—"}: {state.lastEvent.message.split("\n").map((part, i) => (
                    <span key={i} className={i > 0 ? "block mt-1 text-xs text-muted-foreground" : ""}>
                      {part}
                    </span>
                  ))}
                </div>
              )}
              {state?.error && (
                <div className="chalk-text mb-2 space-y-2" style={{ zoom: codeZoom }}>
                  <div className="rounded-md border border-destructive/50 bg-destructive/20 p-2 text-sm text-destructive-foreground">
                    ⚠ <strong>Erro do interpretador:</strong> {state.error}
                  </div>
                  {getErrorHint(state.error) && (
                    <div className="rounded-md border border-primary/40 bg-primary/10 p-2 text-sm text-primary">
                      💡 <strong>Dica:</strong> {getErrorHint(state.error)}
                    </div>
                  )}
                </div>
              )}
              {state?.finished && !state.error && (
                <div className="chalk-text mb-2 rounded-md border border-[oklch(0.85_0.15_145)]/40 bg-[oklch(0.85_0.15_145)]/15 p-2 text-sm" style={{ color: "var(--chalk-green)", zoom: codeZoom }}>
                  ✓ Execução finalizada com sucesso.
                </div>
              )}
              <div className="relative flex-1 overflow-hidden">
                <div className="h-full w-full" style={{ zoom: codeZoom }}>
                  <CodeEditor
                    code={code}
                    onChange={setCode}
                    highlightLine={state?.currentLine ?? 0}
                    highlight={state?.highlight ?? null}
                    errorLine={state?.error ? state?.currentLine ?? null : null}
                    readOnly={!!interp}
                    variables={variables}
                  />
                </div>
                <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2">
                  <div className="pointer-events-auto rounded-full border border-border bg-card/80 px-1 py-0.5 shadow-md backdrop-blur">
                    <ZoomControls zoom={codeZoom} setZoom={setCodeZoom} />
                  </div>
                </div>
              </div>
            </section>
          </ResizablePanel>

          <ResizableHandle withHandle className="mx-2 bg-primary/40 hover:bg-primary transition-colors" />

          {/* Coluna direita: variáveis + console (em execução) OU dicas pedagógicas (parado) */}
          <ResizablePanel defaultSize={45} minSize={20}>
            {!interp ? (
              <section className="chalkboard relative flex h-full flex-col p-4 overflow-hidden">
                <div className="chalk-text mb-3 text-sm uppercase tracking-widest text-muted-foreground">
                  💡 Dicas pedagógicas
                </div>
                <div className="flex-1 overflow-auto pr-1 space-y-2">
                  {warnings.length === 0 ? (
                    <p className="chalk-text text-muted-foreground">
                      Nenhum aviso encontrado. Seu código parece estar bem escrito! Inicie a execução para ver as variáveis e a saída.
                    </p>
                  ) : (
                    warnings.map((w, i) => (
                      <div
                        key={i}
                        className={
                          "chalk-text rounded-md border p-3 text-sm " +
                          (w.severity === "warning"
                            ? "border-[var(--chalk-orange)]/50 bg-[var(--chalk-orange)]/10 text-[var(--chalk-orange)]"
                            : "border-primary/30 bg-primary/10 text-primary")
                        }
                      >
                        {w.severity === "warning" ? "⚠" : "💡"} <strong>Linha {w.line}:</strong> {w.message}
                      </div>
                    ))
                  )}
                </div>
              </section>
            ) : (
            <section className="flex h-full flex-col gap-4">
              <div className="chalkboard relative flex flex-1 flex-col p-4 overflow-hidden">
                <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2">
                  <div className="pointer-events-auto rounded-full border border-border bg-card/80 px-1 py-0.5 shadow-md backdrop-blur">
                    <ZoomControls zoom={memZoom} setZoom={setMemZoom} />
                  </div>
                </div>
                <div className="flex-1 overflow-auto pr-1" style={{ zoom: memZoom }}>
                  {variables.length === 0 && visibleReturns.length === 0 && pinStates.length === 0 ? (
                    <p className="chalk-text text-muted-foreground">
                      Nenhuma variável criada ainda. Inicie a execução e avance linha a linha.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {pinStates.length > 0 && (
                        <div>
                          <div className="chalk-text mb-2 text-sm uppercase tracking-widest text-muted-foreground">
                            ⚡ Pinos configurados (INPUT / OUTPUT)
                          </div>
                          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                            {pinStates.map((p) => (
                              <PinCard key={p.pin} p={p} />
                            ))}
                          </div>
                        </div>
                      )}
                      {grouped.map(([scope, vars]) => (
                        <div key={scope}>
                          <div className="chalk-text mb-2 text-sm uppercase tracking-widest text-muted-foreground">
                            Escopo: <span className="text-primary">{scope === "global" ? "global" : scope.split("#")[0]}</span>
                          </div>
                          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                            {vars.map((v) => (
                              <VariableCard key={`${v.scope}-${v.name}`} v={v} />
                            ))}
                          </div>
                        </div>
                      ))}
                      {visibleReturns.length > 0 && (
                        <div>
                          <div className="chalk-text mb-2 text-sm uppercase tracking-widest text-muted-foreground">
                            ↩ Retornos de funções
                          </div>
                          <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                            {visibleReturns.map((r) => (
                              <div
                                key={r.id}
                                className={`chalk-text rounded-md border-2 border-dashed bg-card/30 p-3 transition-all ${r.justReturned ? "animate-chalk-write" : ""}`}
                                style={{
                                  borderColor: "var(--chalk-green)",
                                  boxShadow: "0 0 14px color-mix(in oklab, var(--chalk-green) 30%, transparent)",
                                }}
                              >
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-xs uppercase tracking-wider" style={{ color: "var(--chalk-green)" }}>
                                    return
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">linha {r.line}</span>
                                </div>
                                <div className="mt-1 text-lg font-semibold text-foreground">{r.fnName}( )</div>
                                <div
                                  className={`mt-1 font-mono text-3xl chalk-glow ${r.justReturned ? "animate-value-pop" : ""}`}
                                  style={{ color: "var(--chalk-green)", fontFamily: "var(--font-mono)" }}
                                >
                                  → {String(r.value)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="chalkboard relative flex h-[34%] flex-col p-4">
                <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2">
                  <div className="pointer-events-auto rounded-full border border-border bg-card/80 px-1 py-0.5 shadow-md backdrop-blur">
                    <ZoomControls zoom={outZoom} setZoom={setOutZoom} />
                  </div>
                </div>
                <div className="flex-1 overflow-hidden" style={{ zoom: outZoom }}>
                  <ConsolePanel lines={state?.output ?? []} />
                </div>
              </div>
            </section>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <InputDialog
        open={!!state?.awaitingInput}
        prompt={state?.awaitingInput?.prompt ?? ""}
        type={state?.awaitingInput?.type ?? ""}
        pinRead={state?.awaitingInput?.pinRead ?? null}
        onSubmit={provideInput}
      />

      <Dialog open={showAutoPrompt} onOpenChange={setShowAutoPrompt}>
        <DialogContent className="bg-card chalk-text">
          <DialogHeader>
            <DialogTitle className="chalk-text text-2xl text-primary chalk-glow">⏱ Auto execução</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            const ms = Math.max(50, parseInt(autoDelayInput) || 500);
            setAutoDelay(ms);
            setShowAutoPrompt(false);
            startAutoRun();
          }} className="space-y-3">
            <label className="chalk-text block text-sm text-muted-foreground">
              Tempo entre cada linha (em milissegundos):
            </label>
            <Input
              autoFocus
              type="number"
              min={50}
              step={50}
              value={autoDelayInput}
              onChange={(e) => setAutoDelayInput(e.target.value)}
              className="font-mono"
              style={{ fontFamily: "var(--font-mono)" }}
              placeholder="500"
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAutoPrompt(false)}>Cancelar</Button>
              <Button type="submit">Iniciar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
