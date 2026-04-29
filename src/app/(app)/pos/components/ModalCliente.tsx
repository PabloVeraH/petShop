"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { usePOSStore } from "@/stores/pos";
import { getClienteByRUT, getMascotasByCliente } from "../api";
import { formatRUT, validateRUT } from "@/lib/validation";

interface AlimentoCheckItem {
  id: string;
  nombre: string;
  peso_gramos: number | null;
}

interface ConsumoConfig {
  mascota_id: string;
  producto_id: string;
  gramos_porcion: number;
  veces_dia: number;
}

async function getAlimentoCheck(ids: string[]): Promise<AlimentoCheckItem[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ ids: ids.join(",") });
  const res = await fetch(`/api/inventario/alimento-check?${params}`);
  if (!res.ok) return [];
  return res.json();
}

async function getConsumoConfigsCliente(clienteId: string): Promise<ConsumoConfig[]> {
  const params = new URLSearchParams({ clienteId });
  const res = await fetch(`/api/consumo-configs/cliente?${params}`);
  if (!res.ok) return [];
  return res.json();
}

async function saveConsumoConfig(config: { mascota_id: string; producto_id: string; gramos_porcion: number; veces_dia: number }) {
  await fetch("/api/consumo-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

interface ModalClienteProps {
  onClose: () => void;
}

export default function ModalCliente({ onClose }: ModalClienteProps) {
  const [rut, setRut] = useState("");
  const [selectedMascotaId, setSelectedMascotaId] = useState<string | undefined>();
  const [showRegister, setShowRegister] = useState(false);
  const [registerForm, setRegisterForm] = useState({ nombre: "", email: "", telefono: "" });
  const [registerError, setRegisterError] = useState("");
  const [porciones, setPorciones] = useState<Record<string, string>>({});
  const { setCliente, clearCliente, items } = usePOSStore();

  const rutValido = validateRUT(rut);

  const { data: cliente, isLoading: loadingCliente, error } = useQuery({
    queryKey: ["cliente", rut],
    queryFn: () => getClienteByRUT(rut),
    enabled: rutValido,
    retry: false,
  });

  const { data: mascotas } = useQuery({
    queryKey: ["mascotas", cliente?.id],
    queryFn: () => getMascotasByCliente(cliente!.id),
    enabled: !!cliente?.id,
  });

  const { data: fidelizacion, refetch: refetchFid } = useQuery({
    queryKey: ["fidelizacion", cliente?.id],
    queryFn: () => getFidelizacion(cliente!.id),
    enabled: !!cliente?.id,
  });

  const cartProductIds = items.map((i) => i.producto_id);

  const { data: alimentosEnCarrito } = useQuery({
    queryKey: ["alimento-check", cartProductIds.join(",")],
    queryFn: () => getAlimentoCheck(cartProductIds),
    enabled: cartProductIds.length > 0 && !!cliente?.id,
  });

  const { data: configsExistentes } = useQuery({
    queryKey: ["consumo-configs-cliente", cliente?.id],
    queryFn: () => getConsumoConfigsCliente(cliente!.id),
    enabled: !!cliente?.id,
  });

  const necesitaPrompt = mascotas && alimentosEnCarrito && mascotas.length > 0 && alimentosEnCarrito.length > 0
    ? mascotas.flatMap((mascota) =>
        alimentosEnCarrito
          .filter((prod) => !configsExistentes?.some(
            (c) => c.mascota_id === mascota.id && c.producto_id === prod.id
          ))
          .map((prod) => ({ mascota, prod }))
      )
    : [];

  const { mutate: registrarCliente, isPending: registrando } = useMutation({
    mutationFn: async () => {
      if (registerForm.nombre.trim().length < 3) throw new Error("Nombre mínimo 3 caracteres");
      const res = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rut, ...registerForm }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Error al registrar");
      return d;
    },
    onSuccess: (newCliente) => {
      setCliente(newCliente.id, undefined, 0);
      onClose();
    },
    onError: (e: Error) => setRegisterError(e.message),
  });

  const handleConfirm = async () => {
    if (!cliente) return;

    const saves: Promise<void>[] = [];
    for (const key of Object.keys(porciones)) {
      const [mascotaId, productoId] = key.split("|");
      const valor = Number(porciones[key]);
      if (valor > 0) {
        saves.push(saveConsumoConfig({
          mascota_id: mascotaId,
          producto_id: productoId,
          gramos_porcion: valor,
          veces_dia: 1,
        }).then(() => undefined));
      }
    }
    await Promise.allSettled(saves);

    setCliente(cliente.id, selectedMascotaId, fidelizacion?.descuento_actual ?? 0);
    onClose();
  };

  const handleSinCliente = () => {
    clearCliente();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <h2 className="text-base font-semibold mb-4">Seleccionar cliente</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              RUT del cliente
            </label>
            <Input
              placeholder="12.345.678-9"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              autoFocus
            />
            {rut && !rutValido && (
              <p className="text-xs text-red-500 mt-1">RUT inválido</p>
            )}
          </div>

          {loadingCliente && <p className="text-sm text-gray-400">Buscando...</p>}

          {error && (
            <p className="text-sm text-red-500">Error al buscar cliente</p>
          )}

          {rutValido && !loadingCliente && cliente === null && !showRegister && (
            <div className="rounded bg-yellow-50 border border-yellow-200 p-3 space-y-2">
              <p className="text-sm text-yellow-700">Cliente no encontrado.</p>
              <button
                onClick={() => { setShowRegister(true); setRegisterError(""); }}
                className="text-sm text-green-600 font-medium hover:underline"
              >
                + Registrar nuevo cliente
              </button>
            </div>
          )}

          {showRegister && !cliente && (
            <div className="rounded bg-green-50 border border-green-200 p-3 space-y-2">
              <p className="text-xs font-semibold text-green-700 mb-1">Nuevo cliente · {rut}</p>
              {[
                { label: "Nombre *", key: "nombre" as const, placeholder: "Juan Pérez" },
                { label: "Teléfono", key: "telefono" as const, placeholder: "912345678" },
                { label: "Email", key: "email" as const, placeholder: "juan@mail.com" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="text-xs text-gray-600">{label}</label>
                  <input
                    value={registerForm[key]}
                    onChange={(e) => setRegisterForm((f) => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full border border-gray-300 rounded px-2 py-1 text-sm mt-0.5 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
              ))}
              {registerError && <p className="text-xs text-red-500">{registerError}</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => registrarCliente()} disabled={registrando} className="flex-1">
                  {registrando ? "Registrando..." : "Registrar y continuar"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowRegister(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {cliente && (
            <div className="rounded bg-green-50 p-3">
              <p className="text-sm font-medium text-green-800">{cliente.nombre}</p>
              <p className="text-xs text-green-600">
                RUT: {formatRUT(cliente.rut)}{cliente.email ? ` · ${cliente.email}` : ""}
              </p>
              {fidelizacion && (
                <p className="text-xs text-green-700 mt-1 font-medium">
                  Fidelización: {fidelizacion.descuento_actual}% desc.
                  <span className="font-normal text-green-600 ml-1">
                    (${Math.round(Number(fidelizacion.total_historico)).toLocaleString("es-CL")} histórico · {fidelizacion.frecuencia_compras} compras)
                  </span>
                </p>
              )}

              {mascotas && mascotas.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-600 mb-2">Mascota (opcional)</p>
                  <div className="space-y-1">
                    {mascotas.map((m) => (
                      <button
                        key={m.id}
                        onClick={() =>
                          setSelectedMascotaId((prev) => (prev === m.id ? undefined : m.id))
                        }
                        className={`w-full text-left text-xs rounded px-2 py-1 transition-colors ${
                          selectedMascotaId === m.id
                            ? "bg-green-200 text-green-800"
                            : "bg-white hover:bg-green-100"
                        }`}
                      >
                        {m.nombre} ({m.tipo})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {necesitaPrompt.length > 0 && (
                <div className="mt-3 rounded bg-blue-50 border border-blue-200 p-3">
                  <p className="text-xs font-semibold text-blue-700 mb-2">Porción diaria de alimento (opcional)</p>
                  <p className="text-xs text-blue-600 mb-3">
                    Si nos indicas cuánto come tu mascota, te avisaremos cuando el alimento esté por acabarse.
                  </p>
                  <div className="space-y-3">
                    {necesitaPrompt.map(({ mascota, prod }) => {
                      const key = `${mascota.id}|${prod.id}`;
                      return (
                        <div key={key}>
                          <p className="text-xs font-medium text-gray-700">
                            {mascota.nombre} ({mascota.tipo}) — {prod.nombre}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <input
                              type="number"
                              placeholder="gramos/día"
                              value={porciones[key] ?? ""}
                              onChange={(e) => setPorciones((p) => ({ ...p, [key]: e.target.value }))}
                              className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
                              min="1"
                            />
                            <span className="text-xs text-gray-500">g/día</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={handleSinCliente} className="flex-1">
              Sin cliente
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={rutValido && !loadingCliente && !cliente && rut !== ""}
              className="flex-1"
            >
              Confirmar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function getFidelizacion(clienteId: string) {
  const res = await fetch(`/api/fidelizacion?clienteId=${clienteId}`);
  if (!res.ok) return null;
  return res.json() as Promise<{ total_historico: number; frecuencia_compras: number; descuento_actual: number } | null>;
}