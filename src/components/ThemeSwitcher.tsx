import { useEffect, useState } from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export type ThemeName = "chalkboard" | "light" | "contrast";

const STORAGE_KEY = "app-theme";
const THEMES: { id: ThemeName; label: string; desc: string }[] = [
  { id: "chalkboard", label: "Lousa (padrão)", desc: "Quadro-negro escuro com giz" },
  { id: "light", label: "Claro", desc: "Fundo claro — bom para sala iluminada" },
  { id: "contrast", label: "Alto contraste", desc: "Preto e amarelo, alta legibilidade" },
];

function applyTheme(t: ThemeName) {
  const root = document.documentElement;
  root.classList.remove("theme-light", "theme-contrast");
  if (t === "light") root.classList.add("theme-light");
  else if (t === "contrast") root.classList.add("theme-contrast");
}

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeName>("chalkboard");

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as ThemeName) || "chalkboard";
    setTheme(saved);
    applyTheme(saved);
  }, []);

  const choose = (t: ThemeName) => {
    setTheme(t);
    applyTheme(t);
    localStorage.setItem(STORAGE_KEY, t);
  };

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className="chalk-text text-base" title={`Tema: ${current.label}`}>
          <Palette className="mr-2 h-4 w-4" /> Tema
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Aparência</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onClick={() => choose(t.id)}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="font-semibold">
              {t.id === theme ? "✓ " : ""}
              {t.label}
            </span>
            <span className="text-xs text-muted-foreground">{t.desc}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
