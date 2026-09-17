import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, collection, getDocs, QueryConstraint, query as firestoreQuery } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Caché global en memoria para evitar múltiples lecturas a Firestore
const globalCache = new Map<string, { data: any; timestamp: number }>();
const DEFAULT_TTL = 1000 * 60 * 5; // 5 minutos por defecto

export interface UseFirebaseDataOptions {
  ttl?: number;
  queryConstraints?: QueryConstraint[];
}

export function useFirebaseData<T = any>(
  path: string | null, // Si es null, no ejecuta la petición
  type: 'doc' | 'collection' = 'doc',
  options: UseFirebaseDataOptions = {}
) {
  const { ttl = DEFAULT_TTL, queryConstraints } = options;
  
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async (force: boolean = false) => {
    if (!path) {
      setLoading(false);
      return;
    }

    // El key de caché incluye la ruta y el tipo (se puede extender para constraints si es necesario)
    const cacheKey = `${type}:${path}`;
    const cached = globalCache.get(cacheKey);
    const now = Date.now();

    // Validar caché
    if (!force && cached && (now - cached.timestamp < ttl)) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let result: any = null;

      if (type === 'doc') {
        const docRef = doc(db, path);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          result = Object.assign({ id: docSnap.id }, docSnap.data());
        }
      } else if (type === 'collection') {
        const colRef = collection(db, path);
        
        let finalQuery: any = colRef;
        if (queryConstraints && queryConstraints.length > 0) {
          finalQuery = firestoreQuery.apply(null, [colRef, ...queryConstraints] as any);
        }
        
        const querySnapshot = await getDocs(finalQuery);
        result = querySnapshot.docs.map(d => Object.assign({ id: d.id }, d.data()));
      }

      // Guardar en caché
      globalCache.set(cacheKey, { data: result, timestamp: Date.now() });
      setData(result);
    } catch (err: any) {
      console.warn(`[useFirebaseData] Error fetching ${type} at ${path}:`, err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [path, type, ttl, queryConstraints]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const clearCache = useCallback(() => {
    if (path) {
      globalCache.delete(`${type}:${path}`);
    }
  }, [path, type]);

  return { 
    data, 
    loading, 
    error, 
    refetch: () => fetchData(true),
    clearCache
  };
}
