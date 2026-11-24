import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getDatabase, DatabaseSchema } from './dbStore.js';

export const ADMIN_CEDULA = '1094269932';
export const CLEAN_ADMIN_CEDULA = '9005042417';
export const ADMIN_CEDULAS = [ADMIN_CEDULA, CLEAN_ADMIN_CEDULA];
export const CLIENTE_472_NIT = '9000629179';
export const CLIENTE_472_NIT_SIN_DV = '900062917';
export const CLIENTE_472_NIT_DISPLAY = '900.062.917-9';
export const ADMIN_ACCESS_PASSWORD = process.env.ADMIN_ACCESS_PASSWORD || 'Camarca.2026*';
const TOKEN_SECRET =
  process.env.AUTH_SECRET || process.env.JWT_SECRET || 'camarca_secure_jwt_token_secret_2026_x9932';

export type UserRole = 'admin' | 'expendio' | 'cliente';

export interface AuthenticatedUser {
  cedula: string;
  roles: UserRole[];
  role?: UserRole; // Compatibilidad regresiva con consumidores existentes
  expendioId: string;
  name: string;
  municipio?: string;
  isMultiRoleAdmin: boolean;
  isCleanAdmin?: boolean;
  issuedAt: number;
  tokenVersion?: number;
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
}

/**
 * Normaliza número de cédula (solo dígitos)
 */
export function normalizeCedula(cedula: string | number | undefined | null): string {
  if (!cedula) return '';
  return String(cedula).trim().replace(/\D/g, '');
}

/**
 * Verifica si una cédula corresponde a uno de los Administradores autorizados (1094269932 o 9005042417)
 */
export function resolveAuthorizedAdminCedula(cedula: string | number | undefined | null): string | null {
  if (!cedula) return null;
  const str = String(cedula).trim().toLowerCase();
  if (str === 'admin' || str === 'administrador') return ADMIN_CEDULA;
  const norm = normalizeCedula(cedula);
  if (norm === ADMIN_CEDULA) return ADMIN_CEDULA;
  if (norm === CLEAN_ADMIN_CEDULA || norm === '900504241') return CLEAN_ADMIN_CEDULA;
  return null;
}

export function isAuthorizedAdminCedula(cedula: string | number | undefined | null): boolean {
  return resolveAuthorizedAdminCedula(cedula) !== null;
}

/**
 * Verifica si un número corresponde al NIT autorizado del Cliente 4-72 (900.062.917-9 / 9000629179 / 900062917)
 */
export function isCliente472Nit(cedula: string | number | undefined | null): boolean {
  const norm = normalizeCedula(cedula);
  return norm === CLIENTE_472_NIT || norm === CLIENTE_472_NIT_SIN_DV;
}

/**
 * Genera un token de sesión criptográficamente firmado (HMAC-SHA256)
 */
export function generateSessionToken(user: AuthenticatedUser): string {
  // Asegurar que roles sea un arreglo y que role esté sincronizado
  const normalizedUser: AuthenticatedUser = {
    ...user,
    roles: Array.isArray(user.roles) && user.roles.length > 0 ? user.roles : (user.role ? [user.role] : ['expendio']),
    role: user.role || (Array.isArray(user.roles) && user.roles.length > 0 ? user.roles[0] : 'expendio'),
    tokenVersion: 2,
  };
  const payload = JSON.stringify(normalizedUser);
  const payloadBase64 = Buffer.from(payload, 'utf-8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadBase64)
    .digest('base64url');
  return `${payloadBase64}.${signature}`;
}

export const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 días de vigencia de sesión

/**
 * Verifica un token de sesión firmado y extrae el usuario autenticado
 */
export function verifySessionToken(token: string): AuthenticatedUser | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, providedSignature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(payloadBase64)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSignature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    try {
      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8');
      const user: AuthenticatedUser = JSON.parse(payloadJson);

      // Expiración a los 30 días (con inactividad controlada)
      if (user.issuedAt && Date.now() - Number(user.issuedAt) > MAX_SESSION_AGE_MS) {
        return null;
      }

      // Normalizar roles
      if (!Array.isArray(user.roles)) {
        user.roles = user.role ? [user.role] : ['expendio'];
      }
      if (!user.role && user.roles.length > 0) {
        user.role = user.roles[0];
      }

      const resolvedAdminCed = resolveAuthorizedAdminCedula(user.cedula);

      // Invalidar tokens v1 anteriores de 1094269932 que pudieron quedar en caché en navegadores de expendios
      if (resolvedAdminCed === ADMIN_CEDULA && (Number(user.tokenVersion) || 1) < 2) {
        return null;
      }

      // Si es el Administrador General (1094269932), garantizar siempre los 3 roles
      if (resolvedAdminCed === ADMIN_CEDULA) {
        if (!user.roles.includes('admin')) user.roles.push('admin');
        if (!user.roles.includes('expendio')) user.roles.push('expendio');
        if (!user.roles.includes('cliente')) user.roles.push('cliente');
        user.isMultiRoleAdmin = true;
        user.isCleanAdmin = false;
      } else if (resolvedAdminCed === CLEAN_ADMIN_CEDULA) {
        user.cedula = CLEAN_ADMIN_CEDULA;
        if (!user.roles.includes('admin')) user.roles.push('admin');
        if (!user.roles.includes('cliente')) user.roles.push('cliente');
        user.isMultiRoleAdmin = false;
        user.isCleanAdmin = true;
      } else if (isCliente472Nit(user.cedula)) {
        user.cedula = CLIENTE_472_NIT;
        user.roles = ['cliente'];
        user.role = 'cliente';
        user.isMultiRoleAdmin = false;
        user.isCleanAdmin = false;
      }

      // Regla estricta de seguridad: Si tiene rol admin, su cédula DEBE ser autorizada (1094269932 o 9005042417)
      const hasAdminRole = user.roles.includes('admin') || user.role === 'admin';
      if (hasAdminRole && !resolvedAdminCed) {
        console.warn(`[Seguridad] Intento bloqueado de elevación de privilegios admin con cédula no autorizada: "${user.cedula}"`);
        return null;
      }
      return user;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Extrae y valida el usuario desde los encabezados de la petición o cookies seguras.
 * REGLA 10 y 11: Se elimina toda confianza en x-user-role o x-user-cedula como autoridad.
 * Solo se aceptan tokens criptográficamente firmados por el servidor.
 */
export function extractAuthenticatedUser(req: Request): AuthenticatedUser | null {
  // 1. Authorization Bearer o headers de token
  const authHeader = req.headers['authorization'] || req.headers['x-session-token'] || req.headers['x-auth-token'];
  if (authHeader && typeof authHeader === 'string') {
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();
    const verified = verifySessionToken(token);
    if (verified) return verified;
  }

  // 2. Cookie segura HttpOnly camarca_token
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)camarca_token=([^;]+)/);
    if (match && match[1]) {
      const verified = verifySessionToken(decodeURIComponent(match[1]));
      if (verified) return verified;
    }
  }

  // 3. Query parameter seguro (útil para descargas directas de archivos / reportes)
  const queryToken = (req.query?.token || req.query?.auth_token || req.query?.session_token) as string | undefined;
  if (queryToken && typeof queryToken === 'string') {
    const verified = verifySessionToken(queryToken.trim());
    if (verified) return verified;
  }

  return null;
}

/**
 * Middleware para requerir usuario autenticado
 */
export function requireAuthenticatedUser(req: AuthRequest, res: Response, next: NextFunction) {
  const user = extractAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Acceso no autorizado. Debe autenticarse con su número de cédula.',
    });
  }
  req.user = user;
  next();
}

/**
 * Middleware para requerir rol de Administrador.
 * REGLA ESTRICTA: Solo las cédulas administrativas autorizadas (1094269932 y 9005042417) con capacidad 'admin' pueden obtener este acceso.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const user = extractAuthenticatedUser(req);
  if (!user || !user.roles.includes('admin') || !isAuthorizedAdminCedula(user.cedula)) {
    return res.status(403).json({
      success: false,
      message: 'Acceso restringido exclusivamente a usuarios Administradores autorizados.',
    });
  }
  req.user = user;
  next();
}

/**
 * Middleware para requerir rol de Expendio.
 * Puede ser un expendio regular O el administrador en su capacidad de expendio propio.
 */
export function requireExpendio(req: AuthRequest, res: Response, next: NextFunction) {
  const user = extractAuthenticatedUser(req);
  if (!user || (!user.roles.includes('expendio') && !user.roles.includes('admin'))) {
    return res.status(403).json({
      success: false,
      message: 'Acceso no autorizado: Se requiere rol de Expendio activo.',
    });
  }
  req.user = user;
  next();
}

/**
 * Middleware para verificar acceso a un expendio específico.
 * Para operaciones de expendio, se comprueba que el expendio solicitado coincida con el propio.
 */
export function requireExpendioOwnership(req: AuthRequest, res: Response, next: NextFunction) {
  const user = extractAuthenticatedUser(req);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Acceso no autorizado.',
    });
  }
  req.user = user;

  // Si el usuario autenticado es Administrador autorizado, tiene acceso autorizado
  if (user.roles.includes('admin') && isAuthorizedAdminCedula(user.cedula)) {
    return next();
  }

  const targetExpendioId = req.params.id || req.body?.expendioId || req.body?.id;
  if (targetExpendioId && targetExpendioId !== user.expendioId && normalizeCedula(targetExpendioId) !== normalizeCedula(user.cedula)) {
    return res.status(403).json({
      success: false,
      message: 'Acceso denegado: No tiene permisos para modificar o consultar otro expendio.',
    });
  }

  const targetCedula = req.params.cedula || req.body?.cedula;
  if (targetCedula && normalizeCedula(targetCedula) !== normalizeCedula(user.cedula) && targetCedula !== user.expendioId) {
    return res.status(403).json({
      success: false,
      message: 'Acceso denegado: No tiene permisos para operar sobre la cédula de otro expendio.',
    });
  }

  next();
}

/**
 * Resuelve el Expendio canónico propio del usuario autenticado a partir de su expendioId interno.
 */
export function resolveUserExpendio(req: AuthRequest, db: DatabaseSchema) {
  if (!req.user) return null;
  const expendios = Array.isArray(db.expendios) ? db.expendios : [];
  const userCedNorm = normalizeCedula(req.user.cedula);

  // Protección anti-colisión: Si el token pertenece al Super-Admin (1094269932) pero la petición
  // especifica explícitamente otra cédula o un encargado distinto de DIEGO ALEJANDRO BECERRA,
  // resolver al expendio real correspondiente para jamás sobrescribir GIRON por accidente.
  if (userCedNorm === ADMIN_CEDULA) {
    const explicitCed = normalizeCedula(
      (req.headers['x-expendio-cedula'] as string) || req.body?.cedula || req.params?.cedula || req.query?.cedula
    );
    if (explicitCed && explicitCed !== ADMIN_CEDULA) {
      const byExplicitCed = expendios.find(
        (e) =>
          normalizeCedula(e.cedula) === explicitCed ||
          (Array.isArray((e as any).cedulasAnteriores) &&
            (e as any).cedulasAnteriores.some((prev: string) => normalizeCedula(prev) === explicitCed))
      );
      if (byExplicitCed) return byExplicitCed;
    }

    const explicitEncargado = String(req.body?.encargado || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (explicitEncargado && explicitEncargado !== 'DIEGO ALEJANDRO BECERRA') {
      const byEncargado = expendios.find((e) => {
        const eNorm = String(e.encargado || '')
          .trim()
          .toUpperCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        return eNorm === explicitEncargado && normalizeCedula(e.cedula) !== ADMIN_CEDULA;
      });
      if (byEncargado) return byEncargado;
    }
  }

  // 1. Búsqueda por ID canónico inmutable
  if (req.user.expendioId) {
    const foundById = expendios.find((e) => e.id === req.user!.expendioId);
    if (foundById) return foundById;
  }

  // 2. Búsqueda por cédula del usuario autenticado (incluyendo historial de cédulas si el admin la actualizó)
  if (userCedNorm) {
    const foundByCed = expendios.find(
      (e) =>
        normalizeCedula(e.cedula) === userCedNorm ||
        (Array.isArray((e as any).cedulasAnteriores) &&
          (e as any).cedulasAnteriores.some((prev: string) => normalizeCedula(prev) === userCedNorm))
    );
    if (foundByCed) return foundByCed;
  }

  return null;
}
