#!/bin/bash
# Eval script: verifica que una API route siga las convenciones de petShop
# Uso: ./eval-route.sh <ruta-al-archivo>
# Retorna exit 0 si pasa, exit 1 si hay problemas
# Integrado como hook PostToolUse en settings.json

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  exit 0
fi

# Solo evaluar routes de API (no tests, no libs)
echo "$FILE" | grep -qE 'src/app/api/.*route\.tsx?$' || exit 0

BASENAME=$(basename "$FILE")
ISSUES=()
WARNINGS=()

# Rutas exentas de auth y multi-tenant (públicas o usan otro mecanismo)
IS_EXEMPT=$(echo "$FILE" | grep -cE "api/admin|api/cron|api/health|api/webhooks|api/onboarding|api/hub-sync" || true)

# ── 1. Auth check ─────────────────────────────────────────────────────────────
if [ "$IS_EXEMPT" -eq 0 ]; then
  if ! grep -q "getStoreId\(\)" "$FILE" && ! grep -q "clerkMiddleware\|auth()" "$FILE"; then
    ISSUES+=("FALTA auth: no se encontró getStoreId() — toda route necesita verificar autenticación")
  fi

  # ── 2. Respuesta 401 ──────────────────────────────────────────────────────────
  if grep -q "getStoreId" "$FILE" && ! grep -q "status: 401\|status:401" "$FILE"; then
    WARNINGS+=("POSIBLE: getStoreId() presente pero sin return 401 explícito")
  fi
fi

# ── 3. Multi-tenant store_id ──────────────────────────────────────────────────
IS_ADMIN=$(echo "$FILE" | grep -cE "api/admin|api/cron|api/health|api/webhooks|api/onboarding|api/hub-sync" || true)
if [ "$IS_ADMIN" -eq 0 ]; then
  if grep -q '\.from(' "$FILE" && ! grep -q 'store_id' "$FILE"; then
    ISSUES+=("FALTA store_id: hay queries Supabase sin filtro multi-tenant")
  fi
fi

# ── 4. Zod validation en mutaciones ───────────────────────────────────────────
HAS_POST=$(grep -c "async function POST\|export.*POST" "$FILE" || true)
HAS_PATCH=$(grep -c "async function PATCH\|export.*PATCH" "$FILE" || true)
HAS_PUT=$(grep -c "async function PUT\|export.*PUT" "$FILE" || true)

if [ "$((HAS_POST + HAS_PATCH + HAS_PUT))" -gt 0 ]; then
  if ! grep -q "safeParse\|\.parse(" "$FILE"; then
    ISSUES+=("FALTA Zod: hay POST/PATCH/PUT sin validación safeParse — agregar schema en src/lib/validation/")
  fi
fi

# ── 5. logAudit en mutaciones sensibles ───────────────────────────────────────
if [ "$((HAS_PATCH + HAS_PUT))" -gt 0 ]; then
  if ! grep -q "logAudit(" "$FILE"; then
    WARNINGS+=("RECOMENDADO: PATCH/PUT sin logAudit() — agregar para trazabilidad de cambios")
  fi
fi

HAS_DELETE=$(grep -c "async function DELETE\|export.*DELETE" "$FILE" || true)
if [ "$HAS_DELETE" -gt 0 ] && ! grep -q "logAudit(" "$FILE"; then
  ISSUES+=("FALTA logAudit: DELETE sin auditoría — requerido para todas las eliminaciones")
fi

# ── 6. Manejo de errores explícito ────────────────────────────────────────────
if grep -q '\.from(' "$FILE" && ! grep -q "status: 500\|status:500" "$FILE"; then
  WARNINGS+=("POSIBLE: queries Supabase sin return 500 para error de BD")
fi

# ── 7. CLP sin centavos ───────────────────────────────────────────────────────
if grep -qE "\* [0-9]|precio|monto|total|subtotal" "$FILE" && ! grep -q "Math.round" "$FILE"; then
  WARNINGS+=("POSIBLE: cálculos monetarios sin Math.round — CLP requiere pesos enteros")
fi

# ── Output ────────────────────────────────────────────────────────────────────
if [ ${#ISSUES[@]} -eq 0 ] && [ ${#WARNINGS[@]} -eq 0 ]; then
  echo "[eval] ✅ $BASENAME — convenciones OK"
  exit 0
fi

echo ""
echo "[eval] 📋 $BASENAME"

for issue in "${ISSUES[@]}"; do
  echo "  ❌ $issue"
done

for warning in "${WARNINGS[@]}"; do
  echo "  ⚠️  $warning"
done

echo ""

# Solo falla (exit 2) si hay ISSUES, no solo warnings
[ ${#ISSUES[@]} -gt 0 ] && exit 2 || exit 0
