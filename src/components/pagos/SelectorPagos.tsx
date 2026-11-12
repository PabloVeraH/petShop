"use client";

// Selector de medios de pago (pago mixto) compartido por el cobro del POS y el
// de citas: filas método/monto/TRX, NC con validación, saldo a favor, "resto"
// y aviso de cuánto boletear (Res. Ex. SII 176/2020). Componente controlado:
// el estado de cobro vive en el modal que lo usa (no en el store ni en
// localStorage, ticket Trello 6a619fafd0aa9aa5ad06b1dd). La validación final
// es del servidor (validarPagos + RPC); aquí solo se guía al cajero.
// Diseño: docs/plan_pago_mixto.md §2.5.

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  MAX_PAGOS,
  METODOS_CON_TRX,
  calcularMontoBoleta,
  desgloseBoleta,
  etiquetaMetodo,
  validarPagos,
  type MetodoPago,
  type PagoInput,
} from "@/lib/ventas/pagos";

export interface NcValidada {
  id: string;
  numero_nc: string;
  monto_disponible: number;
  fecha_vencimiento: string | null;
}

export interface FilaPago {
  id: string;
  metodo: MetodoPago;
  monto: number;
  numeroTransaccion?: string;
  nc?: NcValidada;
}

const OPCIONES: { value: MetodoPago; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "debito", label: "Débito" },
  { value: "credito", label: "Crédito" },
  { value: "transferencia", label: "Transferencia" },
  { value: "nota_credito", label: "Nota de crédito" },
  { value: "saldo_a_favor", label: "Saldo a favor" },
];

const pesos = (n: number) => `$${n.toLocaleString("es-CL")}`;

function nuevaFila(metodo: MetodoPago, monto: number): FilaPago {
  return { id: crypto.randomUUID(), metodo, monto };
}

export function filasIniciales(total: number): FilaPago[] {
  return [nuevaFila("efectivo", total)];
}

export function filasAPagos(filas: FilaPago[]): PagoInput[] {
  return filas.map((f) => ({
    metodo: f.metodo,
    monto: f.monto,
    ...(f.numeroTransaccion?.trim() ? { numeroTransaccion: f.numeroTransaccion.trim() } : {}),
    ...(f.metodo === "nota_credito" && f.nc ? { notaCreditoId: f.nc.id } : {}),
  }));
}

// null si se puede cobrar; si no, el motivo para mostrar al cajero. Misma
// regla que el servidor (validarPagos) + lo que solo la UI sabe: una NC sin
// validar, o un monto mayor a lo disponible de la NC / del saldo.
export function errorFilas(filas: FilaPago[], total: number, clienteId?: string, saldoDisponible?: number | null): string | null {
  for (const f of filas) {
    if (f.metodo === "nota_credito") {
      if (!f.nc) return "Valida la nota de crédito";
      if (f.monto > f.nc.monto_disponible) return `La nota de crédito tiene ${pesos(f.nc.monto_disponible)} disponibles`;
    }
    if (f.metodo === "saldo_a_favor" && saldoDisponible != null && f.monto > saldoDisponible) {
      return `El saldo a favor disponible es ${pesos(saldoDisponible)}`;
    }
  }
  return validarPagos(filasAPagos(filas), total, clienteId);
}

interface SelectorPagosProps {
  total: number;
  filas: FilaPago[];
  onChange: (filas: FilaPago[]) => void;
  clienteId?: string;
  // Aviso de 135 UF (Ley 21.713): umbral configurado por la tienda; null = sin aviso.
  umbralIdentificacion?: number | null;
  // Notifica el saldo a favor consultado, para que el modal valide con él.
  onSaldoDisponible?: (saldo: number | null) => void;
}

export default function SelectorPagos({
  total, filas, onChange, clienteId, umbralIdentificacion, onSaldoDisponible,
}: SelectorPagosProps) {
  const suma = filas.reduce((s, f) => s + (Number.isFinite(f.monto) ? f.monto : 0), 0);
  const resto = total - suma;
  const usaSaldo = filas.some((f) => f.metodo === "saldo_a_favor");

  // Si cambia el total (p. ej. el descuento) y había un solo pago en dinero
  // que lo cubría entero, ese pago sigue al total nuevo. Solo ante un cambio
  // del TOTAL: si reaccionara a cada render, revertiría la edición del cajero
  // al bajar el monto para dividir el pago.
  const totalAnterior = useRef(total);
  useEffect(() => {
    const previo = totalAnterior.current;
    totalAnterior.current = total;
    if (previo === total || filas.length !== 1) return;
    const f = filas[0];
    if (f.metodo !== "nota_credito" && f.metodo !== "saldo_a_favor" && f.monto === previo) {
      onChange([{ ...f, monto: total }]);
    }
  }, [total, filas, onChange]);

  // Saldo a favor del cliente (solo si hay una fila de saldo). El valor
  // vigente se deriva en el render: sin fila de saldo o sin cliente es null,
  // sin tener que resetear estado dentro del efecto.
  const [saldoConsultado, setSaldo] = useState<number | null>(null);
  const [saldoError, setSaldoError] = useState<string | null>(null);
  const saldo = usaSaldo && clienteId ? saldoConsultado : null;
  useEffect(() => {
    if (!usaSaldo || !clienteId) return;
    let vigente = true;
    fetch(`/api/saldos-a-favor?clienteId=${encodeURIComponent(clienteId)}`)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}));
        if (!vigente) return;
        if (!r.ok) { setSaldoError(json.error ?? "No se pudo consultar el saldo a favor"); setSaldo(null); return; }
        setSaldoError(null);
        setSaldo(Math.floor(Number(json.saldo_disponible ?? 0)));
      })
      .catch(() => vigente && setSaldoError("No se pudo consultar el saldo a favor"));
    return () => { vigente = false; };
  }, [usaSaldo, clienteId]);
  useEffect(() => { onSaldoDisponible?.(saldo); }, [saldo, onSaldoDisponible]);

  function actualizar(id: string, cambio: Partial<FilaPago>) {
    onChange(filas.map((f) => (f.id === id ? { ...f, ...cambio } : f)));
  }

  function cambiarMetodo(fila: FilaPago, metodo: MetodoPago) {
    actualizar(fila.id, {
      metodo,
      nc: undefined,
      numeroTransaccion: METODOS_CON_TRX.has(metodo) ? fila.numeroTransaccion : undefined,
      // Al pasar a NC el monto lo fija la validación.
      monto: metodo === "nota_credito" ? 0 : fila.monto,
    });
  }

  function agregar() {
    onChange([...filas, nuevaFila("efectivo", Math.max(resto, 0))]);
  }

  return (
    <div className="space-y-2" data-testid="selector-pagos">
      <label className="text-sm font-medium text-gray-700 block">Medios de pago</label>

      {filas.map((fila, i) => {
        const otraNc = filas.some((f) => f.id !== fila.id && f.metodo === "nota_credito");
        const otroSaldo = filas.some((f) => f.id !== fila.id && f.metodo === "saldo_a_favor");
        const disponible = (m: MetodoPago) => {
          if (m === "nota_credito") return !otraNc && !otroSaldo;
          if (m === "saldo_a_favor") return !!clienteId && !otroSaldo && !otraNc;
          return true;
        };
        return (
          <div key={fila.id} className="rounded border border-gray-200 p-2 space-y-2" data-testid={`fila-pago-${i}`}>
            <div className="flex gap-2 items-center">
              <select
                aria-label={`Método del pago ${i + 1}`}
                value={fila.metodo}
                onChange={(e) => cambiarMetodo(fila, e.target.value as MetodoPago)}
                className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
              >
                {OPCIONES.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.value !== fila.metodo && !disponible(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                aria-label={`Monto del pago ${i + 1}`}
                value={Number.isFinite(fila.monto) ? fila.monto : ""}
                disabled={fila.metodo === "nota_credito" && !fila.nc}
                onChange={(e) => actualizar(fila.id, { monto: e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)) })}
                className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm text-right"
              />
              {filas.length > 1 && (
                <button
                  type="button"
                  aria-label={`Quitar pago ${i + 1}`}
                  onClick={() => onChange(filas.filter((f) => f.id !== fila.id))}
                  className="text-gray-400 hover:text-red-600 px-1"
                >
                  ✕
                </button>
              )}
            </div>

            {METODOS_CON_TRX.has(fila.metodo) && (
              <input
                type="text"
                aria-label={`N° de transacción del pago ${i + 1}`}
                placeholder="N° de transacción (obligatorio)"
                value={fila.numeroTransaccion ?? ""}
                maxLength={100}
                onChange={(e) => actualizar(fila.id, { numeroTransaccion: e.target.value })}
                className={`w-full rounded border px-2 py-1.5 text-sm ${fila.numeroTransaccion?.trim() ? "border-gray-300" : "border-amber-400"}`}
              />
            )}

            {fila.metodo === "nota_credito" && (
              <ValidadorNc
                fila={fila}
                maxAplicable={total - (suma - (Number.isFinite(fila.monto) ? fila.monto : 0))}
                onValidada={(nc, monto) => actualizar(fila.id, { nc, monto })}
              />
            )}

            {fila.metodo === "saldo_a_favor" && (
              <p className="text-xs text-gray-600">
                {saldoError
                  ? <span className="text-red-600">{saldoError}</span>
                  : saldo === null ? "Consultando saldo…" : `Saldo disponible: ${pesos(saldo)}`}
              </p>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between text-sm">
        {filas.length < MAX_PAGOS && resto > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={agregar}>
            + Agregar medio de pago
          </Button>
        ) : <span />}
        <span
          data-testid="resto-pago"
          className={resto === 0 ? "text-green-700 font-medium" : "text-red-600 font-medium"}
        >
          {resto === 0 ? "✓ Total cubierto" : resto > 0 ? `Falta ${pesos(resto)}` : `Sobra ${pesos(-resto)}`}
        </span>
      </div>

      {resto === 0 && <AvisoBoleta pagos={filasAPagos(filas)} />}

      {umbralIdentificacion != null && total > umbralIdentificacion && (
        <p className="rounded bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800" data-testid="aviso-135uf">
          Venta sobre {pesos(umbralIdentificacion)} (135 UF): la boleta debe identificar al comprador con nombre y RUT (Ley 21.713).
        </p>
      )}
    </div>
  );
}

// Aviso al cajero: cuánto boletear fuera del sistema (no se imprime en el ticket).
export function AvisoBoleta({ pagos }: { pagos: { metodo: string; monto: number }[] }) {
  const monto = calcularMontoBoleta(pagos);
  if (monto === 0) {
    return (
      <p className="rounded bg-gray-50 border p-2 text-xs text-gray-600" data-testid="aviso-boleta">
        El voucher Transbank cubre el total: no requiere boleta.
      </p>
    );
  }
  const desglose = desgloseBoleta(pagos).map((d) => `${etiquetaMetodo(d.metodo)} ${pesos(d.monto)}`).join(", ");
  return (
    <p className="rounded bg-blue-50 border border-blue-200 p-2 text-xs text-blue-800" data-testid="aviso-boleta">
      <strong>Emitir boleta SII por {pesos(monto)}</strong> ({desglose}). El voucher solo cubre lo pagado con tarjeta.
    </p>
  );
}

function ValidadorNc({
  fila, maxAplicable, onValidada,
}: {
  fila: FilaPago;
  maxAplicable: number;
  onValidada: (nc: NcValidada, monto: number) => void;
}) {
  const [codigo, setCodigo] = useState("");
  const [validando, setValidando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function validar() {
    if (!codigo.trim()) return;
    setValidando(true);
    setError(null);
    try {
      const res = await fetch(`/api/notas-credito?numero_nc=${encodeURIComponent(codigo.trim())}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error ?? "Error validando la nota de crédito"); return; }
      const nc = json.data as NcValidada;
      onValidada(nc, Math.max(0, Math.min(nc.monto_disponible, maxAplicable)));
    } catch {
      setError("No se pudo validar la nota de crédito");
    } finally {
      setValidando(false);
    }
  }

  if (fila.nc) {
    return (
      <p className="text-xs text-amber-800 bg-amber-50 rounded p-1.5">
        NC <span className="font-mono">{fila.nc.numero_nc}</span> · disponible {pesos(fila.nc.monto_disponible)}
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          type="text"
          aria-label="Código de la nota de crédito"
          placeholder="Código NC (ej: NC-20260508-ABCD1234)"
          value={codigo}
          onChange={(e) => { setCodigo(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); validar(); } }}
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
        />
        <Button type="button" size="sm" variant="outline" onClick={validar} disabled={validando || !codigo.trim()}>
          {validando ? "..." : "Validar"}
        </Button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
