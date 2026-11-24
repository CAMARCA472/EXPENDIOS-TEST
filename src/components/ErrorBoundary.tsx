import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, X, ShieldCheck } from 'lucide-react';
import { logCriticalClientException } from '../lib/clientErrorStorageDB';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  onClose?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Capturar la excepción crítica en IndexedDB con detalles técnicos completos
    logCriticalClientException({
      error,
      errorCode: 'REACT_RENDER_CRASH',
      errorName: error.name || 'ReactRenderCrash',
      technicalDetails: `Excepción crítica en renderizado de componente: ${error.message}\n${error.stack || ''}`,
      componentStack: errorInfo.componentStack || undefined,
      category: 'RENDER_CRASH',
      severity: 'CRITICO',
      source: 'react-boundary',
    }).catch(() => {});
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 shadow-xl max-w-xl mx-auto my-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-amber-400">
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/25 text-amber-400">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm tracking-tight text-white">
                  {this.props.fallbackTitle || 'Novedad temporal en este módulo'}
                </h3>
                <p className="text-xs text-slate-400">
                  El incidente fue registrado en la bitácora interna para soporte técnico.
                </p>
              </div>
            </div>
            {this.props.onClose && (
              <button
                type="button"
                onClick={this.props.onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Cerrar módulo"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800/80 text-xs text-slate-300 space-y-1.5">
            <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-[11px]">
              <ShieldCheck className="w-4 h-4" />
              <span>Tus datos y registros previos se encuentran seguros</span>
            </div>
            <p className="text-slate-400 leading-relaxed text-[11px]">
              Puedes reintentar la visualización o continuar utilizando las demás funciones del panel mientras el sistema restablece la vista.
            </p>
          </div>

          <div className="flex items-center space-x-3 pt-1">
            <button
              type="button"
              onClick={this.handleReset}
              className="flex-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center space-x-2 transition-all cursor-pointer shadow"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reintentar Carga</span>
            </button>
            {this.props.onClose && (
              <button
                type="button"
                onClick={this.props.onClose}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold py-2.5 px-4 rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cerrar Panel
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

