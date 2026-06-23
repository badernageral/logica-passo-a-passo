import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Tab", desc: "Insere uma tabulação" },
  { keys: "Shift + Tab", desc: "Remove uma tabulação à esquerda" },
  { keys: "Tab (com seleção)", desc: "Indenta todas as linhas selecionadas" },
  { keys: "Shift + Tab (com seleção)", desc: "Desindenta todas as linhas selecionadas" },
  {
    keys: "Ctrl + ← / →",
    desc: "Seleciona a palavra sob o cursor; pressionando novamente, seleciona a próxima ocorrência igual",
  },
  {
    keys: "Ctrl + D",
    desc: "Renomeia todas as ocorrências da palavra selecionada (substitui em massa)",
  },
  { keys: "Ctrl + L", desc: "Seleciona a linha atual" },
  { keys: "Ctrl + Shift + K", desc: "Apaga a linha atual" },
  { keys: "Ctrl + ↓", desc: "Duplica a linha (ou seleção) para baixo" },
  { keys: "Alt + ↑ / ↓", desc: "Move a linha atual (ou seleção) para cima / baixo" },
  { keys: "Ctrl + /", desc: "Comenta / descomenta as linhas selecionadas" },
  { keys: "Ctrl + Enter", desc: "Insere uma nova linha abaixo, mantendo a indentação" },
  { keys: "Ctrl + Shift + Enter", desc: "Insere uma nova linha acima, mantendo a indentação" },
  {
    keys: "Home",
    desc: "Vai ao primeiro caractere não-branco da linha; pressionando novamente, vai ao início",
  },
  {
    keys: "Botão direito → Auto tabular",
    desc: "Re-indenta automaticamente o código selecionado (ou tudo)",
  },
];

export function ShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Atalhos do editor</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {SHORTCUTS.map((s, i) => (
                <tr key={i} className="border-b border-border/40 last:border-0">
                  <td className="whitespace-nowrap py-2 pr-4 align-top">
                    <kbd
                      className="rounded border border-border bg-secondary/60 px-2 py-0.5 font-mono text-xs"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {s.keys}
                    </kbd>
                  </td>
                  <td className="py-2 text-muted-foreground">{s.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
