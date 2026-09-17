import React, { useState } from 'react';
import { HardDrive, PlayCircle, DownloadCloud } from 'lucide-react';
import { getAccessToken, googleSignIn } from '../lib/googleAuth';
import { executeGoogleDriveBackup, listBackupFiles, getOrCreateBackupFolder } from '../lib/googleDriveService';
import { DatabaseBackup } from 'lucide-react';
import { manualDriveBackup, manualDriveRestore } from '../lib/driveSync';

export const GoogleDriveAutoBackupCard: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [feedback, setFeedback] = useState<{type: string, msg: string} | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [driveSnapshots, setDriveSnapshots] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  
  const handleListSnapshots = async () => {
    setLoadingList(true);
    setShowSnapshots(true);
    try {
      let token = await getAccessToken();
      if (!token) {
        const result = await googleSignIn();
        if (!result || !result.accessToken) throw new Error('No se pudo autenticar');
        token = result.accessToken;
      }
      const folder = await getOrCreateBackupFolder(token);
      const files = await listBackupFiles(token, folder.id);
      setDriveSnapshots(files);
    } catch (e: any) {
      setFeedback({ type: 'error', msg: 'Error al listar: ' + e.message });
    } finally {
      setLoadingList(false);
    }
  };

  const handleRestoreDatabase = async (fileId: string) => {
    if (!window.confirm('¿Estás seguro de que deseas sobreescribir TODA la base de datos con esta copia de seguridad?')) return;
    
    setRestoring(true);
    setFeedback({ type: 'info', msg: 'Descargando Snapshot desde Google Drive y aplicando...' });
    try {
      let token = await getAccessToken();
      if (!token) throw new Error('No token');
      
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Error al descargar');
      const blob = await res.blob();
      
      const formData = new FormData();
      formData.append('backupFile', blob, 'backup.json');
      formData.append('password', 'Camarca.2023*');
      
      const restoreRes = await fetch('/api/admin/database-import-file', {
        method: 'POST',
        body: formData
      });
      const data = await restoreRes.json();
      
      if (data.success) {
         setFeedback({ type: 'success', msg: 'Base de datos restaurada correctamente desde Drive. La página se recargará.' });
         setTimeout(() => window.location.reload(), 2000);
      } else {
         throw new Error(data.message || 'Error importando');
      }
    } catch (e: any) {
      setFeedback({ type: 'error', msg: 'Error: ' + e.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleManualBackup = async () => {
    setLoading(true);
    setFeedback({ type: 'info', msg: 'Generando copia de seguridad manual en Google Drive... Esto puede tardar varios minutos.' });
    try {
      let token = await getAccessToken();
      if (!token) {
        const result = await googleSignIn();
        if (!result || !result.accessToken) throw new Error('No se pudo autenticar con Google Drive');
        token = result.accessToken;
      }

      // 1. Respaldo de Base de Datos
      setFeedback({ type: 'info', msg: 'Respaldando base de datos (Snapshots) a Google Drive...' });
      const dbRes = await executeGoogleDriveBackup(token);
      
      // 2. Respaldo de Fotos
      setFeedback({ type: 'info', msg: 'Respaldando fotografías a Google Drive...' });
      const photoRes = await manualDriveBackup(token, (curr, tot, name) => {
        setFeedback({ type: 'info', msg: `Respaldando foto ${curr}/${tot}: ${name}` });
      });

      setFeedback({ type: 'success', msg: `¡Respaldo Exitoso! Base de datos guardada y ${photoRes.totalUploaded} fotos nuevas sincronizadas a Drive.` });
    } catch (e: any) {
      setFeedback({ type: 'error', msg: 'Error al respaldar en Drive: ' + e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRestorePhotos = async () => {
    setRestoring(true);
    setFeedback({ type: 'info', msg: 'Buscando y restaurando fotos desde Google Drive... Esto puede demorar bastante.' });
    try {
      let token = await getAccessToken();
      if (!token) {
        const result = await googleSignIn();
        if (!result || !result.accessToken) throw new Error('No se pudo autenticar con Google Drive');
        token = result.accessToken;
      }

      const res = await manualDriveRestore(token, (curr, tot, name) => {
        setFeedback({ type: 'info', msg: `Restaurando foto ${curr}/${tot}: ${name}` });
      });

      setFeedback({ type: 'success', msg: `¡Restauración Completa! Se recuperaron ${res.restoredCount} fotos desde Google Drive.` });
    } catch (e: any) {
      setFeedback({ type: 'error', msg: 'Error al restaurar fotos: ' + e.message });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
      <div className="flex items-center space-x-3 text-blue-400 mb-4">
        <HardDrive className="w-8 h-8" />
        <div>
          <h3 className="text-sm font-bold text-slate-100">Copia de Seguridad y Restauración (Google Drive)</h3>
          <p className="text-xs text-slate-400 mt-1">Exportar fotos y base de datos hacia Google Drive, o recuperar datos perdidos.</p>
        </div>
      </div>

      <p className="text-xs text-slate-300 leading-relaxed bg-slate-950 p-4 rounded-xl border border-slate-800 mb-6">
        El respaldo manual creará un Snapshot de tu base de datos y respaldará todas tus fotos en la carpeta <code>Fotos_Expendios</code> de Google Drive. También puedes Restaurar fotos desde Drive a Firebase Storage si se han perdido.
      </p>

      {feedback && (
        <div className={`p-3 rounded-xl border text-xs mb-4 ${
          feedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
          feedback.type === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
          'bg-blue-500/10 text-blue-400 border-blue-500/20'
        }`}>
          {feedback.msg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={handleManualBackup}
          disabled={loading || restoring}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm py-3 px-4 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
        >
          <PlayCircle className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Subiendo a Drive...' : 'Respaldar a Google Drive'}</span>
        </button>
        
        <button
          onClick={handleRestorePhotos}
          disabled={loading || restoring}
          className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm py-3 px-4 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
        >
          <DownloadCloud className={`w-5 h-5 ${restoring ? 'animate-bounce' : ''}`} />
          <span>{restoring ? 'Restaurando...' : 'Restaurar Fotos de Drive'}</span>
        </button>

        <button
          onClick={handleListSnapshots}
          disabled={loading || restoring}
          className="w-full md:col-span-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-sm py-3 px-4 rounded-xl flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
        >
          <DatabaseBackup className={`w-5 h-5 ${loadingList ? 'animate-spin' : ''}`} />
          <span>Restaurar Base de Datos desde Drive (Snapshots JSON)</span>
        </button>
      </div>

      {showSnapshots && (
        <div className="mt-6 border-t border-slate-700 pt-4">
           <h4 className="text-sm font-bold text-slate-200 mb-3">Snapshots Disponibles en Google Drive</h4>
           {loadingList ? (
              <div className="text-xs text-slate-400">Cargando...</div>
           ) : driveSnapshots.length === 0 ? (
              <div className="text-xs text-slate-400">No se encontraron respaldos.</div>
           ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
                {driveSnapshots.map(snap => (
                   <div key={snap.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
                     <div>
                       <div className="text-xs font-bold text-slate-300">{snap.name}</div>
                       <div className="text-[10px] text-slate-500">{(snap.size / 1024).toFixed(1)} KB - {new Date(snap.createdTime).toLocaleString()}</div>
                     </div>
                     <button onClick={() => handleRestoreDatabase(snap.id)} className="px-3 py-1 bg-emerald-600/20 text-emerald-400 text-xs rounded hover:bg-emerald-600/40">
                       Restaurar
                     </button>
                   </div>
                ))}
              </div>
           )}
        </div>
      )}

    </div>
  );
};
