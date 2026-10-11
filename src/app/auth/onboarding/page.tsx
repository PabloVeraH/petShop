"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { validateRUT } from "@/lib/validation";

export default function OnboardingPage() {
  const router = useRouter();
  const [storeName, setStoreName] = useState("");
  const [rut, setRut] = useState("");
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName.trim() || !rut.trim() || !address.trim()) return;
    if (!validateRUT(rut.trim())) {
      setError("RUT de la tienda inválido");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName: storeName.trim(), rut: rut.trim(), address: address.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Error al crear la tienda");
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Configurar tu tienda</h1>
        <p className="text-sm text-gray-500 mt-1">Un último paso para empezar</p>
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-base">Datos de la tienda</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="onboarding-name" className="text-sm font-medium text-gray-700 block mb-1">
                Nombre de la tienda
              </label>
              <Input
                id="onboarding-name"
                placeholder="Ej: PetShop La Reina"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                required
                minLength={3}
                maxLength={100}
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="onboarding-rut" className="text-sm font-medium text-gray-700 block mb-1">
                RUT de la tienda
              </label>
              <Input
                id="onboarding-rut"
                placeholder="Ej: 76.123.456-0"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                required
                maxLength={12}
              />
            </div>

            <div>
              <label htmlFor="onboarding-address" className="text-sm font-medium text-gray-700 block mb-1">
                Dirección
              </label>
              <Input
                id="onboarding-address"
                placeholder="Ej: Av. Ossa 123, La Reina"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                maxLength={200}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button
              type="submit"
              disabled={loading || !storeName.trim() || !rut.trim() || !address.trim()}
              className="w-full"
            >
              {loading ? "Creando..." : "Crear tienda"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
