import React, { useState, useEffect, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ref, list } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { CheckCircle2, AlertCircle, Loader2, RefreshCw } from 'lucide-react';

let cachedHealth: 'checking' | 'ok' | 'error' | null = null;
let cachedDetails: string = '';
let lastCheckTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

export const FirebaseHealthCheck: React.FC = () => {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>(cachedHealth || 'checking');
  const [details, setDetails] = useState<string>(cachedDetails);

  const runCheck = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && cachedHealth && (now - lastCheckTime < CACHE_TTL)) {
      setStatus(cachedHealth);
      setDetails(cachedDetails);
      return;
    }

    setStatus('checking');
    let firestoreOk = false;
    let storageOk = false;
    let errorMsgs = [];

    try {
      const res = await fetch('/api/system/firestore-status');
      const data = await res.json();
      
      if (res.ok && data.success) {
        if (data.quotaExhausted) {
           firestoreOk = false;
           errorMsgs.push('Cuota Excedida. Base local activa.');
        } else {
           firestoreOk = true;
           storageOk = true; // Servidor tiene admin auth
        }
      } else {
        errorMsgs.push('El servidor reporta error de conexión.');
      }
    } catch (err: any) {
      errorMsgs.push(`Error de red: ${err.message}`);
    }

    const finalStatus = (firestoreOk && storageOk) ? 'ok' : 'error';
    const finalDetails = finalStatus === 'ok'
      ? 'Conexión estable a Firestore y Storage.'
      : errorMsgs.join(' | ');

    cachedHealth = finalStatus;
    cachedDetails = finalDetails;
    lastCheckTime = Date.now();

    setStatus(finalStatus);
    setDetails(finalDetails);
  }, []);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  return (
    <div className="flex items-center gap-2 text-xs bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-full shadow-sm">
      {status === 'checking' && (
        <>
          <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
          <span className="text-slate-300 font-medium">Verificando Firebase...</span>
        </>
      )}
      {status === 'ok' && (
        <>
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400 font-medium">Firebase OK</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-red-400 font-medium max-w-[150px] truncate" title={details}>Firebase Error</span>
        </>
      )}
      
      <button 
        onClick={() => runCheck(true)}
        className="ml-1 p-1 hover:bg-slate-700 rounded-full transition-colors text-slate-400 hover:text-slate-200"
        title="Reintentar diagnóstico"
        disabled={status === 'checking'}
      >
        <RefreshCw className={`w-3 h-3 ${status === 'checking' ? 'opacity-50 animate-spin' : ''}`} />
      </button>
    </div>
  );
};
