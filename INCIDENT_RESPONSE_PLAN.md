# Incident Response Plan - PetShop

**Fecha**: 2026-04-17  
**Versión**: 1.0  
**Estado**: Activo

---

## 1. Detection & Alerting (5 min)

### Monitoreo en Tiempo Real

| Alert Type | Threshold | Severity | Action |
|-----------|-----------|----------|---------|
| Auth Failed | >5 failed logins en 5min | HIGH | Notify Slack #security |
| Rate Limit | Any 429 violation | MEDIUM | Log + notify |
| Audit Log Failure | logAudit error | CRITICAL | Alert on-call |
| Unauthorized Access | 401/403 on critical API | HIGH | Alert + block IP |
| Injection Attempt | SQL/NoSQL pattern detected | CRITICAL | Block + alert |

### Canales de Notificación

- **Slack**: #security-alerts (webhook configurado)
- **PagerDuty**: On-call rotation para P1 incidents
- **Email**: admin@petshop.cl para P2+

---

## 2. Initial Response (15 min)

### Severity Levels

| Level | Response Time | Example |
|-------|---------------|---------|
| P1 - Critical | 15 min | Data breach, complete outage |
| P2 - High | 1 hour | Partial outage, unauthorized access |
| P3 - Medium | 4 hours | Non-critical bug, performance issue |
| P4 - Low | 24 hours | UI issue, minor bug |

### Acciones Iniciales

1. **Assess severity** - Determine P1-P4
2. **Gather facts** - Screenshots, logs, timestamps
3. **Notify stakeholders** - Si P1 o P2
4. **Create incident ticket** - Registrar en sistema

---

## 3. Containment (30 min)

### Acciones de Contención

- **Compromised tokens**: Revocar en Clerk dashboard
- **Malicious IPs**: Agregar a blocklist en rate limiter
- **Affected services**: Disable temporarily si es necesario
- **Database**: Aislar tablas afectadas si aplica
- **Backup**: Verificar integridad de backups recientes

### Contactos de Emergencia

| Role | Contact | Phone |
|------|---------|-------|
| On-call Engineer | [ DESIGNATE ] | [ PHONE ] |
| Tech Lead | [ DESIGNATE ] | [ PHONE ] |
| Admin | Pablo | +56 9 XXXX XXXX |

---

## 4. Investigation (1-4 hours)

### Root Cause Analysis

1. **Timeline reconstruction**: Logs desde detección hasta ahora
2. **Scope assessment**: Cuántos usuarios/registros afectados
3. **Impact determination**: Financial, reputational, legal
4. **Attack vector identification**: Cómo ocurrió

### Evidence Collection

```bash
# Export relevant logs
supabase logs --start-time "2026-04-17T00:00:00Z" --end-time "2026-04-17T12:00:00Z" > incident_logs.txt

# Database audit
SELECT * FROM audit_logs WHERE created_at > '2026-04-17' AND result = 'failure';
```

---

## 5. Remediation (variable)

### Pasos de Remediación

1. **Deploy fixes** - Apply security patches
2. **Apply patches** - Update dependencies
3. **Restore if needed** - From backup verified
4. **Verify integrity** - Tests passing

### Rollback Plan

- Git revert al último commit estable
- Database rollback si es necesario
- Re-deploy de imagen anterior

---

## 6. Communication

### Stakeholder Matrix

| Incident Level | Notify |
|----------------|--------|
| P1 | All stakeholders + customers |
| P2 | Tech team + management |
| P3 | Tech team only |
| P4 | As needed |

### Customer Communication

- **Status page**: Update con status
- **Email**: Si P1, notificar dentro de 24h
- **Social**: Si es visible públicamente

### Regulatory Reporting (GDPR/CCPA)

- Si datos de EU citizens comprometidos: 72h deadline
- Documentar todo para compliance

---

## 7. Post-Incident

### Report Requirements

- Full incident report (qué, cuándo, cómo, por qué)
- Lessons learned
- Process improvements
- Team debriefing dentro de 1 semana

### Action Items Example

```
- [ ] Add 2FA requirement
- [ ] Implement IP blocklist
- [ ] Update rate limiting
- [ ] Add additional logging
```

---

## 📞 Escalation Flow

```
         ┌──────────────┐
         │   DETECT    │
         └──────┬─────┘
                │
         ┌──────▼──────┐
         │  ASSESS     │ ──► P1: Contact on-call immediate
         │  severity  │
         └──────┬─────┘
                │
      ┌─────────┼─────────┐
      │         │         │
 ┌────▼───┐┌──▼────┐┌──▼────┐
 │  P1   │ │  P2   │ │ P3-P4 │
 │Contain│ │Contain│ │Track  │
 │Now    │ │1hr    │ │4hr    │
 └───────┘ └───────┘ └───────┘
```

---

## Quick Reference Card

| Commands | Action |
|----------|--------|
| `supabase db reset` | Rollback database |
| `git revert HEAD` | Rollback code |
| Slack #security | Report incident |
| PagerDuty | Page on-call |

---

**Document Status**: Active  
**Next Review**: 2026-05-17  
**Owner**: Tech Lead