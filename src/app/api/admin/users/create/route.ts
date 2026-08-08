import { NextRequest, NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { createServiceClient } from "@/lib/supabase";
import { getAdminStatus, requireStoreAdmin, requireSystemAdminConsistent } from "@/lib/admin-check";
import { AdminUserCreateFullSchema } from "@/lib/validation";
import { logError } from "@/lib/audit";

type ClerkApiError = {
  errors: { code?: string; longMessage?: string; message?: string }[];
  status?: number;
};

function isClerkApiError(err: unknown): err is ClerkApiError {
  return (
    err !== null &&
    typeof err === "object" &&
    "errors" in err &&
    Array.isArray((err as ClerkApiError).errors)
  );
}

// form_password_pwned (contraseña en HIBP) NO es "email ya existe":
// agruparlo aquí producía un 409 engañoso para emails nuevos (ticket 6a76c8c5946f3e4288a6176d).
function isEmailTakenError(err: ClerkApiError): boolean {
  return err.errors.some((e) => e.code === "form_identifier_exists");
}

async function createClerkUser(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
  nombre: string,
  storeId: string | undefined,
  userId: string,
  role: string,
  rut: string | undefined,
  meta_ventas: number | undefined,
) {
  const client = await clerkClient();

  let clerkUser: Awaited<ReturnType<typeof client.users.createUser>>;
  try {
    clerkUser = await client.users.createUser({
      emailAddress: [email],
      password,
      firstName,
      lastName,
    });
  } catch (createErr: unknown) {
    if (isClerkApiError(createErr) && isEmailTakenError(createErr)) {
      const existing = await client.users.getUserList({ emailAddress: [email] });
      if (!existing.data.length) {
        // El email existe en Clerk pero no se pudo recuperar un usuario asociado:
        // típico cuando el usuario fue borrado en Clerk (el email queda reservado)
        // o hay un desface entre Clerk y la BD local. No es un error recuperable
        // del usuario final: el email no está disponible para crear una cuenta.
        // Se devuelve un mensaje claro al usuario y se loguea el detalle técnico
        // para revisión (ticket Trello 6a76c861779de90209ed8ba3).
        logError({
          storeId,
          userId,
          errorCode: "CLERK_EMAIL_TAKEN_UNRESOLVABLE",
          errorMessage: `Email "${email}" reportado como existente en Clerk pero sin usuario recuperable`,
          context: { email, storeId, role },
          severity: "WARNING",
          endpoint: "POST /api/admin/users/create",
        }).catch(() => {});
        return NextResponse.json({ error: "Ya existe un usuario con este email" }, { status: 409 });
      }
      clerkUser = existing.data[0] as typeof clerkUser;
    } else {
      throw createErr;
    }
  }

  if (role === "systemAdmin") {
    await client.users.updateUserMetadata(clerkUser.id, {
      publicMetadata: { systemAdmin: true },
    });

    const supabase = createServiceClient();
    await supabase.from("clerk_users").upsert(
      {
        clerk_id: clerkUser.id,
        email,
        nombre,
        system_admin: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_id" }
    );
  } else {
    await client.users.updateUserMetadata(clerkUser.id, {
      publicMetadata: {
        storeId,
        storeAdmin: role === "storeAdmin",
        storeWorker: role === "storeWorker",
      },
    });

    const supabase = createServiceClient();
    await supabase.from("clerk_users").upsert(
      {
        clerk_id: clerkUser.id,
        email,
        nombre,
        rut: rut ?? null,
        meta_ventas: role === "storeWorker" ? (meta_ventas ?? null) : null,
        store_id: storeId,
        store_admin: role === "storeAdmin",
        store_worker: role === "storeWorker",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "clerk_id" }
    );
  }

  return NextResponse.json({ ok: true, clerkId: clerkUser.id });
}

export async function POST(req: NextRequest) {
  const { sessionClaims } = await auth();
  const admin = getAdminStatus(sessionClaims);

  // storeAdmin — puede crear usuarios solo para su propia tienda
  if (admin?.isStoreAdmin && !admin.isSystemAdmin) {
    try {
      requireStoreAdmin(admin);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = AdminUserCreateFullSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { email, password, firstName, lastName, role, rut, meta_ventas } = parsed.data;

    if (role === "systemAdmin") {
      return NextResponse.json({ error: "No puedes crear administradores del sistema" }, { status: 403 });
    }

    const storeId = admin!.storeId;
    if (!storeId) {
      return NextResponse.json({ error: "Tienda no asignada" }, { status: 403 });
    }

    const nombre = `${firstName} ${lastName}`.trim();

    try {
      return await createClerkUser(email, password, firstName, lastName, nombre, storeId, admin!.userId, role, rut, meta_ventas);
    } catch (error: unknown) {
      if (isClerkApiError(error) && error.errors.length > 0) {
        const clerkError = error.errors[0];
        // longMessage/message ya vienen redactados por Clerk para mostrarse al
        // usuario final (ej. "This password has been found..."); el fallback
        // NO debe nombrar el proveedor (mismo defecto que el 409 de este
        // ticket, ver isEmailTakenError arriba) — se usa cuando el error de
        // Clerk no trae ningún mensaje utilizable, caso defensivo/raro.
        const message = clerkError.longMessage ?? clerkError.message ?? "Error al crear el usuario";
        return NextResponse.json({ error: message }, { status: 422 });
      }
      const message = error instanceof Error ? error.message : "Error desconocido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // systemAdmin — control total
  try {
    await requireSystemAdminConsistent(admin);
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = AdminUserCreateFullSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { email, password, firstName, lastName, storeId, role, rut, meta_ventas } = parsed.data;

  if (role !== "systemAdmin" && !storeId) {
    return NextResponse.json({ error: "storeId requerido para roles de tienda" }, { status: 400 });
  }

  const nombre = `${firstName} ${lastName}`.trim();

  try {
    return await createClerkUser(email, password, firstName, lastName, nombre, storeId, admin!.userId, role, rut, meta_ventas);
  } catch (error: unknown) {
    if (isClerkApiError(error) && error.errors.length > 0) {
      const clerkError = error.errors[0];
      // Ver comentario equivalente en la rama storeAdmin más arriba.
      const message = clerkError.longMessage ?? clerkError.message ?? "Error al crear el usuario";
      return NextResponse.json({ error: message }, { status: 422 });
    }
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
