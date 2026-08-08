"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminRole } from "@/hooks/useAdminAuth";
import { ModalOverlay } from "@/components/ui/modal-overlay";

type AuditLog = {
  id: string;
  store_id: string;
  user_id: string;
  user_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  change_description: string | null;
  ip_address: string | null;
  user_agent: string | null;
  result: string;
  error_message: string | null;
  created_at: string;
};

type ErrorLog = {
  id: string;
  store_id: string | null;
  user_id: string | null;
  error_code: string | null;
  error_message: string;
  stack_trace: string | null;
  context: Record<string, unknown> | null;
  severity: string;
  endpoint: string | null;
  ip_address: string | null;
  user_agent: string | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

type UserSession = {
  id: string;
  store_id: string;
  user_id: string;
  clerk_session_id: string | null;
  event_type: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type AuditFilters = {
  user_id: string;
  action: string;
  entity_type: string;
  result: string;
  desde: string;
  hasta: string;
};

type ErrorFilters = {
  severity: string;
  resolved: string;
  endpoint: string;
  desde: string;
  hasta: string;
};

type SessionFilters = {
  user_id: string;
  event_type: string;
  desde: string;
  hasta: string;
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-green-100 text-green-800",
  UPDATE: "bg-blue-100 text-blue-800",
  DELETE: "bg-red-100 text-red-800",
  LOGIN_FAILED: "bg-orange-100 text-orange-800",
  EXPORT: "bg-gray-100 text-gray-800",
  SETTINGS: "bg-purple-100 text-purple-800",
  BAN_USER: "bg-red-900 text-red-100",
  UNBAN_USER: "bg-green-900 text-green-100",
};

const RESULT_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-800",
  failure: "bg-red-100 text-red-800",
  partial: "bg-yellow-100 text-yellow-800",
};

const SEVERITY_COLORS: Record<string, string> = {
  INFO: "bg-gray-100 text-gray-800",
  WARNING: "bg-yellow-100 text-yellow-800",
  ERROR: "bg-orange-100 text-orange-800",
  CRITICAL: "bg-red-900 text-red-100",
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  "session.created": "bg-green-100 text-green-800",
  "session.ended": "bg-gray-100 text-gray-800",
  "session.removed": "bg-red-100 text-red-800",
};

interface AuditoriaCardProps {
  role: AdminRole;
}

export function AuditoriaCard({ role }: AuditoriaCardProps) {
  const [activeTab, setActiveTab] = useState<"audit" | "errors" | "sessions">("audit");
  const [page, setPage] = useState(0);
  const [modalLog, setModalLog] = useState<AuditLog | ErrorLog | null>(null);
  const limit = 50;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setModalLog(null); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const [auditFilters, setAuditFilters] = useState<AuditFilters>({
    user_id: "",
    action: "",
    entity_type: "",
    result: "",
    desde: "",
    hasta: "",
  });

  const [errorFilters, setErrorFilters] = useState<ErrorFilters>({
    severity: "",
    resolved: "",
    endpoint: "",
    desde: "",
    hasta: "",
  });

  const [sessionFilters, setSessionFilters] = useState<SessionFilters>({
    user_id: "",
    event_type: "",
    desde: "",
    hasta: "",
  });

  const queryClient = useQueryClient();

  const auditQueryParams = useMemo(() => {
    const params: Record<string, string> = { offset: String(page * limit), limit: String(limit) };
    if (auditFilters.user_id) params.user_id = auditFilters.user_id;
    if (auditFilters.action) params.action = auditFilters.action;
    if (auditFilters.entity_type) params.entity_type = auditFilters.entity_type;
    if (auditFilters.result) params.result = auditFilters.result;
    if (auditFilters.desde) params.desde = auditFilters.desde;
    if (auditFilters.hasta) params.hasta = auditFilters.hasta;
    return params;
  }, [auditFilters, page]);

  const errorQueryParams = useMemo(() => {
    const params: Record<string, string> = { offset: String(page * limit), limit: String(limit) };
    if (errorFilters.severity) params.severity = errorFilters.severity;
    if (errorFilters.resolved) params.resolved = errorFilters.resolved;
    if (errorFilters.endpoint) params.endpoint = errorFilters.endpoint;
    if (errorFilters.desde) params.desde = errorFilters.desde;
    if (errorFilters.hasta) params.hasta = errorFilters.hasta;
    return params;
  }, [errorFilters, page]);

  const sessionQueryParams = useMemo(() => {
    const params: Record<string, string> = { offset: String(page * limit), limit: String(limit) };
    if (sessionFilters.user_id) params.user_id = sessionFilters.user_id;
    if (sessionFilters.event_type) params.event_type = sessionFilters.event_type;
    if (sessionFilters.desde) params.desde = sessionFilters.desde;
    if (sessionFilters.hasta) params.hasta = sessionFilters.hasta;
    return params;
  }, [sessionFilters, page]);

  const { data: auditData, isLoading: auditLoading } = useQuery<{ data: AuditLog[]; count: number }>({
    queryKey: ["audit-logs", auditQueryParams],
    queryFn: () =>
      fetch(`/api/audit-logs?${new URLSearchParams(auditQueryParams)}`).then(async (r) => {
        if (!r.ok) throw new Error("Error cargando logs");
        return r.json();
      }),
    enabled: activeTab === "audit",
  });

  const { data: errorData, isLoading: errorLoading } = useQuery<{ data: ErrorLog[]; count: number }>({
    queryKey: ["error-logs", errorQueryParams],
    queryFn: () =>
      fetch(`/api/error-logs?${new URLSearchParams(errorQueryParams)}`).then(async (r) => {
        if (!r.ok) throw new Error("Error cargando logs de errores");
        return r.json();
      }),
    enabled: activeTab === "errors",
  });

  const { data: sessionData, isLoading: sessionLoading } = useQuery<{ data: UserSession[]; count: number }>({
    queryKey: ["user-sessions", sessionQueryParams],
    queryFn: () =>
      fetch(`/api/user-sessions?${new URLSearchParams(sessionQueryParams)}`).then(async (r) => {
        if (!r.ok) throw new Error("Error cargando sesiones");
        return r.json();
      }),
    enabled: activeTab === "sessions",
  });

  const resolveMutation = useMutation({
    mutationFn: (errorId: string) =>
      fetch(`/api/error-logs/${errorId}/resolve`, { method: "PATCH" }).then(async (r) => {
        if (!r.ok) throw new Error("Error resolviendo");
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["error-logs"] });
    },
  });

  const handleExportCSV = useCallback(() => {
    const params = { ...auditQueryParams, limit: "500", offset: "0" };
    fetch(`/api/audit-logs?${new URLSearchParams(params)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Error exportando");
        return r.json();
      })
      .then((json) => {
        const data: AuditLog[] = json.data;
        const headers = ["Fecha", "Usuario", "Acción", "Entidad", "ID Entidad", "Descripción", "IP", "Resultado", "Error"];
        const rows = data.map((log) => [
          new Date(log.created_at).toLocaleString("es-CL"),
          log.user_id,
          log.action,
          log.entity_type,
          log.entity_id ?? "",
          log.change_description ?? "",
          log.ip_address ?? "",
          log.result,
          log.error_message ?? "",
        ]);
        const csv = [headers, ...rows]
          .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
          .join("\n");
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }, [auditQueryParams]);

  const currentData = activeTab === "audit" ? auditData : activeTab === "errors" ? errorData : sessionData;
  const currentCount = currentData?.count ?? 0;
  const currentLoading = activeTab === "audit" ? auditLoading : activeTab === "errors" ? errorLoading : sessionLoading;
  const totalPages = Math.ceil(currentCount / limit);

  const isSystemAdmin = role === "systemAdmin";

  if (currentLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-[#666]">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 border-b border-[rgba(45,52,54,0.08)]">
        {(["audit", "errors", "sessions"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(0); setModalLog(null); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "text-[#1a5f3f] border-b-2 border-[#d4a574]"
                : "text-[#666] hover:text-[#2d3436]"
            }`}
          >
            {tab === "audit" ? "Actividad de usuarios" : tab === "errors" ? "Errores de sistema" : "Sesiones de usuarios"}
          </button>
        ))}
      </div>

      {/* Audit Tab Filters */}
      {activeTab === "audit" && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 p-4 bg-[#faf9f7] rounded-lg">
          <select
            value={auditFilters.action}
            onChange={(e) => { setAuditFilters((f) => ({ ...f, action: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
          >
            <option value="">Todas las acciones</option>
            <option value="CREATE">CREATE</option>
            <option value="UPDATE">UPDATE</option>
            <option value="DELETE">DELETE</option>
            <option value="LOGIN_FAILED">LOGIN_FAILED</option>
            <option value="EXPORT">EXPORT</option>
            <option value="SETTINGS">SETTINGS</option>
            <option value="BAN_USER">BAN_USER</option>
            <option value="UNBAN_USER">UNBAN_USER</option>
            <option value="BACKFILL">BACKFILL</option>
          </select>
          <select
            value={auditFilters.entity_type}
            onChange={(e) => { setAuditFilters((f) => ({ ...f, entity_type: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
          >
            <option value="">Todas las entidades</option>
            <option value="producto">producto</option>
            <option value="categoria">categoria</option>
            <option value="cliente">cliente</option>
            <option value="venta">venta</option>
            <option value="nota_credito">nota_credito</option>
            <option value="usuario">usuario</option>
            <option value="cuenta_pagar">cuenta_pagar</option>
            <option value="orden_compra">orden_compra</option>
            <option value="saldo_favor">saldo_favor</option>
            <option value="proveedor">proveedor</option>
            <option value="cierre_mes">cierre_mes</option>
            <option value="report_export">report_export</option>
          </select>
          <select
            value={auditFilters.result}
            onChange={(e) => { setAuditFilters((f) => ({ ...f, result: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
          >
            <option value="">Todos los resultados</option>
            <option value="success">success</option>
            <option value="failure">failure</option>
            <option value="partial">partial</option>
          </select>
          <input
            type="date"
            value={auditFilters.desde}
            onChange={(e) => { setAuditFilters((f) => ({ ...f, desde: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="Desde"
          />
          <input
            type="date"
            value={auditFilters.hasta}
            onChange={(e) => { setAuditFilters((f) => ({ ...f, hasta: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="Hasta"
          />
          <input
            type="text"
            value={auditFilters.user_id}
            onChange={(e) => setAuditFilters((f) => ({ ...f, user_id: e.target.value }))}
            onBlur={() => setPage(0)}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="User ID"
          />
        </div>
      )}

      {/* Error Tab Filters */}
      {activeTab === "errors" && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 p-4 bg-[#faf9f7] rounded-lg">
          <select
            value={errorFilters.severity}
            onChange={(e) => { setErrorFilters((f) => ({ ...f, severity: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
          >
            <option value="">Todas las severidades</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <select
            value={errorFilters.resolved}
            onChange={(e) => { setErrorFilters((f) => ({ ...f, resolved: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
          >
            <option value="">Todos</option>
            <option value="false">Sin resolver</option>
            <option value="true">Resueltos</option>
          </select>
          <input
            type="text"
            value={errorFilters.endpoint}
            onChange={(e) => { setErrorFilters((f) => ({ ...f, endpoint: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="Endpoint"
          />
          <input
            type="date"
            value={errorFilters.desde}
            onChange={(e) => { setErrorFilters((f) => ({ ...f, desde: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="Desde"
          />
          <input
            type="date"
            value={errorFilters.hasta}
            onChange={(e) => { setErrorFilters((f) => ({ ...f, hasta: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="Hasta"
          />
        </div>
      )}

      {/* Session Tab Filters */}
      {activeTab === "sessions" && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-4 bg-[#faf9f7] rounded-lg">
          <input
            type="text"
            value={sessionFilters.user_id}
            onChange={(e) => setSessionFilters((f) => ({ ...f, user_id: e.target.value }))}
            onBlur={() => setPage(0)}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="User ID"
          />
          <select
            value={sessionFilters.event_type}
            onChange={(e) => { setSessionFilters((f) => ({ ...f, event_type: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
          >
            <option value="">Todos los eventos</option>
            <option value="session.created">session.created</option>
            <option value="session.removed">session.removed</option>
          </select>
          <input
            type="date"
            value={sessionFilters.desde}
            onChange={(e) => { setSessionFilters((f) => ({ ...f, desde: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="Desde"
          />
          <input
            type="date"
            value={sessionFilters.hasta}
            onChange={(e) => { setSessionFilters((f) => ({ ...f, hasta: e.target.value })); setPage(0); }}
            className="px-3 py-2 border border-[rgba(45,52,54,0.12)] rounded-md text-sm bg-white"
            placeholder="Hasta"
          />
        </div>
      )}

      {/* Export button (audit tab only) */}
      {activeTab === "audit" && (
        <div className="flex justify-end">
          <button
            onClick={handleExportCSV}
            className="px-4 py-2 text-sm font-medium text-[#1a5f3f] border border-[#1a5f3f] rounded-md hover:bg-[#1a5f3f] hover:text-white transition-colors"
          >
            Exportar CSV
          </button>
        </div>
      )}

      {/* Audit Table */}
      {activeTab === "audit" && (
        <div className="overflow-x-auto rounded-lg border border-[rgba(45,52,54,0.08)]">
          <table className="w-full text-sm">
            <thead className="bg-[#faf9f7]">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Fecha/Hora</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Usuario</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Acción</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Entidad</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Descripción</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">IP</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Resultado</th>
                {isSystemAdmin && <th className="px-4 py-3 text-left font-medium text-[#666]">Store ID</th>}
              </tr>
            </thead>
            <tbody>
              {(auditData?.data ?? []).map((log) => (
                <tr key={log.id} className="border-t border-[rgba(45,52,54,0.06)] hover:bg-[#faf9f7] cursor-pointer" onClick={() => setModalLog(log)}>
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(log.created_at).toLocaleString("es-CL")}</td>
                  <td className="px-4 py-3 text-xs" title={log.user_id}>
                    {log.user_email ?? `${log.user_id.slice(0, 12)}…`}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${ACTION_COLORS[log.action] || "bg-gray-100 text-gray-800"}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3">{log.entity_type}</td>
                  <td className="px-4 py-3 max-w-xs truncate">{log.change_description ?? "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{log.ip_address ?? "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${RESULT_COLORS[log.result] || "bg-gray-100 text-gray-800"}`}>
                      {log.result}
                    </span>
                  </td>
                  {isSystemAdmin && <td className="px-4 py-3 font-mono text-xs">{log.store_id.slice(0, 8)}...</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Error Table */}
      {activeTab === "errors" && (
        <div className="overflow-x-auto rounded-lg border border-[rgba(45,52,54,0.08)]">
          <table className="w-full text-sm">
            <thead className="bg-[#faf9f7]">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Fecha</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Severidad</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Endpoint</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Mensaje</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">IP</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Resuelto</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(errorData?.data ?? []).map((err) => (
                <tr key={err.id} className="border-t border-[rgba(45,52,54,0.06)] hover:bg-[#faf9f7] cursor-pointer" onClick={() => setModalLog(err)}>
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(err.created_at).toLocaleString("es-CL")}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${SEVERITY_COLORS[err.severity] || "bg-gray-100 text-gray-800"}`}>
                      {err.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{err.endpoint ?? "-"}</td>
                  <td className="px-4 py-3 max-w-xs truncate">{err.error_message}</td>
                  <td className="px-4 py-3 font-mono text-xs">{err.ip_address ?? "-"}</td>
                  <td className="px-4 py-3">{err.resolved ? <span className="text-green-600">&#10003;</span> : <span className="text-red-600">&#10007;</span>}</td>
                  <td className="px-4 py-3">
                    {!err.resolved && (
                      <button
                        onClick={(e) => { e.stopPropagation(); resolveMutation.mutate(err.id); }}
                        className="px-2 py-1 text-xs font-medium text-[#1a5f3f] border border-[#1a5f3f] rounded hover:bg-[#1a5f3f] hover:text-white transition-colors"
                      >
                        Marcar resuelto
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Session Table */}
      {activeTab === "sessions" && (
        <div className="overflow-x-auto rounded-lg border border-[rgba(45,52,54,0.08)]">
          <table className="w-full text-sm">
            <thead className="bg-[#faf9f7]">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Fecha/Hora</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Usuario</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">Evento</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">IP</th>
                <th className="px-4 py-3 text-left font-medium text-[#666]">User-Agent</th>
              </tr>
            </thead>
            <tbody>
              {(sessionData?.data ?? []).map((session) => (
                <tr key={session.id} className="border-t border-[rgba(45,52,54,0.06)] hover:bg-[#faf9f7]">
                  <td className="px-4 py-3 whitespace-nowrap">{new Date(session.created_at).toLocaleString("es-CL")}</td>
                  <td className="px-4 py-3 font-mono text-xs">{session.user_id.slice(0, 12)}...</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${EVENT_TYPE_COLORS[session.event_type] || "bg-gray-100 text-gray-800"}`}>
                      {session.event_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{session.ip_address ?? "-"}</td>
                  <td className="px-4 py-3 max-w-xs truncate text-xs">{session.user_agent ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between px-2">
        <span className="text-sm text-[#666]">
          Mostrando {page * limit + 1}-{Math.min((page + 1) * limit, currentCount)} de {currentCount} registros
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-sm border border-[rgba(45,52,54,0.12)] rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#faf9f7] transition-colors"
          >
            Anterior
          </button>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 text-sm border border-[rgba(45,52,54,0.12)] rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#faf9f7] transition-colors"
          >
            Siguiente
          </button>
        </div>
      </div>
      {/* Detail Modal */}
      {modalLog && (
        <ModalOverlay open onClose={() => setModalLog(null)}>
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(45,52,54,0.08)]">
              <h3 className="text-base font-semibold text-[#2d3436]">
                {"action" in modalLog ? `Detalle — ${modalLog.action}` : `Error — ${modalLog.severity}`}
              </h3>
              <button
                onClick={() => setModalLog(null)}
                className="text-[#666] hover:text-[#2d3436] text-xl leading-none"
                aria-label="Cerrar"
              >
                &times;
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 text-xs font-mono">
              {"action" in modalLog ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="font-semibold text-[#666] mb-1 font-sans">old_values</div>
                      <pre className="bg-[#faf9f7] p-3 rounded-md overflow-auto max-h-56 whitespace-pre-wrap break-all">
                        {modalLog.old_values ? JSON.stringify(modalLog.old_values, null, 2) : "null"}
                      </pre>
                    </div>
                    <div>
                      <div className="font-semibold text-[#666] mb-1 font-sans">new_values</div>
                      <pre className="bg-[#faf9f7] p-3 rounded-md overflow-auto max-h-56 whitespace-pre-wrap break-all">
                        {modalLog.new_values ? JSON.stringify(modalLog.new_values, null, 2) : "null"}
                      </pre>
                    </div>
                  </div>
                  {modalLog.user_agent && (
                    <div>
                      <div className="font-semibold text-[#666] mb-1 font-sans">user_agent</div>
                      <p className="text-[#2d3436] break-all">{modalLog.user_agent}</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <div className="font-semibold text-[#666] mb-1 font-sans">error_message</div>
                    <pre className="bg-[#faf9f7] p-3 rounded-md overflow-auto max-h-32 whitespace-pre-wrap break-all">{modalLog.error_message}</pre>
                  </div>
                  {modalLog.stack_trace && (
                    <div>
                      <div className="font-semibold text-[#666] mb-1 font-sans">stack_trace</div>
                      <pre className="bg-[#faf9f7] p-3 rounded-md overflow-auto max-h-56 whitespace-pre-wrap break-all">{modalLog.stack_trace}</pre>
                    </div>
                  )}
                  {modalLog.context && (
                    <div>
                      <div className="font-semibold text-[#666] mb-1 font-sans">context</div>
                      <pre className="bg-[#faf9f7] p-3 rounded-md overflow-auto max-h-56 whitespace-pre-wrap break-all">{JSON.stringify(modalLog.context, null, 2)}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  );
}
