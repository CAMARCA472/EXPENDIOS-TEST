/**
 * ==============================================================================
 * dbClient.ts — Cliente Centralizado de API y Base de Datos (Frontend)
 * ==============================================================================
 * Centraliza todas las comunicaciones HTTP entre la interfaz React y la capa
 * de backend conectada a Cloud SQL (PostgreSQL).
 *
 * Arquitectura:
 *   React Components -> dbClient -> Express API -> PostgreSQL (Cloud SQL)
 *
 * Características:
 *  - Inyección automática de tokens de autenticación Bearer y x-session-token.
 *  - Manejo seguro de errores de red y parseo tipado de respuestas JSON.
 *  - Espacios de nombres dedicados para cada entidad (expendios, historial, pagos,
 *    trazabilidad, documentos, fotos, visitas, configuración, diagnósticos).
 * ==============================================================================
 */

import {
  ExpendioData,
  HistorialItem,
  PagoRelacionItem,
  TrazabilidadExpendio,
  UserSession,
} from '../types';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  [key: string]: any;
}

class DbClient {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * Obtiene los encabezados estándar con el token de sesión autenticado
   */
  private getHeaders(customHeaders: Record<string, string> = {}): Headers {
    const headers = new Headers(customHeaders);
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    if (typeof window !== 'undefined') {
      const token =
        sessionStorage.getItem('camarca_token') ||
        localStorage.getItem('camarca_token');

      if (token) {
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        if (!headers.has('x-session-token')) {
          headers.set('x-session-token', token);
        }
      }
    }

    return headers;
  }

  /**
   * Método base para ejecutar peticiones HTTP
   */
  public async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.getHeaders(
      (options.headers as Record<string, string>) || {}
    );

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        ...options,
        headers,
        credentials: 'same-origin',
      });

      const contentType = response.headers.get('content-type') || '';
      let json: any = {};

      if (contentType.includes('application/json')) {
        json = await response.json();
      } else {
        const text = await response.text();
        json = {
          success: response.ok,
          message: text || `Respuesta HTTP ${response.status}`,
        };
      }

      if (!response.ok && !json.error) {
        json.error = `HTTP_${response.status}`;
      }

      return json;
    } catch (err: any) {
      console.error(`[dbClient Error] Fallo al consultar ${endpoint}:`, err);
      return {
        success: false,
        error: 'NETWORK_ERROR',
        message: err.message || 'Error de conexión con el servidor.',
      };
    }
  }

  // Métodos genéricos
  public async get<T = any>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  public async post<T = any>(endpoint: string, body?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public async put<T = any>(endpoint: string, body?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public async delete<T = any>(endpoint: string, body?: any): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * MÓDULO 1: EXPENDIOS (Admin & CRUD)
   */
  public expendios = {
    list: async (): Promise<ApiResponse<ExpendioData[]>> => {
      return this.get<ExpendioData[]>(`/api/expendios?_t=${Date.now()}`);
    },

    getById: async (id: string): Promise<ApiResponse<ExpendioData>> => {
      return this.get<ExpendioData>(`/api/expendios/${encodeURIComponent(id)}`);
    },

    update: async (id: string, data: Partial<ExpendioData>): Promise<ApiResponse<ExpendioData>> => {
      return this.put<ExpendioData>(`/api/admin/expendios/${encodeURIComponent(id)}`, data);
    },

    create: async (data: Partial<ExpendioData>): Promise<ApiResponse<ExpendioData>> => {
      return this.post<ExpendioData>('/api/admin/expendios', data);
    },

    delete: async (id: string, masterPassword?: string): Promise<ApiResponse<void>> => {
      return this.delete<void>(`/api/admin/expendios/${encodeURIComponent(id)}`, { masterPassword });
    },

    importExcel: async (expendios: any[], mode: 'replace' | 'merge' = 'replace'): Promise<ApiResponse<any>> => {
      return this.post('/api/admin/import-excel', { expendios, mode });
    },

    importSheets: async (data: any): Promise<ApiResponse<any>> => {
      return this.post('/api/admin/import-sheets', data);
    },
  };

  /**
   * MÓDULO 2: EXPENDIO PROPIO (Autogestión por Cédula)
   */
  public expendio = {
    getMyData: async (): Promise<ApiResponse<ExpendioData>> => {
      return this.get<ExpendioData>('/api/expendio/me');
    },

    updateSelf: async (data: Partial<ExpendioData>): Promise<ApiResponse<ExpendioData>> => {
      return this.post<ExpendioData>('/api/expendio/update', data);
    },

    marcarItem: async (itemKey: string, tiene: 'SI' | 'NO', motivo?: string): Promise<ApiResponse<any>> => {
      return this.post('/api/expendio/marcar-disponibilidad-item', { itemKey, tiene, motivo });
    },
  };

  /**
   * MÓDULO 3: CLIENTE / CONSULTA PÚBLICA
   */
  public cliente = {
    consultar: async (cedula: string): Promise<ApiResponse<any>> => {
      return this.post('/api/cliente/consultar', { cedula });
    },

    buscarCuentas: async (cedula: string): Promise<ApiResponse<any>> => {
      return this.get(`/api/cliente/cuentas/${encodeURIComponent(cedula)}`);
    },
  };

  /**
   * MÓDULO 4: HISTORIAL CONTABLE DE CUENTAS DE COBRO
   */
  public historial = {
    list: async (filtros?: { mes?: string; anio?: string }): Promise<ApiResponse<HistorialItem[]>> => {
      const params = new URLSearchParams();
      if (filtros?.mes) params.append('mes', filtros.mes);
      if (filtros?.anio) params.append('anio', filtros.anio);
      const query = params.toString() ? `?${params.toString()}` : '';
      return this.get<HistorialItem[]>(`/api/admin/historial${query}`);
    },

    save: async (data: Partial<HistorialItem>): Promise<ApiResponse<HistorialItem>> => {
      return this.post<HistorialItem>('/api/admin/historial', data);
    },

    delete: async (id: string): Promise<ApiResponse<void>> => {
      return this.delete<void>(`/api/admin/historial/${encodeURIComponent(id)}`);
    },
  };

  /**
   * MÓDULO 5: RELACIÓN DE PAGOS
   */
  public pagos = {
    list: async (mes?: string, anio?: string): Promise<ApiResponse<PagoRelacionItem[]>> => {
      const params = new URLSearchParams();
      if (mes) params.append('mes', mes);
      if (anio) params.append('anio', anio);
      const query = params.toString() ? `?${params.toString()}` : '';
      return this.get<PagoRelacionItem[]>(`/api/admin/relacion-pagos${query}`);
    },

    save: async (data: Partial<PagoRelacionItem>): Promise<ApiResponse<PagoRelacionItem>> => {
      return this.post<PagoRelacionItem>('/api/admin/relacion-pagos', data);
    },
  };

  /**
   * MÓDULO 6: TRAZABILIDAD Y AUDITORÍA
   */
  public trazabilidad = {
    list: async (): Promise<ApiResponse<TrazabilidadExpendio[]>> => {
      return this.get<TrazabilidadExpendio[]>('/api/trazabilidad');
    },

    create: async (data: Partial<TrazabilidadExpendio>): Promise<ApiResponse<TrazabilidadExpendio>> => {
      return this.post<TrazabilidadExpendio>('/api/trazabilidad', data);
    },
  };

  /**
   * MÓDULO 7: CLOUD SQL (POSTGRESQL) GESTIÓN Y DIAGNÓSTICO
   */
  public cloudSql = {
    getStatus: async (): Promise<ApiResponse<any>> => {
      return this.get(`/api/admin/cloudsql/status?_t=${Date.now()}`);
    },

    syncNow: async (): Promise<ApiResponse<any>> => {
      return this.post('/api/admin/cloudsql/sync-now');
    },

    restoreToLocal: async (): Promise<ApiResponse<any>> => {
      return this.post('/api/admin/cloudsql/restore-to-local');
    },

    migrateFromJson: async (): Promise<ApiResponse<any>> => {
      return this.post('/api/admin/cloudsql/migrate-from-json');
    },
  };

  /**
   * MÓDULO 8: AUTENTICACIÓN CENTRALIZADA
   */
  public auth = {
    login: async (cedula: string): Promise<ApiResponse<UserSession>> => {
      return this.post<UserSession>('/api/auth/login', { cedula });
    },

    verifyToken: async (): Promise<ApiResponse<any>> => {
      return this.get('/api/auth/verify');
    },

    logout: async (): Promise<ApiResponse<void>> => {
      return this.post<void>('/api/auth/logout');
    },
  };

  /**
   * MÓDULO 9: GESTIÓN DE FOTOGRAFÍAS Y ALMACENAMIENTO PERSISTENTE
   */
  public fotos = {
    getUrl: (cedula: string, slotKey: string): string => {
      return `/api/photos/${encodeURIComponent(cedula.trim())}/${encodeURIComponent(slotKey.trim())}`;
    },

    uploadBase64: async (photoType: string, photoBase64: string): Promise<ApiResponse<any>> => {
      return this.post('/api/expendio/upload-photo-base64', { photoType, photoBase64 });
    },

    uploadFile: async (photoType: string, file: File): Promise<ApiResponse<any>> => {
      const formData = new FormData();
      formData.append('photo', file);
      formData.append('photoType', photoType);

      const headers = new Headers();
      const token =
        (typeof window !== 'undefined' &&
          (sessionStorage.getItem('camarca_token') || localStorage.getItem('camarca_token'))) ||
        '';
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
        headers.set('x-session-token', token);
      }

      try {
        const response = await fetch('/api/expendio/upload-photo', {
          method: 'POST',
          headers,
          body: formData,
        });
        return await response.json();
      } catch (err: any) {
        return { success: false, error: 'UPLOAD_FAILED', message: err.message };
      }
    },
  };

  /**
   * MÓDULO 10: DOCUMENTOS Y CUENTAS CARGADAS
   */
  public documentos = {
    list: async (): Promise<ApiResponse<any[]>> => {
      return this.get<any[]>('/api/admin/cuentas-cargadas');
    },

    updateEstado: async (id: string, estado: string, observaciones?: string): Promise<ApiResponse<any>> => {
      return this.put(`/api/admin/cuentas-cargadas/${encodeURIComponent(id)}/estado`, { estado, observaciones });
    },
  };

  /**
   * MÓDULO 11: VISITAS Y NOVEDADES
   */
  public visitas = {
    list: async (): Promise<ApiResponse<any[]>> => {
      return this.get<any[]>('/api/visitas');
    },

    create: async (data: any): Promise<ApiResponse<any>> => {
      return this.post('/api/visitas', data);
    },
  };

  /**
   * MÓDULO 12: PARÁMETROS GLOBALES Y CONFIGURACIÓN DEL SISTEMA
   */
  public config = {
    get: async (): Promise<ApiResponse<any>> => {
      return this.get('/api/admin/config');
    },

    save: async (configData: any): Promise<ApiResponse<any>> => {
      return this.post('/api/admin/config', configData);
    },

    updatePeriodo: async (periodo: string, habilitada: boolean): Promise<ApiResponse<any>> => {
      return this.post('/api/admin/config/periodo-descarga', {
        periodoHabilitadoDescarga: periodo,
        descargaHabilitada: habilitada,
      });
    },
  };
}

// Instancia singleton para uso en toda la aplicación frontend
export const dbClient = new DbClient();
export default dbClient;
