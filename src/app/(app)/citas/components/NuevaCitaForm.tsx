"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Cliente, Mascota, Servicio, SlotDisponible } from "@/types";
import { autoFormatRUT, formatRUTMiles, pareceRUT } from "./rut-format";

interface ClientesResponse {
  data: Cliente[];
  count: number;
}

export function NuevaCitaForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [searchCliente, setSearchCliente] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [mascotaId, setMascotaId] = useState("");
  const [servicioId, setServicioId] = useState("");
  const [fecha, setFecha] = useState("");
  const [slotSel, setSlotSel] = useState<string>("");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");

  // searchCliente es lo que SE MUESTRA (formato RUT left-to-right propio de
  // /citas). apiSearch es lo que se ENVÍA a /api/clientes — en formato
  // miles-from-right si pareceRUT, para matchear el stored `rut` persistido
  // con formatRUT; texto plano en caso contrario (búsqueda por nombre).
  const apiSearch = useMemo(
    () => (pareceRUT(searchCliente) ? formatRUTMiles(searchCliente) : searchCliente),
    [searchCliente]
  );

  const { data: clientesData } = useQuery<ClientesResponse>({
    queryKey: ["clientes-cita", apiSearch],
    queryFn: () => fetch(`/api/clientes?search=${encodeURIComponent(apiSearch)}`).then((r) => r.json()),
  });
  const clientes = clientesData?.data ?? [];

  const { data: mascotas = [] } = useQuery<Mascota[]>({
    queryKey: ["mascotas-cita", clienteId],
    queryFn: () => fetch(`/api/mascotas?clienteId=${clienteId}`).then((r) => r.json()),
    enabled: !!clienteId,
  });

  const { data: servicios = [] } = useQuery<Servicio[]>({
    queryKey: ["servicios"],
    queryFn: () => fetch("/api/servicios").then((r) => r.json()),
  });

  const { data: slots = [], isFetching: cargandoSlots } = useQuery<SlotDisponible[]>({
    queryKey: ["disponibilidad", servicioId, fecha],
    queryFn: () =>
      fetch(`/api/servicios/${servicioId}/disponibilidad?fecha=${fecha}`).then(async (r) => {
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.error ?? "Error consultando disponibilidad");
        }
        return r.json();
      }),
    enabled: !!servicioId && !!fecha,
  });

  const { mutate: crear, isPending } = useMutation({
    mutationFn: () =>
      fetch("/api/citas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicio_id: servicioId,
          cliente_id: clienteId,
          mascota_id: mascotaId || undefined,
          fecha,
          hora_inicio: slotSel,
          notas: notas || undefined,
        }),
      }).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Error al crear la cita");
        return d;
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["citas"] });
      queryClient.invalidateQueries({ queryKey: ["disponibilidad"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const puedeConfirmar = clienteId && servicioId && fecha && slotSel && !isPending;

  return (
    <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg mx-4">
      <h3 className="text-base font-semibold text-gray-800 mb-4">Nueva cita</h3>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Cliente *</label>
          {!clienteId ? (
            <>
              <Input
                placeholder="Buscar por nombre o RUT..."
                value={searchCliente}
                onChange={(e) => {
                  const v = e.target.value;
                  setSearchCliente(pareceRUT(v) ? autoFormatRUT(v) : v);
                }}
              />
              <div className="mt-1 max-h-32 overflow-y-auto border border-gray-100 rounded">
                {clientes.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setClienteId(c.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-green-50 border-b last:border-0"
                  >
                    <span className="font-medium">{c.nombre}</span>
                    <span className="text-xs text-gray-400 ml-2">{c.rut}</span>
                  </button>
                ))}
                {clientes.length === 0 && (
                  <p className="text-xs text-gray-400 p-3 text-center">Sin resultados</p>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between bg-green-50 rounded px-3 py-2">
              <span className="text-sm font-medium text-green-800">
                {clientes.find((c) => c.id === clienteId)?.nombre ?? "Cliente seleccionado"}
              </span>
              <button
                onClick={() => { setClienteId(""); setMascotaId(""); }}
                className="text-xs text-green-600 hover:underline"
              >
                Cambiar
              </button>
            </div>
          )}
        </div>

        {clienteId && mascotas.length > 0 && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Mascota (opcional)</label>
            <select
              value={mascotaId}
              onChange={(e) => setMascotaId(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-3 py-2"
            >
              <option value="">Sin mascota específica</option>
              {mascotas.map((m) => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-xs text-gray-500 block mb-1">Servicio *</label>
          <select
            value={servicioId}
            onChange={(e) => { setServicioId(e.target.value); setSlotSel(""); }}
            className="w-full text-sm border border-gray-300 rounded px-3 py-2"
          >
            <option value="">Seleccionar servicio...</option>
            {servicios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre} ({s.duracion_minutos} min)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 block mb-1">Fecha *</label>
          <Input
            type="date"
            value={fecha}
            onChange={(e) => { setFecha(e.target.value); setSlotSel(""); }}
          />
        </div>

        {servicioId && fecha && (
          <div>
            <label className="text-xs text-gray-500 block mb-1">Horario disponible *</label>
            {cargandoSlots && <p className="text-xs text-gray-400 py-2">Consultando disponibilidad...</p>}
            {!cargandoSlots && slots.length === 0 && (
              <p className="text-xs text-gray-400 py-2">Sin horarios disponibles para ese día</p>
            )}
            {!cargandoSlots && slots.length > 0 && (
              <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                {slots.map((s) => (
                  <button
                    key={s.hora_inicio}
                    onClick={() => setSlotSel(s.hora_inicio)}
                    className={`text-sm rounded px-2 py-1.5 border ${
                      slotSel === s.hora_inicio
                        ? "bg-green-600 text-white border-green-600"
                        : "bg-white text-gray-700 border-gray-300 hover:border-green-400"
                    }`}
                  >
                    {s.hora_inicio}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="text-xs text-gray-500 block mb-1">Notas (opcional)</label>
          <Input
            placeholder="Observaciones de la cita..."
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <div className="flex gap-2 mt-5">
        <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
        <Button onClick={() => crear()} disabled={!puedeConfirmar} className="flex-1">
          {isPending ? "Agendando..." : "Agendar cita"}
        </Button>
      </div>
    </div>
  );
}
