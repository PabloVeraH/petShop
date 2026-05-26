"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

interface Store {
  id: string;
  name: string;
  openrouter_model: string | null;
}

interface IAConfigSectionProps {
  stores: Store[];
}

export function IAConfigSection({ stores }: IAConfigSectionProps) {
  const [models, setModels] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Initialize models from stores data
    const initialModels: Record<string, string> = {};
    stores.forEach(store => {
      initialModels[store.id] = store.openrouter_model || "z-ai/glm-4.5-air:free";
    });
    setModels(initialModels);
  }, [stores]);

  const handleSave = async (storeId: string) => {
    setSaved(prev => ({ ...prev, [storeId]: false }));
    setErrors(prev => ({ ...prev, [storeId]: "" }));

    const model = models[storeId];
    if (!model.trim()) {
      setErrors(prev => ({ ...prev, [storeId]: "El modelo no puede estar vacío" }));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/ai-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: storeId, openrouter_model: model.trim() }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Error al guardar");
      }

      setSaved(prev => ({ ...prev, [storeId]: true }));
      // Clear saved status after 2 seconds
      setTimeout(() => {
        setSaved(prev => ({ ...prev, [storeId]: false }));
      }, 2000);
    } catch (error) {
      setErrors(prev => ({
        ...prev,
        [storeId]: error instanceof Error ? error.message : "Error desconocido"
      }));
    } finally {
      setLoading(false);
    }
  };

  const getStoreName = (storeId: string) => {
    const store = stores.find(s => s.id === storeId);
    return store?.name || `Tienda ${storeId.slice(0, 8)}...`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span>🤖</span>
          Configuración de IA
        </CardTitle>
        <CardDescription>
          Configura el modelo de IA para cada tienda. La API key se configura en el servidor (.env).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
          <p><strong>Nota:</strong> Los modelos disponibles en OpenRouter incluyen:</p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li><code>z-ai/glm-4.5-air:free</code> - Gratuito (recomendado para empezar)</li>
            <li><code>openai/gpt-4o</code> - De pago (más potente)</li>
            <li><code>anthropic/claude-3-haiku</code> - De pago (rápido y económico)</li>
          </ul>
          <p className="mt-2">Solo los modelos de OpenRouter son compatibles.</p>
        </div>

        <div className="space-y-4">
          {Object.entries(models).map(([storeId, model]) => (
            <div key={storeId} className="flex items-center gap-3 p-3 border rounded-lg">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{getStoreName(storeId)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={model}
                    onChange={(e) => setModels(prev => ({ ...prev, [storeId]: e.target.value }))}
                    placeholder="z-ai/glm-4.5-air:free"
                    className="h-8 text-sm"
                  />
                  <Button
                    onClick={() => handleSave(storeId)}
                    disabled={loading || saved[storeId]}
                    size="sm"
                    className="h-8"
                  >
                    {saved[storeId] ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Guardar"
                    )}
                  </Button>
                </div>
                {errors[storeId] && (
                  <div className="flex items-center gap-1 mt-1">
                    <AlertCircle className="h-3 w-3 text-red-500" />
                    <span className="text-xs text-red-500">{errors[storeId]}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs text-muted-foreground">
          <p><strong>¿Necesitas ayuda?</strong></p>
          <p>Consulta la documentación de OpenRouter para ver todos los modelos disponibles: https://openrouter.ai/models</p>
        </div>
      </CardContent>
    </Card>
  );
}