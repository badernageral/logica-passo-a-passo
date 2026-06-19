import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

interface Props {
  zoom: number;
  setZoom: (z: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function ZoomControls({ zoom, setZoom, min = 0.7, max = 2.5, step = 0.15 }: Props) {
  const dec = () => setZoom(Math.max(min, +(zoom - step).toFixed(2)));
  const inc = () => setZoom(Math.min(max, +(zoom + step).toFixed(2)));
  const reset = () => setZoom(1);
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-7 w-7"
        onClick={dec}
        title="Diminuir tamanho"
        aria-label="Diminuir tamanho"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <button
        type="button"
        onClick={reset}
        className="chalk-text min-w-[42px] rounded px-1 text-xs text-muted-foreground hover:text-foreground"
        title="Restaurar tamanho"
      >
        {Math.round(zoom * 100)}%
      </button>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-7 w-7"
        onClick={inc}
        title="Aumentar tamanho"
        aria-label="Aumentar tamanho"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
