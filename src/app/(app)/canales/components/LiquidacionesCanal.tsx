"use client";

import { useCallback, useEffect, useState } from "react";

// Liquidaciones de la plataforma (Fase 5, 5.2 — D17/D24): el admin registra
// lo que la plataforma depositó; el servidor calcula el neto y genera el
// asiento (Banco + Comisión neta + IVA crédito / CxC canal). Solo admin: el
// control real está en la API.

interface Liquidacion {
  id: string;
  periodo_desde: string;
  periodo_hasta: string;
  monto_bruto: number;
  comision: number;
  monto_neto: number;
  referencia: string | null;
  journal_entry_id: string | null;
}

const clp = (n: number) => `$${Math.round(Number(n)).toLocaleString("es-CL")}`;
const VACIO = { periodo_desde: "", periodo_hasta: "", fecha_deposito: "", monto_bruto: "", comision: "", referencia: "" };

export default function LiquidacionesCanal({ canalId, nombre }: { canalId: string; nombre: string }) {
  const [lista, setLista] = useState<Liquidacion[]>([]);
  const [form, setForm] = useState(VACIO);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/canales/liquidacion?canal=${canalId}`);
    if (!res.ok) {
      setError("No se pudieron cargar las liquidaciones");
      return;
    }
    const data = await res.json();
    setLista(Array.isArray(data) ? data : []);
  }, [canalId]);

  useEffect(() => {
    cargar().catch(() => setError("No se pudieron cargar las liquidaciones"));
  }, [cargar]);

  const bruto = Number(form.monto_bruto);
  const comision = Number(form.comision);
  const netoPrevio = form.monto_bruto !== "" && form.comision !== "" ? bruto - comision : null;

  async function registrar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setAviso("");
    if (!form.periodo_desde || !form.periodo_hasta || !form.fecha_deposito) {
      setError("Completa el período y la fecha de depósito");
      return;
    }
    if (!(Number.isInteger(bruto) && bruto > 0) || !(Number.isInteger(comision) && comision >= 0) || comision > bruto) {
      setError("Montos inválidos: enteros, bruto mayor que 0 y comisión entre 0 y el bruto");
      return;
    }
    setGuardando(true);
    try {
      const res = await fetch("/api/canales/liquidacion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canal_id: canalId,
          periodo_desde: form.periodo_desde,
          periodo_hasta: form.periodo_hasta,
          fecha_deposito: form.fecha_deposito,
          monto_bruto: bruto,
          comision,
          ...(form.referencia.trim() ? { referencia: form.referencia.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((data && data.error) || "No se pudo registrar la liquidación");
        return;
      }
      setForm(VACIO);
      setAviso("Liquidación registrada y contabilizada.");
      await cargar();
    } catch {
      setError("Error de red registrando la liquidación");
    } finally {
      setGuardando(false);
    }
  }

  const campo = (k: keyof typeof VACIO, label: string, type: string) => (
    <label className="text-xs text-gray-600">
      {label}
      <input
        type={type}
        value={form[k]}
        onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="mt-1 block w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
      />
    </label>
  );

  return (
    <section aria-label={`Liquidaciones ${nombre}`} className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-800">Liquidaciones de {nombre}</h2>
      <p className="text-xs text-gray-500 mb-4">
        Registra cada depósito de la plataforma: se salda la cuenta por cobrar y la comisión se contabiliza
        como gasto con su IVA crédito fiscal.
      </p>

      <form onSubmit={registrar} className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {campo("periodo_desde", "Período desde", "date")}
        {campo("periodo_hasta", "Período hasta", "date")}
        {campo("fecha_deposito", "Fecha de depósito", "date")}
        {campo("monto_bruto", "Ventas del período (con IVA)", "number")}
        {campo("comision", "Comisión (con IVA)", "number")}
        {campo("referencia", "Referencia (opcional)", "text")}
        <div className="col-span-2 md:col-span-3 flex items-center justify-between">
          <span className="text-sm text-gray-600">
            Depositado: <strong>{netoPrevio == null ? "—" : clp(netoPrevio)}</strong>
          </span>
          <button
            type="submit"
            disabled={guardando}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {guardando ? "Registrando..." : "Registrar liquidación"}
          </button>
        </div>
      </form>

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {aviso && <p role="status" className="mt-3 text-sm text-green-700">{aviso}</p>}

      <table className="mt-4 w-full text-sm">
        <thead className="border-b border-gray-200 text-gray-500">
          <tr>
            <th className="text-left py-1 font-medium">Período</th>
            <th className="text-right py-1 font-medium">Bruto</th>
            <th className="text-right py-1 font-medium">Comisión</th>
            <th className="text-right py-1 font-medium">Depositado</th>
            <th className="text-left py-1 pl-3 font-medium">Referencia</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((l) => (
            <tr key={l.id} className="border-b border-gray-100">
              <td className="py-1">{l.periodo_desde} al {l.periodo_hasta}</td>
              <td className="py-1 text-right">{clp(l.monto_bruto)}</td>
              <td className="py-1 text-right">{clp(l.comision)}</td>
              <td className="py-1 text-right">{clp(l.monto_neto)}</td>
              <td className="py-1 pl-3 text-gray-500">{l.referencia ?? "—"}</td>
            </tr>
          ))}
          {lista.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-gray-400">Sin liquidaciones registradas</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
